//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

// Prepare for execution for the given operation: add, del, put, update,...
// Returns prepared object to be passed to the driver's .query method. This method is a part of the driver
// helpers and is not used directly in the applications.
db.prepare = function(op, table, obj, options)
{
    table = this.tableName(table);
    const pool = this.getPool(options);
    const req = { op: op, table: table, text: "", obj: obj, options: lib.objClone(options) };
    if (!req.options.nopreparerow) this.prepareRow(pool, req);
    pool.prepare(req);
    logger.logger(req.options.logger_db || "debug", "prepare:", table, req);
    return req;
}

// Preprocess an object for a given operation, convert types, assign defaults...
db.prepareRow = function(pool, req)
{
    if (!pool) pool = this.getPool(req.options);

    // Keep an object in the format we support
    const type = lib.typeName(req.obj);
    switch (type) {
    case "object":
    case "string":
    case "array":
        break;
    default:
        req.obj = {};
    }

    // Cache table columns
    const columns = this.getColumns(req.table, req.options);

    // Pre-process input properties before sending it to the database, make a shallow copy of the
    // object to preserve the original properties in the parent
    if (!req.options.noprocessrows) {
        switch (req.op) {
        case "create":
        case "upgrade":
            break;

        default:
            if (type != "string" && this.getProcessRows('pre', req.table, req.options)) {
                req.obj = lib.objClone(req.obj);
            }
            this.runProcessRows("pre", req.table, req, req.obj);
        }
        // Always run the global hook, keep the original object
        this.runProcessRows("pre", "*", req, req.obj);
    }

    req.orig = {};
    switch (type) {
    case "object":
        // Original record before the prepare processing, only for single records
        for (const p in req.obj) {
            req.orig[p] = req.obj[p];
            if (!pool.configOptions.noCustomColumns && !columns[p]) {
                this.checkCustomColumn(req, p);
            }
        }
        break;

    case "string":
        // Native language in a string, pass as is
        return;
    }
    pool.prepareRow(req);

    switch (req.op) {
    case "incr":
        this.prepareForIncr(pool, req);

    case "add":
    case "put":
    case "update":
    case "updateall":
        this.prepareForUpdate(pool, req);
        break;

    case "del":
    case "delall":
        this.prepareForDelete(pool, req);
        break;

    case "search":
        if (pool.configOptions.searchable) break;

    case "get":
    case "select":
        if (type == "string") break;
        this.prepareForSelect(pool, req);
        break;

    case "list":
        this.prepareForList(pool, req);
        break;

    case "bulk":
        var list = [];
        for (const i in req.obj) {
            var obj = req.obj[i];
            if (!obj || !obj.table || !obj.obj || !obj.op) continue;
            obj = this.prepare(obj.op, obj.table, obj.obj, obj.options);
            if (obj.error) {
                obj.errstatus = obj.error.code || obj.error.status;
                obj.errmsg = obj.error.message;
                delete obj.options;
            }
            lib.objDel(obj, "error", "orig");
            list.push(obj);
        }
        req.obj = list;
        break;
    }
}

db.prepareForIncr = function(pool, req)
{
    var columns = this.getColumns(req.table, req.options);
    if (!lib.objSearch(req.options.updateOps, { hasValue: "incr", count: 1 })) {
        if (!lib.isObject(req.options.updateOps)) req.options.updateOps = {};
        for (const p in columns) {
            if (columns[p].type == "counter" && typeof req.obj[p] != "undefined") req.options.updateOps[p] = "incr";
        }
        for (const p in req.allow) {
            if (req.allow[p].type == "counter" && typeof req.obj[p] != "undefined") req.options.updateOps[p] = "incr";
        }
    }
}

