//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
 
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const QueueClient = require(__dirname + "/client");

/**
 * Queue client using a database for persistence, this driver uses naive content
 * resolution method by SELECT first and then UPDATE received record with new visibilityTimeout, this relies on
 * the database to atomically perform conditional UPDATE, if no record updated it is ignored and performs SELECT again.
 *
 * This is not supposed to be used in production but only for development without external tools like AWS, Redis.
 *
 * It supports the same behaviour as Redis/SQS clients regarding visibilityTimeout.
 *
 * ### To create bk_queue table run as:
 * ```
 * bksh -db-create-tables -queue-default db://
 * ```
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

class DBQueueClient extends QueueClient {

    tables = {
        bk_queue: {
            id: { type: "uuid", primary: 1 },
            name: { index: 1, },                               // queue name
            data: { type: "obj" },                             // job definition object
            vtime: { type: "timeout" },                        // absolute visible time in the future
            ctime: { type: "now", readonly: 1 },               // create time
            mtime: { type: "now" },                            // last update
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

    submit(job, options, callback) {
        logger.dev("submit:", this.url, job, options);
        const name = this.channel(options);
        const vtime = Date.now() + lib.validPositive(job.visibilityTimeout, options.visibilityTimeout, this.options.visibilityTimeout, 10);
        db.add("bk_queue", { name, data: job, vtime }, { pool: this.options.pool }, callback);
    }

    poll(options) {
        this._poll_run(options);
    }

    drop(msg, options, callback) {
        if (!msg.__itemId) return lib.tryCall(callback);
        db.del("bk_queue", { id: msg.__itemId }, { pool: this.options.pool }, callback);
    }

    _poll_get(options, callback) {
        const opts = {
            pool: this.options.pool,
            count: this.options.count,
        };
        const q = {
            name: this.channel(options),
            vtime_$lt: Date.now(),
            data_$not_null: "",
        }

        var rc = [];
        db.select("bk_queue", q, opts, (err, rows) => {
            if (err) return callback(err);

            lib.forEvery(rows, (row, next) => {
                const vopts = {
                    pool: this.options.poll,
                    query: { vtime: row.vtime },
                    logger_error: "debug"
                };
                const vtime = Date.now() + lib.validPositive(row.data?.visibilityTimeout, options.visibilityTimeout, this.options.visibilityTimeout, 10);
                // If failed to update it means some other worker just did it before us so we just ignore this message
                db.update("bk_queue", { id: row.id, vtime }, vopts, (err, _, info) => {
                    if (!err && info?.affected_rows) rows.push(row);
                    next();
                });
            }, (err) => {
                callback(err, rc);
            });
        });
    }

    _poll_update(options, item, visibilityTimeout, callback) {
        db.update("bk_queue", { id: item.id, vtime: Date.now() + visibilityTimeout }, { pool: this.options.pool }, callback);
    }

    _poll_del(options, item, callback) {
        db.del("bk_queue", { id: item.id }, { pool: this.options.pool }, callback);
    }

}

module.exports = DBQueueClient;
