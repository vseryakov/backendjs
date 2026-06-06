/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module middleware/static
 */

const app = require(__dirname + '/../app');
const api = require(__dirname + '/../api');

const mod = {
    name: "middleware.static",
    args: [
        { name: "global", type: "bool", descr: "Enable the middlware to serve static files from all 'app.path.web' folders" },
        { name: "root", descr: "Root path for files" },
        { name: "max-age", type: "int", descr: "Max age for files in ms" },
        { name: "no-cache", type: "bool", descr: "Serve files as non cacheable" },
        { name: "last-modified", type: "bool", descr: "Serve Last-Modified header to support conditional requests" },
        { name: "index", descr: "Name of index file to use for default directory requests" },
    ],
    index: "index.html",
};

/**
 * Static middleware - Handles serving static files
 *
 * ## Routing globally:
 *
 * Config
 *
 * ```
 * middleware-static-global = true
 *
 * # optional parmeters
 * middleware-static-last-modified = true
 * middleware-static-max-age = 86400000
 * ```
 *
 *  One middleware for all with above config
 *
 * ```js
 * const { api, middleware } = require("backendjs")
 *
 * api.app.get(middleware.static)
 * ```
 *
 * ## Routing explicitly
 *
 * Separate middleware by route
 * ```js
 *  api.app.get("/blog/*", middleware.static.handle.bind({ root: "dist/" }))
 *
 *  api.app.get("/public/*", { root: "web", maxAge: 300000, lastModified: true, handle: middleware.static.handle })
 * ```
 *
 */
module.exports = mod;

/**
 * Start global middleware, enable static access to all folders listed in the `app.path.web` property, this will include
 * all packages loaded via `app-import` config patrameter.
 *
 * @memberof module:middleware/static
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (this.global) {
        for (const root of app.path.web) {
            api.app.get("*", mod.handle.bind(Object.assign({}, this, { root })));
        }
        api.app.get("*", mod.handle.bind(Object.assign({}, this, { root: __dirname + "/../../web" })));
    }

    callback();
}

/**
 * Static middleware, if root is not provided the `app.home` is used to prevent out of scope access,
 * see {@link RequestContext#sendFile} for options.
 * @memberof module:middleware/static
 * @method handle
 */
mod.handle = function(context, next)
{
    const opts = {
        root: this.root || app.home,
        maxAge: this.maxAge,
        noCache: this.noCache,
        lastModified: this.lastModified,
        index: this.index,
    }
    context.sendFile(context.path, opts, next);
}