// Keep only columns from the table definition if we have it
// Go over all properties in the object and makes sure the types of the values correspond to the column definition types,
// this is for those databases which are very sensitive on the types like DynamoDB.
db.prepareForUpdate = function(pool, req)
{
    var columns = this.getColumns(req.table, req.options);
    var o = {}, v, col, updateOps = req.options.updateOps || lib.empty;
    var insert = req.op == "add" || req.op == "put";

    for (const p in req.obj) {
        v = req.obj[p];
        col = columns[p] || req.allow && req.allow[p];
        if (!(col && col.allow) && this.skipColumn(p, v, req.options, columns)) continue;
        if (col) {
            // Skip artificial join columns
            if (pool.configOptions.noJoinColumns && Array.isArray(col.join) && col.join.indexOf(p) == -1) continue;
            // Convert into native data type
            if (v !== null) {
                // Handle json separately in sync with convertRows
                switch (col.type) {
                case "json":
                    if (pool.configOptions.noJson && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "{}" || v === "[]") v = null;
                    }
                    break;

                case "counter":
                    if (v === 0 && updateOps[p] == "incr") continue;
                    break;

                case "obj":
                case "object":
                    if (typeof v != "object") continue;
                    if (pool.configOptions.noObjects && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "{}" || v === "[]") v = null;
                    }
                    break;

                case "array":
                    if (!Array.isArray(v)) continue;
                    if (pool.configOptions.noObjects && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "[]") v = null;
                    }
                    break;

                case "set":
                case "list":
                    if (pool.configOptions.noObjects && typeof v != "string") {
                        v = lib.stringify(v);
                        if (v === "[]") v = null;
                        break;
                    }

                default:
                    if (!pool.configOptions.strictTypes) break;
                    if (col.primary || col.index || col.type || (typeof v != "undefined" && pool.configOptions.defaultType)) {
                        v = lib.toValue(v, col.type || pool.configOptions.defaultType, col);
                    }
                }
            }
            // Verify against allowed values
            if (lib.isArray(col.values) && col.values.indexOf(typeof v == "string" ? v : String(v)) == -1) continue;

            // Replace exact values, for cases like nulls, empty string or to ignore invalid values
            if (lib.isArray(col.values_map)) {
                for (let i = 0; i < col.values_map.length - 1; i += 2) {
                    if (v === col.values_map[i]) {
                        v = col.values_map[i + 1];
                        break;
                    }
                }
            }
            // Max length limit for text fields
            const maxlength = col.maxlength || pool.configOptions.maxLength;
            if (maxlength > 0 && typeof v == "string" && v.length > maxlength && lib.rxTextType.test(col.type || pool.configOptions.defaultType || "text")) {
                v = v.substr(0, maxlength);
            }
            // The column must exist but it may not support NULLs, so we replace it with the appropriate default value by datatype
            if (col.notempty && lib.isEmpty(v)) {
                if (!insert) continue;
                if (!pool.configOptions.noNulls) v = null; else
                if (typeof pool.configOptions.emptyValue != "undefined") {
                    v = lib.toValue(pool.configOptions.emptyValue, col.type, col);
                }
            }
        }
        // Skip empty values by op and type
        if (lib.isEmpty(v)) {
            if (col && col.skip_empty) continue;
            if (pool.configOptions.skipEmpty) {
                if (lib.testRegexp(col && col.type, pool.configOptions.skipEmpty[req.op])) continue;
            }
        }
        // Skip NULLs by op and type
        if ((v === null || v === "") && !(col && col.notempty) && pool.configOptions.skipNull) {
            if (lib.testRegexp(col && col.type, pool.configOptions.skipNull[req.op])) continue;
        }
        // auto update ops
        if (!updateOps[p] && req.options.typesOps && req.options.typesOps[col.type]) {
            if (!req.options.updateOps) req.options.updateOps = updateOps = {};
            updateOps[p] = req.options.typesOps[col.type];
        }
        o[p] = v;
    }
    req.obj = o;
    var allkeys = this.getKeys(req.table, { allkeys: 1 });
    for (const p in columns) {
        col = columns[p] || req.allow && req.allow[p] || lib.empty;
        // Restrictions
        if (col.hidden ||
            (!col.allow && this.skipColumn(p, "", req.options, columns)) ||
            (col.readonly && (req.op == "incr" || req.op == "update")) ||
            (col.writeonly && (req.op == "add" || req.op == "put"))) {
            delete req.obj[p];
            continue;
        }
        if (insert) {
            if (typeof col.value != "undefined" && typeof req.obj[p] == "undefined") req.obj[p] = col.value;
            if (typeof req.obj[p] == "undefined") {
                if (col.type == "counter" && pool.configOptions.initCounters) req.obj[p] = 0;
            }
        }

        // In sync mode we copy all values as is for pool syncing or importing from backups
        if (req.options.syncMode) {
            this.joinColumn(req, req.obj, p, col, req.orig);
            continue;
        }

        // Only use the given timestamp if it is an update with primary key involving the property
        switch (col.type) {
        case "uuid":
            if (insert && !lib.isUuid(req.obj[p], col.prefix)) req.obj[p] = lib.uuid(col.prefix);
            break;
        case "tuuid":
            if (insert && !lib.isTuuid(req.obj[p], col.prefix)) req.obj[p] = lib.tuuid(col.prefix);
            break;
        case "suuid":
            if (insert && !req.obj[p]) req.obj[p] = lib.suuid(col.prefix, col);
            break;
        case "uid":
            if (req.options.account) req.obj[p] = req.options.account.id;
            break;
        case "uname":
            if (req.options.account) req.obj[p] = req.options.account.name;
            break;
        case "random":
            if (insert && !req.obj[p]) {
                req.obj[p] = col.max || col.min ? lib.randomInt(col.min, col.max) : lib.randomUInt();
            }
            break;
        case "now":
            if (insert || !req.obj[p] || allkeys.indexOf(p) == -1) {
                req.obj[p] = col.epoch ? lib.now() : col.clock ? lib.clock()/1000 : Date.now();
            }
            break;
        case "clock":
            if (insert || !req.obj[p] || allkeys.indexOf(p) == -1) {
                req.obj[p] = lib.clock();
            }
            break;
        case "ttl":
            // Autoexpire based on the period specified
            if (insert && !req.obj[p] && (col.days > 0 || col.hours > 0 || col.minutes > 0)) {
                req.obj[p] = lib.now() + lib.toNumber(col.days) * 86400 + lib.toNumber(col.hours) * 3600 + lib.toNumber(col.minutes) * 60;
                if (!pool.configOptions.epochTtl) req.obj[p] *= 1000;
            }
            break;
        }
        if (typeof req.obj[p] == "number") {
            if (col.multiplier) req.obj[p] *= col.multiplier;
            if (col.increment) req.obj[p] += col.increment;
            if (col.decimal > 0) req.obj[p] = lib.toNumber(req.obj[p].toFixed(col.decimal));
        }
        if (typeof req.obj[p] == "string") {
            if (col.strip) req.obj[p] = req.obj[p].replace(col.strip, "");
            for (const r in col.replace) req.obj[p] = req.obj[p].replace(r, col.replace[r]);
            if (col.trim) req.obj[p] = req.obj[p].trim();
            if (col.lower) req.obj[p] = req.obj[p].toLowerCase();
            if (col.upper) req.obj[p] = req.obj[p].toUpperCase();
            if (col.cap) req.obj[p] = lib.toTitle(req.obj[p]);
            if (col.word > 0) req.obj[p] = lib.strSplit(req.obj[p], col.separator || " ")[col.word - 1];
        }
        if (typeof req.obj[p] != "undefined" && col.type == "counter") {
            req.obj[p] = lib.toNumber(req.obj[p]);
        }
        if (typeof col.format == "function") {
            req.obj[p] = col.format(req.obj[p], req);
        }
        this.joinColumn(req, req.obj, p, col, req.orig);
        if (insert && col.fail_ifempty && lib.isEmpty(req.obj[p])) {
            req.error = lib.newError(col.errmsg_ifempty || ((col.label || p) + " is required"), 400, "EmptyColumn");
        }
    }
}

