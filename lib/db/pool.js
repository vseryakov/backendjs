/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const Pool = require(__dirname + '/../pool');
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
 *   var pool = db.getPool("pg");
 *   pool.aquire((err, client) => {
 *     client.query("SELECT * from users", (err, rows) => {
 *        pool.release(client);
 *      });
 *   });
 * @class DbPool
 */

module.exports = class DbPool extends Pool {

    constructor(options, defaults)
    {
        const methods = {
            init: defaults?.init,
            shutdown: defaults?.shutdown,
        };
        if (lib.isPositive(options.max)) {
            methods.create = function(callback) {
                try {
                    this.open.call(this, callback);
                } catch (e) {
                    logger.error('pool.create:', this.name, this.type, this.url, e);
                    callback(e);
                }
            }
            methods.reset = function(client) {
                if (typeof client.reset == "function") client.reset();
            }
            methods.destroy = function(client, callback) {
                try {
                    this.close.call(this, client, callback);
                } catch (e) {
                    logger.error("pool.destroy:", this.name, this.type, this.url, e);
                    if (typeof callback == "function") callback(e);
                }
            }
        }
        super(methods);

        this.type = defaults?.type || options.type || "none";
        this.name = options.pool || defaults?.name || this.type;
        this.url = this.url || options.url || defaults?.url;
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
     */
    configure(options)
    {
        this.init(options);
        if (options.url) this.url = options.url;
        lib.objExtend(this.configOptions, options.configOptions, { deep: 1 });
        lib.objExtend(this.connectOptions, options.connectOptions, { deep: 1 });
        logger.debug("configure:", this.name, this.type, this.url, "opts:", options);
    }

    /**
     * Close the database connection and cleanup
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
     */
    open(callback)
    {
        if (typeof cb == "function") callback(null, {});
    }

    /**
     * Close a connection, default is do nothing
     */
    close(client, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Query the database, always return an array as a result (i.e. the second argument for the callback)
     */
    query(client, req, callback)
    {
        if (typeof callback == "function") callback(null, []);
    }

    /**
     * Return true if given table exists, to be used in createTables
     */
    exists(table)
    {
        return !!this.dbcolumns[table];
    }

    /**
     * Cache columns for all tables
     */
    cacheColumns(options, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Cache indexes for all tables
     */
    cacheIndexes(options, callback)
    {
        if (typeof callback == "function") callback();
    }

    /**
     * Return next token from the client object
     */
    nextToken(client, req, rows)
    {
        return client.next_token || null;
    }

    /**
     * Update the options with pool config parameters if needed, the options is from the request
     */
    prepareOptions(options)
    {
    }

    /**
     * Perform pool specific actions for prepared query before passing it to the op specific columns filterting
     */
    prepareQuery(req)
    {
    }

    /**
     * Pool specific actions after {@link module:db.prepare}
     */
    prepare(req)
    {
    }

    /**
    * Return the value to be used in binding, mostly for SQL drivers, on input value and col info are passed, this callback
    * may convert the value into something different depending on the DB driver requirements, like timestamp as string into milliseconds
    */
    bindValue(req, name, value, op)
    {
        return value;
    }

    /**
     * Converts native DB driver error into other human readable format
     */
    convertError(table, op, err, options)
    {
        return err;
    }

}

