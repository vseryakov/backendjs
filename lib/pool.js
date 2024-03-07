//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');

// Create a resource pool, `create` and `close` callbacks must be given which perform allocation and deallocation of the resources like db connections.
//
// Options defines the following properties:
// - create - method to be called to return a new resource item, takes 1 argument, a callback as `function(err, item)`
// - destroy - method to be called to destroy a resource item
// - reset - method to bec alled just before releasing an item back to the resource pool, this is a chance to reset the item to the initial state
// - validate - method to verify active resource item, return false if it needs to be destroyed
// - init - method to cal on pool.init, it may be called multiple times
// - shutdown - method to call on pool shutdown to clear other resources
// - min - min number of active resource items
// - max - max number of active resource items
// - max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
// - timeout - number of milliseconds to wait for the next available resource item, cannot be 0
// - idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
//
// If no create implementation callback is given then all operations are basically noop but still cals the callbacks.
//
// Example:
//        var pool = new Pool({ min: 1, max: 5,
//                                  create: function(cb) {
//                                     someDb.connect(function(err) { cb(err, this) }
//                                  },
//                                  destroy: function(client) {
//                                     client.close() }
//                                  })
//
//        pool.aquire(function(err, client) {
//           ...
//           client.findItem....
//           ...
//           pool.release(client);
//
//        });
//
function Pool(options)
{
    this._pool = {
        min: 0,
        max: 10,
        max_queue: 100,
        timeout: 5000,
        idle: 300000,
        queue_count: 0,
        queue: {},
        avail: [],
        mtime: [],
        busy: []
    };
    this.init(options);
}
module.exports = Pool;

// Initialize pool properties, this can be run anytime even on the active pool to override some properties
Pool.prototype.init = function(options)
{
    if (!options) return;
    var idle = this._pool.idle;

    if (typeof options.min != "undefined") this._pool.min = lib.toNumber(options.min, { float: 0, flt: 0, min: 0 });
    if (typeof options.max != "undefined") this._pool.max = lib.toNumber(options.max, { float: 0, dflt: 10, min: 0, max: 9999 });
    if (typeof options.interval != "undefined") this._pool.max_queue = lib.toNumber(options.interval, { float: 0, dflt: 100, min: 0 });
    if (typeof options.timeout != "undefined") this._pool.timeout = lib.toNumber(options.timeout, { float: 0, dflt: 5000, min: 1 });
    if (typeof options.idle != "undefined") this._pool.idle = lib.toNumber(options.idle, { float: 0, dflt: 300000, min: 0 });

    if (typeof options.create == "function") this._create = options.create;
    if (typeof options.destroy == "function") this._destroy = options.destroy;
    if (typeof options.reset == "function") this._reset = options.reset;
    if (typeof options.validate == "function") this._validate = options.validate;

    if (typeof options.shutdown == "function") this._shutdown = options.shutdown;
    if (typeof options.init == "function") this._init = options.init;

    // Periodic housekeeping if interval is set
    if (this._pool.idle > 0 && (idle != this._pool.idle || !this._pool.interval)) {
        clearInterval(this._pool.interval);
        this._pool.interval = setInterval(this._timer.bind(this), Math.max(30000, this._pool.idle/3));
        setImmediate(this._timer.bind(this));
    }
    if (this._pool.idle == 0) clearInterval(this._pool.interval);

    this._call("_init", options);
    return this;
}

