/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const path = require('path');
const util = require('util');
const fs = require('fs');
const qs = require("qs");
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const cache = require(__dirname + '/../cache');
const db = require(__dirname + '/../db');

/**
 * Replace redirect placeholders in the path/url for the current request
 * @param {object} req - Express Request
 * @param {string} pathname - redirect path, it may contain placeholders in the form: @name@:
 * - HOST - full host name from header
 * - IP - remote IP address
 * - DOMAIN - domain from the hostname
 * - PATH([1-9])? - full path or a part
 * - URL - full url
 * - BASE - basename from the path no extention
 * - FILE - base file name with extention
 * - DIR - directory name only
 * - SUBDIR - last part of the directory path
 * - EXT - file extention
 * - QUERY - stringified query
 * @return {string} possibly new path
 * @memberof module:api
 * @method checkRequestPlaceholders
 */
api.checkRequestPlaceholders = function(req, pathname)
{
    return pathname.replace(/@(HOST|IP|DOMAIN|PATH([1-9])?|URL|BASE|FILE|DIR|SUBDIR|EXT|QUERY)@/g, function(_, m) {
        switch (m.substr(0, 2)) {
        case "HO": return req.options.host;
        case "IP": return req.options.ip;
        case "DO": return req.options.domain;
        case "PA": return m[4] > 0 ? req.options.apath.slice(m[4]).join("/") : req.options.path;
        case "UR": return req.url;
        case "BA": return path.basename(req.options.path).split(".").shift();
        case "FI": return path.basename(req.options.path);
        case "DI": return path.dirname(req.options.path);
        case "SU": return path.dirname(req.options.path).split("/").pop();
        case "EX": return path.extname(req.options.path);
        case "QU": return qs.stringify(req.query);
        }
    });
}

/**
 * Perform rate limiting by specified property, if not given no limiting is done.
 * @param {object} req - Express Request
 * @param {object} options
 * @param {string|string[]} options.type - determines by which property to perform rate limiting, when using user properties
 *     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
 *     custom type and used as is. If it is an array all items will be checked sequentially.
 *     **This property is required.**
 *
 *     The predefined types checked for every request:
 *     - ip - check every IP address
 *     - path - limit by path and IP address, * can be used at the end to match only the beginning,
 *         method can be placed before the path to use different rates for the same path by request method
 *
 *         -api-rlimits-rate-ip=100
 *         -api-rlimits-rate-/api/path=2
 *         -api-rlimits-rate-GET/api/path=10
 *         -api-rlimits-rate-/api/path/*=1
 *         -api-rlimits-rate-/api/path/127.0.0.1=100
 *         -api-rlimits-map-/api/*=rate:100,interval:1000
 *
 * @param {string} [options.ip] - to use the specified IP address
 * @param {number} [options.max - max capacity to be used by default
 * @param {number} [options.rate] - fill rate to be used by default
 * @param {number} [options.interval] - interval in ms within which the rate is measured, default 1000 ms
 * @param {string} [options.message] - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
 * @param {string} [options.queue] - which queue to use instead of the default, some limits are more useful with global queues like Redis instead of the default in-process cache
 * @param {number} [options.delay] - time in ms to delay the response, slowing down request rate
 * @param {number} [options.multiplier] - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
 *    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
 *    value on first successful consumption
 * @param {function} callback as function(err, info) where info is from {@link module:cache.limiter}
 * @example
 *
 *  api.checkRateLimits(req, { type: "ip", rate: 100, interval: 60000 }, (err, info) => {
 *     if (err) return api.sendReply(err);
 *     ...
 *  });
 * @example <caption>More endpoint config examples</caption>
 * api-rlimits-map-/pub/settings=rate:10,interval:1000,delay:250
 * api-rlimits-map-GET/passkey/login=rate:3,interval:1000,delay:250
 * api-rlimits-map-/login=rate:3,interval:30000,delay:1000,multiplier:1.5,queue:unique
 * api-rlimits-map-/checkin*=rate:5,interval:30000
 * @memberof module:api
 * @method checkRateLimits
 */
