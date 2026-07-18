/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const sqlPool = require(__dirname + '/sqlpool');

exports.defaults = {
    type: "pg",
};

class PgClient {
    constructor(client) {
        this.pg = client;
    }

    query(req, callback) {
        if (typeof req === "string") req = { text: req };
        logger.dev("pgClient:", req.text, req.values);

        this.pg.query(req.text, req.values, (err, result) => {
            callback(err, result?.rows || [], { affected_rows: result?.rowCount });
        });
    }
}

let _pg;

/**
 * PostgreSQL wire compatible pool based on the SqlPool, it does not have any PG specific config or types,
 * uses default SqlPool config. Can be used directly with databases like CockroachDB, DSQL, ....
 */
class PgPool extends sqlPool.Pool {

    constructor(options, defaults)
    {
        _pg = lib.tryRequire(__dirname + "/../../dist/pg");

        _pg?.types?.setTypeParser(_pg.types.builtins.INT8, (val) => {
            try {
                return val?.length > 15 ? BigInt(val) : Number.parseInt(val, 10);
            } catch (_e) {
                return val;
            }
        });

        super(options, lib.extend({}, exports.defaults, defaults));
    }

    openDb(callback)
    {
        if (!_pg) return callback({ status: 500, message: "service unavailable" });

        if (this.url === "default") {
            this.url = "postgresql://postgres@127.0.0.1/default";
        }
        const client = new _pg.Client(/:\/\//.test(this.url) ? { connectionString: this.url } : this.connect);
        client.connect((err) => {
            if (err) {
                logger.error('openDb:', this.name, err);
                callback(err);
            } else {
                logger.dev('openDb:', this.name);
                client.on('error', logger.error.bind(logger, this.name));
                client.on('notice', logger.log.bind(logger, this.name));
                client.on('notification', logger.info.bind(logger, this.name));
                callback(err, new PgClient(client));
            }
        });
    }

    closeDb(client, callback)
    {
        logger.debug('closeDb:', this.name);
        client.pg.end(callback);
    }

}

exports.Pool = PgPool;
