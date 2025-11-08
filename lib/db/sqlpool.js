/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');

// Translation map for similar operators from different database drivers, merge with the basic SQL mapping
db.sqlConfigOptions = {
    sql: true,
    schema: [],
    noObjectTypes: 1,
    noListOps: 1,
    noListTypes: 1,
    noCustomColumns: 1,
    initCounters: 1,
    maxIndexes: 20,
    cacheColumns: 1,
    sqlPlaceholder: "$",
    typesMap: {
        real: "numeric", number: "numeric", bigint: "bigint", smallint: "smallint", int: "bigint",
        now: "bigint", mtime: "bigint", ttl: "bigint", random: "bigint", counter: "bigint",
        obj: "json", array: "json", object: "json", bool: "boolean",
    },
    opsMap: {
        begins_with: 'like%', ne: "<>", eq: '=', le: '<=', lt: '<', ge: '>=', gt: '>'
    },
    keywords: [
        'ABORT','ACTION','ADD','AFTER','ALL','ALTER','ANALYZE','AND','AS','ASC','ATTACH','AUTOINCREMENT','BEFORE','BEGIN','BETWEEN',
        'BY','CASCADE','CASE','CAST','CHECK','COLLATE','COLUMN','COMMIT','CONFLICT','CONSTRAINT','CREATE','CROSS','CURRENT_DATE',
        'CURRENT_TIME','CURRENT_TIMESTAMP','DATABASE','DEFAULT','DEFERRABLE','DEFERRED','DELETE','DESC','DETACH','DISTINCT','DROP',
        'EACH','ELSE','END','ESCAPE','EXCEPT','EXCLUSIVE','EXISTS','EXPLAIN','FAIL','FOR','FOREIGN','FROM','FULL','GLOB','GROUP',
        'HAVING','IF','IGNORE','IMMEDIATE','IN','INDEX','INDEXED','INITIALLY','INNER','INSERT','INSTEAD','INTERSECT','INTO',
        'IS','ISNULL','JOIN','KEY','LEFT','LIKE','LIMIT','MATCH','NATURAL','NO','NOT','NOTNULL','NULL','OF','OFFSET','ON','OR',
        "ORDER","OUTER","PLAN","PRAGMA","PRIMARY","QUERY","RAISE","RECURSIVE","REFERENCES","REGEXP","REINDEX","RELEASE","RENAME",
        "REPLACE","RESTRICT","RIGHT","ROLLBACK","ROW","SAVEPOINT","SELECT","SET","TABLE","TEMP","TEMPORARY","THEN","TO","TRANSACTION",
        "TRIGGER","UNION","UNIQUE","UPDATE","USER","USING","VACUUM","VALUES","VIEW","VIRTUAL","WHEN","WHERE","WITH","WITHOUT",
    ],
};

/**
 * Create a database pool for SQL like databases, see {@link module:db.db.Pool db.Pool}
 * @param {object} options - an object defining the pool, the following properties define the pool:
 * @param {string} options.pool - pool name/type, if not specified the SQLite is used
 * @param {int} options.max - max number of clients to be allocated in the pool
 * @param {int} options.idle - after how many milliseconds an idle client will be destroyed
 * @param {object} defaults - an object with default pool methods for init and shutdown and other properties, see {@link Pool}
 * @memberof module:db
 * @class
 */
class SqlPool extends db.Pool {

    constructor(options, defaults)
    {
        // SQL databases cannot support unlimited connections, keep reasonable default to keep it from overloading
        if (!lib.isPositive(options.max)) options.max = 25;

        if (defaults) {
            defaults = lib.objMerge({ configOptions: db.sqlConfigOptions },
                { configOptions: defaults.configOptions, connectOptions: defaults.connectOptions },
                { deep: 1 });
        }

        super(options, defaults);
    }

    // Call column caching callback with our pool name
    cacheColumns(options, callback)
    {
        db.sqlCacheColumns(this, options, callback);
    }

    // Prepare for execution, return an object with formatted or transformed SQL query for the database driver of this pool
    prepare(req)
    {
        db.sqlPrepare(this, req);
    }

    // Execute a query in req.text
    query(client, req, options, callback)
    {
        db.sqlQuery(this, client, req, options, callback);
    }

    // Support for pagination, for SQL this is the OFFSET for the next request
    nextToken(client, req, rows)
    {
        return req.options?.count && rows.length == req.options.count ? lib.toNumber(req.options.start) + lib.toNumber(req.options.count) : null;
    }

    updateAll(table, query, obj, options, callback)
    {
        var req = db.prepare("update", table, query, obj, lib.objExtend(options, { keys: Object.keys(obj) }));
        db.query(req, req.options, callback);
    }

    delAll(table, query, options, callback)
    {
        var req = db.prepare("del", table, query, lib.objExtend(options, { keys: Object.keys(query) }));
        db.query(req, req.options, callback);
    }

    updateOps(req, op, name, value, placeholder)
    {
        switch (op) {
        case "not_exists":
            // Update only if the value is null, otherwise skip
            return `${name}=COALESCE(${name},${placeholder})`;

        case "incr":
            // Increment a number
            return `${name}=COALESCE(${name},0)+${placeholder}`;

        case "append":
            // Append to a value
            return `${name}=COALESCE(${name},'')||${placeholder}`;

        case "unset":
        case "remove":
            return name + "=NULL";

        default:
            return name + "=" + placeholder;
        }
    }

}

db.SqlPool = SqlPool;