db.prepareForDelete = function(pool, req)
{
    var columns = this.getColumns(req.table, req.options);
    var o = {}, v, col, type;
    for (const p in req.obj) {
        v = req.obj[p];
        type = typeof v;
        col = columns[p] || req.allow && req.allow[p] || lib.empty;
        if (col.hidden) continue;
        if (!col.allow && this.skipColumn(p, v, req.options, columns)) continue;
        // Convert into native data type
        if (pool.configOptions.strictTypes && typeof v != "undefined") {
            if ((col.primary || col.type) || pool.configOptions.defaultType) {
                v = lib.toValue(v, col.type || pool.configOptions.defaultType);
            }
        }
        if (type == "string") {
            if (col.trim) v = v.trim();
            if (col.lower) v = v.toLowerCase();
            if (col.upper) v = v.toUpperCase();
        }
        o[p] = v;
    }
    req.obj = o;
    for (const p in columns) {
        this.joinColumn(req, req.obj, p, columns[p], req.orig);
    }
}

db.prepareForSelect = function(pool, req)
{
    // Keep only columns, non existent properties cannot be used
    var columns = this.getColumns(req.table, req.options);
    var o = {}, rx = /^\$(or|and)/, col, v, type, ops;
    for (const p in req.obj) {
        col = columns[p] || req.allow && req.allow[p] || lib.empty;
        if (col.hidden) continue;
        if (rx.test(p) || col.allow || !this.skipColumn(p, req.obj[p], req.options, columns)) {
            o[p] = req.obj[p];
        }
    }
    req.obj = o;

    // Convert simple types into the native according to the table definition, some query parameters are not
    // that strict and can be arrays which we should not convert due to options.ops
    for (const p in columns) {
        v = req.obj[p];
        type = typeof v;
        col = columns[p] || req.allow && req.allow[p] || lib.empty;

        // Default search op, for primary key cases
        ops = req.options.ops || lib.empty;
        if (col.ops && col.ops[req.op] && !ops[p]) {
            lib.objSet(req.options, ["ops", p], col.ops[req.op]);
            ops = req.options.ops;
        }

        if (pool.configOptions.strictTypes) {
            switch (col.type) {
            case "bool":
            case "boolean":
                if (type == "number") req.obj[p] = lib.toBool(v); else
                if (type == "string" && v) req.obj[p] = lib.toBool(v);
                break;
            case "mtime":
            case "date":
            case "time":
            case "datetime":
            case "timestamp":
                if (v) req.obj[p] = lib.toValue(v, col.type);
                break;
            default:
                if (lib.isNumericType(col.type)) {
                    if (type == "string" && v) req.obj[p] = lib.toNumber(v);
                } else
                if (type == "number") {
                    req.obj[p] = String(v);
                } else
                if (Array.isArray(v) && !lib.isFlag(db.arrayOps, ops[p])) {
                    if (v.length) req.obj[p] = String(v); else delete req.obj[p];
                } else
                if (req.op == "get" && col.primary && col.type) {
                    req.obj[p] = lib.toValue(v, col.type, col);
                }
            }
        }
        // Case conversion
        if (type == "string") {
            if (col.trim) req.obj[p] = v.trim();
            if (col.lower) req.obj[p] = v.toLowerCase();
            if (col.upper) req.obj[p] = v.toUpperCase();
        }

        // Lists may be of a specific type for exact comparisons
        if (lib.isFlag(db.arrayOps, ops[p])) {
            if (!Array.isArray(v) || v.length) {
                if (v) {
                    req.obj[p] = lib.strSplitUnique(v, null, { datatype: col.datatype || !lib.rxObjectType.test(col.type) && col.type });
                } else {
                    delete req.obj[p];
                }
            } else
            if (!v.length) delete req.obj[p];
        }

        // Joined values for queries, if nothing joined or only one field is present keep the original value
        this.joinColumn(req, req.obj, p, col, req.orig);
    }
}

