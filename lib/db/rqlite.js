/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const SqlPool = require(__dirname + '/sqlpool');
const SqlitePool = require(__dirname + '/sqlite');

const defaults = {
    name: "rqlite",
    type: "rqlite",
    configOptions: {
        typesMap: { bool: "int" },
        noLengths: 1,
        upsert: 1,
        replace: 1,
        bulkSize: 100,
    },
};

class RqliteClient {

    constructor(url) {
        this.url = url;
    }

    query(req, callback) {
        if (typeof req == "string") req = { text: req };
        logger.dev("rqliteQuery:", req.text, req.values);

        var opts = {
            url: `${this.url}/db/${req.options?.queue ? "execute" : "request"}`,
            method: "POST",
            query: { associative: 1 },
            postdata: Array.isArray(req.text) ? req.text : lib.isArray(req.values) ? [req.text, ...req.values] : [req.text],
        };

        lib.fetch(opts, (err, rc) => {
            const result = rc.obj?.results?.[0];
            const info = {
                affected_rows: result?.rows_affected,
                last_rowid: result?.last_insert_id,
                results: rc.obj?.results
            };
            if (!err && rc.status >= 400) {
                err = { status: rc.status, message: rc.data };
            }
            if (!err && result?.error && info.results?.length == 1) {
                err = { status: 400, message: result.error };
            }
            callback(err, result?.rows, info);
        });
    }
}

module.exports = class RqlitePool extends SqlPool {

    constructor(options)
    {
        super(options, defaults);
        if (this.url == "default") this.url = "http://127.0.0.1:4001";
    }

    openDb(callback)
    {
        callback(null, new RqliteClient(this.url));
    }

    closeDb(client, callback)
    {
        lib.tryCall(callback);
    }

    cacheColumns(client, options, callback)
    {
        SqlitePool.sqliteCacheColumns.call(this, client, options, callback);
    }

    // queryBulk(client, req, callback)
    // {
    // }

    // queryTransact(client, req, callback)
    // {
    // }
}

