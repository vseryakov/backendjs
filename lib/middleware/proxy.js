/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/proxy
  */

const lib = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.proxy",
    args: [
        { name: "path-(.+)", obj: "path", type: "regexp", make: "$1", nocamel: 1, descr: "Proxy matched requests by path to given host" },
    ],
};

module.exports = mod;

var _proxy;

/**
 * Web proxy middleware
 * @memberof module:middleware/proxy
 * @method handle
 */
mod.handle = function(context, next)
{
    if (!this.path) return next();

    const { req, res, path } = context;

    for (const host in this.path) {
        if (!this.path.test(path)) continue;

        if (!_proxy) {
            _proxy = lib.tryRequire("http-proxy");
            if (!_proxy) break;
            _proxy.createProxyServer({});
        }
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
        logger.debug("handle:", mod.name, opts, context.url);
        _proxy.web(req, res, opts);
        return;
    }
    next();
}
