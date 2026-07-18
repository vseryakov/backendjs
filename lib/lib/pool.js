/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Create a resource pool, `create` and `close` callbacks must be given which perform allocation and deallocation of the resources like db connections.
 *
 * @param {object} options - defines the following properties
 * @param {function(pool, callback)} [options.create] - method to be called to return a new resource item the callback is `function(err, item)`
 * @param {function(item)} [options.destroy] - method to be called to destroy a resource item
 * @param {function(item)} [options.reset] - method to be called just before releasing an item back to the resource pool, this is a chance to reset the item to the initial state
 * @param {function(item)} [options.validate] - method to verify active resource item, return false if it needs to be destroyed
 * @param {function} [options.init] - method to cal on pool.init, it may be called multiple times
 * @param {function} [options.shutdown] - method to call on pool shutdown to clear other resources
 * @param {int} [options.min] - min number of active resource items
 * @param {int} [options.max] - max number of active resource items
 * @param {int} [options.max_queue] - how big the waiting queue can be, above this all requests will be rejected immediately
 * @param {int} [options.timeout] - number of milliseconds to wait for the next available resource item, cannot be 0
 * @param {int} [options.idle] - number of milliseconds before starting to destroy all active resources above the minimum, 0 to disable.
 *
 * If no create implementation callback is given then all operations are basically noop still calling the callbacks.
 *
 * @example
 * var pool = new lib.Pool({
 *     min: 1,
 *     max: 5,
 *     create: (pool, cb) => {
 *         someDb.connect((err) => { cb(err, this) }
 *     },
 *     destroy: (item) => {
 *         item.close() }
 *     })
 * });
 *
 * pool.use((err, item) => {
 *     ...
 *     pool.release(item);
 * });
 *
 * const { err, item } = await pool.ause();
 * if (!err) {
 *     ...
 *     pool.release(item);
 * }
 * @class Pool
 */
