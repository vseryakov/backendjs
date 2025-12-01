/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');

/**
 * Create a resource pool, `create` and `close` callbacks must be given which perform allocation and deallocation of the resources like db connections.
 *
 * @param {object} options - defines the following properties
 * @param {function} [options.create] - method to be called to return a new resource item, takes 1 argument, a callback as `function(err, item)`
 * @param {function} [options.destroy] - method to be called to destroy a resource item
 * @param {function} [options.reset] - method to be called just before releasing an item back to the resource pool, this is a chance to reset the item to the initial state
 * @param {function} [options.validate] - method to verify active resource item, return false if it needs to be destroyed
 * @param {function} [options.init] - method to cal on pool.init, it may be called multiple times
 * @param {function} [options.shutdown] - method to call on pool shutdown to clear other resources
 * @param {int} min - min number of active resource items
 * @param {int} max - max number of active resource items
 * @param {int} max_queue - how big the waiting queue can be, above this all requests will be rejected immediately
 * @param {int} timeout - number of milliseconds to wait for the next available resource item, cannot be 0
 * @param {int} idle - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
 *
 * If no create implementation callback is given then all operations are basically noop still calling the callbacks.
 *
 * @example
 * var pool = new Pool({
 *     min: 1,
 *     max: 5,
 *     create: function(cb) {
 *         someDb.connect((err) => { cb(err, this) }
 *     },
 *     destroy: function(client) {
 *         client.close() }
 *     })
 * });
 *
 * pool.use((err, client) => {
 *     ...
 *     pool.release(client);
 * });
 *
 * const { err, client } = await pool.ause();
 * if (!err) {
 *     ...
 *     pool.release(client);
 * }
 * @class Pool
 */