db.prepareForList = function(pool, req)
{
    var col, row, type, list = [];
    var keys = db.getKeys(req.table);
    var columns = this.getColumns(req.table, req.options);
    for (var i = 0; i < req.obj.length; i++) {
        row = req.obj[i];
        for (const p in columns) {
            col = columns[p];
            type = typeof row[p];
            if (pool.configOptions.strictTypes) {
                if (lib.isNumericType(col.type)) {
                    if (typeof row[p] == "string") row[p] = lib.toNumber(row[p]);
                } else {
                    if (typeof row[p] == "number") row[p] = String(row[p]);
                }
                if (col.primary && col.type) {
                    row[p] = lib.toValue(row[p], col.type);
                }
            }
            // Case conversion
            if (type == "string") {
                if (col.trim) row[p] = row[p].trim();
                if (col.lower) row[p] = row[p].toLowerCase();
                if (col.upper) row[p] = row[p].toUpperCase();
            }

            // Joined values for queries, if nothing joined or only one field is present keep the original value
            this.joinColumn(req, row, p, col, req.orig);
            // Delete at the end to give a chance some joined columns to be created
            if (!col.primary) delete row[p];
        }
        for (const p in row) {
            if (!columns[p] || lib.isEmpty(row[p])) delete row[p];
        }
        if (Object.keys(row).length == keys.length) list.push(row);
    }
    req.obj = list;
}

