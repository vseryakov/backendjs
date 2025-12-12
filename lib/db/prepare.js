/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Prepare for execution for the given operation: add, del, put, update,...
 * Returns prepared object to be passed to the driver's .query method.
 * @param {object|DBRequest} options
 * @param {string|DbPool} [options.pool]
 * @params {string} [options.op]
 * @param {string} [options.table]
 * @param {object} [options.query]
 * @param {string} [options.text]
 * @param {any[]} [options.values]
 * @param {DBRequestOptions} [options.options]
 * @param {DBRequestCallback} [options.callback]
 * @returns {DBRequest} - a request object
 * @memberOf module:db
 * @method prepare
 */
db.prepare = function(options)
{
    var req = db.prepareRequest(options);
    if (!req.options.nopreparequery) {
        db.prepareQuery(req);
    }
    req.pool.prepare(req);
    logger.logger(req.options.logger_db || "debug", "prepare:", req);
    return req;
}

/**
 * Prepare a DB request object with required properties
 * @param {object|DBRequest} options
 * @param {string|DbPool} [options.pool]
 * @params {string} [options.op]
 * @param {string} [options.table]
 * @param {object} [options.query]
 * @param {string} [options.text]
 * @param {any[]} [options.values]
 * @param {DBRequestOptions} [options.options]
 * @param {DBRequestCallback} [options.callback]
 * @returns {DBRequest} - a new request object
 * @memberOf module:db
 * @method prepareRequest
 */
db.prepareRequest = function(options)
{
    options = options || lib.empty;
    const pool = db.getPool(options.pool?.name || lib.isString(options.pool) || options.options?.pool);
    const req = {
        op: options.op,
        table: db.alias(options.table),
        text: options.text,
        values: options.values,
        query: options.query || {},
        options: Object.assign({}, options.options, { pool: pool.name }),
        custom: {},
        callback: options.callback,
        now: Date.now(),
    };
    Object.defineProperty(req, "pool", { value: pool });
    Object.defineProperty(req, "config", { value: pool.configOptions });
    Object.defineProperty(req, "column", { value: getColumn });
    Object.defineProperty(req, "columns", { value: db.getColumns(req.table) });
    Object.defineProperty(req, "keys", { value: db.getKeys(req.table) });
    return req;
}

function getColumn(name)
{
    return this.columns[name] || this.custom[name]
}

/**
 * Preprocess a query object for a given operation, convert types, assign defaults...
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

    req.orig = {};
    switch (type) {
    case "object":
        // Original record before the prepare processing, only for single records
        for (const p in req.query) {
            req.orig[p] = req.query[p];
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
            delete item.orig;
            list.push(item);
        }
        req.query = list;
        break;
    }
}

/**
 * Prepare a column for a retrieval operation, convert aliases, types and ops according to the request and pool mapping
 *
 * The op in the name after `_$` takes precedence over the options.ops
 *
 * NOTE: `op` is lowercase and all underscores are converted into spaces
 * @param {DBRequest} [req] - request object or null, it is not required to be strict DBRequest
 * @param {string} name - column name
 * @param {any} value - query or update value
 * @example
 * { name_$contains: "cat" } // means use the `contains` op for the column `name`
 * { $or: { id: 1, id_$: 2, id_$$: 3 } }  // means id=1 OR id=2 OR id=3
 *
 * @return {DBRequestColumn}
 * @memberOf module:db
 * @method prepareColumn
 */
db.prepareColumn = function(req, name, value)
{
    const alias = name;
    let op = req?.options?.ops?.[name];

    const i = name.lastIndexOf("_$");
    if (i > 0) {
        let j = i + 2;
        while (name[j] === "$") j++;
        op = name.substr(j) || op;
        name = name.substr(0, i);
    }
    const col = req?.column(name);

    if (!op) {
        op = value === null && "null" ||
             Array.isArray(value) && "in" ||
             col?.ops?.[req?.op] || "eq";
    }

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
    if (!lib.isObject(req.options.updateOps)) {
        req.options.updateOps = {};
    }
    for (const p in req.columns) {
        if (req.columns[p].type == "counter" && req.query[p] !== undefined) req.options.updateOps[p] = "incr";
    }
    for (const p in req.custom) {
        if (req.custom[p].type == "counter" && req.query[p] !== undefined) req.options.updateOps[p] = "incr";
    }
}

/*
 * Keep only columns from the table definition if we have it
 * Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
 * this is for those databases which are very sensitive on the types like DynamoDB.
 */
