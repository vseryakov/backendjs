//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
const util = require('util');
const lib = require(__dirname + '/lib');
const db = require(__dirname + '/db');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');

// Return true if the current user belong to the specified type, account type may contain more than one type.
// NOTE: after this call the `type` property is converted into an array
api.checkAccountType = function(account, type)
{
    if (!lib.isObject(account)) return false;
    if (!Array.isArray(account.type)) account.type = lib.strSplit(account.type);
    return lib.isFlag(account.type, type);
}

// Assign or clear the current account record for the given request, if account is null the account is cleared
api.setCurrentAccount = function(req, account)
{
    if (!req) return;
    if (!req.account) req.account = {};
    if (!req.options) req.options = {};
    if (account === null) {
        req.account = {};
        req.options.account = {};
    } else
    if (account && account.id) {
        for (var p in account) req.account[p] = account[p];
        req.options.account = { id: account.id, login: account.login, name: account.name, type: account.type };
        delete req.__account;
    }
}

// Convert query options into internal options, such options are prepended with the underscore to
// distinguish control parameters from the query parameters.
//
// For security purposes this is the only place that translates special control query parameters into the options properties,
// all the supported options are defined in the `api.controls` and can be used by the apps freely but with caution. See `registerControlParams`.
//
// if `controls` is an object it will be used to define additional control parameters or override existing ones for this request only. Same rules as for
// `registerControlParams` apply.
//
//         api.getOptions(req, { count: { min: 5, max: 100 } })
//
//
api.getOptions = function(req, controls)
{
    var opts = { prefix: "_", data: { "*": { secret: this.getTokenSecret(req) } } };
    var params = lib.toParams(req.query, controls ? lib.objMerge(this.controls, controls) : this.controls, opts);
    if (!req.options) req.options = {};
    for (const p in params) req.options[p] = params[p];
    return req.options;
}

// Parse query parameters according to the `params`, optionally process control parameters if `controls` is specified, this call combines
// `lib.toParams()` with `api.getOptions`. Returns a query object or an error message, on success all controls will be set in the `req.options`
//
//        var query = api.getQuery(req, { q: { required: 1 } }, { _count: { type: "int", min: 10, max: 25 } });
//
api.getQuery = function(req, params, controls)
{
    var query = lib.toParams(req.query, params);
    if (typeof query != "string") this.getOptions(req, controls);
    return query;
}

// Return a secret to be used for enrypting tokens, it uses the account property if configured or the global API token
// to be used to encrypt data and pass it to the clients. `-api-query-token-secret` can be configured and if a column in the `bk_auth`
// with such name exists it is used as a secret, otherwise the value of this property is used as a secret.
api.getTokenSecret = function(req)
{
    if (!this.queryTokenSecret) return "";
    return req.account[this.queryTokenSecret] || this.queryTokenSecret;
}

// Return an object to be returned to the client as a page of result data with possibly next token
// if present in the info. This result object can be used for pagination responses.
api.getResultPage = function(req, options, rows, info)
{
    if (options.total) return { count: rows.length && rows[0].count ? rows[0].count : 0 };
    var token = { count: rows.length, data: rows };
    if (info) {
        if (info.next_token) token.next_token = lib.jsonToBase64(info.next_token, this.getTokenSecret(req));
        if (info.total > 0) token.total = info.total;
    }
    return token;
}

// Columns that are allowed to be visible, used in select to limit number of columns to be returned by a query
//  - pub property means public column
//  - admins property means visible to admins and owners only
//
// options may be used to define the following properties:
//  - skip - a regexp with names to be excluded as well
//  - allow - a list of properties which can be checked along with the `pub` property for a column to be considered public
//  - disallow - a list of properties which if set will prevent a column to be returned, it is checked before the 'allow' rule
//
//    api.getPublicColumns("bk_account", { allow: ["admins"], skip: /device_id|0$/ });
//
api.getPublicColumns = function(table, options)
{
    var allow = [ "pub" ].concat(lib.isArray(options && options.allow, []));
    var skip = options && util.isRegExp(options.skip) ? options.skip : null;
    var disallow = lib.isArray(options && options.disallow);
    var cols = db.getColumns(table, options);
    return Object.keys(cols).filter(function(x) {
        if (skip && skip.test(x)) return false;
        for (const i in disallow) if (cols[x][disallow[i]]) return false;
        for (const i in allow) if (cols[x][allow[i]]) return true;
        return false;
    });
}