api.checkRateLimits = function(req, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (!req || !options?.type) return callback();
    var types = Array.isArray(options.type) ? options.type : [ options.type ];
    var ip = options.ip || req.options?.ip;
    var mapping = this.rlimitsMap;
    lib.forEachSeries(types, (type, next) => {
        var name = type, key = type;
        switch (type) {
        case "ip":
            name = ip;
            break;

        case "path":
            key = options.path || req.options?.path;
            if (!key) break;
            if (!mapping[key] && !mapping[req.method + key]) {
                for (const p in mapping) {
                    const item = mapping[p];
                    if (item._seen === undefined) {
                        item._seen = p.endsWith("*") ? p.slice(0, -1) : null;
                    }
                    if (item._seen && key.startsWith(item._seen)) {
                        key = p;
                        break;
                    }
                }
            }
            name = key + "/" + ip;
            break;
        }

        var map = mapping[name] || mapping[req.method + key] || mapping[key];
        var rate = options.rate || map?.rate;
        logger.debug("checkRateLimits:", type, key, name, req.method, options, map);
        if (!rate) return next();
        var max = options.max || map?.max || rate;
        var interval = options.interval || map?.interval || this.rlimits.interval || 1000;
        var multiplier = options.multiplier || map?.multiplier || this.rlimits.multiplier || 0;
        var ttl = options.ttl || map?.ttl || this.rlimits.ttl;
        var cacheName = options.cache || map?.cache || this.limiterCache;

        // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
        // in server mode use direct access to the LRU cache
        var limit = {
            name: "RL:" + name,
            rate,
            max,
            interval,
            ttl,
            multiplier,
            cacheName,
        };
        cache.limiter(limit, (delay, info) => {
            logger.debug("checkRateLimits:", options, "L:", limit, "D:", delay, info);
            if (!delay) return next();
            var err = { status: 429, message: lib.__(options.message || map?.message || api.rlimits.message, lib.toDuration(delay)), retryAfter: delay };
            if (options.delay || map?.delay) {
                if (req.options) req.options.sendDelay = -1;
                return setTimeout(callback, options.delay || map?.delay, err, info);
            }
            callback(err, info);
        });
    }, callback, true);
}

/**
 * Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
 * If err is not null the error message is returned immediately with {@link module:api.sendReply}.
 *
 * if `req.options.cleanup` is defined it uses {@link module:api.cleanupResult} to remove not allowed properties according to the given table rules.
 *
 * @param {object} req - Express Request object
 * @param {string|string[]} [options.cleanup] - a table or list of tables to use for cleaning records before returning, see {@link module:api.cleanupResult}
 * @param {object|Error} [err] - error object
 * @param {object} [data] - data to send back as JSON
 * @memberof module:api
 * @method sendJSON
 */
