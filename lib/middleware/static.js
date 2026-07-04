/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
 * @module middleware/static
 */

const path = require("node:path");
const app = require(__dirname + '/../app');
const api = require(__dirname + '/../api');

const mod = {
    name: "middleware.static",
    deps: "*",
    args: [
        { name: "enable", type: "bool", descr: "Enable the middlware for all folders in 'app.path.web'" },
        { name: "root", type: "path", descr: "Root path for files" },
        { name: "max-age", type: "int", descr: "Max age for files in ms, -1 to disable" },
        { name: "no-cache", type: "bool", descr: "Serve files as non cacheable" },
        { name: "last-modified", type: "bool", descr: "Serve Last-Modified header to support conditional requests" },
        { name: "index", descr: "Name of index file to use for default directory requests" },
        { name: "precompressed", type: "regexp", descr: "Match request path to serve pre-compressed files with given encoding or default gzip" },
        { name: "encoding", descr: "Compress encoding to use for precompressed files: gzip, br, zstd" },
        { name: "etag", type: "bool", descr: "Produce weak ETag header for static files" },
        { name: "sorting-id", type: "int", descr: "Add routes with this sorting number, for config mode only" },
    ],
    index: "index.html",
    lastModified: true,
    etag: true,
    maxAge: 0,
    sortingId: 9999,
};

/**
 * Static middleware - Handles serving static files
 *
 * ## Routing globally using configured paths to static assets listed in the `app.path.web` property, this will include
 * all packages loaded via `app-import` config parameter.
 *
 * By default local folder "web" is used as the static root relative to the `app.home`.
 *
 * The `backendjs` "web" folder is also enable by default to serve Alpine and Bootstrap bundles.
 *
 * Config
 *
 * ```
 * // Additional public folder somewhere
 * app-path-web = /path/to/public/files
 *
 * middleware-static-enable = true
 *
 * # optional parmeters
 * middleware-static-last-modified = true
 * middleware-static-max-age = 86400000
 * middleware-static-etag = true
 *
 * # serve gzipped bundles
 * middleware-static-precompressed = \.js$|\.css$
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
 * const { api, middleware } = require("backendjs");
 * const { static } = middleware;
 *
 * api.app.get("/blog/*", { root: "dist/", precompressed: /\.js$|/static/.+\.html$/, handle: static.handle })
 *
 * api.app.get("/public/*", { root: "web", noCache: true, lastModified: false, handle: static.handle })
 * ```
 *
 */
module.exports = mod;

/**
 * Start global middleware
 *
 * @memberof module:middleware/static
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    if (this.enable) {
        const opts = {
            maxAge: this.maxAge,
            noCache: this.noCache,
            lastModified: this.lastModified,
            index: this.index,
            precompressed: this.precompressed,
            encoding: this.encoding,
            etag: this.etag,
        };
        const get = `GET#${this.sortingId || ""}`;

        for (const root of app.path.web) {
            api.app.use(get, "*", Object.assign({}, opts, { root, handle: mod.handle }));
        }
        api.app.use(get, "*", Object.assign({}, opts, { root: path.resolve(__dirname + "/../../web"), handle: mod.handle }));
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
        precompressed: this.precompressed,
        encoding: this.encoding,
        etag: this.etag,
    }
    context.sendFile(context.path, opts, next);
}

