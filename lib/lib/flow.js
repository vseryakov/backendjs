/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

function _call(direct, callback, args)
{
    if (!Array.isArray(args)) args = [args];
    if (direct) {
        callback.apply(null, args);
    } else {
        setImmediate.apply(null, [callback, ...args]);
    }
}

/**
 * Apply an iterator function to each item in an array in parallel. Execute a callback when all items
 * have been completed or immediately if there is an error provided.
 * @param {any[]} list
 * @param {function} iterator
 * @param {function} callback
 * @param {boolean} direct - controls how the final callback is called, if true it is called directly otherwisde via setImmediate
 * @example
 * lib.forEach([ 1, 2, 3 ], function (i, next) {
 *   console.log(i);
 *   next();
 * }, (err) => {
 *   console.log('done');
 * });
 * @memberof module:lib
 * @method forEach
 */
lib.forEach = function(list, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function itForEach(...args) {
            if (args[0]) {
                _call(direct, callback, args)
                callback = lib.noop;
                i = list.length + 1;
            } else
            if (--count == 0) {
                _call(direct, callback, args)
                callback = lib.noop;
            }
        });
    }
}

/**
 * Same as {@link module:lib.forEach} except that the iterator will be called for every item in the list, all errors will be ignored
 * @param {any[]} list
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @memberof module:lib
 * @method forEvery
 */
lib.forEvery = function(list, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (var i = 0; i < list.length; i++) {
        iterator(list[i], function itForEvery(...args) {
            if (--count == 0) {
                _call(direct, callback, args);
                callback = lib.noop;
            }
        });
    }
}

/**
 * Apply an iterator function to each item in an array serially. Execute a callback when all items
 * have been completed or immediately if there is is an error provided.
 * @param {any[]} list
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * lib.forEachSeries([ 1, 2, 3 ], function (i, next, data) {
 *    console.log(i, data);
 *    next(null, data);
 * }, (err, data) => {
 *    console.log('done', data);
 * });
 * @memberof module:lib
 * @method forEachSeries
 */
lib.forEachSeries = function(list, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, ...args) {
        if (i >= list.length) {
            return _call(direct, callback, [null, ...args]);
        }
        iterator.apply(null, [list[i], function itForEachSeries(...args) {
            if (args[0]) {
                _call(direct, callback, args);
                callback = lib.noop;
            } else {
                iterate.apply(null, [++i, ...args.slice(1)]);
            }
        }, ...args]);
    }
    iterate(0);
}

/**
 * Same as {@link module:lib.forEachSeries} except that the iterator will be called for every item in the list, all errors will be passed to the next
 * item with optional additional data argument.
 * @param {any[]} list
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * lib.forEverySeries([ 1, 2, 3 ], function (i, next, err, data) {
 *   console.log(i, err, data);
 *   next(err, i, data);
 * }, (err, data) => {
 *   console.log('done', err, data);
 * });
 * @memberof module:lib
 * @method forEverySeries
 */
lib.forEverySeries = function(list, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, ...args) {
        if (i >= list.length) {
            return _call(direct, callback, args);
        }
        iterator.apply(null, [list[i], function itForEverySeries(...args) {
            iterate.apply(null, [++i, ...args]);
        }, ...args]);
    }
    iterate(0);
}

/**
 * Apply an iterator function to each item in an array in parallel as many as specified in `limit` at a time. Execute a callback when all items
 * have been completed or immediately if there is is an error provided.
 * @param {any[]} list
 * @param {int} limit=1
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @memberof module:lib
 * @method forEachLimit
 */
lib.forEachLimit = function(list, limit, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length || typeof iterator != "function") return callback();
    limit = lib.toNumber(limit, { min: 1, float: 0 });
    var idx = 0, done = 0, running = 0;
    function iterate() {
        if (done >= list.length) {
            return _call(direct, callback);
        }
        while (running < limit && idx < list.length) {
            running++;
            iterator(list[idx++], function itForEachLimit(err) {
                running--;
                if (err) {
                    _call(direct, callback, [err]);
                    callback = lib.noop;
                    idx = done = list.length + 1;
                } else {
                    if (++done >= list.length) {
                        _call(direct, callback);
                        callback = lib.noop;
                    } else {
                        iterate();
                    }
                }
            });
        }
    }
    iterate();
}

