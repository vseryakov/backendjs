//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
 
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const QueueClient = require(__dirname + "/client");

/**
 * Queue client using a database for persistence, this driver uses naive content
 * resolution method by SELECT first and then UPDATE received record with new status, this relies on
 * the database to atomically perform conditional UPDATE, if no record updated it is ignored and performs SELECT again.
 *
 * This is not supposed to be used in production but only for development without external tools like AWS, Redis.
 *
 * It supports the same behaviour as Redis/SQS clients regarding visibilityTimeout.
 *
 * @param {object} options
 * @param {int} [options.count] config property specifies how messages to process at the same time, default is 1.
 *
 * @param {int} [options.interval] config property defines in ms how often to check for new messages after processing a message, i.e. after a messages processed
 * it can poll immediately or after this amount of time, default is 3000 milliseconds.
 *
 * @param {int} [options.retryInterval] config property defines in ms how often to check for new messages after an error or no data, i.e. on empty
 * pool when no messages are processed it can poll immediately or after this amount of time, default is 5000 mulliseconds.
 *
 * @param {int} [options.visibilityTimeout] property specifies how long the messages being processed stay hidden, in milliseconds.
 *
 * @param {int} [options.timeout] property defines how long to wait for new messages, i.e. the long poll, in milliseconds
 *
 * @param {int} [options.startTime] property which is the time in the future when a message must be actually processed there,
 *  The scheduling is implemented using AWS `visibilityTimeout` feature, keep scheduled messages hidden until the actual time.
 *
 * @example
 *
 * queue-messages = db://?bk-pool=dynamodb
 * queue-store = db://?bk-pool=pg&bk-visibilityTimeout=300&bk-count=2
 *
 * @memberOf module:queue
 */

class DBClient extends QueueClient {

    tables = {
        bk_queue: {
            id: { type: "uuid", primary: 1 },
            name: { index: 1, },                               // queue name
            status: { index: 2, value: "new" },                // new, running, error
            job: { type: "obj" },                              // job definition object
            vtime: { type: "timeout" },                        // visible time
            ctime: { type: "now", readonly: 1 },               // create time
            mtime: { type: "now" },                            // last status update
        },
    }

    constructor(options) {
        super(options);
        this.name = "db";
        this.applyOptions();
        this.emit("ready");
        db.describeTables(this.tables);
    }

    close() {
        super.close();
        clearInterval(this._monitorTimer);
    }

    applyOptions(options) {
        super.applyOptions(options);
        this.options.timeout = lib.toNumber(this.options.timeout, { dflt: 20000, min: 0 });
        this.options.visibilityTimeout = lib.toNumber(this.options.visibilityTimeout, { min: 0 });
        if (this.options.visibilityTimeout < 1000) this.options.visibilityTimeout *= 1000;
        this.options.count = lib.toNumber(this.options.count, { dflt: 0, min: 1, max: 10 });
        this.options.interval = lib.toNumber(this.options.interval, { dflt: 3000, min: 0 });
        this.options.retryInterval = lib.toNumber(this.options.retryInterval, { dflt: 5000, min: 0 });
        this.options.maxTimeout = lib.toNumber(this.options.maxTimeout, { dflt: 3600000*6, min: 60000 });
    }

    _monitor(options) {
        const name = this.channel(options);
        var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        if (!visibilityTimeout) return;

        var opts = { pool: this.options.pool };
        var q = { name, status: "running", vtime_$lt: Date.now() };
        db.updateAll("bk_queue", q, { status: "new" }, opts);
    }

    monitor(options) {
        var visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        if (!this._monitorTimer && visibilityTimeout) {
            this._monitorTimer = setInterval(this._monitor.bind(this, options), visibilityTimeout);
            this._monitor(options);
        }
    }

    submit(job, options, callback) {
        const name = this.channel(options);
        const vtime = lib.validPositive(job.visibilityTimeout, options.visibilityTimeout, this.options.visibilityTimeout);
        db.add("bk_queue", { name, job, vtime }, { pool: this.options.pool }, callback);
    }

