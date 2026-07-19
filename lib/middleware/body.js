
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module middleware/body
  */

const qs = require("node:querystring");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

const mod = {
    name: "middleware.body",
    args: [
        { name: "enable", type: "bool", descr: "Enable the middlware globally" },
        { name: "methods", type: "list", upper: 1, descr: "HTTP methods enabled in global mode" },
        { name: "content-type", type: "list", descr: "List of additional content types to be parsed in additional to default json/url-encoded/text", example: "middleware-body-content-type = text/xml, image/png" },
        { name: "max-size", type: "number", descr: "Max size for body in bytes" },
        { name: "timeout", type: "number", descr: "Max time in ms to read the body" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    maxSize: 64000,
    timeout: 30000,

    methods: ["POST", "PUT", "PATCH"],

    errTooLarge: "Unable to process the request, it is too large",
    errTimeout: "Timeout reading data",
};

/**
 * Parse body for JSON and x-www-form-urlencoded content.
 *
 * Store parsed data in the `context.body`.
 *
 * Default max body size is 64k, can be configued via `middleware-body-max-size = NNNN` config parameter, in bytes.
 *
 * ## Global node
 *
 * Enabled via `middleware-body-enable = true` no need to register the middleware in the code, it wil be enabled
 * on startup automatically. Just check for `context.body` in the route handlers.
 *
 * Additional content types can be confgured via `middleware-body-content-type = type1, type2, ...`
 *
 * ## Manual mode see below:
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
 * Additional content types can be collected by binding the parser with custom object
 * containing supported properties:
 *
 * ```js
 * api.app.post("/data", middleware.body.handle.bind({
 *     contentType: ["mime/type1", "mime/type2"],
 *     maxSize: 100000,
 *     timeout: 3000
 * }))
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
mod.configureMiddleware = function(_options, callback)
{
    if (mod.enable) {
        for (const method of mod.methods) {
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
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        if (!lib.includes(this.contentType, contentType)) {
            return next();
        }
        req.setEncoding('binary');
    }

    const length = lib.toNumber(req.headers["content-length"]);
    const maxSize = lib.toNumber(this.maxSize);

    logger.debug("handle:", mod.name, context, "TYPE:", contentType, "LEN:", length);

    if (length > 0 && maxSize > 0 && length >= maxSize) {
        logger.debug("handle:", mod.name, "too large:", context);
        return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxSize, length });
    }

    let buf = '', size = 0, timer;

    req.context.body = "";

    // Make sure we do not read indefinitely to handle slow-json attacks
    if (this.timeout > 0) {
        timer = setTimeout(() => {
            logger.debug("handle:", mod.name, "timeout:", context, this.timeout);
            next({ message: mod.errTimeout, code: "timeout", status: 429 });
        }, this.timeout);
    }

    req.on('data', (chunk) => {
        size += chunk.length;
        if (maxSize > 0 && size > maxSize) {
            logger.debug("handle:", mod.name, "too large:", context, buf);
            return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxSize, size, length });
        }
        buf += chunk;
    });

    req.on('end', () => {
        clearTimeout(timer);

        if (maxSize > 0 && size > maxSize) {
            logger.debug("handle:", mod.name, "too large:", context, buf);
            return next({ message: mod.errTooLarge, code: "toolarge", status: 413, maxSize, size, length });
        }

        switch (contentType) {
        case "text/json":
        case "application/json":
            context.body = lib.jsonParse(buf, { data_type: "object", logger: "debug" });
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