/**
 * Same as {@link module:lib.forEachLimit} but does not stop on error, all items will be processed and errors will be collected in an array and
 * passed to the final callback
 * @param {any[]} list
 * @param {int} limit=1
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @memberof module:lib
 * @method forEveryLimit
 */
lib.forEveryLimit = function(list, limit, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!Array.isArray(list) || !list.length || typeof iterator != "function") return callback();
    limit = lib.toNumber(limit, { min: 1 });
    var idx = 0, done = 0, running = 0, errors;
    function iterate() {
        if (done >= list.length) {
            return _call(direct, callback, [errors]);
        }
        while (running < limit && idx < list.length) {
            running++;
            iterator(list[idx++], function itForEveryLimit(err) {
                running--;
                if (err) errors = lib.isArray(errors, []).concat(err);
                if (++done >= list.length) {
                    _call(direct, callback, [errors]);
                    callback = lib.noop;
                } else {
                    iterate();
                }
            });
        }
    }
    iterate();
}

/**
 * Apply an iterator function to each item returned by the `next(item, cb)` function until it returns `null` or the iterator returns an error in the callback,
 * the final callback will be called after all iterators are finished.
 *
 * If no item is available the `next()` should return empty value, it will be called again in `options.interval` ms if specified or
 * immediately in the next tick cycle.
 *
 * The max number of iterators to run at the same time is controlled by `options.max`, default is 1.
 *
 * The maximum time waiting for items can be specified by `options.timeout`, it is not an error condition, just another way to stop
 * processing if it takes too long because the `next()` function is a black box just returning items to process. Timeout will send null
 * to the queue and it will stop after all iterators are finished.
 * @param {object} options
 * @param {function} next
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * var list = [1, 2, "", "", 3, "", 4, "", "", "", null];
 * lib.forEachItem({ max: 2, interval: 1000, timeout: 30000 },
 *     function(next) {
 *         next(list.shift());
 *     },
 *     function(item, next) {
 *         console.log("item:", item);
 *     next();
 * }, (err) => {
 *    console.log("done", err);
 * });
 * @memberof module:lib
 * @method forEachItem
 */

lib.forEachItem = function(options, next, iterator, callback, direct)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!options || typeof next != "function" || typeof iterator != "function") return callback();

    function end() {
        clearTimeout(options.timer);
        delete options.timer;
        options.etime = Date.now();
        _call(direct, callback, [options.error]);
        callback = lib.noop;
    }
    function iterate() {
        if (!next) return;
        next((item) => {
            if (!next) return;
            if (!item && options.timeout > 0 && Date.now() - options.mtime > options.timeout) item = null;
            // End of queue
            if (item === null) {
                next = null;
                logger.dev("forEachItem:", "null:", next ? "next" : "", options.timer ? "timer" : "", options);
                if (!options.running) end();
                return;
            }
            // No item available, need to wait
            if (!item) {
                if (!options.timer) options.timer = setTimeout(() => {
                    delete options.timer;
                    logger.dev("forEachItem:", "timer:", next ? "next" : "", options.timer ? "timer" : "", options);
                    if (!next && !options.running) return end();
                    for (var i = options.running; i < options.max; i++) iterate();
                }, options.interval);
                return;
            }
            options.count++;
            options.running++;
            options.mtime = Date.now();
            iterator(item, (err) => {
                options.running--;
                if (err) next = null, options.error = err;
                logger.dev("forEachItem:", "after:", next ? "next" : "", options.timer ? "timer" : "", options);
                if (!next && !options.running) return end();
                for (var i = options.running; i < options.max; i++) iterate();
            });
        });
    }

    options.running = options.count = 0;
    options.stime = options.mtime = Date.now();
    options.timeout = lib.toNumber(options.timeout);
    options.interval = lib.toNumber(options.interval);
    options.max = lib.toNumber(options.max, { min: 1 });
    for (var i = 0; i < options.max; i++) iterate();
}

/**
 * Execute a list of functions in parallel and execute a callback upon completion or occurance of an error. Each function will be passed
 * a callback to signal completion. The callback accepts an error for the first argument. The iterator and callback will be
 * called via setImmediate function to allow the main loop to process I/O unless the `direct` argument is true
 * @param {function[]} tasks
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @memberof module:lib
 * @method parallel
 */