// Process records and keep only public properties as defined in the table columns. This method is supposed to be used in the post process
// callbacks after all records have been processes and are ready to be returned to the client, the last step would be to cleanup
// all non public columns if necessary.
//
// `table` can be a single table name or a list of table names which combined public columns need to be kept in the rows. List of request tables
// is kept in the `req.options.cleanup` which by default is a table name of the API endpoint, for example for /account/get it will contain bk_account, for
// /connection/get - bk_connection.
//
// In the `options` account object can be present to detect account own records which will not be cleaned and all properties will be returned, by default `id`
// property is used to detect current account but can be specified by the `options.account_key` property.
//
// By default primary keys are not kept and must be marked with `pub` property in the table definition to be returned.
//
// If any column is marked with `secure` property this means never return that column in the result even for the owner of the record
//
// To return data based on the current account roles a special property in the format `pub_type_ROLE` must be set
// and the `ROLE` must be present in the current account `type`` field.
//
// If any column is marked with `admin` or `admins` property and the current account is an admin this property will be returned as well. The `options.admin`
// can be used to make it an artificial admin. Same goes for `staff` as a second level of admin permissions.
// Thes same can be implemented as properties `pub_type_admin: 1` or `pub_type_staff: 1`.
//
// The `options.cleanup_strict` will enforce that all columns not present in the table definition will be skipped as well, by default all
// new columns or columns created on the fly are returned to the client.
//
// The `options.cleanup_rules` can be an object with property names and the values -1, 0, or 1 which correspond to:
// -1 - never return, 0 return only to the owner, 1 always return.
//
// The `pub_max` property makes the column to be partialy visible i.e. for purposes not to expose the whole data but only part of it, keep only first
// specified characters and replace the rest with X, must be 2 or greater
//
// The `pub_enc` property makes the column to be returned in the encrypted form using the `lib.encrypt(api.queryTokenSecret, value)` or if a
// function `pub_enc` in the `options` exists it will be called: `function(name, value, options)`
//
// The `options.pool` property must match the actual rowset to be applied properly, in case the records have been retrieved for the different
// database pool.
api.checkResultColumns = function(table, data, options)
{
    if (!table || !data) return;
    if (!options) options = {};
    var cols = {}, row, owner, col;
    var rules = options.cleanup_rules || lib.empty;
    var key = options.account_key || 'id';
    var aid = options.account && options.account.id || "";
    var roles = options.account ? lib.strSplit(options.account.type).reduce((x, y) => { x["pub_type_" + y] = 1; return x }, {}) : {};
    var tables = lib.strSplit(table);
    for (let i = 0; i < tables.length; i++) {
        const dbcols = db.getColumns(tables[i], options);
        for (const p in dbcols) {
            col = dbcols[p];
            cols[p] = typeof rules[p] != "undefined" ? rules[p] :
                      col ? (col.pub ? 1 :
                             col.secure ? -1 :
                             col.staff ? options.staff || roles.pub_type_staff ? 1 : 0 :
                             col.admin || col.admins ? options.admin || roles.pub_type_admin ? 1 : 0 :
                             col.pub_max > 1 ? col.pub_max :
                             col.pub_enc ? 9999 : 0) : 0;

            // role specific rules are more strict so need to check always at the end
            if (cols[p] != 1) continue;
            for (const c in col) {
                if (c[0] == "p" && c[3] == "_" && c.substr(0, 9) == "pub_type_" && !roles[c]) {
                    cols[p] = 0;
                    break;
                }
            }
        }
    }
    if (!Object.keys(cols).length) return data;
    var rows = Array.isArray(data) ? data : [ data ];
    logger.debug("checkResultColumns:", table, cols, rows.length, aid, options);
    for (let i = 0; i < rows.length; i++) {
        // For personal records, skip only special columns
        row = rows[i];
        owner = aid == row[key];
        for (const p in row) {
            if (typeof cols[p] == "undefined") {
                if (options.strict) delete row[p];
                continue;
            }
            // Owners only skip secure columns
            if (owner && cols[p] < 0) delete row[p];
            if (!owner && cols[p] <= 0) delete row[p];
            if (cols[p] == 9999) {
                row[p] = "$" + (typeof options.pub_enc == "function" ? options.pub_enc(p, row[p], options) :
                                       lib.encrypt(this.accessTokenSecret, String(row[p])));
            } else
            if (cols[p] > 1) {
                const c = String(row[p]);
                if (c.length > cols[p]) row[p] = c.substr(0, cols[p]) + "X".repeat(c.length - cols[p]);
            }
        }
    }
    return data;
}

