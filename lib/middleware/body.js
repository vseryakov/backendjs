
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

const mod = {
    name: "middleware.body",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "path", type: "regexpobj", descr: "Paths that expect JSON/form payloads, parsing will happen before the signature processed, by default all requests are parsed, if defined only matched paths will be processed, the rest will have to use middleware.body explicitely", example: "middleware-body-path = ^/api" },
        { name: "methods", type: "list", upper: 1, descr: "HTTP methods allowed to have body" },
        { name: "types", type: "regexpobj", descr: "Collect full request body in the context.body property for the given MIME types in addition to default json/form posts, this is for custom body processing" },
        { name: "max-size", type: "number", descr: "Max size for body in bytes" },
    ],

    maxSize: 64000,

    methods: ["POST", "PUT", "PATCH"],

    errTooLarge: "Unable to process the request, it is too large",
};

/**
 * Parse JSON/x-www-form-urlencoded from in the request body, this is default middleware called early before authentication
 * for all routes if no `middleware-body-path` config parameter defined. Otherwise only for matchingh routes.
 *
 * Only methods in `middleware-body-methods` processed, defaults are POST/PUT/PATCH.
 * Allow to collect other mime types using `middleware-body-types` config parameter.
 *
 * Store parsed data in the `context.body`.
 */
module.exports = mod;

/**
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/body
 * @method handle
 * @example
 *
 * api.app.use(middleware.body.handle)
 */
mod.handle = function(context, next)
{
    if (context.body !== undefined) return next();

    if (this.path?.rx && !this.path.rx.test(context.path)) return next();

    if (this.methods?.length && !this.methods?.includes(req.method)) return next();

    const { req, contentType } = context;

    switch (contentType) {
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (this.types?.rx && !this.types.rx.test(contentType)) return next();
        req.setEncoding('binary');
    }

    const length = lib.toNumber(req.headers["content-length"]);

    if (length > 0 && this.maxSize > 0 && length >= this.maxSize) {
        logger.debug("handle:", mod.name, "too large:", context);
        return next(lib.newError({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length }));
    }

    req.context.body = "";
    var buf = '', size = 0;

    req.on('data', (chunk) => {
        size += chunk.length;
        if (this.maxSize > 0 && size > this.maxSize) {
            logger.debug("handle:", mod.name, "too large:", context, buf);
            return next(lib.newError({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: size }));
        }
        buf += chunk;
    });

    req.on('end', () => {
        try {
            if (size > this.maxSize) {
                logger.debug("handle:", mod.name, "too large:", context, buf);
                return next(lib.newError({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: size }));
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
        } catch (err) {
            err.status = 400;
            err.title = "handle:" + mod.name;
            next(err);
        }
    });
}