// Join several columns to produce a combined property if configured, given a column description and an object record
// it replaces the column value with joined value if needed. Empty properties will be still joined as empty strings.
// It always uses the original value even if one of the properties has been joined already.
//
// Checks for `join` property in the column definition.
//
// - `join_ops` - an array with operations for which perform columns join only, if not specified it applies for all operations,
//     allowed values: add, put, incr, update, del, get, select
// - `join_ifempty` - only join if the column value is not provided
// - `skip_join` can be used to restrict joins, it is a list with columns that should not be joined
// - `join_pools` can be an array with pool names which are allowed to do the join, other pools will skip joining this column.
// - `nojoin_pools` can be an array with pool names which are not allowed to do the join, other pools will skip joining this column
// - `join_strict` can be used to perform join only if all columns in the list are not empty, so the join
//   is for all columns or none
// - `join_all` can be used to proceed and join empty values, without it the any join stops on firtst empty value but
//   marked to be checked later in case the empty column is not empty anymore in case of uuid or other auto-generated column type.
// - `join_force` can be used to force the join regardless of the existing value, without it if the existing value contains the
//   separator it is skipped
// - `join_hash` can be used to store a hash of the joined column to reduce the space and make the result value easier to use
// - `join_cap, join_lower, join_upper` - convert the joined value with toTitle, lower or upper case
// - `join_process`` - a function(value, obj, col) - must return a value to be used, the value is joined already
//
db.joinColumn = function(req, obj, name, col, orig)
{
    if (!col) return;
    switch (col.type) {
    case "geohash":
    case "geopoint":
        if (obj[name] || obj[name] === null) break;
        var lat = lib.toNumber(obj[col.lat || "latitude"] || orig[col.lat || "latitude"]);
        var lon = lib.toNumber(obj[col.lon || "longitude"] || orig[col.lon || "longitude"]);
        if (lat && lon) {
            obj[name] = lat + "," + lon;
        } else {
            delete obj[name];
        }
        break;
    }

    // Check if this regular column belong to any incomplete joined column, if so recreate the parent
    if (!Array.isArray(col.join) && req._join && req._join[name]) {
        name = req._join[name];
        col = this.getColumns(req.table, req.options)[name];
    }
    if (!Array.isArray(col.join)) return;
    if (col.join_ifempty && obj[name]) return;
    if (req.options.noJoinColumns) return;
    if (Array.isArray(req.options.skip_join) && req.options.skip_join.indexOf(name) > -1) return;
    if (Array.isArray(col.join_ops) && col.join_ops.indexOf(req.op) == -1) return;
    if (Array.isArray(col.join_pools) && col.join_pools.indexOf(req.options && req.options.pool || this.pool) == -1) return;
    if (Array.isArray(col.nojoin_pools) && col.nojoin_pools.indexOf(req.options && req.options.pool || this.pool) > -1) return;

    var separator = col.separator || this.separator;
    if (!col.join_force && typeof obj[name] == "string" && obj[name].indexOf(separator) > -1) return;
    var c, d, v = "", n = 0;
    var ops = req.options.ops, join_strict = req.options.join_strict;
    for (var i = 0; i < col.join.length; i++) {
        c = col.join[i];
        d = (orig && orig[c]) || obj[c] || "";
        if (d) {
            n++;
        } else {
            if (col.join_strict || col.join_hash || join_strict) return;
            switch (ops && ops[name]) {
            case "lt":
            case "le":
            case "gt":
            case "ge":
            case "begins_with":
                // Left to right comparison, skip if we have holes
                if (i > n || (i == n && i < col.join.length - 1)) return;
                break;
            default:
                // Mark for later when possibly new value will be generated, for now, uuid....
                if (!req._join) req._join = {};
                req._join[c] = name;
                if (!col.join_all) return;
            }
        }
        v += (i ? separator : "") + d;
    }
    if (!v || !n) return;
    if (col.join_lower) v = v.toLowerCase();
    if (col.join_upper) v = v.toUpperCase();
    if (col.join_cap) v = lib.toTitle(v);
    if (col.join_hash) v = lib.hash(v);
    if (typeof col.join_process == "function") v = col.join_process(v, obj, col);
    obj[name] = v;
}