module.exports = class Pool {
    #min = 0
    #max = 10
    #max_queue = 100
    #timeout = 5000
    #idle = 300000
    #queue_count = 0
    #queue = {}
    #avail = []
    #mtime = []
    #busy = []
    #interval
    #time


    constructor(options)
    {
        this.init(options);
    }

    // Initialize pool properties, this can be run anytime even on the active pool to override some properties
    init(options)
    {
        if (!options) return;
        var idle = this.#idle;

        if (typeof options.min != "undefined") this.#min = lib.toNumber(options.min, { float: 0, flt: 0, min: 0 });
        if (typeof options.max != "undefined") this.#max = lib.toNumber(options.max, { float: 0, dflt: 10, min: 0, max: 9999 });
        if (typeof options.interval != "undefined") this.#max_queue = lib.toNumber(options.interval, { float: 0, dflt: 100, min: 0 });
        if (typeof options.timeout != "undefined") this.#timeout = lib.toNumber(options.timeout, { float: 0, dflt: 5000, min: 1 });
        if (typeof options.idle != "undefined") this.#idle = lib.toNumber(options.idle, { float: 0, dflt: 300000, min: 0 });

        if (typeof options.create == "function") this._create = options.create;
        if (typeof options.destroy == "function") this._destroy = options.destroy;
        if (typeof options.reset == "function") this._reset = options.reset;
        if (typeof options.validate == "function") this._validate = options.validate;

        if (typeof options.shutdown == "function") this._shutdown = options.shutdown;
        if (typeof options.init == "function") this._init = options.init;

        // Periodic housekeeping if interval is set
        if (this._create && this.#idle > 0 && (idle != this.#idle || !this.#interval)) {
            clearInterval(this.#interval);
            this.#interval = setInterval(this.#timer.bind(this), this.#idle/2);
            setImmediate(this.#timer.bind(this));
        }
        if (this.#idle == 0) clearInterval(this.#interval);

        this.#call("_init", options);
        return this;
    }

    /**
    * Return next available resource item, if not available immediately wait for defined amount of time before calling the
    * callback with an error. The callback second argument is active resource item.
    */
    use(callback)
    {
        if (typeof callback != "function") throw lib.newError("callback is required");
        if (!this._create) return callback(null, {});

        // We have idle items
        if (this.#avail.length) {
            this.#mtime.shift();
            var item = this.#avail.shift();
            this.#busy.push(item);
            return callback.call(this, null, item);
        }
        // Put into waiting queue
        if (this.#busy.length >= this.#max) {
            if (this.#queue_count >= this.#max_queue) return callback(lib.newError("no more resources"));

            this.#queue_count++;
            return lib.deferCallback(this.#queue, {}, function(m) {
                callback(m.item ? null : lib.newError("timeout waiting for the resource"), m.item);
            }, this.#timeout);
        }
        // New item
        this.#call("_create", (err, item) => {
            if (err) {
                logger.error("pool: acquire:", this.name, lib.traceError(err));
            } else {
                if (!item) item = {};
                this.#busy.push(item);
                logger.dev('pool: use', this.name, 'avail:', this.#avail.length, 'busy:', this.#busy.length);
            }
            callback(err, item);
        });
    }

    /**
     * Async version of use
     * @returns {object} as { err, client }
     */
    async ause()
    {
        return new Promise((resolve, reject) => {
            this.acquire((err, client) => {
                resolve({ err, client });
            })
        })
    }

    // Destroy the resource item calling the provided close callback
    destroy(item, callback)
    {
        if (!item) return;
        if (!this._create) return typeof callback == "function" && callback();

        logger.dev('pool: destroy', this.name, 'avail:', this.#avail.length, 'busy:', this.#busy.length);

        var idx = this.#busy.indexOf(item);
        if (idx > -1) {
            this.#call("_destroy", item, callback);
            this.#busy.splice(idx, 1);
            return;
        }
        idx = this.#avail.indexOf(item);
        if (idx > -1) {
            this.#call("_destroy", item, callback);
            this.#avail.splice(idx, 1);
            this.#mtime.splice(idx, 1);
            return;
        }
    }

    // Return the resource item back to the list of available resources.
    release(item)
    {
        if (!item) return;
        if (!this._create) return;

        var idx = this.#busy.indexOf(item);
        if (idx == -1) {
            logger.error('pool: release:', 'not known', item);
            return;
        }
        logger.dev('pool: release', this.name, 'avail:', this.#avail.length, 'busy:', this.#busy.length, 'max:', this.#max);

        // Pass it to the next waiting item
        for (const id in this.#queue) {
            this.#queue_count--;
            this.#queue[id].item = item;
            return lib.runCallback(this.#queue, this.#queue[id]);
        }

        // Destroy if above the limit or invalid
        if (this.#avail.length > this.#max || this.#call("_validate", item) === false) {
            this.#call("_destroy", item);
        } else {
            // Add to the available list
            this.#avail.unshift(item);
            this.#mtime.unshift(Date.now());
            this.#call("_reset", item);
        }
        // Remove from the busy list at the end to keep the object referenced all the time
        this.#busy.splice(idx, 1);
    }

    // Close all active items
    destroyAll()
    {
        while (this.#avail.length > 0) this.destroy(this.#avail[0]);
    }

    // Return an object with stats
    stats()
    {
        return {
            avail: this.#avail.length,
            busy: this.#busy.length,
            queue: this.#queue_count,
            min: this.#min,
            max: this.#max,
            max_queue: this.#max_queue,
            idle: this.#idle,
        };
    }

    /**
    * Close all connections and shutdown the pool, no more items will be open and the pool cannot be used without re-initialization,
    * if callback is provided then wait until all items are released and call it, `options.timeout` can be used to retsrict how long to wait for
    * all items to be released, when expired the callback will be called
    */
    shutdown(options, callback)
    {
        logger.debug('pool.shutdown:', this.name, 'avail:', this.#avail.length, 'busy:', this.#busy.length);
        this.#max = -1;
        this.destroyAll();
        this.#queue = {};
        clearInterval(this.#interval);
        this.#interval = null;
        this.#call("_shutdown");
        if (typeof callback != "function") return;
        this.#time = Date.now();
        const timer = setInterval(() => {
            if (this.#busy.length && (!options?.timeout || Date.now() - this.#time < options?.timeout)) return;
            clearInterval(timer);
            callback();
        }, 50);
    }

    // Call registered method and catch exceptions, pass it to the callback if given
    #call(name, callback)
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
    #timer()
    {
        var now = Date.now();

        // Expire idle items
        if (this.#idle > 0) {
            for (let i = 0; i < this.#avail.length; i++) {
                if (now - this.#mtime[i] > this.#idle && this.#avail.length + this.#busy.length > this.#min) {
                    logger.dev('pool: timer:', this.name, 'idle', i, 'avail:', this.#avail.length, 'busy:', this.#busy.length);
                    this.destroy(this.#avail[i]);
                    i--;
                }
            }
        }

        // Ensure min number of items
        var min = this.#min - this.#avail.length - this.#busy.length;
        for (let i = 0; i < min; i++) {
            this.#call("_create", (err, item) => {
                if (err) return;
                this.#avail.push(item);
                this.#mtime.push(now);
            });
        }
    }

}

