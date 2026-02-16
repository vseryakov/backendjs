/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * API Static Module - Handles serving static files and templates with Express.
 *
 * ## Features:
 *   - Static file serving from multiple directories
 *   - View templating engine (e.g., EJS, Pug) using template placeholders from {@link mdoule:api.checkRequestPlaceholders}
 *   - Virtual hosting with custom paths
 *   - Regex-based path matching for rules
 *   - Compression (GZIP/Brotli) for static assets
 *   - Custom MIME type definitions
 *   - Development/production caching controls
 *
 * ## Explanation of the example below
 * - `disabled=true` → The app acts like a pure API (no static files at all).
 * - `views-{regex}` acts like URL-to-template routing (e.g., `/user` loads `show-user.ejs`,
 *     you have to register ejs egine in your `configureStaticWeb` method).
 * - `vhost-{blog}=blog.com` → Rewrites `/css/page.css` to `/web/blog/css/page.css` if host is `blog.com`.
 * - `compressed-js=gz` → Serves `index.js` as `index.js.gz` if the file exists.
 *
 * @example
 * api-static-disabled=false
 * api-static-views-^/user=show-user.ejs
 * api-static-vhost-blog=blog.com
 * api-static-compressed-js=gz
 *
 * @module api/static
 */
const path = require("path")
const app = require(__dirname + '/../app');
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const modules = require(__dirname + '/../modules');

const mod = {
    name: "api.static",
    args: [
        { name: "disabled", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
        { name: "options", type: "map", obj: "staticOptions", merge: 1, descr: "Options to pass to serve-static module: maxAge, dotfiles, etag, redirect, fallthrough, extensions, index, lastModified" },
        { name: "views-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'views', descr: "Locations to be rendered as views, use ! in front of regexp to remove particular redirect from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@,", example: "-api-static-views-^/user/get show-user" },
        { name: "vhost-([^/]+)", type: "regexp", obj: "vhost", nocamel: 1, regexp: "i", descr: "Define a virtual host regexp to be matched against the hostname header to serve static content from a different root, a vhost path must be inside the web directory, if the regexp starts with !, that means negative match", example: "api-static-vhost-test_dir=test.com$" },
        { name: "no-vhost", type: "regexpobj", descr: "Add to the list of URL paths that should be served for all virtual hosts" },
        { name: "mime-(.+)", obj: "mime", descr: "File extension to MIME content type mapping, this is used by static-serve", example: "-api-static-mime-mobileconfig application/x-apple-aspen-config" },
        { name: "no-cache-files", type: "regexpobj", descr: "Set cache-control=no-cache header for matching static files", },
        { name: "compressed-([^/]+)", type: "regexp", obj: "compressed", nocamel: 1, strip: "compressed-", reverse: 1, regexp: "i", descr: "Match static paths to be returned compressed, files must exist and be pre-compressed with the given extention", example: "-api-static-compress-bundle.js gz" },
    ],

    // Collect body MIME types as binary blobs
    mime: {},

    // Static content options
    options: {
        maxAge: 0,
        setHeaders,
    },
};

/**
 * Default module to return assets using Express static
 */
module.exports = mod;

// Templating and static paths
mod.configureStaticWeb = function(options, callback)
{
    if (mod.disabled) return callback();

    api.app.set('view engine', 'html');

    // Use app specific views path if created even if it is empty
    api.app.set('views', app.path.views.concat([app.home + "/views", __dirname + '/../views']));

    api.app.use((req, res, next) => {
        if (mod.checkViews(req, res)) return;
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        mod.checkRouting(req);
        next();
    });

    // Serve from default web location in the package or from application specific location
    for (let i = 0; i < app.path.web.length; i++) {
        api.app.use(api.express.static(app.path.web[i], mod.options));
    }
    api.app.use(api.express.static(__dirname + "/../../web", mod.options));
    logger.debug("configureStaticWeb:", mod.name, app.path.web, __dirname + "/../../web");

    callback();
}

function setHeaders(res, file)
{
    var ext = path.extname(file), type = mod.mime[ext.substr(1)];
    if (type) res.setHeader("content-type", type);
    if (app.runMode == "dev" || lib.testRegexpObj(file, mod.noCacheFiles)) {
        res.setHeader("cache-control", "max-age=0, no-cache, no-store");
    }
}

mod.checkViews = function(req, res)
{
    if (!mod.views) return;

    const location = req.options.hostname + req.options.path;
    for (const p in mod.views) {
        if (lib.testRegexpObj(req.options.path, this.views[p]) || lib.testRegexpObj(location, mod.views[p])) {
            logger.debug("checkViews:", mod.name, location, "render by:", p);
            res.render(api.checkRequestPlaceholders(req, p));
            return true;
        }
    }
}

mod.checkRouting = function(req)
{
    if (mod.vhost && !lib.testRegexpObj(req.options.path, mod.noVhost)) {
        for (const p in mod.vhost) {
            if (lib.testRegexp(req.options.hostname, mod.vhost[p])) {
                api.replacePath(req, "/" + p + req.options.path);
                logger.debug("vhost:", mod.name, req.options.host, "rerouting to", req.url);
                break;
            }
        }
    }

    for (const p in mod.compressed) {
        if (lib.testRegexp(req.options.path, mod.compressed[p])) {
            api.replacePath(req, req.options.path + "." + p);
            req.res.setHeader("Content-Encoding", p == "br" ? "brotli" : "gzip");
            req.res.setHeader("Content-Type", app.mime.lookup(req.options.opath));
            logger.debug("compressed:", mod.name, req.options.opath, "rerouting to", req.url);
            break;
        }
    }
}
