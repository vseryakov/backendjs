/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/cors
  */

const mod = {
    name: "middleware.cors",
    args: [
        { name: "path", type: "regexpobj", descr: "Match request path" },
        { name: "origin", descr: "Origin header" },
        { name: "credentials", type: "bool", descr: "Allow credentials" },
        { name: "methods", type: "list", descr: "Allow methods" },
        { name: "headers", type: "list", descr: "Allow headers" },
        { name: "expose", type: "list", descr: "Expose headers" },
        { name: "max-age", type: "number", descr: "Set max-age" }
    ],
    
    origin: "*",
    credentials: true,
    methods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    headers: ['content-type'],
};

/**
 * CORS middleware
 * @example
 * middleware-cors-path = ^/app
 *
 * middleware-cors-headers = bk-sid
 * middleware-cors-max-age = 86400
 *
 */

module.exports = mod;

/**
 * Multipart middleware
 *
 * @param {RequestContext} context
 * @param {function} next
 *
 * @memberof module:middleware/cors
 * @method handle
 */
mod.handle = function(context, next)
{
    if (!this.path?.rx || !this.path.rx.test(context.path)) return next();

    const { req, res } = context;

    if (this.origin) {
        res.setHeader('access-control-allow-origin', this.origin);
    }
    if (this.headers?.length) {
        res.setHeader('access-control-allow-headers', this.headers.join(", "));
    }
    if (this.methods?.length) {
        res.setHeader('access-control-allow-methods', this.methods.join(", "));
    }
    if (this.credentials) {
        res.setHeader('access-control-allow-credentials', this.credentials);
    }
    if (this.maxAge > 0) {
        res.setHeader('access-control-max-age', this.maxAge);
    }
    if (this.expose) {
        res.setHeader('access-control-expose-headers', this.expose.join(", "));
    }

    // Return immediately for preflight requests
    if (req.method == 'OPTIONS' && req.headers['access-control-request-method']) {
        return context.send(204)
    }

    next();
}
