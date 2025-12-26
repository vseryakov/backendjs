/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const metrics = require(__dirname + "/../metrics");

/**
 * Create a new database pool with default methods and properties
 * @param {object} options - an object with default pool properties, see {@link Pool}
 * @param {string} options.type - pool type, this is the db driver name
 * @param {string} options.pool - actual pool name, overrides defaults.name because it is the driver module with generic name
 * @param {int} options.min - min number of open database connections
 * @param {int} options.max - max number of open database connections, all attempts to run more will result in clients waiting for the next available db connection, if set to 0 no
 *            pooling will be enabled and will result in the unlimited connections, this is default for DynamoDB
 * @param {int} options.max_queue - how many db requests can be in the waiting queue, above that all requests will be denied instead of putting in the waiting queue
 * @param {object} defaults - an object with default pool methods for init and shutdown and other properties
 *
 * The db methods cover most use cases but in case native driver needs to be used this is how to get the client and use it with its native API,
 * it is required to call `pool.release` at the end to return the connection back to the connection pool.
 *
 * @example
 * var pool = db.getPool("pg");
 * pool.use((err, client) => {
 *    client.query("SELECT * from users", (err, rows) => {
 *       pool.release(client);
 *    });
 * });
 *
 * // Or async version
 *
 * const { client } = await pool.ause((err);
 * const { err, rows, info } = await client.aquery("SELECT * from users");
 * pool.release(client);
 *
 */

class DbPool extends lib.Pool {

    constructor(options, defaults)
    {
        const methods = {
            init: defaults?.init,
            shutdown: defaults?.shutdown,
        };
        if (lib.isPositive(options?.max)) {
            methods.create = (callback) => {
                this.openDb(callback);
            }
            methods.destroy = (client, callback) => {
                this.closeDb(client, callback);
            }
            methods.reset = (client) => {
                if (typeof client.reset == "function") client.reset();
            }
        }
        super(methods);

        this.type = defaults?.type || options?.type || "none";
        this.name = options?.pool || defaults?.name || this.type;
        this.url = this.url || options?.url || defaults?.url;
        this.configOptions = lib.objExtend({}, defaults?.configOptions, { deep: 1 });
        this.connectOptions = lib.objExtend({}, defaults?.connectOptions, { deep: 1 });
        this.dbcolumns = {};
        this.dbkeys = {};
        this.dbindexes = {};
        this.dbcapacity = {};
        this.metrics = {
            running: 0,
            err_count: 0,
            retry_count: 0,
            miss_count: 0,
            hit_count: 0,
            req: new metrics.Timer(),
            que: new metrics.Histogram(),
            cache: new metrics.Histogram(),
            tables: {},
        };

        this.configure(options);
    }

    /**
     * Reconfigure properties, only subset of properties are allowed here so it is safe to apply all of them directly,
     * this is called during realtime config update
     * @param {object} [options]
     */
    configure(options)
    {
        this.init(options);
        if (options?.url) this.url = options.url;
        lib.objExtend(this.configOptions, options?.configOptions, { deep: 1 });
        lib.objExtend(this.connectOptions, options?.connectOptions, { deep: 1 });
        logger.debug("configure:", this.name, this.type, this.url, "opts:", options);
    }

    /**
     * Close the database connection and cleanup
     * @param {object} [options]
     * @param {function} [callback]
     */
    shutdown(options, callback)
    {
        logger.debug("shutdown:", this.name, this.type, this.url);
        super.shutdown(options, () => {
            this.metrics.req.end();
            for (const p in this.metrics.tables) {
                this.metrics.tables[p].read.end();
                this.metrics.tables[p].write.end();
            }
            this.metrics = {};
            this.dbcolumns = this.dbkeys = this.dbindexes = {};
            this.configOptions = this.connectOptions = {};
            if (typeof callback == "function") callback();
        });
    }

    /**
     * Open a connection to the database, default is to return an empty object as a client
     * @param {function} [callback]
     */
    openDb(callback)
    {
        if (typeof cb == "function") callback(null, {});
    }

    /**
     * Close a connection, default is do nothing
     * @param {object} client
     * @param {function} [callback]
     */
    closeDb(client, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Query the database, always return an array as a result (i.e. the second argument for the callback)
     * @param {object} client
     * @param {DbRequest} req
     * @param {function} [callback]
     */
    query(client, req, callback)
    {
        if (typeof callback == "function") callback(null, []);
    }

    /**
     * Async version of query, returns an object { err, rows, info }
     * @param {object} client
     * @param {DbRequest} req
     */
    async aquery(client, req)
    {
        return new Promise((resolve, reject) => {
            this.query(client, req, (err, rows, info) => {
                resolve({ err, rows, info });
            });
        })
    }

    /**
     * Return true if given table exists, to be used in createTables
     * @param {string} table
     * @return {boolean}
     */
    exists(table)
    {
        return !!this.dbcolumns[table];
    }

    /**
     * Cache columns for all tables
     * @param {object} client
     * @param {object} options
     * @param {function} [callback]
     */
    cacheColumns(client, options, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Cache indexes for all tables
     * @param {object} options
     * @param {function} [callback]
     */
    cacheIndexes(options, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Return next token from the client object
     * @param {object} client
     * @param {DbRequest} req
     * @param {object[]} rows
     */
    nextToken(client, req, rows)
    {
        return client.next_token || null;
    }

    /**
     * Update the options with pool config parameters if needed, the options is from the request
     * @param {object} options
     */
    prepareOptions(options)
    {
    }

    /**
     * Perform pool specific actions for prepared query before passing it to the op specific columns filterting
     * @param {DbRequest} req
     */
    prepareQuery(req)
    {
    }

    /**
     * Pool specific actions after {@link module:db.prepare}
     * @param {DbRequest} req
     */
    prepare(req)
    {
    }

    /**
     * Converts native DB driver error into other human readable format
     * @param {DbRequest} req
     * @param {object|Error} err
     * @return {object|Error}
     */
    convertError(req, err)
    {
        return err;
    }

}

module.exports = DbPool;
