/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
  * @module middleware/headers
  */

const mod = {
    name: "middleware.headers",
    args: [
        { name: "(.+)", obj: "headers", type: "regexpobj", reverse: 1, nocamel: 1, onupdate: function(v, o) { if (v) v.value = lib.jsonParse(o._value, { name: o.name, logger: "warn" }) }, descr: "An JSON object with response headers to be set in matching responses, empty value to remove the header", example: 'middleware-headers-^/ = { "x-frame-options": "sameorigin", "x-xss-protection": "1; mode=block" }' },
    ],
};

/**
 * Set response headers by path from the config
 * @example
 * middleware-headers-^/ = { "x-frame-options": "sameorigin", "x-xss-protection": "1; mode=block" }'
 *
 */

module.exports = mod;

/**
 * Response headers middleware
 *
 * @param {RequestContext} context
 * @param {function} next
 *
 * @memberof module:middleware/headers
 * @method handle
 */
mod.handle = function(context, next)
{
    if (!this.headers) return next();

    for (const p in this.headers) {
        const rule = this.headers[p];
        if (rule.value && rule.rx?.test(context.path)) {
            for (const h in rule.value) {
                if (rule.value[h]) {
                    context.res.setHeader(h, rule.value[h]);
                } else {
                    context.res.removeHeader(h);
                }
                logger.debug('handle:', mod.name, context, "HDR:", h, rule.value[h]);
            }
        }
    }

    next();
}