// Split joined columns for all rows
db.unjoinColumns = function(rows, name, col, options)
{
    if (Array.isArray(col.unjoin) || (lib.toBool(col.unjoin) && Array.isArray(col.join))) {
        var unjoin = Array.isArray(col.unjoin) ? col.unjoin : col.join;
        var row, separator = col.separator || this.separator;
        for (var i = 0; i < rows.length; i++) {
            row = rows[i];
            if (typeof row[name] == "string" && row[name].indexOf(separator) > -1) {
                var v = row[name].split(separator);
                if (v.length >= unjoin.length) {
                    for (var j = 0; j < unjoin.length; j++) {
                        row[unjoin[j]] = lib.toValue(v[j], col.datatype || col.type);
                    }
                    // If it is an artificial column do not keep it after unjoining unless needed
                    if (!col.keepjoined && unjoin.indexOf(name) == -1) delete row[name];
                }
            }
        }
    }
}

// Convert rows returned by the database into the Javascript format or into the format
// defined by the table columns.
// The following special properties in the column definition chnage the format:
//  - type = json - if a column type is json and the value is a string returned will be converted into a Javascript object
//  - dflt property is defined for a json type and record does not have a value it will be set to specified default value
//  - list - split the value into an array, optional .separator property can be specified
//  - unjoin - a true value or a list of names, it produces new properties by splitting the value by a separator and assigning pieces to
//      separate properties using names from the list, this is the opposite of the `join` property and is used separately if
//      splitting is required, if joined properties already in the record then no need to split it. If not a list
//      the names are used form the join property.
//
//      Example:
//              db.describeTables([ { user: { id: {}, name: {}, pair: { join: ["left","right"], unjoin: 1 } } ]);
//
//              db.put("test", { id: "1", type: "user", name: "Test", left: "123", right: "000" })
//              db.select("test", {}, lib.log)
//
db.convertRows = function(pool, req, rows, options)
{
    if (typeof pool == "string") pool = this.pools[pool];
    if (!pool) pool = this.getPool(req.options || options);
    var i, col, cols = this.getColumns(req.table, req.options || options);
    var opts = options || req.options || lib.empty;

    for (var p in cols) {
        col = cols[p];
        // Convert from JSON type
        if (!opts.noconvertrows_json) {
            if ((pool.configOptions.noJson && col.type == "json") ||
                (pool.configOptions.noObjects && lib.rxObjectType.test(col.type))) {
                for (i = 0; i < rows.length; i++) {
                    if (typeof rows[i][p] == "string" && rows[i][p]) rows[i][p] = lib.jsonParse(rows[i][p], { logger: "error", [p]: col });
                }
            }
        }

        // Split into a list
        if (col.list && !opts.noconvertrows_list) {
            for (i = 0; i < rows.length; i++) {
                rows[i][p] = lib.toValue(rows[i][p], "list", col);
            }
        }
        // Extract joined values and place into separate columns
        if (!opts.noconvertrows_unjoin) {
            this.unjoinColumns(rows, p, col, opts);
        }

        // Default value on return
        if (cols[p].dflt && !opts.noconvertrows_dflt) {
            for (i = 0; i < rows.length; i++) {
                if (typeof rows[i][p] == "undefined") {
                    switch (typeof cols[p].dflt) {
                    case "object":
                        rows[i][p] = lib.objClone(cols[p].dflt);
                        break;
                    default:
                        rows[i][p] = cols[p].dflt;
                    }
                }
            }
        }

        // Do not return
        if (col.noresult && !opts.noconvertrows_noresult) {
            for (i = 0; i < rows.length; i++) delete rows[i][p];
        }
    }
    return rows;
}

