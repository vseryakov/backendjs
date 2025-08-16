//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
const path = require('path');
const util = require('util');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

// Assign or clear the current user record for the given request, if user is null the current is cleared.
// All columns in the auth table marked with the `auth` property will be also set in the `req.options.user` which is used
// for permissions when the full user record is not available and only the options are passed.
api.setCurrentUser = function(req, user)
{
    if (!req) return;
    if (!req.user) req.user = {};
    if (!req.options) req.options = {};
    if (user === null) {
        req.user = {};
        req.options.user = {};
    } else
    if (user?.id) {
        for (const p in user) req.user[p] = user[p];
        req.options.user = { id: user.id, login: user.login, name: user.name, type: user.type };
        var cols = db.getFilteredColumns(api.users.table, "auth", { list: 1 });
        for (const p of cols) {
            if (!lib.isEmpty(typeof user[p])) req.options.user[p] = user[p];
        }
        delete req.__user;
    }
    logger.debug("setCurrentUser:", req.user)
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
    var opts = { prefix: "_", defaults: { "*": { secret: this.getTokenSecret(req) } } };
    var params = lib.toParams(req.query, controls ? lib.objMerge(this.controls, controls) : this.controls, opts);
    if (!req.options) req.options = {};
    for (const p in params) req.options[p] = params[p];
    return req.options;
}

// Parse query parameters according to the `params`. Uses global api defaults, if provided in options as well defaults are all merged.
//
// Returns a query object or an error message or null
//
//        var query = api.getQuery(req, { q: { required: 1 } }, { null: 1 });
//
api.getQuery = function(req, params, options)
{
    var opts = lib.objMerge(options, {
        dprefix: req.options?.path + "-",
        defaults: lib.objMerge(options?.defaults, this.queryDefaults, { deep: 1 })
    }, { deep: 1 });

    logger.debug("getQuery:", params, "O:", opts);
    return lib.toParams(req.query, params, opts);
}

// Same as getQuery but uses `req.body`, this is for cases when postdata and query both present
api.getBody = function(req, params, options)
{
    return this.getQuery({ query: req.body, options: req.options }, params, options);
}

// Return a secret to be used for enrypting tokens, it uses the user property if configured or the global API token
// to be used to encrypt data and pass it to the clients. `-api-query-token-secret` can be configured and if a column in the `bk_user`
// with such name exists it is used as a secret, otherwise the value of this property is used as a secret.
api.getTokenSecret = function(req)
{
    if (!this.queryTokenSecret) return "";
    return req.user && req.user[this.queryTokenSecret] || this.queryTokenSecret;
}