lib.parallel = function(tasks, callback, direct)
{
    this.forEach(tasks, function itEach(task, next) {
        task(function itTask(...args) {
            _call(direct, next, args);
        });
    }, callback, direct);
}

/**
 * Same as {@link module:lib.parallel} but all functions will be called and any error will be ignored
 * @param {function[]} tasks
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @memberof module:lib
 * @method everyParallel
 */
lib.everyParallel = function(tasks, callback, direct)
{
    this.forEvery(tasks, function itEach(task, next) {
        task(function itTask(err, ...args) {
            _call(direct, next, [null, ...args]);
        });
    }, callback, direct);
}

/**
 * Execute a list of functions serially and execute a callback upon completion or occurance of an error. Each function will be passed
 * a callback to signal completion. The callback accepts either an error for the first argument in which case the flow will be aborted
 * and the final callback will be called immediately or some optional data to be passed to thr next iterator function as a second argument.
 *
 * The iterator and callback will be called via setImmediate function to allow the main loop to process I/O unless the `direct` argument is true
 * @param {function[]} tasks
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * lib.series([
 *    function(next) {
 *        next(null, "data");
 *    },
 *    function(next, data) {
 *       setTimeout(function () { next(null, data); }, 100);
 *    },
 * ], (err, data) => {
 *    console.log(err, data);
 * });
 * @memberof module:lib
 * @method series
 */
lib.series = function(tasks, callback, direct)
{
    this.forEachSeries(tasks, function itEach(task, next, ...args) {
        task.apply(null, [function itTask(...args) {
            _call(direct, next, args);
        }, ...args]);
    }, callback, direct);
}

/**
 * Same as {@link module:lib.series} but all functions will be called with errors passed to the next task, only the last passed error will be returned
 * @param {function[]} tasks
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * lib.everySeries([
 *    function(next) {
 *       next("error1", "data1");
 *    },
 *    function(next, err, data) {
 *       setTimeout(function () { next(err, "data2"); }, 100);
 *    },
 * ], (err, data) => {
 *     console.log(err, data);
 * });
 * @memberof module:lib
 * @method everySeries
 */

lib.everySeries = function(tasks, callback, direct)
{
    this.forEverySeries(tasks, function itEach(task, next, ...args) {
        task.apply(null, [function itTask(...args) {
            _call(direct, next, args);
        }, ...args]);
    }, callback, direct);
}

/**
 * While the test function returns true keep running the iterator, call the callback at the end if specified.
 * All functions are called via setImmediate unless the `direct` argument is true
 * @param {function} test
 * @param {function} iterator
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * var count = 0;
 * lib.whilst(
 *    function(data) {
 *        return count < 5;
 *    },
 *    function (next, data) {
 *        count++;
 *        setTimeout(next, 1000);
 *    },
 *    function (err, data) {
 *        console.log(err, data, count);
 *     });
 * @memberof module:lib
 * @method whilst
 */
lib.whilst = function(test, iterator, callback, direct, _)
{
    callback = typeof callback == "function" ? callback : this.noop;
    if (!test(_)) return callback(null, _);
    iterator(function itWhilst(err, data) {
        if (err) return callback(err, data);
        _call(direct, lib.whilst, [test, iterator, callback, direct, data]);
    }, _);
};

/**
 * Keep running iterator while the test function returns true, call the callback at the end if specified.
 * All functions are called via setImmediate unless the `direct` argument is true
 * @param {function} iterator
 * @param {function} test
 * @param {function} [callback]
 * @param {boolean} [direct]
 * @example
 * var count = 0;
 * lib.doWhilst(
 *    (next, data) => {
 *        count++;
 *        setTimeout(next, 1000);
 *    },
 *    (data) => (count < 5),
 *    (err, data) => {
 *         console.log(err, data, count);
 *    });
 * @memberof module:lib
 * @method doWhilst
 */
lib.doWhilst = function(iterator, test, callback, direct, _)
{
    callback = typeof callback == "function" ? callback : this.noop;
    iterator(function itDoWhilst(err, data) {
        if (err) return callback(err, data);
        if (!test(data)) return callback(err, data);
        _call(direct, lib.doWhilst, [iterator, test, callback, direct, data]);
    }, _);
}
