/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const path = require('path');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
 * Replace redirect placeholders in the path/url for the current request
 * @param {RequestContext} context - Request context object
 * @param {string} pathname - redirect path, it may contain placeholders in the form: @name@:
 * - HOST - full host name from header
 * - IP - remote IP address
 * - DOMAIN - domain from the hostname
 * - PATH([1-9])? - full path or a path starting from given index till the end, eg.: /a/b/c/d, PATH2 will be /b/c/d
 * - URL - full url
 * - BASE - basename from the path no extention
 * - FILE - base file name with extention
 * - DIR - directory name only
 * - SUBDIR - last part of the directory path
 * - EXT - file extention
 * - QUERY - stringified query
 * @return {string} possibly new path
 * @memberof module:api
 * @method checkPlaceholders
 */
api.checkPlaceholders = function(context, pathname)
{
    return pathname.replace(/@(HOST|IP|DOMAIN|PATH([1-9])?|URL|BASE|FILE|DIR|SUBDIR|EXT|QUERY)@/g, function(_, m) {
        switch (m.substr(0, 2)) {
        case "HO": return context.host;
        case "IP": return context.ip;
        case "DO": return context.domain;
        case "PA": return m[4] > 0 ? context.paths.slice(m[4] - 1).join("/") : context.path;
        case "UR": return context.url;
        case "BA": return path.basename(context.path).split(".").shift();
        case "FI": return path.basename(context.path);
        case "DI": return path.dirname(context.path);
        case "SU": return path.dirname(context.path).split("/").pop();
        case "EX": return path.extname(context.path);
        case "QU": return context.search;
        }
    });
}

/**
 * Validate body/query parameters according to the `schema` by using `lib.validate`,
 * uses the context.body if present or context.query.
 * @param {RequestContext} context
 * @param {module:lib.ParamsOptions} schema - schema object
 * @param {object} [options]
 * @param {object} [options.defaults] - merged with global `api.defaults`
 * @param {boolean} [options.query] - use only `context.query`, req.context.body
 * @returns {object|string} - a body object or an error message or null
 * @example
 *  var body = api.validate(req, { q: { required: 1 } }, { null: 1 });
 *  if (typeof body == "string") return api.sendReply(req, 400, query)
 * @memberof module:api
 * @method validate
 */
api.validate = function(context, schema, options)
{
    var opts = lib.extend({}, options, {
        dprefix: context?.path + "-",
        defaults: lib.extend({}, options?.defaults, api.defaults)
    });
    logger.debug("validate:", "api", context, "S:", schema, "O:", opts);

    var query = options?.query ? context.query : context.body || context.query;
    return lib.validate(query, schema, opts);
}

/**
 * Record reauest into access log if enabled
 * @param {RequestContext} context
 * @memberof module:api
 * @method writeAccesslog
 */
api.writeAccesslog = function(context)
{
    if (api.accesslog.disabled) return;

    if (context.var("accesslog", true)) return;

    const { reqID, time, method, req, res } = context;
    const now = new Date();

    var line = context.ip + " - " +
                (api.accesslog.file ? '[' + now.toUTCString() + ']' : "-") + " " +
                (method || "NONE") + " " +
                (context.orig?.url || context.url) + " " +
                (req?.httpVersion || "-") + " " +
                (res?.statusCode || 0) + " " +
                (res?.headers?.['content-length'] || '-') + " - " +
                (now - time) + " ms " +
                (reqID || "-") + " - " +
                (req?.headers?.['user-agent'] || "-") + " - " +
                (context?.user?.id || "-");

    // Append additional fields
    for (let v of api.accesslog.fields) {
        switch (v[1] == ":" ? v[0] : "") {
        case "q":
            v = context?.query?.[v.substr(2)];
            break;
        case "b":
            v = context?.body?.[v.substr(2)];
            break;
        case "h":
            v = req?.headers?.[v.substr(2)];
            break;
        case "u":
            v = context?.user?.[v.substr(2)];
            break;
        case "o":
            v = context?.[v.substr(2)];
            break;
        }
        if (typeof v == "object") v = "";
        line += " " + (v || "-");
    }
    if (api.accesslog.file) {
        line += "\n";
    }
    api.accesslog.stream.write(line);
}


