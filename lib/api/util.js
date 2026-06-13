/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
 * Validate body/query parameters according to the `schema` by using {@link module:lib.validate},
 * uses the context.body if present or context.query
 * @param {RequestContext} context
 * @param {module:lib.ParamsOptions} schema - schema object
 * @param {object} [options]
 * @param {object} [options.defaults] - merged with global `api.defaults`
 * @param {boolean} [options.query] - use only `context.query`, req.context.body
 * @returns {object} - a query object or an error { data, err }
 * @example
 *  const { err, data } = api.validate(context, { q: { required: 1 } });
 *  if (err) return context.reply(err)
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
                (context?.user?.id || context?.userId || "-");

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
