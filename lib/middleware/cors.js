/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module middleware/cors
  */

const mod = {
    name: "middleware.cors",
    args: [
        { name: "origin", descr: "Origin header" },
        { name: "credentials", type: "bool", descr: "Allow credentials" },
        { name: "methods", type: "list", array: 1, descr: "Allow methods" },
        { name: "headers", type: "list", array: 1, descr: "Allow headers" },
        { name: "expose", type: "list", array: 1, descr: "Expose headers" },
        { name: "max-age", type: "number", descr: "Set max-age" }
    ],
    
    origin: "*",
    credentials: true,
    methods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    headers: ['content-type'],
};

/**
 * CORS middleware
 *
 * Config:
 * ```
 * middleware-cors-headers = bk-sid
 * middleware-cors-max-age = 86400
 * ```
 *
 * Code:
 *
 * ```js
 * const { middleware } = require("backendjs");
 * const { cors } = middleware;
 *
 * api.app.use("/optin", cors)
 *
 * api.app.use("/cors/", { origin: "*", headers: ["bk-sid"], handle: cors.handle })
 * ```
 */

module.exports = mod;

/**
 * CORS middleware
 *
 * @param {RequestContext} context
 * @param {function} next
 *
 * @memberof module:middleware/cors
 * @method handle
 */
mod.handle = function(context, next)
{
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
    if (this.expose?.length) {
        res.setHeader('access-control-expose-headers', this.expose.join(", "));
    }

    // Return immediately for preflight requests
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        return context.send(204)
    }

    next();
}