api.sendJSON = function(req, err, data)
{
    if (err) return this.sendReply(req.res, err);

    // Do not cache API results by default, routes that send directly have to handle cache explicitely
    if (!req.res.get("cache-control")) {
        req.res.header("pragma", "no-cache");
        req.res.header("cache-control", "max-age=0, no-cache, no-store");
        req.res.header('last-modified', new Date().toUTCString());
    }

    if (!data) data = {};
    var sent = 0;
    var hooks = this.hooks.find('post', req.method, req.options.path);
    lib.forEachSeries(hooks, (hook, next) => {
        try {
            sent = hook.callback(req, req.res, data);
        } catch (e) {
            logger.error('sendJSON:', req.options.path, e.stack);
        }
        logger.debug('sendJSON:', req.method, req.options.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, (err) => {
        if (sent || req.res.headersSent) return;
        if (req.options.cleanup) {
            api.cleanupResult(req, req.options.cleanup, typeof data.count == "number" && Array.isArray(data.data) ? data.data : data);
        }
        if (req.options.pretty) {
            req.res.header('Content-Type', 'application/json');
            req.res.status(200).send(lib.stringify(data, null, req.options.pretty) + "\n");
        } else {
            req.res.json(data);
        }
    }, true);
}

/**
 * Send result back formatting according to the options properties:
 *  - format - json, csv, xml, JSON is default
 *  - separator - a separator to use for CSV and other formats
 * @memberof module:api
 * @method sendFormatted
 */
api.sendFormatted = function(req, err, data, options)
{
    if (err) return this.sendReply(req.res, err);
    if (!options) options = req.options;
    if (!data) data = {};

    switch (options.format) {
    case "xml":
        if (req.options.cleanup) {
            this.cleanupResult(req, req.options.cleanup, typeof data.count == "number" && Array.isArray(data.data) ? data.data : data);
        }
        var xml = "<data>\n";
        if (data.next_token) xml += "<next_token>" + data.next_token + "</next_token>\n";
        xml += lib.toFormat(options.format, data, options);
        xml += "</data>";
        req.res.set('Content-Type', 'application/xml');
        req.res.status(200).send(xml);
        break;

    case "csv":
        if (req.options.cleanup) {
            this.cleanupResult(req, req.options.cleanup, typeof data.count == "number" && Array.isArray(data.data) ? data.data : data);
        }
        var rows = Array.isArray(data) ? data : (data.data || lib.emptylist);
        var csv = "";
        if (!options.header) csv = lib.objKeys(rows[0]).join(options.separator || ",") + "\n";
        csv += lib.toFormat(options.format, rows, options);
        req.res.set('Content-Type', 'text/csv');
        req.res.status(200).send(csv);
        break;

    case "json":
    case "jsontext":
        if (req.options.cleanup) {
            this.cleanupResult(req, req.options.cleanup, typeof data.count == "number" && Array.isArray(data.data) ? data.data : data);
        }
        var json = lib.toFormat(options.format, data, options);
        req.res.set('Content-Type', 'text/plain');
        req.res.status(200).send(json);
        break;

    default:
        this.sendJSON(req, err, data);
    }
}

/**
 * Return reply to the client using the options object, it contains the following properties:
 * **i18n Note:**
 *
 * The API server attaches fake i18n functions `req.__` and `res.__` which are used automatically for the `message` property
 * before sending the response.
 *
 * With real i18n module these can/will be replaced performing actual translation without
 * using `i18n.__` method for messages explicitely in the application code for `sendStatus` or `sendReply` methods.
 *
 * Replies can be delayed per status via `api.delays` if configured, to override any dalays set
 * `req.options.sendDelay` to nonzero value, negative equals no delay
 *
 * @param {object} res - Express Response
 * @param {object} options
 * @param {number} [options.status=200] - the respone status code
 * @param {string} [options.message]  - property to be sent as status line and in the body
 * @param {string} [options.contentType] - defines Content-Type header, the `options.message` will be sent in the body only
 * @param {string} [options.url] - for redirects when status is 301, 302...
 *
 * @memberof module:api
 * @method sendStatus
 */
api.sendStatus = function(res, options)
{
    if (res.headersSent) return;
    if (!options) options = { status: 200, message: "" };
    var req = res.req, sent = 0;
    var status = options.status || 200;
    var delay = req.options?.sendDelay || (options.code && api.delays[`${status}:${options.code}`]) || api.delays[status];
    try {
        switch (status) {
        case 301:
        case 302:
        case 303:
        case 307:
        case 308:
            res.redirect(status, options.url);
            break;

        default:
            var hooks = this.hooks.find('status', req.method, req.options?.path);
            lib.forEachSeries(hooks, (hook, next) => {
                try {
                    sent = hook.callback(req, res, options);
                } catch (e) {
                    logger.error('sendStatus:', req.options?.path, e.stack);
                }
                logger.debug('sendStatus:', req.method, req.options?.path, hook.path, 'sent:', sent || res.headersSent, delay);
                next(sent || res.headersSent);
            }, (err) => {
                if (sent || res.headersSent) return;
                if (options.contentType) {
                    res.type(options.contentType);
                    if (delay > 0) {
                        setTimeout(() => {
                            res.status(status).send(res.__(options.message || ""));
                        }, delay);
                    } else {
                        res.status(status).send(res.__(options.message || ""));
                    }
                } else {
                    for (const p in options) {
                        if (typeof options[p] == "string") options[p] = res.__(options[p]);
                    }
                    if (delay > 0) {
                        setTimeout(() => {
                            res.status(status).json(options);
                        }, delay);
                    } else {
                        res.status(status).json(options);
                    }
                }
            }, true);
        }
    } catch (e) {
        logger.error('sendStatus:', res.req.url, api.cleanupHeaders(res.getHeaders()), options, e.stack);
        if (!res.headersSent) {
            res.status(500).send("Internal error");
        }
    }
}

/**
 * Send formatted JSON reply to an API client, calls {@link module:api.sendStatus} after formatting the parameters.
 *
 * @param {object} res - Express Response
 * @param {object|string|Error|number} - different scenarios by type:
 * - number: this is HTTP status code, text must be provided to return
 * - string: return 500 error with status as text
 * - object: status properties is set to 200 if not proided
 * - Error: return a generic error message `api.errInternalError` without exposing the real error message, it will log all error exceptions in the logger
 * subject to log throttling configuration.
 * @param {string} [text] - message to return
 * @example
 * api.sendReply(res, 400, "invalid input")
 * api.sendReply(res, "server is not available")
 * @memberof module:api
 * @method sendReply
 */
api.sendReply = function(res, status, text)
{
    if (util.types.isNativeError(status)) {
        // Do not show runtime errors
        if (status.message && !this.errlog.ignore?.rx.test(status.message)) {
            if (!this.errlog.token || this.errlog.token.consume(1)) {
                logger.error("sendReply:", res.req.url, status.message, api.cleanupHeaders(res.req.headers), res.req.options, lib.traceError(status), res.req.body);
            }
        }
        text = lib.testRegexpObj(status.code, this.errlog.codes) ? res.__(status.message) :
               status._msg ? res.__(status._msg) : res.__(this.errInternalError);
        status = status.status > 0 ? status.status : 500;
        return this.sendStatus(res, { status: status || 200, message: typeof text == "string" ? text : String(text || "") });
    }
    if (status instanceof Object) {
        status.status = status.status > 0 ? status.status : 200;
        return this.sendStatus(res, status);
    }
    if (typeof status == "string" && status) {
        text = status;
        status = 500;
    }
    if (status >= 400) logger.debug("sendReply:", status, text);
    this.sendStatus(res, { status: status || 200, message: typeof text == "string" ? text : String(text || "") });
}

/**
 * Send file back to the client or return 404 status
 * @param {object} req - Express Request
 * @param {string} file - absolute file path
 * @param {boolean} [redirect] - redirect url in case of error instead of returning 404
 * @memberof module:api
 * @method sendFile
 */
api.sendFile = function(req, file, redirect)
{
    file = lib.normalize(file);
    fs.stat(file, (err, st) => {
        logger.debug("sendFile:", file, st);
        if (req.method == 'HEAD') {
            return req.res.set("Content-Length", err ? 0 : st.size).set("Content-Type", app.mime.lookup(file)).status(!err ? 200 : 404).send();
        }
        if (!err) return req.res.sendFile(file);
        if (redirect) return req.res.redirect(redirect);
        req.res.sendStatus(404);
    });
}

/**
 * Parse body/query parameters according to the `schema` by using `lib.toParams`,
 * uses the req.body if present or req.query.
 * @param {object} req - Express request
 * @param {module:lib.ParamsOptions} schema - schema object
 * @param {object} [options]
 * @param {object} [options.defaults] - merged with global `queryDefaults`
 * @param {boolean} [options.query] - use only `req.query`, not req.body
 * @returns {object|string} - a query object or an error message or null
 * @example
 *  var query = api.toParams(req, { q: { required: 1 } }, { null: 1 });
 *  if (typeof query == "string") return api.sendReply(req, 400, query)
 * @memberof module:api
 * @method toParams
 */
api.toParams = function(req, schema, options)
{
    var opts = lib.extend({}, options, {
        dprefix: req.options?.path + "-",
        defaults: lib.extend({}, options?.defaults, this.queryDefaults)
    });
    logger.debug("toParams:", schema, "O:", opts);

    var query = options?.query ? req.query : req.body || req.query;
    return lib.toParams(query, schema, opts);
}

/**
 * Return an object to be returned to the client as a page of result data with possibly next token
 * if present in the info. This result object can be used for pagination responses.
 * @param {object} req - Express Request object
 * @param {boolean} [req.options.total] - return count only from rows[0].count
 * @param {object|object[]} rows
 * @param {object} info
 * @param {any} [info.next_token] - if present returned in result, this is from DB pagination, only numbers are returned
 *  as is, if it is a not number the next_token is base64 encoded with {@link module:lib.jsonToBase64}.
 *  When processing requests with JSON tokens in {@link module:api.toParams} use the "token" type
 * @example <caption>Validating pagonation request</caption>
 * var query = api.toParams(req, {
 *     { count: { type: "int", dflt: 25 } },
 *     { start: { type: "token" } }
 * })
 * @param {number} [req.options.total] - total results if available (Elasticsearch)
 * @return {object} with properties { count, data, next_token, total }
 * @memberof module:api
 * @method getResultPage
 */
api.getResultPage = function(req, rows, info)
{
    rows = Array.isArray(rows) ? rows : lib.emptylist;
    if (req?.options?.total) {
        return { count: rows.length && rows[0].count || 0 };
    }
    var token = { count: rows.length, data: rows };
    if (info) {
        if (info.next_token) {
            token.next_token = lib.isNumber(info.next_token) || lib.jsonToBase64(info.next_token);
        }
        if (info.total > 0) token.total = info.total;
    }
    return token;
}

/**
 * Process records and keep only public properties as defined in the table columns. This method is supposed to be used in the post process
 * callbacks after all records have been processes and are ready to be returned to the client, the last step would be to cleanup
 * all non public columns if necessary. See  the `api` object in {@link DbTableColumn} for all supported conditions.
 *
 * @param {object} req - Express HTTP incoming request
 * @param {boolean} [req.options.cleanup_strict] will enforce that all columns not present in the table definition will be skipped as well, by default all
 * new columns or columns created on the fly are returned to the client. `api.cleanupStrict=1` can be configured globally.
 *
 * @param {object} [req.options.cleanup_rules] can be an object with property names and the values 0|1 for `pub`, `2` for `admin`, `3` for `staff``
 *
 * @param { boolean} [req.options.cleanup_copy] means to return a copy of every modified record, the original data is preserved
 * @param {string|string[]} table - can be a single table name or a list of table names which combined public columns need to
 * be kept in the rows.
 * @param {object|object[]} data
 * @return {object|object[]} cleaned records
 *
 * @memberof module:api
 * @method cleanupResult
 */
api.cleanupResult = function(req, table, data)
{
    if (!req || !table || !data) return;

    var row, nrows, nrow;
    var r, col, cols = {}, all = 0, pos = 0;

    const options = req.options || lib.empty;
    const admin = options.isAdmin || options.isInternal;
    const internal = options.isStaff || options.isInternal;
    const strict = options.cleanup_strict || this.cleanupStrict;
    const roles = lib.split(req.user?.roles);
    const tables = lib.split(table);
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
                          !col.api || col.api.priv ? 0 :
                          col.api.pub ? 1 :
                          col.api.staff ? internal ? 3 : 0 :
                          col.api.admin ? admin ? 2 : 0 :
                          options.isInternal ? 4 : 0;

            if (r && !options.isInternal) {
                if (col.api.noroles && lib.isFlag(roles, col.api.noroles)) r = cols[p] = 0; else
                if (col.api.roles && !lib.isFlag(roles, col.api.roles)) r = cols[p] = 0;

                // For nested objects simplified rules based on the params only
                if (r && col.params) {
                    const hidden = [], params = col.params;
                    for (const k in params) {
                        col = params[k] || lib.empty;
                        r = !col.api || col.api.priv ? 0 :
                             col.api.staff ? internal ? 1 : 0 :
                             col.api.admin ? admin ? 1 : 0 : 1;
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

/**
 * Replace current request path including updating request options. It is used in routing and vhosting.
 * @param {object} req - Express Request
 * @param {stream} path - new request path
 * @memberof module:api
 * @method replacePath
 */
api.replacePath = function(req, path)
{
    if (!lib.isString(path)) return;
    req.options.opath = req.options.path;
    req.options.path = path;
    req.options.apath = req.options.path.substr(1).split("/");
    req.url = req.options.path + req.url.substr(req.options.opath.length);
}


/**
 * Register access rate limit for a given name, all other rate limit properties will be applied as
 * described in the {@link module:api.checkRateLimits}
 * @param {string} name - path or reserved rate type
 * @param {object} options
 * @param {number} options.rate - base rate limit
 * @param {number} options.max - max rate limit
 * @param {number} options.internal - rate interval
 * @param {number} options.queue - which limiter queue to use
 * @memberof module:api
 * @method registerRateLimits
 */
api.registerRateLimits = function(name, options)
{
    if (!name) return false;
    this.rlimitsMap[name] = options;
    return true;
}

/**
 * Register a callback to be called just before HTTP headers are flushed, the callback may update response headers
 * @param {object} req - Express Request
 * @param {function} callback is a function(req, res, statusCode)
 * @memberof module:api
 * @method registerPreHeaders
 */
api.registerPreHeaders = function(req, callback)
{
    if (typeof callback != "function") return;
    if (typeof req?.res?.writeHead != "function") return;
    var old = req.res.writeHead;
    req.res.writeHead = function(statusCode, statusMessage, headers) {
        if (callback) {
            callback(req, req.res, statusCode);
            callback = null;
        }
        old.call(req.res, statusCode, statusMessage, headers);
    }
}
