/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const aws = require(__dirname + '/../aws');
const postgresPool = require(__dirname + '/postgres');

exports.defaults = {
    type: "rds",
};

class RdsDataClient {

    query(req, callback)
    {
        const opts = Object.assign({}, req.options, {
            sql: req.text,
            parameters: lib.isArray(req.values, lib.emptylist).map((value, i) => ({ name: "p" + (i + 1), value })),
            resourceArn: req.options.resourceArn || req.config.resourceArn,
            secretArn: req.options.secretArn || req.config.secretArn,
            database: req.options.database || req.pool.url,
            convertResult: true,
        });

        logger.dev("query:", "rds", req.text, opts.parameters);

        aws.rdsDataExecute(opts, (err, obj, rc) => {
            const info = { affected_rows: lib.toNumber(obj?.numberOfRecordsUpdated) };
            callback(err, lib.isArray(obj?.records, []), info);
        });
    }
}

/**
 * Create a database pool that uses AWS RDS Data API to execute SQL statements against an Aurora PostgreSQL cluster,
 * no direct database connections are used, only HTTPS requests via {@link module:aws.rdsDataExecute}.
 *
 * Configuration:
 *  - `db-rds-pool=DATABASE` - database name
 *  - `db-rds-pool-options-resourceArn=arn:aws:rds:...:cluster:...` - required, the Aurora cluster ARN
 *  - `db-rds-pool-options-secretArn=arn:aws:secretsmanager:...` - required, the secret with db credentials
 *
 * Multiple databases are supported via `req.options.database` property for every request.
 *
 * ```js
 * await db.aget("users", { id: "..", { pool:" rds", database: "users_backup" } });
 * ```
 */
class RdsDataPool extends postgresPool.Pool {

    constructor(options, defaults)
    {
        super(options, lib.extend({}, exports.defaults, defaults));
    }

    openDb(callback)
    {
        callback(null, new RdsDataClient());
    }

    placeholder(req, value)
    {
        req.values.push(toValue(value));
        return ":p" + req.values.length;
    }

    queryTransaction(client, req, callback)
    {
        const opts = {
            resourceArn: req.options.resourceArn || req.config.resourceArn,
            secretArn: req.options.secretArn || req.config.secretArn,
        };

        lib.everySeries([
            (next) => {
                aws.queryRdsData("BeginTransaction", opts, req.options, next);
            },

            (next, err, rc) => {
                if (err || !rc?.transactionId) {
                    return callback(err || { status: 400, message: "no transactionId" });
                }

                req.options.concurrency = 1;
                for (const item of req.query) {
                    item.options = Object.assign(item.options || {}, { transactionId: rc.transactionId });
                }

                super.queryBulk(client, req, (err, errors, info) => {

                    opts.transactionId = rc.transactionId;
                    aws.queryRdsData(err ? "RollbackTransaction" : "CommitTransaction", opts, req.options, (e) => {
                        callback(err || e, errors, info);
                    });
                });
            }
        ], callback, true);
    }

}
exports.Pool = RdsDataPool;

function toValue(value)
{
    if (value === null || value === undefined) return { value: { isNull: true } };

    switch (typeof value) {
    case "boolean":
        return { value: { booleanValue: value } };

    case "number":
        return Number.isInteger(value) ? { value: { longValue: value } } : { value: { doubleValue: value } };

    case "bigint":
        return value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER ?
        { longValue: Number(value) } : { stringValue: String(value) };

    case "object":
        return { stringValue: lib.stringify(value) };

    default:
        if (Buffer.isBuffer(value)) {
            return { value: { blobValue: value.toString("base64") } };
        }
        if (value instanceof Date) {
            return { value: { stringValue: value.toISOString() }, typeHint: "TIMESTAMP" };
        }
        if (Array.isArray(value)) {
            if (value.every((x) => (typeof x == "number"))) {
                return value.every((x) => (Number.isInteger(x))) ?
                { value: { arrayValue: { longValues: value } } } :
                { value: { arrayValue: { doubleValues: value } } };
            }
            return { value: { arrayValue: { stringValues: value.map(lib.toString) } } };
        }
        if (typeof v == "object") {
            return { value: { stringValue: lib.stringify(value) }, typeHint: "JSON" };
        }
        return { value: { stringValue: lib.toString(value) } };
    }
}