lib.Pool = class Pool {
    #min = 0
    #max = 10
    #max_queue = 100
    #timeout = 5000
    #idle = 300000
    #queue = []
    #avail = []
    #busy = []
    #interval
    #id = 0


    constructor(options)
    {
        this.init(options);
    }

    // Initialize pool properties, this can be run anytime even on the active pool to override some properties
    init(options)
    {
        if (!options) return;
        const idle = this.#idle;

        if (typeof options.min !== "undefined") this.#min = lib.toNumber(options.min, { float: 0, dflt: 0, min: 0 });
        if (typeof options.max !== "undefined") this.#max = lib.toNumber(options.max, { float: 0, dflt: 10, min: 0, max: 9999 });
        if (typeof options.max_queue !== "undefined") this.#max_queue = lib.toNumber(options.max_queue, { float: 0, dflt: 100, min: 0 });
        if (typeof options.timeout !== "undefined") this.#timeout = lib.toNumber(options.timeout, { float: 0, dflt: 5000, min: 1 });
        if (typeof options.idle !== "undefined") this.#idle = lib.toNumber(options.idle, { float: 0, dflt: 300000, min: 0 });

        if (typeof options.create === "function") this._create = options.create;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.reset === "function") this._reset = options.reset;
        if (typeof options.validate === "function") this._validate = options.validate;

        if (typeof options.shutdown === "function") this._shutdown = options.shutdown;
        if (typeof options.init === "function") this._init = options.init;

        // Periodic housekeeping if interval is set
        if (this._create && this.#idle > 0 && (idle !== this.#idle || !this.#interval)) {
            clearInterval(this.#interval);
            this.#interval = setInterval(this.#timer.bind(this), this.#idle/2);
            setImmediate(this.#timer.bind(this));
        }
        if (this.#idle === 0) clearInterval(this.#interval);

        this.#call("_init", options);
        return this;
    }

    /**
    * Return next available resource item, if not available immediately wait for defined amount of time before calling the
    * callback with an error. The callback second argument is active resource item.
    */
    use(callback)
    {
        if (typeof callback !== "function") throw lib.newError("callback is required");
        if (!this._create) return callback(null, {});

        const now = Date.now();

        // We have idle items
        if (this.#avail.length) {
            const avail = this.#avail.shift();
            avail.now = now;
            this.#busy.push(avail);
            return callback(null, avail.item);
        }

        // Put into waiting queue
        if (this.#busy.length >= this.#max) {

            if (this.#queue.length >= this.#max_queue) {
                return callback(lib.newError("no more resources", 503));
            }

            const id = this.#id++;
            this.#queue.push({
                id,
                callback,
                now,
                timer: setTimeout(this.#onTimeout.bind(this), this.#timeout, callback, id)
            });
            return;
        }

        // New item
        this.#call("_create", this, (err, item) => {
            if (err) {
                this.logger('error', "use:", lib.traceError(err));
            } else {
                if (!item) item = {};
                this.#busy.push({ item, now });
                this.logger('dev', 'use:');
            }
            callback(err, item);
        });
    }

    /**
     * Async version of use
     * @returns {{ err:object, item:object }}
     */
    ause()
    {
        return new Promise((resolve, _reject) => {
            this.use((err, item) => {
                resolve({ err, item });
            })
        })
    }

    // Return the resource item back to the list of available resources.
    release(item)
    {
        if (!item) return;
        if (!this._create) return;

        const idx = this.#busy.findIndex(x => x.item === item);
        if (idx === -1) {
            this.logger('trace', 'release:', 'not known', item);
            return;
        }

        // Pass it to the next waiting item, still busy
        const waiting = this.#queue.shift();
        if (waiting) {
            clearTimeout(waiting.timer);

            if (this.#call("_validate", item) === false) {
                this.logger('dev', 'release:');

                this.#call("_reset", item);
                return waiting.callback(null, item);
            }
        }

        // Destroy if above the limit or invalid
        if (this.#avail.length >= this.#max || this.#call("_validate", item) === false) {
            this.#call("_destroy", item);
        } else {
            // Add to the available list
            this.#avail.unshift({ item, now: Date.now() });
            this.#call("_reset", item);
        }
        // Remove from the busy list at the end to keep the object referenced all the time
        this.#busy.splice(idx, 1);

        this.logger('dev', 'release:');
    }

    // Destroy the resource item calling the provided close callback
    destroy(item, callback)
    {
        if (!item) return;
        if (!this._create) {
            return typeof callback === "function" && callback();
        }

        let idx = this.#busy.findIndex(x => x.item === item);
        if (idx > -1) {
            this.#busy.splice(idx, 1);
            this.#call("_destroy", item, callback);
        } else {
            idx = this.#avail.findIndex(x => x.item === item);
            if (idx > -1) {
                this.#avail.splice(idx, 1);
                this.#call("_destroy", item, callback);
            }
        }

        this.logger('dev', 'destroy:', idx);
    }

    // Close all active items
    destroyAll()
    {
        while (this.#queue.length > 0) {
            const item = this.#queue.shift();
            clearTimeout(item.timer);
        }
        while (this.#avail.length > 0) {
            this.destroy(this.#avail[0].item);
        }
    }

    // Return an object with stats
    stats()
    {
        return {
            avail: this.#avail.length,
            busy: this.#busy.length,
            queue: this.#queue.length,
            min: this.#min,
            max: this.#max,
            max_queue: this.#max_queue,
            idle: this.#idle,
        };
    }

    logger(level, name, ...args)
    {
        logger.logger(level, name, 'pool', this.name, 'avail:', this.#avail.length, 'busy:', this.#busy.length, 'queue:', this.#queue.length, 'max:', this.#max, ...args);
    }

    /**
    * Close all connections and shutdown the pool, no more items will be open and the pool cannot be used without re-initialization,
    * if callback is provided then wait until all items are released and call it,
    * `options.timeout` can be used to restrict how long to wait for all items to be released, when expired the callback will be called
    */
    shutdown(options, callback)
    {
        this.logger('debug', 'shutdown:');

        this.#max = -1;
        clearInterval(this.#interval);
        this.#interval = null;
        this.destroyAll();
        this.#call("_shutdown");
        if (typeof callback !== "function") return;

        const timeout = Date.now() + lib.toNumber(options?.timeout, { dflt: 1000 });
        const timer = setInterval(() => {
            if (this.#busy.length && Date.now() < timeout) return;
            clearInterval(timer);
            callback();
        }, 50);
    }

    // Call registered method and catch exceptions, pass it to the callback if given
    #call(name, item, callback)
    {
        if (typeof this[name] !== "function") {
            if (typeof callback === "function") return callback();
            return;
        }
        try {
            return this[name].call(this, item, callback);
        } catch (e) {
            this.logger('error', 'call:', name, item, e);
            if (typeof callback === "function") callback(e);
        }
    }

    // Timer to ensure pool integrity
    #timer()
    {
        var now = Date.now();

        // Expire idle items
        if (this.#idle > 0) {
            for (let i = 0; i < this.#avail.length; i++) {
                if (now - this.#avail[i].now > this.#idle && this.#avail.length + this.#busy.length > this.#min) {
                    this.logger('dev', 'timer:', 'idle:', i);
                    this.destroy(this.#avail[i].item);
                    i--;
                }
            }
        }

        // Ensure min number of items
        const min = this.#min - this.#avail.length - this.#busy.length;
        for (let i = 0; i < min; i++) {
            this.#call("_create", this, (err, item) => {
                if (err) return;
                this.#avail.push({ item, now: Date.now() });
            });
        }
    }

    #onTimeout(callback, id)
    {
        const idx = this.#queue.findIndex(x => x.callback === callback && x.id === id);
        if (idx > -1) this.#queue.splice(idx, 1);

        callback(lib.newError("timeout waiting for the resource", 504))
    }

}

