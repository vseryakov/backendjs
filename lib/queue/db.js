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
 * @example
 *
 * queue-messages = db://?bk-pool=dynamodb
 * queue-store = db://?bk-pool=pg&bk-visibilityTimeout=300&bk-queueCount=2
 *
 * @memberOf module:queue
 */

class DBQueueClient extends QueueClient {

    tables = {
        bk_queue: {
            id: { type: "uuid", primary: 1 },
            name: { index: 1, },                               // queue name
            data: { type: "obj" },                             // job definition object
            ctime: { type: "now", readonly: 1 },               // create time
            mtime: { type: "now" },                            // last update
            vtime: { type: "timeout" },                        // absolute visible time in the future
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
    }

    submit(job, options, callback) {
        logger.dev("submit:", this.url, job, options);
        const name = this.channel(options);
        const vtime = Date.now() + lib.validPositive(options.delay, this.options.delay);
        db.add("bk_queue", { name, data: job, vtime }, { pool: this.options.pool }, callback);
    }

    poll(options) {
        this._poll_run(options);
    }

    purge(options, callback) {
        const name = this.channel(options);
        db.delAll("bk_queue", { name }, { pool: this.options.pool }, callback);
    }

    _poll_get(options, callback) {
        const opts = {
            pool: this.options.pool,
            count: this.options.queueCount,
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
                    query: {
                        vtime: row.vtime
                    },
                    pool: this.options.poll,
                    logger_error: "debug"
                };
                const vtime = Date.now() + lib.validPositive(row.data?.visibilityTimeout, options.visibilityTimeout, this.options.visibilityTimeout, 10);
                // If failed to update it means some other worker just did it before us so we just ignore this message
                db.update("bk_queue", { id: row.id, vtime }, vopts, (err, _, info) => {
                    if (!err && info?.affected_rows) rc.push(row);
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