function prepareForUpdate(req)
{
    var o = {}, v, col, max, updateOps = req.options.updateOps || lib.empty, failed = [];
    var insert = req.op == "add" || req.op == "put";
    var update = req.op == "update" || req.op == "incr";

    for (const p in req.query) {
        v = req.query[p];
        col = req.column(p);

        // Skip unsupported columns
        if (!p || p[0] == '_' || v === undefined) continue;
        if (!col && !req.options?.no_columns) {
            // Allow nested fields if objects supported and the parent exists
            if (req.config.noObjectTypes) continue;
            var dot = p.indexOf(".");
            if (dot == -1) continue;
            col = req.column(p.substr(0, dot));
            if (!col || !lib.rxObjectType.test(col.type)) continue;
        }
        if (lib.isFlag(req.options.skip_columns, p)) continue;

        if (col) {
            // Convert into native data type
            if (v !== null) {
                // Handle json separately in sync with convertRows
                switch (col.type) {
                case "json":
                    if (typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "{}" || v === "[]") v = null;
                    }
                    break;

                case "counter":
                    if (v === 0 && updateOps[p] == "incr") continue;
                    break;

                case "obj":
                case "object":
                    if (!lib.isObject(v)) continue;
                    if (req.config.noObjectTypes && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "{}" || v === "[]") v = null;
                    }
                    break;

                case "array":
                    if (!Array.isArray(v)) continue;
                    if (req.config.noObjectTypes && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "[]" || v === "{}") v = null;
                    }
                    break;

                case "set":
                case "list":
                    if (req.config.noListTypes) {
                        v = Array.isArray(v) ? v.join(col.separator || ",") : typeof v == "string" ? v : String(v);
                        if (v === "[]" || v === "{}") v = null;
                        break;
                    }

                default:
                    if ((col.primary && insert) || col.index || col.type || (v !== undefined && req.config.defaultType)) {
                        v = lib.toValue(v, col.type || req.config.defaultType, col);
                    }
                }
            }

            // Max length limit for text fields
            if (typeof v == "string") {
                max = col.check?.max || req.config.maxSize;
                if (max > 0 && v.length > max) {
                    if (col.check?.trunc) {
                        v = v.substr(0, max);
                    } else {
                        failed.push([p, "max", v.length, max]);
                        continue;
                    }
                }
            }
            // The column must exist but it may not support NULLs, so we replace it with the appropriate default value by datatype
            if (col.check?.not_empty && lib.isEmpty(v)) {
                if (!insert) continue;
                if (!req.config.noNulls) v = null; else
                if (req.config.emptyValue !== undefined) {
                    v = lib.toValue(req.config.emptyValue, col.type, col);
                }
            }
        }
        // Skip empty values by op and type
        if (lib.isEmpty(v)) {
            if (col?.check?.skip_empty) continue;
            if (req.config.skipEmpty) {
                if (lib.testRegexp(col?.type, req.config.skipEmpty[req.op])) continue;
            }
        }
        // Skip NULLs by op and type
        if ((v === null || v === "") && !col?.check?.not_empty && req.config.skipNull) {
            if (lib.testRegexp(col?.type, req.config.skipNull[req.op])) continue;
        }
        // auto update ops
        if (!updateOps[p] && req.options.typesOps?.[col.type]) {
            if (!req.options.updateOps) req.options.updateOps = updateOps = {};
            updateOps[p] = req.options.typesOps[col.type];
        }
        o[p] = v;
    }
    req.query = o;
    for (const p in req.columns) {
        col = req.columns[p];
        // Restrictions
        if ((col.readonly && update) || (col.writeonly && insert)) {
            delete req.query[p];
            continue;
        }
        if (insert) {
            if (col.value !== undefined && req.query[p] === undefined) req.query[p] = col.value;
            if (req.query[p] === undefined) {
                if (col.type == "counter" && req.config.initCounters) req.query[p] = 0;
            }
        }

        // In sync mode we copy all values as is for pool syncing or importing from backups
        if (req.options.syncMode) {
            continue;
        }

        // Only use the given timestamp if it is an update with primary key involving the property
        switch (col.type) {
        case "uuid":
            if (insert && !lib.isUuid(req.query[p], col.prefix)) req.query[p] = lib.uuid(col.prefix);
            break;
        case "suuid":
            if (insert && !req.query[p]) req.query[p] = lib.suuid(col.prefix, col);
            break;
        case "sfuuid":
            if (insert && !req.query[p]) req.query[p] = lib.sfuuid(col);
            break;
        case "random":
            if (insert && !req.query[p]) {
                req.query[p] = col.max || col.min ? lib.randomInt(col.min, col.max) : lib.randomUInt();
            }
            break;
        case "now":
            if (insert && !req.query[p]) {
                req.query[p] = col.convert?.epoch ? lib.now() : req.now;
            }
            break;
        case "clock":
            if (insert && !req.query[p]) {
                req.query[p] = lib.clock();
            }
            break;
        case "ttl":
            // Autoexpire based on the period specified
            if (insert && !req.query[p] && (col.days > 0 || col.hours > 0 || col.minutes > 0)) {
                req.query[p] = lib.now() + lib.toNumber(col.days) * 86400 + lib.toNumber(col.hours) * 3600 + lib.toNumber(col.minutes) * 60;
                if (!req.config.epochTtl) req.query[p] *= 1000;
            }
            break;
        }
        if (typeof req.query[p] == "number") {
            if (col.check?.not_zero && req.query[p] === 0) delete req.query[p];
            if (col.convert?.multiplier) req.query[p] *= col.convert?.multiplier;
            if (col.convert?.increment) req.query[p] += col.convert?.increment;
            if (col.convert?.decimal > 0) req.query[p] = lib.toNumber(req.query[p].toFixed(col.convert?.decimal));
        }
        if (typeof req.query[p] == "string") {
            if (col.convert?.strip) req.query[p] = req.query[p].replace(col.convert?.strip, "");
            for (const r in col.convert?.replace) req.query[p] = req.query[p].replaceAll(r, col.convert?.replace[r]);
            if (col.convert?.trim) req.query[p] = req.query[p].trim();
            if (col.convert?.lower) req.query[p] = req.query[p].toLowerCase();
            if (col.convert?.upper) req.query[p] = req.query[p].toUpperCase();
            if (col.convert?.cap) req.query[p] = lib.toTitle(req.query[p], col.cap);
        }
        if (req.query[p] !== undefined && col.type == "counter") {
            req.query[p] = lib.toNumber(req.query[p]);
        }
        if (req.query[p] !== undefined && typeof col.convert?.format == "function") {
            req.query[p] = col.convert?.format(req.query[p], req);
        }
        // Max length limits for arrays and objects, approximate
        max = col.check?.maxlist || req.config.maxList;
        if (max > 0 && Array.isArray(req.query[p])) {
            if (req.query[p].length > max) {
                if (col.trunc) {
                    req.query[p] = req.query[p].slice(0, max);
                } else {
                    failed.push([p, "maxlist", req.query[p].length, max]);
                    delete req.query[p];
                }
            }
        }
        max = col.check?.max || req.config.maxSize;
        if (max > 0 && lib.isObject(req.query[p])) {
            v = lib.objSize(req.query[p]);
            if (v > max) {
                failed.push([p, "max", v, max]);
                delete req.query[p];
            }
        }

        if (insert && col.check?.fail_ifempty && lib.isEmpty(req.query[p])) {
            req.error = lib.newError(col.check?.errmsg_ifempty || ((col.label || p) + " is required"), 400, "EmptyColumn");
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

        const keys = req.keys.reduce((a, b) => { a[b] = row[b]; return a }, {});
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
        var value = col.join.map(x => (req.orig[x] || query[x] || ""));
        if (value.length) {
            query[name] = value.join(col.separator || db.separator);
        }
    }
}

