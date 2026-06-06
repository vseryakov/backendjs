
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/body
  */

const qs = require("querystring");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

const mod = {
    name: "middleware.body",
    args: [
        { name: "global", type: "bool", descr: "Enable the middlware to parse body by content type for all routes" },
        { name: "methods", type: "list", upper: 1, descr: "HTTP methods enabled in global mode" },
        { name: "content-type", type: "list", descr: "List of additional content types to be parsed in additional to default json/url-encoded/text", example: "middleware-body-content-type = text/xml, image/png" },
        { name: "max-size", type: "number", descr: "Max size for body in bytes" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    maxSize: 64000,

    methods: ["POST", "PUT", "PATCH"],

    errTooLarge: "Unable to process the request, it is too large",
};

/**
 * Parse body for JSON, x-www-form-urlencoded and plain/text content.
 *
 * Store parsed data in the `context.body`.
 *
 * Default max body size is 64k, can be configued via `middleware-body-max-size = NNNN` config parameter, in bytes.
 *
 * In global node via `middleware-body-global = true` no need to register the middleware in the code, it wil be enabled
 * on startup automatically. Just check for `context.body` in the route handlers.
 *
 * In manual mode see below:
 *
 * ```js
 * const { api, middleware } = require("backendjs");
 *
 * api.app.post("*", middleware.body)
 *
 * // or individually
 *
 * api.app.post("/api/data", middleware.body, (context, next) => {
 *     if (context.body?.id) ....
 * })
 *
 * ```
 * Additional content types can be collected via global config `middleware-body-content-type = type1, type2...` config or manually
 * binding the parser with custom object containing `contentType` property.
 *
 * ```js
 * api.app.post("/data", middleware.body.handle.bind({ contentType: ["mime/type1", "mime/type2"] }))
 * ```
 *
 */
module.exports = mod;

/**
 * Start global middleware if enabled, run body parser for all endpoints
 *
 * Only methods in `middleware-body-methods` enabled, defaults are POST/PUT/PATCH.
 *
 * @memberof module:middleware/body
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (this.global) {
        for (const method of this.methods) {
            api.app.use(method, "*", mod);
        }
    }

    callback();
}

/**
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/body
 * @method handle
 * @example
 *
 * api.app.post("*", middleware.body)
 *
 * api.app.post("/api", middleware.body)
 *
 */
mod.handle = function(context, next)
{
    if (context.body !== undefined) return next();

    const { req, contentType } = context;

    switch (contentType) {
    case "text/plain":
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        if (!this.contentType?.length || !this.contentType.includes(contentType)) {
            return next();
        }
        req.setEncoding('binary');
    }

    const length = lib.toNumber(req.headers["content-length"]);

    logger.debug("handle:", mod.name, context, "TYPE:", contentType, "LEN:", length);

    if (length > 0 && this.maxSize > 0 && length >= this.maxSize) {
        logger.debug("handle:", mod.name, "too large:", context);
        return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length });
    }

    var buf = '', size = 0;

    req.context.body = "";

    req.on('data', (chunk) => {
        size += chunk.length;
        if (this.maxSize > 0 && size > this.maxSize) {
            logger.debug("handle:", mod.name, "too large:", context, buf);
            return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: size });
        }
        buf += chunk;
    });

    req.on('end', () => {
        if (size > this.maxSize) {
            logger.debug("handle:", mod.name, "too large:", context, buf);
            return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: size });
        }

        switch (contentType) {
        case "text/json":
        case "application/json":
            context.body = lib.jsonParse(buf, { datatype: "object", logger: "debug" });
            break;

        case "application/x-www-form-urlencoded":
            context.body = buf.length ? qs.parse(buf) : {};
            break;

        default:
            context.body = buf;
        }

        next();
    });
}

