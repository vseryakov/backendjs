
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
        { name: "path", type: "regexpobj", descr: "Paths that expect JSON/form payloads", example: "middleware-body-path = ^/api" },
        { name: "methods", type: "list", upper: 1, descr: "HTTP methods allowed to have body" },
        { name: "max-size", type: "number", descr: "Max size for body in bytes" },
    ],

    maxSize: 64000,

    methods: ["POST", "PUT", "PATCH"],

    errTooLarge: "Unable to process the request, it is too large",
};

/**
 * Parse body for JSON or x-www-form-urlencoded content.
 *
 * Only methods in `middleware-body-methods` processed, defaults are POST/PUT/PATCH.
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
 * api.app.use(middleware.body)
 * api.app.use("/api", middleware.body)
 */
mod.handle = function(context, next)
{
    if (context.body !== undefined) return next();

    if (this.path?.rx && !this.path.rx.test(context.path)) return next();

    if (this.methods?.length && !this.methods?.includes(context.method)) return next();

    const { req, contentType } = context;

    switch (contentType) {
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        req.setEncoding('binary');
    }

    const length = lib.toNumber(req.headers["content-length"]);

    logger.debug("handle:", mod.name, context, "TYPE:", contentType, "LEN:", length);

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

