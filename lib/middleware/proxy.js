/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
 * @module middleware/proxy
 */

const lib = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.proxy",
    args: [
        { name: "host", descr: "Host where to proxy requests, takes precedence over the path, for direct routing", example: "middleware-proxy-host = myhost.com" },
        { name: "path-(.+)", obj: "path", type: "regexp", make: "$1", nocamel: 1, descr: "Proxy matched requests by path to given host", example: "middleware-proxy-path-blog.host.com = ^/blog/\nmiddleware-proxy-path-www.host.com = ^/products/" },
    ],
};

/**
 * This middleware requires `http-proxy` package
 *
 * ## Routing globally
 *
 * Config
 *
 * ```
 * middleware-proxy-path-blog.host.com = ^/blog/
 * middleware-proxy-path-www.host.com = ^/products/
 * ```
 *
 *  One middleware for all
 *
 * ```js
 * const { api, middleware } = require("backendjs")
 *
 * api.app.use(middleware.proxy)
 * ```
 *
 * ## Routing explicitly
 *
 * Separate middleware by route
 * ```js
 *  api.app.use("/blog/*", middleware.proxy.handle.bind({ host: "myhost.com" }))
 *
 *  api.app.use("/internal/*", { host: "myhost.int", handle: middleware.proxy.handle })
 * ```
 *
 */

module.exports = mod;

var _proxy;

/**
 * Web proxy middleware
 * @memberof module:middleware/proxy
 * @method handle
 */
mod.handle = function(context, next)
{
    if (lib.isString(this.host)) {
        return mod.proxy(this.host, context);
    }

    if (!this.path) return next();

    for (const host in this.path) {
        if (!this.path[host].test(context.path)) continue;
        return mod.proxy(context, host);
    }
    next();
}

/**
 * Proxy middleware for a single host to use by explicit router
 * @param {RequestContext} context
 * @param {string} host
 * @memberof module:middleware/proxy
 * @method proxy
 */
mod.proxy = function(context, host)
{
    if (!_proxy) {
        _proxy = lib.tryRequire("http-proxy");
        if (!_proxy) {
            return context.send(500);
        }
        _proxy.createProxyServer({});
    }

    const { req, res } = context;

    const opts = {
        target: "https://" + host,
        ws: true,
        changeOrigin: true,
        hostRewrite: true,
        cookieDomainRewrite: "localhost",
        headers: {
            origin: host
        }
    }
    logger.debug("proxy:", mod.name, opts, context.url);
    _proxy.web(req, res, opts);
}