// Return next available resource item, if not available immediately wait for defined amount of time before calling the
// callback with an error. The callback second argument is active resource item.
Pool.prototype.acquire = function(callback)
{
    if (typeof callback != "function") throw lib.newError("callback is required");
    if (!this._create) return callback(null, {});

    // We have idle items
    if (this._pool.avail.length) {
        this._pool.mtime.shift();
        var item = this._pool.avail.shift();
        this._pool.busy.push(item);
        return callback.call(this, null, item);
    }
    // Put into waiting queue
    if (this._pool.busy.length >= this._pool.max) {
        if (this._pool.queue_count >= this._pool.max_queue) return callback(lib.newError("no more resources"));

        this._pool.queue_count++;
        return lib.deferCallback(this._pool.queue, {}, function(m) {
            callback(m.item ? null : lib.newError("timeout waiting for the resource"), m.item);
        }, this._pool.timeout);
    }
    // New item
    this._call("_create", (err, item) => {
        if (err) {
            logger.error("pool: acquire:", this.name, lib.traceError(err));
        } else {
            if (!item) item = {};
            this._pool.busy.push(item);
            logger.dev('pool: acquire', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
        }
        callback(err, item);
    });
}

// Destroy the resource item calling the provided close callback
Pool.prototype.destroy = function(item, callback)
{
    if (!item) return;
    if (!this._create) return typeof callback == "function" && callback();

    logger.dev('pool: destroy', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);

    var idx = this._pool.busy.indexOf(item);
    if (idx > -1) {
        this._call("_destroy", item, callback);
        this._pool.busy.splice(idx, 1);
        return;
    }
    idx = this._pool.avail.indexOf(item);
    if (idx > -1) {
        this._call("_destroy", item, callback);
        this._pool.avail.splice(idx, 1);
        this._pool.mtime.splice(idx, 1);
        return;
    }
}

// Return the resource item back to the list of available resources.
Pool.prototype.release = function(item)
{
    if (!item) return;
    if (!this._create) return;

    var idx = this._pool.busy.indexOf(item);
    if (idx == -1) {
        logger.error('pool: release:', 'not known', item);
        return;
    }
    logger.dev('pool: release', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length, 'max:', this._pool.max);

    // Pass it to the next waiting item
    for (var id in this._pool.queue) {
        this._pool.queue_count--;
        this._pool.queue[id].item = item;
        return lib.runCallback(this._pool.queue, this._pool.queue[id]);
    }

    // Destroy if above the limit or invalid
    if (this._pool.avail.length > this._pool.max || this._call("_validate", item) === false) {
        this._call("_destroy", item);
    } else {
        // Add to the available list
        this._pool.avail.unshift(item);
        this._pool.mtime.unshift(Date.now());
        this._call("_reset", item);
    }
    // Remove from the busy list at the end to keep the object referenced all the time
    this._pool.busy.splice(idx, 1);
}

// Close all active items
Pool.prototype.destroyAll = function()
{
    while (this._pool.avail.length > 0) this.destroy(this._pool.avail[0]);
}

// Return an object with stats
Pool.prototype.stats = function()
{
    return { avail: this._pool.avail.length, busy: this._pool.busy.length, queue: this._pool.queue_count, min: this._pool.min, max: this._pool.max, max_queue: this._pool.max_queue };
}

// Close all connections and shutdown the pool, no more items will be open and the pool cannot be used without re-initialization,
// if callback is provided then wait until all items are released and call it, optional maxtime can be used to retsrict how long to wait for
// all items to be released, when expired the callback will be called
Pool.prototype.shutdown = function(callback, maxtime)
{
    logger.debug('pool.shutdown:', this.name, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
    this._pool.max = -1;
    this.destroyAll();
    this._pool.queue = {};
    clearInterval(this._pool.interval);
    delete this._pool.interval;
    this._call("_shutdown");
    if (typeof callback != "function") return;
    this._pool.time = Date.now();
    this._pool.interval = setInterval(() => {
        if (this._pool.busy.length && (!maxtime || Date.now() - self._pool.time < maxtime)) return;
        clearInterval(this._pool.interval);
        delete this._pool.interval;
        callback();
    }, 500);
}

// Call registered method and catch exceptions, pass it to the callback if given
Pool.prototype._call = function(name, callback)
{
    if (typeof this[name] != "function") {
        if (typeof callback == "function") return callback();
        return;
    }
    try {
        return this[name].call(this, callback);
    } catch (e) {
        logger.error('pool:', this.name, name, e);
        if (typeof callback == "function") callback(e);
    }
}

// Timer to ensure pool integrity
Pool.prototype._timer = function()
{
    var now = Date.now();

    // Expire idle items
    if (this._pool.idle > 0) {
        for (let i = 0; i < this._pool.avail.length; i++) {
            if (now - this._pool.mtime[i] > this._pool.idle && this._pool.avail.length + this._pool.busy.length > this._pool.min) {
                logger.dev('pool: timer:', this.name, 'idle', i, 'avail:', this._pool.avail.length, 'busy:', this._pool.busy.length);
                this.destroy(this._pool.avail[i]);
                i--;
            }
        }
    }

    // Ensure min number of items
    var min = this._pool.min - this._pool.avail.length - this._pool.busy.length;
    for (let i = 0; i < min; i++) {
        this._call("_create", (err, item) => {
            if (err) return;
            this._pool.avail.push(item);
            this._pool.mtime.push(now);
        });
    }
}

