/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Prepare a DB request object with required properties
 * @param {object} [options]
 * @param {string|DbPool} [options.pool]
 * @params {string} [options.op]
 * @param {string} [options.table]
 * @param {object} [options.query]
 * @param {string} [options.text]
 * @param {any[]} [options.values]
 * @param {DbRequestOptions} [options.options]
 * @param {DbRequestCallback} [options.callback]
 */
class DbRequest {
    #pool

    constructor(options) {

        this.#pool = db.getPool(options.pool?.name || lib.isString(options?.pool) || options.options?.pool);

        /**
         * DB operation, one of get, put, incr, update, select, ...
         * @member {string}
         */
        this.op = options.op

        /**
         * a DB table name
         * @member {string}
         */
        this.table = db.alias(options.table)

        /**
         * native DB query, SQL or etc...
         * @member {string}
         */
        this.text = options.text

        /**
         * values to be used for SQL binding
         * @member {any[]}
         */
        this.values = options.values

        /**
         * a query object
         * @member {object}
         */
        this.query = options.query || {}

        /**
         * an object with optional properties for the operation
         * @member {object|DbRequestOptions}
         */
        this.options = Object.assign({}, options?.options, { pool: this.#pool.name })

        /**
         * callback to call after finished
         * @member {DbResultCallback}
         */
        this.callback = lib.isFunc(options.options) || lib.isFunc(options.callback)

        /**
         * an object for custom columns
         * @member {object}
         */
        this.custom = {}

        /**
         * timestamp when this is created, ms
         * @member {int}
         */
        this.now = Date.now()

    }

    /**
     * DB pool reference
     * @member {DbPool}
     */
    get pool() {
        return this.#pool;
    }

    /**
     * link pool.configOptions for quick convenient access
     * @member {object}
     */
    get config() {
        return this.#pool.configOptions;
    }

    /**
     * All columns for the table
     * @member {DbTable}
     */
    get columns() {
        return db.getColumns(this.table)
    }

    /**
     * Return a column by name
     * @param {string} name
     * @return {DbTableColumn}
     */
    column(name) {
        return this.columns[name] || this.custom[name];
    }

    /**
     * List of primary key for the table
     * @member {string[]}
     */
    get keys() {
        return db.getKeys(this.table)
    }

}

db.Request = DbRequest;

/**
 * Prepare for execution for the given operation: add, del, put, update,...
 * Returns prepared object to be passed to the driver's .query method.
 * @param {object|DbRequest} options
 * @param {string|DbPool} [options.pool]
 * @params {string} [options.op]
 * @param {string} [options.table]
 * @param {object} [options.query]
 * @param {string} [options.text]
 * @param {any[]} [options.values]
 * @param {DbRequestOptions} [options.options]
 * @param {DbRequestCallback} [options.callback]
 * @returns {DbRequest} - a request object
 * @method prepare
 * @memberof module:db
 */
db.prepare = function(options)
{
    var req = new DbRequest(options);
    if (!req.options.nopreparequery) {
        db.prepareQuery(req);
    }
    req.pool.prepare(req);
    logger.logger(req.options.logger_db || "debug", "prepare:", req);
    return req;
}

/**
 * Preprocess a query object for a given operation, convert types, assign defaults...
 * @param {DbRequest} req
 * @memberof module:db
 * @method prepareQuery
 */
db.prepareQuery = function(req)
{
    // Keep an object in the format we support
    const type = lib.typeName(req.query);
    switch (type) {
    case "object":
    case "string":
    case "array":
        break;
    default:
        req.query = {};
    }

    /**
     * Pre-process input properties before sending it to the database, make a shallow copy of the
     * object to preserve the original properties in the parent
     */
    if (!req.options.noprocessrows) {
        switch (req.op) {
        case "create":
        case "upgrade":
            break;

        default:
            if (type != "string" && db.getProcessRows('pre', req.table, req.options)) {
                req.query = lib.objClone(req.query);
            }
            db.runProcessRows("pre", req.table, req, req.query);
        }
        // Always run the global hook, keep the original object
        db.runProcessRows("pre", "*", req, req.query);
    }

    switch (type) {
    case "object":
        for (const p in req.query) {
            if (!req.config.noCustomColumns && !req.columns[p]) {
                db.checkCustomColumn(req, p);
            }
        }
        break;

    case "string":
        // Native language in a string, pass as is
        return;
    }
    req.pool.prepareQuery(req);

    switch (req.op) {
    case "incr":
        prepareForIncr(req);

    case "add":
    case "put":
    case "update":
        prepareForUpdate(req);
        break;

    case "del":
    case "delall":
    case "updateall":
        prepareForSelect(req);
        break;

    case "search":
        if (req.config.searchable) break;

    case "get":
    case "select":
        if (type == "string") break;
        prepareForSelect(req);
        break;

    case "list":
        prepareForList(req);
        break;

    case "bulk":
        var list = [];
        for (const p in req.query) {
            const item = db.prepare(req.query[p]);
            delete item.error;
            list.push(item);
        }
        req.query = list;
        break;
    }
}

/**
 * Prepare a column for a retrieval operation, convert aliases, types and ops according to the request and pool mapping
 *
 * The op in the name after `_$_op` takes precedence over the options.ops
 *
 * NOTE: `op` is lowercase and all underscores are converted into spaces
 * @param {DbRequest} [req] - request object or null, it is not required to be strict DbRequest
 * @param {string} name - column name
 * @param {any} value - query or update value
 * @example
 * { name_$contains: "cat" } // means use the `contains` op for the column `name`
 * { $or: { id: 1, id_$: 2, id_$$: 3 } }  // means id=1 OR id=2 OR id=3
 *
 * @return {DbRequestColumn}
 * @memberOf module:db
 * @method prepareColumn
 */
db.prepareColumn = function(req, name, value)
{
    const alias = name;

    const [aname, aop] = db.parseNameOp(name, value);
    name = aname;

    const col = req?.column(name);

    let op = aop ||
             req?.options?.ops?.[name] ||
             (value === null && "null" || Array.isArray(value) && "in") ||
             col?.ops?.[req?.op] || "eq";

    op = (req?.config?.opsMap?.[op] || op).toLowerCase().replaceAll("_", " ");

    const type = req?.config?.typesMap?.[col?.type] || col?.type;
    const vtype = typeof value;

    // Type conversion, only strict cases
    switch (type) {
    case "bool":
    case "boolean":
        if (vtype == "number") value = lib.toBool(value); else
        if (vtype == "string" && value) value = lib.toBool(value);
        break;

    default:
        if (lib.rxDateType.test(col?.type)) {
            if (value) value = lib.toValue(value, type);
        } else
        if (lib.rxNumericType.test(col?.type)) {
            if (vtype == "string" && value) value = lib.toNumber(value);
        } else
        if (vtype == "number") {
            value = String(value);
        } else
        if (Array.isArray(value) && op && !lib.isFlag(db.arrayOps, op)) {
            if (value.length) value = String(value); else value = undefined;
        } else
        if (col?.primary && type) {
            value = lib.toValue(value, type, col);
        }
    }
    // Case conversion
    if (vtype == "string") {
        if (col?.convert?.trim) value = value.trim();
        if (col?.convert?.lower) value = value.toLowerCase();
        if (col?.convert?.upper) value = value.toUpperCase();
    }

    logger.dev("prepareColumn:", name, type, op, value, alias, !!col);

    return { name, type, op, value, join: req?.options?.joinOps?.[alias], alias, col };
}

function prepareForIncr(req)
{
    if (!lib.isObject(req.options.ops)) {
        req.options.ops = {};
    }
    for (const p in req.columns) {
        if (req.columns[p].type == "counter" && req.query[p] !== undefined) req.options.ops[p] = "incr";
    }
    for (const p in req.custom) {
        if (req.custom[p].type == "counter" && req.query[p] !== undefined) req.options.ops[p] = "incr";
    }
}

/*
 * Keep only columns from the table definition if we have it
 * Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
 * this is for those databases which are very sensitive on the types like DynamoDB.
 */
function prepareForUpdate(req)
{
    var o = {}, value, col, max, failed = [];
    var insert = req.op == "add" || req.op == "put";

    // Step 1: types

    for (let name in req.query) {
        value = req.query[name];

        // Extract explicit operator, takes precedence over existing in ops
        const [aname, aop] = db.parseNameOp(name, value);
        name = aname;
        if (aop) {
            if (!req.options.ops) req.options.ops = {};
            req.options.ops[name] = aop;
        }

        col = req.column(name);

        // Skip unsupported columns
        if (!name || name[0] == '_' || value === undefined) continue;

        // Allow nested fields if objects supported and the parent exists
        if (!col && !req.options?.no_columns) {
            if (req.config.noObjectTypes) continue;
            const dot = name.indexOf(".");
            if (dot == -1) continue;
            col = req.column(name.substr(0, dot));
            if (!col || !lib.rxObjectType.test(col.type)) continue;
        }
        if (lib.isFlag(req.options.skip_columns, name)) continue;

        // auto update ops
        if (!req.options.ops?.[name] && req.options.typesOps?.[col.type]) {
            if (!req.options.ops) req.options.ops = {};
            req.options.ops[name] = req.options.typesOps[col.type];
        }

        if (col) {
            // Convert into native data type
            if (value !== null) {
                // Handle json separately in sync with convertRows
                switch (col.type) {
                case "json":
                    if (typeof value != "string") {
                        value = lib.stringify(value);
                        if (value === "{}" || value === "[]") value = null;
                    }
                    break;

                case "counter":
                    if (value === 0 && req.options.ops?.[name] == "incr") continue;
                    break;

                case "array":
                    if (!Array.isArray(value)) continue;
                case "obj":
                case "object":
                    if (typeof value != "object") continue;
                    if (req.config.noObjectTypes && typeof value != "string") {
                        value = lib.stringify(value);
                        if (value === "{}" || value === "[]") value = null;
                    }
                    break;

                case "set":
                case "list":
                    if (req.config.noListTypes) {
                        value = Array.isArray(value) ? value.join(col.separator || ",") : typeof value == "string" ? value : String(value);
                        if (value === "[]" || value === "{}") value = null;
                        break;
                    }

                default:
                    // No point converting the value if update op is provided
                    if (req.options.ops?.[name]) break;
                    if ((col.primary && insert) || col.index || col.type || (value !== undefined && req.config.defaultType)) {
                        value = lib.toValue(value, col.type || req.config.defaultType, col);
                    }
                }
            }

            // Max length limit for text fields
            if (typeof v == "string") {
                max = col.check?.max || req.config.maxSize;
                if (max > 0 && value.length > max) {
                    if (col.check?.trunc) {
                        value = value.substr(0, max);
                    } else {
                        failed.push([name, "max", value.length, max]);
                        continue;
                    }
                }
            }
            // The column must exist but it may not support NULLs, so we replace it with the appropriate default value by datatype
            if (col.check?.not_empty && lib.isEmpty(value)) {
                if (!insert) continue;
                if (!req.config.noNulls) value = null; else
                if (req.config.emptyValue !== undefined) {
                    value = lib.toValue(req.config.emptyValue, col.type, col);
                }
            }
        }
        // Skip empty values by op and type
        if (lib.isEmpty(value)) {
            if (col?.check?.skip_empty) continue;
            if (req.config.skipEmpty) {
                if (lib.testRegexp(col?.type, req.config.skipEmpty[req.op])) continue;
            }
        }
        // Skip NULLs by op and type
        if ((value === null || value === "") && !col?.check?.not_empty && req.config.skipNull) {
            if (lib.testRegexp(col?.type, req.config.skipNull[req.op])) continue;
        }
        o[name] = value;
    }
    req.query = o;

    // Step 2, conditions and conversions

    for (const name in req.columns) {
        col = req.columns[name];
        // Restrictions
        if ((col.readonly && !insert && !col.primary) || (col.writeonly && insert)) {
            delete req.query[name];
            continue;
        }
        if (insert) {
            if (col.value !== undefined && req.query[name] === undefined) req.query[name] = col.value;
            if (req.query[name] === undefined) {
                if (col.type == "counter" && req.config.initCounters) req.query[name] = 0;
            }
        }

        // In sync mode we copy all values as is for pool syncing or importing from backups
        if (req.options.syncMode) {
            continue;
        }

        // Only use the given timestamp if it is an update with primary key involving the property
        switch (col.type) {
        case "now":
            if (!req.query[name]) {
                req.query[name] = col.convert?.epoch ? lib.now() : col.convert?.clock ? lib.clock(): req.now;
            }
            break;
        case "uuid":
            if (insert && !lib.isUuid(req.query[name], col.prefix)) {
                req.query[name] = lib.uuid(col.prefix);
            }
            break;
        case "suuid":
            if (insert && !req.query[name]) {
                req.query[name] = lib.suuid(col.prefix, col);
            }
            break;
        case "sfuuid":
            if (insert && !req.query[name]) {
                req.query[name] = lib.sfuuid(col);
            }
            break;
        case "random":
            if (insert && !req.query[name]) {
                req.query[name] = col.max || col.min ? lib.randomInt(col.min, col.max) : lib.randomUInt();
            }
            break;
        case "ttl":
            // Autoexpire based on the period specified
            if (insert && !req.query[name] && (col.days > 0 || col.hours > 0 || col.minutes > 0)) {
                req.query[name] = lib.now() + lib.toNumber(col.days) * 86400 + lib.toNumber(col.hours) * 3600 + lib.toNumber(col.minutes) * 60;
                if (!req.config.epochTtl) req.query[name] *= 1000;
            }
            break;
        }
        if (typeof req.query[name] == "number") {
            if (col.check?.not_zero && req.query[name] === 0) delete req.query[name];
            if (col.convert?.multiplier) req.query[name] *= col.convert?.multiplier;
            if (col.convert?.increment) req.query[name] += col.convert?.increment;
            if (col.convert?.decimal > 0) req.query[name] = lib.toNumber(req.query[name].toFixed(col.convert?.decimal));
        }
        if (typeof req.query[name] == "string") {
            if (col.convert?.strip) req.query[name] = req.query[name].replace(col.convert?.strip, "");
            for (const r in col.convert?.replace) req.query[name] = req.query[name].replaceAll(r, col.convert?.replace[r]);
            if (col.convert?.trim) req.query[name] = req.query[name].trim();
            if (col.convert?.lower) req.query[name] = req.query[name].toLowerCase();
            if (col.convert?.upper) req.query[name] = req.query[name].toUpperCase();
            if (col.convert?.cap) req.query[name] = lib.toTitle(req.query[name], col.cap);
        }
        if (req.query[name] !== undefined && col.type == "counter") {
            req.query[name] = lib.toNumber(req.query[name]);
        }
        if (req.query[name] !== undefined && typeof col.convert?.format == "function") {
            req.query[name] = col.convert?.format(req.query[name], req);
        }
        // Max length limits for arrays and objects, approximate
        max = col.check?.maxlist || req.config.maxList;
        if (max > 0 && Array.isArray(req.query[name])) {
            if (req.query[name].length > max) {
                if (col.trunc) {
                    req.query[name] = req.query[name].slice(0, max);
                } else {
                    failed.push([name, "maxlist", req.query[name].length, max]);
                    delete req.query[name];
                }
            }
        }
        max = col.check?.max || req.config.maxSize;
        if (max > 0 && lib.isObject(req.query[name])) {
            value = lib.objSize(req.query[name]);
            if (value > max) {
                failed.push([name, "max", value, max]);
                delete req.query[name];
            }
        }

        if (insert && col.check?.fail_ifempty && lib.isEmpty(req.query[name])) {
            req.error = lib.newError(col.check?.errmsg_ifempty || ((col.label || name) + " is required"), 400, "EmptyColumn");
        }
    }
    if (failed.length) req.failed = failed;

    prepareJoinColumns(req, req.query);
}

function prepareForSelect(req)
{
    for (const name in req.query) {
        req.query[name] = db.prepareColumn(req, name, req.query[name]).value;
    }
    prepareJoinColumns(req, req.query);
}

function prepareForList(req)
{
    var list = [];
    for (const row of req.query) {

        for (const name in row) {
            row[name] = db.prepareColumn(req, name, row[name]).value;
        }
        prepareJoinColumns(req, row);

        const keys = db.getQueryForKeys(req.keys, row);
        if (Object.keys(keys).length == req.keys.length) {
            list.push(keys);
        }
    }
    req.query = list;
}

function prepareJoinColumns(req, query)
{
    const cols = db.joins[req.table];
    if (!cols?.length) return;
    for (const name of cols) {
        const col = req.column(name);
        if (!col?.join?.length) continue;
        var value = col.join.map(x => (query[x] || ""));
        if (value.length) {
            query[name] = value.join(col.separator || db.separator);
        }
    }
}

/**
 * Convert rows returned by the database into the Javascript format or into the format
 * defined by the table columns, most use cases are json, lists, defaults
 * @param {DbRequest} req
 * @param {any[]} rows
 * @param {DbRequestOptions} [options]
 * @example
 * db.describeTables([ { user: { id: {}, name: {}, pair: { join: ["left","right"] } } ]);
 *
 * db.put("test", { id: "1", type: "user", name: "Test", left: "123", right: "000" })
 * db.select("test", {}, lib.log)
 * @memberof module:db
 * @method convertRows
 */
db.convertRows = function(req, rows, options)
{
    var i, col, opts = options || req.options;

    for (const name in req.columns) {
        col = req.columns[name];
        // Convert from JSON type
        if (!opts?.noconvertrows_json) {
            if (col.type == "json" || (req.config.noObjectTypes && lib.rxObjectType.test(col.type))) {
                for (i = 0; i < rows.length; i++) {
                    if (typeof rows[i][name] == "string" && rows[i][name]) {
                        rows[i][name] = lib.jsonParse(rows[i][name], { logger: "error", [name]: col });
                    }
                }
            } else
            if (req.config.noListTypes && lib.rxListType.test(col.type)) {
                for (i = 0; i < rows.length; i++) {
                    rows[i][name] = lib.toValue(rows[i][name], col.type, col);
                }
            }
        }

        // Split into a list
        if (col.convert?.list && !opts?.noconvertrows_list) {
            for (i = 0; i < rows.length; i++) {
                rows[i][name] = lib.toValue(rows[i][name], "list", col);
            }
        }

        // Default value on return
        if (req.columns[name].dflt && !opts?.noconvertrows_dflt) {
            for (i = 0; i < rows.length; i++) {
                if (rows[i][name] === undefined || rows[i][name] === null) {
                    switch (typeof req.columns[name].dflt) {
                    case "object":
                        rows[i][name] = lib.objClone(req.columns[name].dflt);
                        break;
                    default:
                        rows[i][name] = req.columns[name].dflt;
                    }
                }
            }
        }
    }
    return rows;
}

/**
 * Add a callback to be called after each cache columns event, it will be called for each pool separately.
 * The callback to be called may take options argument and it is called in the context of the pool.
 *
 * The primary goal for this hook is to allow management of the existing tables which are not own by the
 * backendjs application. For such tables, because we have not created them, we need to define column properties
 * after the fact and to keep column definitions in the app for such cases is not realistic. This callback will
 * allow to handle such situations and can be used to set necessary propeties to the table columns.
 *
 * @example <caption>a few public columns, allow an admin to see all the columns</caption>
 *
 * db.setProcessColumns(function() {
 *   var cols = db.getColumns("users", { pool: this.name });
 *   for (var name in cols) {
 *     if (["id","name"].includes(name)) cols[name].pub = 1; else cols[name].admin = 1;
 *   }
 * })
 * @memberof module:db
 * @method setProcessColumns
 */
db.setProcessColumns = function(callback)
{
    if (typeof callback != "function") return;
    db.processColumns.push(callback);
}

/**
 * Returns a list of hooks to be used for processing rows for the given table
 * @memberof module:db
 * @method getProcessRows
 */
db.getProcessRows = function(type, table, options)
{
    if (!type || !table || !db.processRows[type]) return null;
    var hooks = db.processRows[type][table];
    return lib.isArray(hooks) ? hooks : null;
}

/**
 * Run registered pre- or post- process callbacks.
 * - `type` is one of the `pre` or 'post`
 * - `table` - the table to run the hooks for, usually the same as req.table but can be '*' for global hooks
 * - `req` is the original db request object with the following required properties: `op, table, obj, options, info`,
 * - `rows` is the result rows for post callbacks and the same request object for pre callbacks.
 * @memberof module:db
 * @method runProcessRows
 */
db.runProcessRows = function(type, table, req, rows)
{
    if (!req) return rows;
    var hooks = db.getProcessRows(type, table, req.options);
    if (!hooks) return rows;

    // Stop on the first hook returning true to remove this row from the list
    function processRow(row) {
        if (!row) row = {};
        for (var i = 0; i < hooks.length; i++) {
            if (hooks[i].call(row, req, row) === true) return false;
        }
        return true;
    }
    if (Array.isArray(rows)) {
        rows = rows.filter(processRow);
    } else {
        processRow(rows);
    }
    return rows;
}

/**
 * Assign a processRow callback for a table, this callback will be called for every row on every result being retrieved from the
 * specified table thus providing an opportunity to customize the result.
 *
 * type defines at what time the callback will be called:
 *  - `pre` - making a request to the db on the query record
 *  - `post` - after the request finished to be called on the result rows
 *
 * All assigned callback to this table will be called in the order of the assignment.
 *
 * The callback accepts 2 arguments: function(req, row)
 *   where:
 *  - `req` - the original request for a db operation with required
 *  - `row` - a row from the result
 *
 * When producing complex properties by combining other properties it needs to be synchronized using both pre and post
 * callbacks to keep the record consistent.
 *
 * **For queries returning rows, if the callback returns true for a row it will be filtered out and not included in the final result set.**
 *
 *
 * @example
 *
 * db.setProcessRow("post", "bk_user", (req, row) => {
 *    if (row.birthday) row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
 * });
 *
 * db.setProcessRow("post", "icons", (req, row) => {
 *    if (row.type == "private" && row.id != req.options.user.id) return true;
 * });
 * @memberof module:db
 * @method setProcessRow
 */
db.setProcessRow = function(type, table, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!table || typeof callback != "function") return;
    if (!db.processRows[type]) db.processRows[type] = {};
    if (!db.processRows[type][table]) db.processRows[type][table] = [];
    db.processRows[type][table].push(callback);
}