// Add a callback to be called after each cache columns event, it will be called for each pool separately.
// The callback to be called may take options argument and it is called in the context of the pool.
//
// The primary goal for this hook is to allow management of the existing tables which are not own by the
// backendjs application. For such tables, because we have not created them, we need to define column properties
// after the fact and to keep column definitions in the app for such cases is not realistic. This callback will
// allow to handle such situations and can be used to set necessary propeties to the table columns.
//
// Example, a few public columns, allow an admin to see all the columns
//
//         db.setProcessColumns(function() {
//             var cols = db.getColumns("users", { pool: this.name });
//             for (var p in  cols) {
//                 if (["id","name"].indexOf(p) > -1) cols[p].pub = 1; else cols[p].admin = 1;
//             }
//         })
db.setProcessColumns = function(callback)
{
    if (typeof callback != "function") return;
    this.processColumns.push(callback);
}

// Returns a list of hooks to be used for processing rows for the given table
db.getProcessRows = function(type, table, options)
{
    if (!type || !table || !this.processRows[type]) return null;
    var hooks = this.processRows[type][table];
    return lib.isArray(hooks) ? hooks : null;
}

// Run registered pre- or post- process callbacks.
// - `type` is one of the `pre` or 'post`
// - `table` - the table to run the hooks for, usually the same as req.table but can be '*' for global hooks
// - `req` is the original db request object with the following required properties: `op, table, obj, options, info`,
// - `rows` is the result rows for post callbacks and the same request object for pre callbacks.
db.runProcessRows = function(type, table, req, rows)
{
    if (!req) return rows;
    var hooks = this.getProcessRows(type, table, req.options);
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

// Assign a processRow callback for a table, this callback will be called for every row on every result being retrieved from the
// specified table thus providing an opportunity to customize the result.
//
// type defines at what time the callback will be called:
//  - `pre` - making a request to the db on the query record
//  - `post` - after the request finished to be called on the result rows
//
// All assigned callback to this table will be called in the order of the assignment.
//
// The callback accepts 2 arguments: function(req, row)
//   where:
//  - `req` - the original request for a db operation with required
//      - `op` - current db operation, like add, put, ....
//      - `table` -  current table being updated
//      - `obj` - the record with data
//      - `pool` - current request db pool name
//      - `options` - current request db options
//      - `info` - an object returned with special properties like affected_rows, next_token, only passed to the `post` callbacks
//  - `row` - a row from the result
//
// When producing complex properties by combining other properties it needs to be synchronized using both pre and post
// callbacks to keep the record consistent.
//
// **For queries returning rows, if the callback returns true for a row it will be filtered out and not included in the final result set.**
//
//
//  Example
//
//      db.setProcessRow("post", "bk_user", function(req, row) {
//          if (row.birthday) row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
//      });
//
//      db.setProcessRow("post", "bk_icon", function(req, row) {
//          if (row.type == "private" && row.id != req.options.account.id) return true;
//      });
//
db.setProcessRow = function(type, table, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!table || typeof callback != "function") return;
    if (!this.processRows[type]) this.processRows[type] = {};
    if (!this.processRows[type][table]) this.processRows[type][table] = [];
    this.processRows[type][table].push(callback);
}