    async poll(options) {
        const visibilityTimeout = lib.validPositive(options.visibilityTimeout, this.options.visibilityTimeout);
        const name = this.channel(options);
        const pool = this.options.pool;

        const { data, err } = await db.aselect("bk_queue", { name, status: "new", vtime_$lt: Date.now() }, { count: this.options.count, pool });
        if (err) return this.schedule(options, this.options.retyInterval);

        var processed = 0;
        lib.forEvery(data, async (row, next) => {
            // If we failed to update it means some other worker just did it before us so we just ignore this message
            let vtime = lib.validPositive(row.visibilityTimeout, visibilityTimeout);
            const { err, info } = await db.aupdate("bk_queue", { id: row.id, status: "running", vtime }, { pool, query: { status: "new" } });
            if (err || !info.affected_rows) return next();

            var vtimer, done;
            var msg = row.job;

            // Check message timestamps if not ready yet then keep it hidden
            if (visibilityTimeout) {
                var now = Date.now();
                if (msg.endTime > 0 && msg.endTime < now) {
                    return db.del("bk_queue", { id: row.id }, { pool }, next);
                }
                if (msg.startTime > 0 && msg.startTime - now > this.options.interval) {
                    let vtime = msg.startTime - now;
                    if (vtime > this.options.maxTimeout) vtime = this.options.maxTimeout;
                    return db.update("bk_queue", { id: row.id, status: "new", vtime }, { pool }, next);
                }

                // Delete immediately, this is a one-off message not to be handled or repeated
                if (msg.noWait) {
                    db.del("bk_queue", { id: row.id }, { pool });
                } else

                // Delay deletion in case checks need to be done for uniqueness or something else
                if (msg.noWaitTimeout > 0) {
                    setTimeout(() => {
                        if (done) return;
                        msg.noWait = 1;
                        db.del("bk_queue", { id: row.id }, { pool });
                    }, msg.noWaitTimeout * 1000);
                }
            }

            // Keep updating timestamp to prevent the job being placed back to the active queue
            vtime = msg.visibilityTimeout > 0 ? msg.visibilityTimeout : visibilityTimeout;
            if (vtime && !msg.noWait) {
                Object.defineProperty(msg, "__msgid", { enumerable: false, value: row.id });
                if (msg.visibilityTimeout > 0) {
                    await db.aupdate("bk_queue", { id: row.id, status: "running", vtime }, { pool });
                }
                vtimer = setInterval(() => {
                    if (done) return;
                    db.update("bk_queue", { id: row.id, status: "running", vtime }, { pool }, (err) => {
                        if (err) clearInterval(vtimer);
                    })
                }, vtime * 0.8);
            }

            processed++;
            if (!this.emit(name, msg, async (err) => {
                if (done) return;
                done = 1;
                clearInterval(vtimer);

                // Retain the message only in case of known fatal errors, otherwise delete it after processing, any other error
                // is considered as undeliverable due to corruption or invalid message format...
                if (!msg.noVisibility && (err?.status >= 500 || msg.noWait)) {
                    vtime = lib.toNumber(msg.retryVisibilityTimeout && msg.retryVisibilityTimeout[err?.status]);
                    if (err && vtime > 0) {
                        return db.update("bk_queue", { id: row.id, status: "new", vtime }, { pool }, next);
                    }
                    return next();
                }
                db.del("bk_queue", { id: row.id }, { pool }, next);
            })) {
                done = 1;
                clearInterval(vtimer);
                next();
            }

        }, () => {
            this.schedule(options, processed ? this.options.interval : this.options.retryInterval);
        });
    }

    drop(msg, options, callback) {
        if (!msg.__msgid) return lib.tryCall(callback);
        db.del("bk_queue", { id: msg.__msgid }, { pool: this.options.pool }, callback);
    }
}

module.exports = DBClient;