// Return an object to be returned to the client as a page of result data with possibly next token
// if present in the info. This result object can be used for pagination responses.
api.getResultPage = function(req, options, rows, info)
{
    rows = Array.isArray(rows) ? rows : lib.emptylist;
    if (options?.total) return { count: rows.length && rows[0].count ? rows[0].count : 0 };
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
//    api.getPublicColumns("bk_user", { allow: ["admins"], skip: /device_id|0$/ });
//
api.getPublicColumns = function(table, options)
{
    var allow = [ "pub" ].concat(lib.isArray(options && options.allow, []));
    var skip = options && util.types.isRegExp(options.skip) ? options.skip : null;
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
// is kept in the `req.options.cleanup` which by default is empty.
//
// By default primary keys are not kept and must be marked with `pub` property in the table definition to be returned.
//
// If any column is marked with `priv` property this means never return that column in the result even for the owner of the record
//
// The `options.isInternal` allows to return everything except secure columns
//
// Columns with the `pub_admin` property will be returned only if the options contains `isAdmin`, same with the `pub_staff` property, it requires `options.isStaff`.
//
// To return data based on the current user roles a special property in the format `pub_types` must be set as a string or an array
// with roles to be present in the current user `type`` field. This is checked only if the column is allowed, this is an
// additional restriction, i.e. a column must be allowed by the `pub` property or other way.
//
// To retstrict by role define `priv_types` in a column with a list of roles which should be denied access to the field.
//
// The `options.pool` property must match the actual rowset to be applied properly, in case the records
// have been retrieved for the different database pool.
//
// The `options.cleanup_strict` will enforce that all columns not present in the table definition will be skipped as well, by default all
// new columns or columns created on the fly are returned to the client. `api.cleanupStrict` can be configured globbly.
//
// The `options.cleanup_rules` can be an object with property names and the values 0, or 1 for `pub` or `2` for `admin`` or `3` for `staff``
//
// The `options.cleanup_copy` means to return a copy of every modified record, the original data is preserved
//
api.cleanupResult = function(table, data, options)
{
    if (!table || !data) return;
    options = options || lib.empty;

    var row, nrows, nrow;
    var r, col, cols = {}, all = 0, pos = 0;
    const admin = options.isAdmin || options.isInternal;
    const internal = options.isStaff || options.isInternal;
    const strict = options.cleanup_strict || this.cleanupStrict;
    const roles = lib.strSplit(options.user?.type);
    const tables = lib.strSplit(table);
    const rules = {
        $: options.cleanup_rules || lib.empty,
        '*': this.cleanupRules["*"] || lib.empty
    };

    for (const table of tables) {
        rules[table] = this.cleanupRules[table] || lib.empty;
        const dbcols = db.getColumns(table, options);
        for (const p in dbcols) {
            col = dbcols[p] || lib.empty;
            r = typeof rules.$[p] == "number" ? rules.$[p] : typeof rules[table][p] == "number" ? rules[table][p] : undefined;
            r = cols[p] = r !== undefined ? r === 1 ? 1 : r === 2 && !admin ? 0 : r === 3 && !internal ? 0 : r === 4 && !options.isInternal ? 0 : r :
                          col.priv ? 0 :
                          col.pub ? 1 :
                          col.pub_staff ? internal ? 3 : 0 :
                          col.pub_admin ? admin ? 2 : 0 :
                          options.isInternal ? 4 : 0;

            if (r && !options.isInternal) {
                if (col.priv_types && lib.isFlag(roles, col.priv_types)) r = cols[p] = 0; else
                if (col.pub_types && !lib.isFlag(roles, col.pub_types)) r = cols[p] = 0;

                // For nested objects simplified rules based on the params only
                if (r && col.params) {
                    const hidden = [], params = col.params;
                    for (const k in params) {
                        col = params[k] || lib.empty;
                        r = col.priv ? 0 :
                            col.pub_staff ? internal ? 1 : 0 :
                            col.pub_admin ? admin ? 1 : 0 : 1;
                        all++;
                        pos += r ? 1 : 0;
                        if (!r) hidden.push(k);
                    }
                    cols[p] = hidden.length ? hidden : cols[p];
                }
            }
            all++;
            pos += r ? 1 : 0;
        }
    }
    // Exit if nothing to cleanup
    if (!strict && (!all || all == pos)) return data;

    const _rules = {};
    function checkRules(p) {
        var r = _rules[p];
        if (r === undefined) {
            for (const n in rules) {
                r = rules[n][p];
                if (r !== undefined) {
                    r = r === 2 && !admin ? 0 : r === 3 && !internal ? 0 : r === 4 && !options.isInternal ? 0 : r;
                    break;
                }
            }
            _rules[p] = r || 0;
        }
        return r;
    }

    const rows = Array.isArray(data) ? data : [ data ];
    for (let i = 0; i < rows.length; ++i) {
        row = rows[i];
        nrow = null;
        for (const p in row) {
            col = cols[p];
            r = col === 0 || Array.isArray(col) || (strict && col === undefined && !checkRules(p));
            if (r) {
                // Lazy copy on modify
                if (options.cleanup_copy && !nrow) {
                    nrow = {};
                    for (const k in row) nrow[k] = row[k];
                    row = nrow;
                }
                if (Array.isArray(col) && row[p]) {
                    var crows = Array.isArray(row[p]) ? row[p] : [row[p]];
                    for (let j = 0; j < crows.length; ++j) {
                        for (const c in col) delete crows[j][col[c]];
                    }
                } else {
                    delete row[p];
                }
            }
        }
        if (options.cleanup_copy && nrow) {
            if (!nrows) nrows = rows.slice(0);
            nrows[i] = nrow;
        }
    }
    if (options.cleanup_copy && nrows) {
        data = Array.isArray(data) ? nrows : nrows[0];
    }
    logger.debug("cleanupResult:", table, rows.length, all, pos, cols, options, _rules);
    return data;
}

api.normalize = function(...args)
{
    try {
        return path.normalize(path.join.apply(path, args.map((x) => (typeof x == "string" ? x : String(x))))).replace(/\\/g, "/");
    } catch (e) {
        logger.error("api.normalize:", e, args);
        return "";
    }
}

api.replacePath = function(req, path)
{
    if (!path || typeof path != "string") return;
    req.options.opath = req.options.path;
    req.options.path = path;
    req.options.apath = req.options.path.substr(1).split("/");
    req.url = req.options.path + req.url.substr(req.options.opath.length);
}

api.clearQuery = db.clearQuery;

// Web proxy: checkProxy("web", req, res)
// WS proxy: checkProxy("ws", req, socket, head)
// Returns a host matched or undefined
api.checkProxy = function(type, ...args)
{
    const req = args[0];
    const path = req.path || req.url;

    for (const host in api.proxy) {
        if (!lib.testRegexp(path, api.proxy[host])) continue;

        if (!api._proxy) {
            api._proxy = require("http-proxy").createProxyServer({});
        }
        const opts = {
            target: "https://" + host,
            ws: true,
            changeOrigin: true,
            hostRewrite: true,
            cookieDomainRewrite: "localhost",
            headers: {
                origin: host
            }
        }
        logger.debug("proxy:", opts, req.options);
        api._proxy[type](...args, opts);
        return host;
    }
}