/**
 * Convert rows returned by the database into the Javascript format or into the format
 * defined by the table columns, most use cases are json, lists, defaults
 * @param {DBRequest} req
 * @param {any[]} rows
 * @param {DBRequestOptions} [options]
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

    for (const p in req.columns) {
        col = req.columns[p];
        // Convert from JSON type
        if (!opts?.noconvertrows_json) {
            if (col.type == "json" || (req.config.noObjectTypes && lib.rxObjectType.test(col.type))) {
                for (i = 0; i < rows.length; i++) {
                    if (typeof rows[i][p] == "string" && rows[i][p]) {
                        rows[i][p] = lib.jsonParse(rows[i][p], { logger: "error", [p]: col });
                    }
                }
            } else
            if (req.config.noListTypes && lib.rxListType.test(col.type)) {
                for (i = 0; i < rows.length; i++) {
                    rows[i][p] = lib.toValue(rows[i][p], col.type, col);
                }
            }
        }

        // Split into a list
        if (col.convert?.list && !opts?.noconvertrows_list) {
            for (i = 0; i < rows.length; i++) {
                rows[i][p] = lib.toValue(rows[i][p], "list", col);
            }
        }

        // Default value on return
        if (req.columns[p].dflt && !opts?.noconvertrows_dflt) {
            for (i = 0; i < rows.length; i++) {
                if (rows[i][p] === undefined || rows[i][p] === null) {
                    switch (typeof req.columns[p].dflt) {
                    case "object":
                        rows[i][p] = lib.objClone(req.columns[p].dflt);
                        break;
                    default:
                        rows[i][p] = req.columns[p].dflt;
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
 * Example, a few public columns, allow an admin to see all the columns
 *
 *         db.setProcessColumns(function() {
 *             var cols = db.getColumns("users", { pool: this.name });
 *             for (var p in  cols) {
 *                 if (["id","name"].indexOf(p) > -1) cols[p].pub = 1; else cols[p].admin = 1;
 *             }
 *         })
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