// Clear request query properties specified in the table definition or in custom schema.
//
// The `table` argument can be a table name or an object with properties as columns.
//
// If `options.filter` is not specified the `query` will only keep existing columns for the given table.
//
// If `options.filter` is a list then the `query` will delete properties for columns that contain any specified
// property from the filter list. This is used for the `bk_auth` table to remove properties that supposed to be updated by admins only.
// The filter will keep non-existent columns in the `query`. To remove such columns when using the filter specify `options.force`.
//
// If a name in the filter is prefixed with ! then the logic is reversed, keep all except this property
//
// If `options.keep` is a regexp it will be used to keep matched properties by name in the `query` regardless of any condition.
//
// If `options.clear` is a regexp it will be used to remove matched properties by name in the `query`.
//
//  Example:
//
//        api.clearQuery("bk_account", req.query)
//        api.clearQuery("bk_auth", req.query, "admin")
//        api.clearQuery("bk_auth", req.query, { filter: "admin" })
//        api.clearQuery("bk_auth", req.query, { filter: ["admin"] })
//        api.clearQuery("bk_auth", req.query, { filter: ["!pub"] })
//        api.clearQuery("bk_account", req.query, { filter: ["admin","secure"] })
//        api.clearQuery("bk_account", req.query, { filter: ["admin","!secure"], keep: /^__/ })
//        api.clearQuery({ name: {}, id: { admin: 1 } }, req.query, { filter: ["admin"] })
//
api.clearQuery = function(table, query, options)
{
    var cols = lib.isObject(table) ? table : db.getColumns(table), name, reverse;
    if (typeof options == "string") options = { filter: [options] };
    if (!options) options = lib.empty;
    var filter = lib.isArray(options.filter) || (typeof options.filter == "string" && [options.filter]);
    var keep = options.keep && util.isRegExp(options.keep) ? options.keep : null;
    var clear = options.clear && util.isRegExp(options.clear) ? options.clear : null;
    if (!filter) {
        for (const p in query) {
            if (keep && keep.test(p)) continue;
            if (!cols[p] || (clear && clear.test(p))) delete query[p];
        }
        return query;
    }
    for (var i in filter) {
        name = filter[i];
        if (!name) continue;
        if (name[0] == "!") {
            reverse = 1;
            name = name.substr(1);
        } else {
            reverse = 0;
        }
        for (const p in cols) {
            if (keep && keep.test(p)) continue;
            if ((!reverse && cols[p][name]) || (reverse && !cols[p][name])) delete query[p];
        }
    }
    if (clear || options.force) {
        for (const p in query) {
            if (keep && keep.test(p)) continue;
            if (clear && clear.test(p)) delete query[p];
            if (options.force && !cols[p]) delete query[p];
        }
    }
    return query;
}

