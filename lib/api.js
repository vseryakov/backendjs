//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const stream = require('stream');
const util = require('util');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const domain = require('domain');
const qs = require("qs");
const formidable = require('formidable');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const cache = require(__dirname + '/cache');
const metrics = require(__dirname + '/metrics');
const logger = require(__dirname + '/logger');

// HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
// incorporates the Express server which is exposed as api.app object, the master server spawns Web workers which perform actual operations and monitors
// the worker processes if they die and restart them automatically. How many processes to spawn can be configured via `-server-max-workers` config parameter.
//
// When an HTTP request arrives it goes over Express middleware, but before processing any registered routes there are several steps performed:
// - the `req` object which is by convention is a Request object, assigned with common backend properties to be used later:
//   - user - an empty object which will be filled after by signature verification method, if successful, properties from the `bk_user` table will be set
//   - options - an object with internal state and control parameters. Every request always has an options object attached very
//     early with some properties always present:
//      - ip - cached IP address
//      - host - cached host header from the request
//      - path - parsed request url path
//      - apath - an array with the path split by /
//      - secure - if the request is encrypted, like https
//      - appTimezone - milliseconds offset from the UTC provided in the header by the app
// - access verification, can the request be satisfied without proper signature, i.e. is this a public request
// - autherization, check the signature and other global or user specific checks
// - when a API route found by the request url, it is called as any regular Connect middlware
//   - if there are registered pre processing callback they will be called during access or autherization phases
//   - if inside the route a response was returned using `api.sendJSON` method, registered post process callbacks will be called for such response
//
// Every request has `trace` property, either fake or Xray depending on the config, see metrics for usage
//

const api = {
    name: "api",
    // Config parameters
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "max-request-queue", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns too busy error" },
        { name: "timeout", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests" },
        { name: "keep-alive-timeout", type: "int", descr: "Number of milliseconds to keep the HTTP conection alive" },
        { name: "request-timeout", type: "int", min: 0, descr: "Number of milliseconds to receive the entire request from the client" },
        { name: "max-requests-per-socket", type: "int", min: 0, descr: "The maximum number of requests a socket can handle before closing keep alive connection" },
        { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
        { name: "access-log-file", descr: "File for access logging" },
        { name: "access-log-level", type: "int", descr: "Syslog level priority, default is local5.info, 21 * 8 + 6" },
        { name: "access-log-fields", array: 1, type: "list", descr: "Additional fields from the request or user to put in the access log, prefix defines where the field is lcoated: q: - query, h: - headers, u: - user otherwise from the request, Example: -api-log-fields h:Referer,u:name,q:action" },
        { name: "errlog-limiter-max", type: "int", descr: "How many error messages to put in the log before throttling kicks in" },
        { name: "errlog-limiter-interval", type: "int", descr: "Interval for error log limiter, max errors per this interval" },
        { name: "errlog-limiter-ignore", type: "regexpobj", descr: "Do not show errors that match the regexp" },
        { name: "salt", descr: "Salt to be used for scrambling credentials or other hashing activities" },
        { name: "qs-options-(.+)", autotype: 1, obj: "qsOptions", strip: "qs-options-", nocamel: 1, descr: "Options to pass to qs.parse: depth, arrayLimit, allowDots, comma, plainObjects, allowPrototypes, parseArrays" },
        { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
        { name: "static-options-(.+)", autotype: 1, obj: "staticOptions", strip: "static-options-", nocamel: 1, descr: "Options to pass to serve-static module: maxAge, dotfiles, etag, redirect, fallthrough, extensions, index, lastModified" },
        { name: "vhost-path-([^/]+)", type: "regexp", obj: "vhostPath", nocamel: 1, strip: "vhost-path-", regexp: "i", descr: "Define a virtual host regexp to be matched against the hostname header to serve static content from a different root, a vhost path must be inside the web directory, if the regexp starts with !, that means negative match, example: api-vhost-path-test_dir=test.com$" },
        { name: "no-vhost-path", type: "regexpobj", descr: "Add to the list of URL paths that should be served for all virtual hosts" },
        { name: "templating", descr: "Templating engine package to use, it assumes it supports Expres by exposing __express or renderfile methods" },
        { name: "query-token-secret", descr: "Name of the property to be used for encrypting tokens for pagination or other sensitive data, any property from bk_user can be used, if empty no secret is used, if not a valid property then it is used as the secret" },
        { name: "no-cache-files", type: "regexpobj", descr: "Set cache-control=no-cache header for matching static files", },
        { name: "access-token-secret", descr: "A generic secret to be used for API access or signatures" },
        { name: "allow-configure-(web|middleware)", type: "regexp", descr: "Modules allowed to call configureWeb or Middleware, i.e. only allowed endpoints" },
        { name: "allow-error-code", type: "regexpobj", descr: "Error codes in exceptions to return in the response to the user, if not matched the error-message will be returned" },
        { name: "allow-empty", type: "regexpobj", descr: "Regexp for URLs that should return empty responses if not found, for example return nothing for non-existent javascript files or css files" },
        { name: "allow-ssl", type: "regexpobj", descr: "Add to the list of allowed locations using HTTPs only, plain HTTP requests to these urls will be refused" },
        { name: "ignore-ssl", type: "regexpobj", descr: "Allow plain HTTP from matched IP addresss or locations" },
        { name: "redirect-ssl", type: "regexpobj", descr: "Add to the list of the locations to be redirected to the same path but using HTTPS protocol" },
        { name: "express-options", type: "json", obj: "express-options", merge: 1, logger: "warn", descr: "Set Express config options during initialization, ex: `-api-express-options { \"trust proxy\": 1, \"strict routing\": true }`" },
        { name: "body-methods", type: "list", upper: 1, descr: "HTTP methods allowed to have body" },
        { name: "body-types", type: "regexpobj", descr: "Collect full request body in the req.body property for the given MIME types in addition to default json/form posts, this is for custom body processing" },
        { name: "body-raw", type: "regexpobj", descr: "Do not parse the collected body for the following MIME content types, keep it as a string" },
        { name: "body-multipart", type: "regexpobj", descr: "URLs that expect multipart/form-data payloads, parsing will happend after the signature processed" },
        { name: "mime-map-(.+)", obj: "mime-map", descr: "File extension to MIME content type mapping, this is used by static-serve, ex: -api-mime-map-mobileconfig application/x-apple-aspen-config" },
        { name: "cors-origin", descr: "Origin header for CORS requests" },
        { name: "cors-allow", type: "regexpobj", descr: "Enable CORS requests if a request host/path matches the given regexp" },
        { name: "tz-header", descr: "Name for the timezone offset header a client can send for time sensitive requests, the backend decides how to treat this offset" },
        { name: "server-header", descr: "Custom Server: header to return for all requests" },
        { name: "error-message", descr: "Default error message to return in case of exceptions" },
        { name: "rlimits-([a-z]+)$", obj: "rlimits", make: "$1", autotype: 1, descr: "Default rate limiter parameters, default interval is 1s, `ttl` is to expire old cache entries, message for error" },
        { name: "rlimits-(rate|max|interval|ttl|ip|delay|multiplier|queue)-(.+)", autotype: 1, obj: "rlimitsMap.$2", make: "$1", descr: "Rate limiter parameters by type for Token Bucket algorithm. `queue` to use specific queue, ttl` is to expire cache entries, `ip` is to limit by IP address as well, ex. -api-rlimits-ip-ip=10, -api-rlimits-rate-/path=1, , -api-rlimits-rate-GET/path=1" },
        { name: "rlimits-map-(.+)", type: "map", obj: "rlimitsMap.$1", maptype: "auto", merge: 1, descr: "Rate limiter parameters for Token Bucket algorithm. set all at once, ex. -api-rlimits-map-/url=rate:1,interval:2000 -api-rlimits-map-GET/url=rate:10" },
        { name: "(query|header|upload)-limit", type: "number", descr: "Max size for query/headers/uploads, bytes" },
        { name: "(files|fields)-limit", type: "number", descr: "Max number of files or fields in uploads" },
        { name: "limiter-cache", descr: "Name of a cache for API rate limiting" },
        { name: "routing-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'routing', descr: "Locations to be re-routed to other path, this is done inside the server at the beginning, only the path is replaced, same format and placeholders as in redirect-url, use ! in front of regexp to remove particular redirect from the list, example: -api-routing-^/user/get /user/read" },
        { name: "ignore-routing", type: "regexpobj", descr: "Ignore locations from the routing" },
        { name: "auth-routing-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'auth-routing', descr: "URL path to be re-routed to other path after the authentication is successful, this is done inside the server, only the path is replaced, same format and placeholders as in redirect-url, example: -api-routing-auth-^/user/get /user/read" },
        { name: "redirect-url", type: "regexpmap", descr: "Add to the list a JSON object with property name defining a location regexp to be matched early against in order to redirect using the value of the property, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location, example: { '^[^/]+/path/$': '/path2/index.html', '.+/$': '301:@PATH@/index.html' } " },
        { name: "login-redirect-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: "login-redirect", descr: "Define a location where to redirect if no login is provided, same format and placeholders as in redirect-url, example: api-login-redirect-^/admin/=/login.html" },
        { name: "response-headers", type: "regexpmap", json: 1, descr: "An JSON object with list of regexps to match against the location and set response headers defined as a ist of pairs name, value..., -api-response-headers={ \"^/\": [\"x-frame-options\",\"sameorigin\",\"x-xss-protection\",\"1; mode=block\"] }" },
        { name: "cleanup-rules-(.+)", obj: "cleanupRules.$1", type: "map", maptype: "auto", merge: 1, nocamel: 1, descr: "Rules for the cleanupResult per table, ex. api-cleanup-rules-bk_user=email:0,phone:1" },
        { name: "cleanup-strict", type: "bool", descr: "Default mode for cleanup results" },
        { name: "request-cleanup", type: "list", array: 1, descr: "List of fields to explicitely cleanup on request end" },
        { name: "query-defaults-([a-z0-9_]+)-(.+)", obj: "queryDefaults.$2", make: "$1", autotype: 1, descr: "Global query defaults for getQuery, can be path specific, ex. -api-query-defaults-max-name 128 -api-query-defaults-max-/endpoint-name 255" },
        { name: "delays-(.+)", type: "int", obj: "delays", nocamel: 1, descr: "Delays in ms by status and code, useful for delaying error responses to slow down brute force attacks, ex. -api-delays-401 1000 -api-delays-403:DENY -1" },
        { name: "compressed-([^/]+)", type: "regexp", obj: "compressed", nocamel: 1, strip: "compressed-", reverse: 1, regexp: "i", descr: "Match static paths to be returned compressed, files must exist and be pre-compressed with the given extention , example: -api-compress-bundle.js gz" },
        { name: "restart-hours", type: "list", datatype: "int", descr: "List of hours when to restart api workers, only done once for each hour" },
        { name: "trace-options", type: "map", obj: "trace-options", merge: 1, maptype: "auto", descr: "Options for tracing, host where to send if not local, path:regexp for URLs to be traced, interval:Interval in ms how often to trace requests, must be > 0 to enable tracing" },
        { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
        { name: "restart", descr: "On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts" },
    ],

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the user has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: {},

    // Allow only HTTPS requests
    allowSsl: {},
    ignoreSsl: {},
    redirectSsl: {},
    allowEmpty: {},

    // Rate limits
    rlimitsMap: {},
    rlimits: {
        ttl: 86400000,
        message: "Access limit reached, please try again later in %s.",
    },
    delays: {},
    // Global redirect rules, each rule must match host/path to be redirected
    redirectUrl: [],
    routing: {},
    authRouting: {},
    loginRedirect: {},
    responseHeaders: [],

    traceOptions: {},
    expressOptions: {},
    bodyMethods: ["POST", "PUT", "PATCH"],

    // All listening servers
    servers: [],

    // Incoming data limits, bytes
    filesLimit: 10,
    fieldsLimit: 100,
    uploadLimit: 10*1024*1024,
    queryLimit: 16*1024,
    headerLimit: 16*1024,

    // Connection timeouts
    timeout: 30000,
    keepAliveTimeout: 61000,
    requestTimeout: 0,

    // Collect body MIME types as binary blobs
    mimeMap: {},
    qsOptions: {},

    // Static content options
    staticOptions: {
        maxAge: 0,
        setHeaders: function(res, file) {
            var ext = path.extname(file), type = core.modules.api.mimeMap[ext.substr(1)];
            if (type) res.setHeader("content-type", type);
            if (core.runMode == "dev" || lib.testRegexpObj(file, core.modules.api.noCacheFiles)) {
                res.setHeader("cache-control", "max-age=0, no-cache, no-store");
            }
        }
    },

    tzHeader: "bk-tz",
    accessTokenSecret: "",

    corsAllow: null,
    corsOrigin: "*",
    corsCredentials: true,
    corsMethods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'DELETE'],

    // Properties to be cleaned up on finish
    requestCleanup: ["options", "user", "signature", "body", "raw_body", "trace"],
    cleanupRules: {},

    restart: "master,web,process",

    // Metrics and stats
    metrics: {
        req: new metrics.Timer(),
        que: new metrics.Histogram(),
        running: 0,
        busy_count: 0,
        large_count: 0,
        bad_count: 0,
        err_count: 0,
    },

    maxRequestQueue: 0,
    limiterCache: "local",

    accessLogFields: [],
    accessLogLevel: 174,

    // Error reporter throttle
    allowErrorCode: {},
    errlogLimiterMax: 100,
    errlogLimiterInterval: 30000,
    errlogLimiterIgnore: lib.toRegexpObj(null, [ "Range Not Satisfiable", "Precondition Failed" ]),

    // Query options, special parameters that start with the underscore in the req.query, shared between all routes and
    // can perform special actions or to influence the results, in most cases these are used in the db queries.
    controls: {
        total: { type: "bool" },
        format: { type: "string", max: 32, regexp: /^[a-z0-9_]+$/i },
        encoding: { type: "string", max: 32, regexp: /^[a-z0-9_]+$/i },
        page: { type: "int", dflt: 0, min: 0 },
        count: { type: "int", dflt: 32, min: 0, max: 999 },
        distance: { type: "number", min: 0, dflt: 1000, max: 999 },
        latitude: { type: "real", },
        longitude: { type: "real" },
        latlon: { type: "string", regexp: /^[0-9]+(\.[0-9]+)?,[0-9]+(\.[0-9]+)?$/ },
        tm: { type: "timestamp" },
        ext: { type: "string", max: 32, regexp: /^[a-z0-9_]+$/i },
        ops: { type: "map", max: 128, maxlist: 32, regexp: /^[a-z0-9_]+$/i },
        start: { type: "token", max: 1024 },
        token: { type: "token", max: 1024 },
        select: { type: "list", max: 64, maxlist: 32, regexp: /^[a-z0-9_,]+$/i },
        desc: { type: "bool" },
        sort: { type: "string", max: 128, regexp: /^[a-z0-9_,]+$/i },
        join: { type: "string", max: 32, regexp: /^[a-z0-9_]+$/i },
        joinOps: { type: "map", max: 128, maxlist: 32, regexp: /^[a-z0-9_]+$/i },
    },

    // getQuery global defaults, pased as data
    queryDefaults: {
        "*": {
            maxlist: 255,
        },
        "*.json": {
            max: 512,
        },
        "*.token": {
            max: 1024,
        },
        "*.string": {
            max: 255,
        },
        "*.text": {
            max: 255,
        }
    },

    errInvalidLogin: "Authentication is required",
    errInvalidUser: "Authentication failed",
    errInvalidSecret: "Authentication failed",
    errInvalidSession: "This session has expired",
    errInvalidRequest: "Invalid request",
    errInternalError: "Internal error occurred, please try again later",

    errDenyAcl: "Access denied",
    errDenyIp: "Access denied",
    errAclNoMatch: "Access is not allowed",
    errTooLarge: "Unable to process the request, it is too large",
}

module.exports = api;

// Initialize API layer, this must be called before the `api` module can be used but it is called by the server module automatically so `api.init` is
// rearely need to called directly, only for new server implementation or if using in the shell for testing.
//
// During the init sequence, this function calls `api.initMiddleware` and `api.initApplication` methods which by default are empty but can be redefined in the user aplications.
//
// The bkjs.js uses its own request parser that places query parameters into `req.query` or `req.body` depending on the method.
//
// For GET method, `req.query` contains all url-encoded parameters, for POST method `req.body` contains url-encoded parameters or parsed JSON payload or multipart payload.
//
// The reason not to do this by default is that this may not be the alwayse wanted case and distinguishing data coming in the request or in the body may be desirable,
// also, this will needed only for Express handlers `.all`, when registering handler by method like `.get` or `.post` then the handler needs to deal with only either source of the request data.
//
api.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    // Shutdown signal from the master process
    if (core.isWorker) {
        ipc.on("api:restart", () => {
            api.shutdown(() => { process.exit(0) });
        });
    }

    // These will not be used outside of this call
    this.express = require('express');
    this.app = this.express();

    this.app.set("query parser", (q) => (qs.parse(q, api.qsOptions)));

    // Acccess logging, always goes into api.accessLog, it must be a stream
    if (!this.noAccessLog) {
        this.configureAccessLog();
        this.app.use(this.handleAccessLog.bind(this));
    }

    // Early request setup and checks
    this.app.use(this.startServerRequest.bind(this));

    this.app.use(this.handleResponseHeaders.bind(this));

    // Metrics starts early, always enabled
    this.app.use(this.startMetrics.bind(this));

    // Content parsers
    this.app.use(cookieParser());
    this.app.use(this.handleBody.bind(this));

    // Config options for Express
    for (const p in this.expressOptions) {
        this.app.set(p, this.expressOptions[p]);
    }

    // Assign custom middleware just before the security handler, if the signature is disabled then the middleware
    // handler may install some other authentication module and in such case must setup `req.user` with the current user record
    core.runMethods("configureMiddleware", options, { allow: api.allowConfigureMiddleware }, () => {

        // Check for access and authorization
        api.app.use(api.handleAccess.bind(api));

        // Parse multipart payload
        api.app.use(function apiMultipart(req, res, next) {
            if (!req.is('multipart/form-data')) return next("route");
            if (!lib.testRegexpObj(req.options.path, api.bodyMultipart)) return next("route");
            api.handleMultipart(req, res, (err) => (next(err || "route")));
        });

        // Setup routes from the loaded modules
        core.runMethods("configureWeb", options, { allow: api.allowConfigureWeb }, (err) => {
            if (err) return callback.call(api, err);

            // For health checks
            api.app.all("/ping", (req, res) => {
                api.sendStatus(res, { contentType: "text/plain" });
            });

            // Static paths and templating setup
            api.configureStatic();

            // Default error handler to show errors in the log, throttle the output to keep the log from overflow
            if (api.errlogLimiterMax && api.errlogLimiterInterval) {
                api.errlogLimiterToken = new metrics.TokenBucket(api.errlogLimiterMax, 0, api.errlogLimiterInterval);
            }

            // Return empty responses if matched
            api.app.use(function apiEmpty(req, res, next) {
                if (!api.allowEmpty.rx || !api.allowEmpty.rx.test(req.options.path)) return next();
                logger.debug("allowEmpty:", req.options.path);
                return res.set("Content-Type", core.mime.lookup(req.options.path)).status(200).send();
            });

            // The last route is to return an error
            api.app.use(function apiErr(err, req, res, next) {
                api.sendReply(res, err);
            });

            // Performs graceful web worker restart
            api.restartInterval = setInterval(() => {
                if (lib.isFlag(api.restartHours, new Date().getHours())) {
                    logger.info('restarting web workers');
                    ipc.sendMsg("api:restart");
                }
            }, 3600000);

            api.configureServers(options, () => {

                // Notify the master about new worker server
                ipc.sendMsg("api:ready", { id: core.workerId || process.pid, port: core.port, ready: true });

                callback.call(api);
            });
        });

        api.exiting = false;
    });
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    if (this.exiting) return;
    this.exiting = true;
    logger.log("api.shutdown:", core.role, "started");

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: core.workerId || process.pid, pid: process.pid, port: core.port });

    const timeout = typeof callback == "function" ? setTimeout(callback, api.shutdownTimeout || 30000) : null;

    core.runMethods("shutdownServer", { direct: 1, parallel: 1 }, () => {
        clearTimeout(timeout);
        lib.tryCall(callback);
    });
}

api.shutdownServer = function(options, callback)
{
    lib.forEach([ api.server, api.sslServer ], (server, next) => {
        var err;
        try { server?.close() } catch (e) { err = e }
        logger.log("shutdownServer:", server?.serverName, core.role, "closed", err);
        next();
    }, callback, true);
}

api.shutdownWeb = function(options, callback)
{
    this.shutdown(callback);
}

api.configureServers = function(options, callback)
{
    // Start http server
    if (core.port) {
        api.server = core.createServer({
            name: "http",
            port: core.port,
            bind: core.bind,
            restart: api.restart,
            timeout: api.timeout,
            keepAliveTimeout: api.keepAliveTimeout,
            requestTimeout: api.requestTimeout,
            maxRequestsPerSocket: api.maxRequestsPerSocket,
            maxHeaderSize: api.headerLimit,
        }, api.handleServerRequest);
    }

    // Start SSL server
    if (core.ssl.port && (core.ssl.key || core.ssl.pfx)) {
        api.sslServer = core.createServer({
            name: "https",
            ssl: core.ssl,
            port: core.ssl.port,
            bind: core.ssl.bind,
            restart: api.restart,
            timeout: api.timeout,
            keepAliveTimeout: api.keepAliveTimeout,
            requestTimeout: api.requestTimeout,
            maxRequestsPerSocket: api.maxRequestsPerSocket,
            maxHeaderSize: api.headerLimit,
        }, api.handleServerRequest);
    }

    core.runMethods("configureServer", options, { direct: 1 }, callback);
}

// Templating and static paths
api.configureStatic = function()
{
    if (api.templating) {
        api.app.set('view engine', 'html');

        // Use app specific views path if created even if it is empty
        api.app.set('views', core.path.views.concat([core.home + "/views", __dirname + '/../views']));

        try {
            var tmpl = require(api.templating);
        } catch (err) {
            return logger.error("configureStatic:", api.templating, err);
        }
        if (tmpl.__express || tmpl.renderFile) {
            api.app.engine('html', tmpl.__express || tmpl.renderFile);

            if (typeof tmpl.setDefaults === "function") {
                if (!api.app.get("view cache")) tmpl.setDefaults({ cache: false });
            }
        }
        logger.debug("configureStatic:", api.templating, lib.objKeys(api.app.engines), "views:", api.app.get("views"));
    }

    // Serve from default web location in the package or from application specific location
    if (!api.noStatic) {
        api.app.use(function apiStatic(req, res, next) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            api.checkStaticRouting(req);
            next();
        });

        for (var i = 0; i < core.path.web.length; i++) {
            api.app.use(api.express.static(core.path.web[i], api.staticOptions));
        }
        api.app.use(api.express.static(__dirname + "/../web", api.staticOptions));
        logger.debug("configureStatic:", core.path.web, __dirname + "/../web");
    }
}

// Setup access log stream
api.configureAccessLog = function()
{
    if (logger.syslog) {
        this.accessLog = new stream.Stream();
        this.accessLog.writable = true;
        this.accessLog.write = (data) => { logger.syslog.log(api.accessLogLevel, data); return true; };
    } else
    if (this.accessLogFile) {
        this.accessLog = fs.createWriteStream(path.join(core.path.log, this.accessLogFile), { flags: 'a' });
        this.accessLog.on('error', (err) => { logger.error('accessLog:', err); api.accessLog = null; });
    } else {
        this.accessLog = logger;
    }
}

api.handleAccessLog = function(req, res, next)
{
    var startTime = new Date();
    var end = res.end;
    res.end = function(chunk, encoding) {
        res.end = end;
        res.end(chunk, encoding);
        if (req._accessLog || !api.accessLog) return;
        req._accessLog = true;
        var now = new Date();
        var line = req.options.ip + " - " +
                   (this.accessLogFile ? '[' + now.toUTCString() + ']' : "-") + " " +
                   req.method + " " +
                   (req.accessLogUrl || req.originalUrl || req.url) + " " +
                   (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                   res.statusCode + " " +
                   (req.options.clength || '-') + " - " +
                   (now - startTime) + " ms - " +
                   (req.headers['user-agent'] || "-") + " " +
                   (req.user.id || "-");
        // Append additional fields
        for (const i in api.accessLogFields) {
            var v = api.accessLogFields[i];
            switch (v[1] == ":" ? v[0] : "") {
            case "q":
                v = req.query[v.substr(2)];
                break;
            case "h":
                v = req.get(v.substr(2));
                break;
            case "u":
                v = req.user[v.substr(2)];
                break;
            default:
                v = req[v];
            }
            if (typeof v == "object") v = "";
            line += " " + (v || "-");
        }
        if (api.accessLogFile) line += "\n";
        api.accessLog.write(line);
    }
    next();
}

api.startServerRequest = function(req, res, next)
{
    // Fake i18n methods
    req.__ = res.__ = res.locals.__ = lib.__;

    // Request queue size
    if (api.maxRequestQueue && api.metrics.running >= api.maxRequestQueue) {
        api.metrics.busy_count++;
        return api.sendReply(res, 503, "Server is unavailable");
    }

    // Setup request common/required properties
    api.prepareRequest(req);

    // Redirect to SSL or refuse early
    var location = api.checkRedirectSsl(req);
    if (location) return api.sendStatus(res, location);

    // Perform internal routing
    api.checkRouting(req, "routing", "ignoreRouting");

    // Rate limits by IP address and path, early before all other filters
    api.checkRateLimits(req, { type: ["ip", "path"] }, (err) => {
        if (err) {
            metrics.incr(api.metrics, err.type + '_count');
            return api.sendReply(res, err);
        }
        logger.debug("startServerRequest:", req.options);
        next();
    });
}

// Start Express middleware processing wrapped in the node domain
api.handleServerRequest = function(req, res)
{
    logger.dev("handleServerRequest:", core.port, req.url);
    var api = core.modules.api;
    var d = domain.create();
    d.on('error', (err) => {
        logger.error('handleServerRequest:', core.port, req.path, lib.traceError(err));
        if (!res.headersSent) api.sendReply(res, err);
        api.shutdown(() => { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    d.run(api.app, req, res);
}

// Prepare request options that the API routes will merge with, can be used by pre process hooks, initialize
// required properties for subsequent use
api.prepareRequest = function(req)
{
    req.body = req.body || {};
    req.query = req.query || {};

    // Cache the path so we do not need reparse it every time
    var path = req.path || "/";
    var apath = path.substr(1).split("/");
    req.user = {};
    req.options = {
        ops: {},
        noscan: 1,
        ip: req.ip,
        host: (req.hostname || "").toLowerCase(),
        domain: lib.domainName(req.hostname),
        path: path,
        apath: apath,
        secure: req.secure ? "s": "",
        mtime: Date.now(),
        clength: lib.toNumber(req.get("content-length")),
        ctype: req.get("content-type") || "",
    };

    var sc = req.options.ctype.indexOf(";");
    if (sc > 0) req.options.ctype = req.options.ctype.substr(0, sc).trim();

    req.__ = lib.__.bind(req);
    if (req.res) {
        if (!req.res.locals) req.res.locals = {};
        req.res.locals.__ = req.res.__ = lib.__.bind(req.res);
    }

    this.prepareOptions(req);
    logger.debug("prepareRequest:", req.options);
}

// Parse or re-parse special headers about app version, language and timezone, it is called early to parse headers first and then
// right after the query parameters are available, query values have higher priority than headers.
api.prepareOptions = function(req)
{
    // Timezone offset from UTC passed by the client, we just keep it, how to use it is up to the application
    if (!req.options.appTimezone) {
        req.options.appTimezone = lib.toNumber(req.query[this.tzHeader] || req.headers[this.tzHeader], { dflt: 0, min: -720, max: 720 }) * 60000;
    }

    // Authorization user or token
    var auth = req.headers.authorization;
    if (auth) {
        let idx = auth.indexOf(" ");
        req.options.auth_type = auth.substr(0, idx);
        req.options.auth_user = auth.substr(idx + 1);
        if (req.options.auth_type == "Basic") {
            auth = Buffer.from(req.options.auth_user, 'base64').toString();
            idx = auth.indexOf(':');
            req.options.auth_user = auth.substr(0, idx);
            req.options.auth_passwd = auth.substr(idx + 1);
        }
    }
}

api.handleResponseHeaders = function(req, res, next)
{
    var location = req.options.host + req.options.path;

    if (!api.serverHeader) {
        api.serverHeader = core.name + '/' + core.version + " " + core.appName + "/" + core.appVersion;
    }
    res.header('Server', api.serverHeader);

    // Allow cross site requests
    if (lib.testRegexpObj(location, api.corsAllow)) {
        res.header('Access-Control-Allow-Origin', api.corsOrigin);
        res.header('Access-Control-Allow-Headers', ['content-type', api.signature.header, api.tzHeader].join(", "));
        res.header('Access-Control-Allow-Methods', api.corsMethods.join(", "));
        res.header('Access-Control-Allow-Credentials', api.corsCredentials);
        // Return immediately for preflight requests
        if (req.method == 'OPTIONS' && req.get('Access-Control-Request-Method')) return res.sendStatus(204);
    }

    // Set response header by location
    for (const i in api.responseHeaders) {
        const rule = api.responseHeaders[i];
        if (!lib.isArray(rule.value)) continue;
        if (lib.testRegexpObj(req.options.path, rule) || lib.testRegexpObj(location, rule)) {
            for (let j = 0; j < rule.value.length - 1; j += 2) {
                if (rule.value[j + 1]) res.setHeader(rule.value[j], rule.value[j + 1]); else res.removeHeader(rule.value[j]);
            }
        }
    }
    logger.debug('handleResponseHeaders:', core.port, req.method, req.connection.remoteAddress, req.options, req.headers);

    // Redirect before processing the request
    location = api.checkRedirectRules(req, "redirectUrl");
    if (location) return api.sendStatus(res, location);

    next();
}

// This is supposed to be called at the beginning of request processing to start metrics and install the handler which
// will be called at the end to finalize the metrics and call the cleanup handlers.
api.startMetrics = function(req, res, next)
{
    req._timer = this.metrics.req.start();
    this.metrics.que.update(++this.metrics.running);

    var end = res.end;
    res.end = function(chunk, encoding) {
        res.end = end;
        res.end(chunk, encoding);
        api.handleMetrics(req);
        api.handleCleanup(req);
    }

    // Register trace for the request, by default use fake tracer unless explicity marked to use real metrics
    if (api.traceOptions?.interval > 0) {
        if ((!api._traceTime || req.options.mtime - api._traceTime > api.traceOptions.interval) &&
            api.traceOptions?.path?.test && api.traceOptions.path.test(req.options.path)) {
            var opts = {
                _host: api.traceOptions?.host,

                service: {
                    version: core.appName + "/" + core.appVersion,
                },
                annotations: {
                    tag: core.instance.tag || core.name,
                    role: core.role,
                }
            };
            if (core.instance.type == "aws") {
                opts.aws = {};
                if (core.instance.container) {
                    opts.aws.ecs = {
                        container: core.instance.container,
                        container_id: core.instance.container_id,
                    };
                }
                if (core.instance.image) {
                    opts.aws.ec2 = {
                        instance_id: core.instance.id,
                        ami_id: core.instance.image,
                    };
                }
            }
            req.trace = new metrics.Trace(opts);
            api._traceTime = req.options.mtime;
        }
    }
    if (!req.trace) req.trace = new metrics.FakeTrace();

    next();
}

// Finish metrics collection about the current rquest
api.handleMetrics = function(req)
{
    req.elapsed = req._timer?.end();
    delete req._timer;

    this.metrics.running--;
    if (req.res.statusCode) {
        metrics.incr(this.metrics, req.res.statusCode + "_count");
    }
    if (req.res.statusCode >= 400 && req.res.statusCode < 500) {
        this.metrics.bad_count++;
    }
    if (req.res.statusCode >= 500) {
        this.metrics.err_count++;
    }
    req.trace.stop(req);
    req.trace.send();
    req.trace.destroy();
}

// Call registered cleanup hooks and clear the request explicitly
api.handleCleanup = function(req)
{
    var hooks = this.findHook('cleanup', req.method, req.options.path);
    lib.forEverySeries(hooks, (hook, next) => {
        logger.debug('cleanup:', req.method, req.options.path, hook.path);
        hook.callback(req, next);
    }, () => {
        for (const p in req) {
            if (p.startsWith("__") || api.requestCleanup.includes(p)) {
                for (const c in req[p]) delete req[p][c];
                if (!lib.isObject(req[p])) delete req[p];
            }
        }
        for (const p in req.files) {
            if (req.files[p] && req.files[p].path) {
                fs.unlink(req.files[p].path, (err) => { if (err) logger.error("cleanup:", err); });
            }
        }
    }, true);
}

// Parse incoming query parameters in the request body, this is default middleware called early before authenticatoion.
//  Only methods in `-api-body-methods` processed, defaults are POST/PUT/PATCH.
// Store parsed parameters in the `req.body`, if `req.query` is empty it will point to the req.body for convenience.
api.handleBody = function(req, res, next)
{
    if (req._body) return next();

    switch (req.options.ctype) {
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
    case "text/xml":
    case "application/xml":
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (!lib.testRegexpObj(req.options.ctype, this.bodyTypes)) return next();
        req.setEncoding('binary');
    }

    if (req.options.clength > 0 && req.options.clength >= this.queryLimit) {
        this.metrics.large_count++;
        logger.debug("handleBody:", "too large:", req.path, req.headers);
        return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, length: req.options.clength }));
    }

    req._body = true;
    var buf = '', size = 0;
    var sig = this.signature.get(req);

    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > api.queryLimit) {
            this.metrics.large_count++;
            logger.debug("handleBody:", "too large:", req.path, req.headers, buf);
            return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.queryLimit, length: size }));
        }
        buf += chunk;
    });
    req.on('end', () => {
        try {
            if (size > api.queryLimit) {
                this.metrics.large_count++;
                logger.debug("handleBody:", "too large:", req.path, req.headers, buf);
                return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.queryLimit, length: size }));
            }

            // Verify data checksum before parsing
            if (sig?.checksum && lib.hash(buf) != sig.checksum) {
                return next(lib.newError("invalid data checksum"));
            }

            switch (lib.testRegexpObj(req.options.path, api.bodyRaw) ? null : req.options.ctype) {
            case "text/xml":
            case "application/xml":
                if (!api.bodyMethods.includes(req.method)) break;
                req.body = lib.xmlParse(buf, { datatype: "object", logger: "debug" });
                if (lib.isEmpty(req.query)) req.query = req.body;
                req.raw_body = buf;
                break;

            case "text/json":
            case "application/json":
                if (!api.bodyMethods.includes(req.method)) break;
                req.body = lib.jsonParse(buf, { datatype: "object", logger: "debug" });
                if (lib.isEmpty(req.query)) req.query = req.body;
                req.raw_body = buf;
                break;

            case "application/x-www-form-urlencoded":
                if (!api.bodyMethods.includes(req.method)) break;
                req.body = buf.length ? qs.parse(buf, api.qsOptions) : {};
                if (lib.isEmpty(req.query)) req.query = req.body;
                req.raw_body = buf;
                break;

            default:
                req.body = buf;
            }
            api.prepareOptions(req);
            next();
        } catch (err) {
            err.status = 400;
            err.title = "handleBody";
            next(err);
        }
    });
}

// Parse multipart forms for uploaded files, this must be called explicitly by the endpoints that need uploads.
//
// Example
//
//        api.app.post("/upload", api.handleMultipart, (req, res, next) => {
//            if (req.files.file) ....
//        })
//
// Another global way to handle uploads for many endpoints is to call it for all known paths at once before the actual
// upload handlers.
//
//        api.app.post(/^\/upload\//, api.handleMultipart, (req, res, next) => (next("route")));
//        ...
//        api.app.post("/upload/icon", (req, res, next) => {
//        ...
//        api.app.post("/upload/icon", (req, res, next) => {
//
//
// The api module handles uploads automatically for configured paths via `-api-allow-multipart` config parameter.
//
api.handleMultipart = function(req, res, next)
{
    if (!req.is('multipart/form-data')) return next();

    const opts = {
        uploadDir: core.path.tmp,
        allowEmptyFiles: true,
        keepExtensions: true,
        maxFiles: api.filesLimit,
        maxFileSize: api.uploadLimit,
        maxFields: api.fieldsLimit,
        maxFieldsSize: api.queryLimit,
    };
    const form = formidable.formidable(opts);
    const trace = req.trace.start("handleMultipart");

    var data = {}, files = {};

    form.on('field', (name, val) => {
        if (Array.isArray(data[name])) {
            data[name].push(val);
        } else
        if (data[name]) {
            data[name] = [data[name], val];
        } else {
            data[name] = val;
        }
    });
    form.on('file', (name, val) => {
        val = val.toJSON();
        val.path = val.filepath;
        val.name = val.originalFilename;
        files[name] = val;
    });
    form.on('progress', (bytesReceived, bytesExpected) => {
        if (bytesExpected < api.uploadLimit) return;
        this.metrics.large_count++;
        form.emit("error", lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.uploadLimit, length: bytesExpected }));
    });

    form.parse(req, (err) => {
        logger.debug("handleMultipart:", err, req.path, req.headers, data, Object.keys(files));
        if (err) {
            if (err && /maxFile|maxField|maxTotal/.test(err.message)) {
                this.metrics.large_count++;
                err._msg = api.errTooLarge;
                err.status = 413;
            }
            trace.stop(err);
            return next(err);
        }
        try {
            req.body = qs.parse(data, api.qsOptions);
            req.files = files;
            if (lib.isEmpty(req.query)) req.query = req.body;
            trace.stop();
            next();
        } catch (e) {
            e.status = 400;
            e.title = "handleMultipart";
            trace.stop(e);
            next(e);
        }
    });
}

// Check if the current request must be re-routed to another endpoint
api.checkRouting = function(req, name, ignore)
{
    var location = req.options.host + req.options.path;
    // Some subset of urls can be ignored
    if (ignore) {
        ignore = this[ignore];
        if (lib.testRegexpObj(req.options.path, ignore) || lib.testRegexpObj(location, ignore)) return;
    }
    // Change the url into a new one according to the first matched rule
    var rules = this[name];
    for (var p in rules) {
        if (lib.testRegexpObj(req.options.path, rules[p]) || lib.testRegexpObj(location, rules[p])) {
            req.signatureUrl = req.url;
            api.replacePath(req, api.checkRedirectPlaceholders(req, p));
            logger.debug("checkRouting:", name, location, "switch to:", p, req.url);
            break;
        }
    }
}

api.checkStaticRouting = function(req)
{
    if (!lib.testRegexpObj(req.options.path, api.noVhostPath)) {
        for (const p in api.vhostPath) {
            if (lib.testRegexp(req.options.host, api.vhostPath[p])) {
                api.replacePath(req, "/" + p + req.options.path);
                logger.debug("vhost:", req.options.host, "rerouting to", req.url);
                break;
            }
        }
    }
    for (const p in api.compressed) {
        if (lib.testRegexp(req.options.path, api.compressed[p])) {
            api.replacePath(req, req.options.path + "." + p);
            req.res.setHeader("Content-Encoding", p == "br" ? "brotli" : "gzip");
            req.res.setHeader("Content-Type", core.mime.lookup(req.options.opath));
            logger.debug("compressed:", req.options.opath, "rerouting to", req.url);
            break;
        }
    }
}

// Replace redirect placeholders
api.checkRedirectPlaceholders = function(req, pathname)
{
    return pathname.replace(/@(HOST|IP|DOMAIN|PATH([1-9])?|URL|BASE|FILE|DIR|SUBDIR|EXT|QUERY)@/g, function(_, m) {
        switch (m.substr(0, 2)) {
        case "HO": return req.options.host;
        case "IP": return req.options.ip;
        case "DO": return req.options.domain;
        case "PA": return m[4] > 0 ? req.options.apath.slice(m[4]).join("/") : req.options.path;
        case "UR": return req.url;
        case "BA": return path.basename(req.options.path).split(".").shift();
        case "FI": return path.basename(req.options.path);
        case "DI": return path.dirname(req.options.path);
        case "SU": return path.dirname(req.options.path).split("/").pop();
        case "EX": return path.extname(req.options.path);
        case "QU": return qs.stringify(req.query);
        }
    });
}

// Check a request for possible SSL redirection, it checks the original URL
//
api.checkRedirectSsl = function(req)
{
    var url = req.signatureUrl || req.url, location = req.options.host + url;
    // Auto redirect to SSL
    if (this.redirectSsl.rx) {
        if (!req.options.secure && (this.redirectSsl.rx.test(url) || this.redirectSsl.rx.test(location))) {
            return { status: 302, url: "https://" + req.options.host + url };
        }
    }
    // SSL only access, deny access without redirect
    if (this.allowSsl.rx) {
        if (!req.options.secure && (this.allowSsl.rx.test(url) || this.allowSsl.rx.test(location))) {
            if (!this.ignoreSsl.rx || !(this.ignoreSsl.rx.test(req.options.ip) || this.ignoreSsl.rx.test(req.options.path) || this.ignoreSsl.rx.test(location))) {
                return { status: 421, message: "This location requires SSL" };
            }
        }
    }
    return null;
}

// Check a request for possible redirection condition based on the configuration.
// This is used by API servers for early redirections. It returns null
// if no redirects or errors happend, otherwise an object with status that is expected by the `api.sendStatus` method.
// The options is expected to contain the following cached request properties:
// - path - from req.path or the request pathname only
// - host - from req.hostname or the hostname part only
// - port - port from the host: header if specified
// - secure - if the protocol is https
api.checkRedirectRules = function(req, name)
{
    var url = req.url, location = req.options.host + url;
    var rules = this[name];
    for (var i in rules) {
        const rx = util.types.isRegExp(rules[i].rx) ? rules[i].rx : util.types.isRegExp(rules[i]) ? rules[i] : null;
        if (rx && (rx.test(url) || rx.test(location))) {
            let loc = !lib.isNumeric(i) ? i : rules[i].value || "";
            if (!loc) continue;
            var status = 302;
            if (loc[0]== "3" && loc[1] == "0" && loc[3] == ":") {
                status = lib.toNumber(loc.substr(0, 3), { dflt: 302 });
                loc = loc.substr(4);
            }
            loc = this.checkRedirectPlaceholders(req, loc);
            logger.debug("checkRedirectRules:", name, location, req.options.path, "=>", status, loc, "rule:", i, rules[i]);
            return { status: status, url: loc };
        }
    }
    return null;
}

// Perform rate limiting by specified property, if not given no limiting is done.
//
// The following options properties can be used:
//  - type - determines by which property to perform rate limiting, when using user properties
//     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
//     custom type and used as is. If it is an array all items will be checked sequentially.
//     **This property is required.**
//
//     The predefined types checked for every request:
//     - ip - check every IP address
//     - path - limit by path and IP address, * can be used at the end to match only the beginning,
//         method can be placed before the path to use different rates for the same path by request method
//
//         -api-rlimits-rate-ip=100
//         -api-rlimits-rate-/api/path=2
//         -api-rlimits-rate-GET/api/path=10
//         -api-rlimits-rate-/api/path/*=1
//         -api-rlimits-rate-/api/path/127.0.0.1=100
//         -api-rlimits-map-/api/*=rate:100,interval:1000
//
//  - ip - to use the specified IP address
//  - max - max capacity to be used by default
//  - rate - fill rate to be used by default
//  - interval - interval in ms within which the rate is measured, default 1000 ms
//  - message - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
//  - queue - which queue to use instead of the default, some limits is more useful with global queues like Redis instead of the default
//  - delay - time in ms to delay the response, slowing down request rate
//  - multiplier - multiply the interval after it consumed all tokens, subsequent checks use the increased interval, fractions supported,
//    if the multiplier is positive then the interval will keep increasing indefinitely, if it is negative the interval will reset to the default
//    value on first successful consumption
//
// The metrics are kept in the LRU cache in the process by default or in cluster mode in the server process.
//
// Example:
//
//       api.checkRateLimits(req, { type: "ip", rate: 100, interval: 60000 }, (err, info) => {
//          if (err) return api.sendReply(err);
//          ...
//       });
//
api.checkRateLimits = function(req, options, callback)
{
    if (typeof callback != "function") callback = lib.noop;
    if (!req || !options?.type) return callback();
    var types = Array.isArray(options.type) ? options.type : [ options.type ];
    var ip = options.ip || req.options?.ip;
    var mapping = this.rlimitsMap;
    lib.forEachSeries(types, (type, next) => {
        var name = type, key = type;
        switch (type) {
        case "ip":
            name = ip;
            break;

        case "path":
            key = options.path || req.options?.path;
            if (!key) break;
            if (!mapping[key] && !mapping[req.method + key]) {
                for (const p in mapping) {
                    const item = mapping[p];
                    if (item._seen === undefined) {
                        item._seen = p.endsWith("*") ? p.slice(0, -1) : null;
                    }
                    if (item._seen && key.startsWith(item._seen)) {
                        key = p;
                        break;
                    }
                }
            }
            name = key + "/" + ip;
            break;
        }

        var map = mapping[name] || mapping[req.method + key] || mapping[key];
        var rate = options.rate || map?.rate;
        logger.debug("checkRateLimits:", type, key, name, req.method, options, map);
        if (!rate) return next();
        var max = options.max || map?.max || rate;
        var interval = options.interval || map?.interval || this.rlimits.interval || 1000;
        var multiplier = options.multiplier || map?.multiplier || this.rlimits.multiplier || 0;
        var ttl = options.ttl || map?.ttl || this.rlimits.ttl;
        var cacheName = options.cache || map?.cache || this.limiterCache;

        // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
        // in master mode use direct access to the LRU cache
        var limit = {
            name: "RL:" + name,
            rate,
            max,
            interval,
            ttl,
            multiplier,
            cacheName,
        };
        cache.limiter(limit, (delay, info) => {
            logger.debug("checkRateLimits:", options, "L:", limit, "D:", delay, info);
            if (!delay) return next();
            var err = { status: 429, message: lib.__(options.message || map?.message || api.rlimits.message, lib.toDuration(delay)), retryAfter: delay };
            if (options.delay || map?.delay) {
                if (req.options) req.options.sendDelay = -1;
                return setTimeout(callback, options.delay || map?.delay, err, info);
            }
            callback(err, info);
        });
    }, callback, true);
}

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
// If err is not null the error message is returned immediately.
api.sendJSON = function(req, err, data)
{
    if (err) return this.sendReply(req.res, err);

    // Do not cache API results by default, routes that send directly have to handle cache explicitely
    if (!req.res.get("cache-control")) {
        req.res.header("pragma", "no-cache");
        req.res.header("cache-control", "max-age=0, no-cache, no-store");
        req.res.header('last-modified', new Date().toUTCString());
    }

    if (!data) data = {};
    var sent = 0;
    var hooks = this.findHook('post', req.method, req.options.path);
    lib.forEachSeries(hooks, (hook, next) => {
        try {
            sent = hook.callback(req, req.res, data);
        } catch (e) {
            logger.error('sendJSON:', req.options.path, e.stack);
        }
        logger.debug('sendJSON:', req.method, req.options.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, (err) => {
        if (sent || req.res.headersSent) return;
        // Keep only public columns for the combination of all tables specified
        if (req.options.cleanup) {
            api.cleanupResult(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        }
        if (req.options.pretty) {
            req.res.header('Content-Type', 'application/json');
            req.res.status(200).send(lib.stringify(data, null, req.options.pretty) + "\n");
        } else {
            req.res.json(data);
        }
    }, true);
}

// Send result back formatting according to the options properties:
//  - format - json, csv, xml, JSON is default
//  - separator - a separator to use for CSV and other formats
api.sendFormatted = function(req, err, data, options)
{
    if (err) return this.sendReply(req.res, err);
    if (!options) options = req.options;
    if (!data) data = {};

    switch (options.format) {
    case "xml":
        if (req.options.cleanup) this.cleanupResult(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var xml = "<data>\n";
        if (data.next_token) xml += "<next_token>" + data.next_token + "</next_token>\n";
        xml += lib.toFormat(options.format, data, options);
        xml += "</data>";
        req.res.set('Content-Type', 'application/xml');
        req.res.status(200).send(xml);
        break;

    case "csv":
        if (req.options.cleanup) this.cleanupResult(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var rows = Array.isArray(data) ? data : (data.data || lib.emptylist);
        var csv = lib.objKeys(rows[0]).join(options.separator || "|") + "\n";
        csv += lib.toFormat(options.format, rows, options);
        req.res.set('Content-Type', 'text/csv');
        req.res.status(200).send(csv);
        break;

    case "json":
    case "jsontext":
        if (req.options.cleanup) this.cleanupResult(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var json = lib.toFormat(options.format, data, options);
        req.res.set('Content-Type', 'text/plain');
        req.res.status(200).send(json);
        break;

    default:
        this.sendJSON(req, err, data);
    }
}

// Return reply to the client using the options object, it contains the following properties:
// - status - defines the respone status code
// - message  - property to be sent as status line and in the body
// - type - defines Content-Type header, the message will be sent in the body
// - url - for redirects when status is 301, 302...
//
// **i18n Note:**
//
// The API server attaches fake i18n functions `req.__` and `res.__` which are used automatically for the `message` property
// before sending the response.
//
// With real i18n module these can/will be replaced performing actual translation without
// using `i18n.__` method for messages explicitely in the application code for `sendStatus` or `sendReply` methods.
//
// Replies can be delayed per status via `api.delays` if configured, to override any daly set
// `req.options.sendDelay` to nonzero value, negative equals no delay
//
//
api.sendStatus = function(res, options)
{
    if (res.headersSent) return;
    if (!options) options = { status: 200, message: "" };
    var req = res.req, sent = 0;
    var status = options.status || 200;
    var delay = req.options?.sendDelay || (options.code && api.delays[`${status}:${options.code}`]) || api.delays[status];
    try {
        switch (status) {
        case 301:
        case 302:
        case 303:
        case 307:
        case 308:
            res.redirect(status, options.url);
            break;

        default:
            var hooks = this.findHook('status', req.method, req.options?.path);
            lib.forEachSeries(hooks, (hook, next) => {
                try {
                    sent = hook.callback(req, res, options);
                } catch (e) {
                    logger.error('sendStatus:', req.options?.path, e.stack);
                }
                logger.debug('sendStatus:', req.method, req.options?.path, hook.path, 'sent:', sent || res.headersSent, delay);
                next(sent || res.headersSent);
            }, (err) => {
                if (sent || res.headersSent) return;
                if (options.contentType) {
                    res.type(options.contentType);
                    if (delay > 0) {
                        setTimeout(() => {
                            res.status(status).send(res.__(options.message || ""));
                        }, delay);
                    } else {
                        res.status(status).send(res.__(options.message || ""));
                    }
                } else {
                    for (const p in options) {
                        if (typeof options[p] == "string") options[p] = res.__(options[p]);
                    }
                    if (delay > 0) {
                        setTimeout(() => {
                            res.status(status).json(options);
                        }, delay);
                    } else {
                        res.status(status).json(options);
                    }
                }
            }, true);
        }
    } catch (e) {
        logger.error('sendStatus:', res.req.url, res.getHeaders(), options, e.stack);
    }
}

// Send formatted JSON reply to an API client, if status is an instance of Error then error message with status 500 is sent back.
//
// If the status is an object it is sent as is.
//
// All Error objects will return a generic error message without exposing the real error message, it will log all error exceptions in the logger
// subject to log throttling configuration.
api.sendReply = function(res, status, text)
{
    if (util.types.isNativeError(status)) {
        // Do not show runtime errors
        if (status.message && !this.errlogLimiterIgnore.rx.test(status.message)) {
            if (!this.errlogLimiterToken || this.errlogLimiterToken.consume(1)) {
                logger.error("sendReply:", res.req.url, status.message, res.req.headers, res.req.query, res.req.options, lib.traceError(status));
            }
        }
        text = lib.testRegexpObj(status.code, this.allowErrorCode) ? res.__(status.message) :
               status._msg ? res.__(status._msg) : res.__(this.errInternalError);
        status = status.status > 0 ? status.status : 500;
        return this.sendStatus(res, { status: status || 200, message: typeof text == "string" ? text : String(text || "") });
    }
    if (status instanceof Object) {
        status.status = status.status > 0 ? status.status : 200;
        return this.sendStatus(res, status);
    }
    if (typeof status == "string" && status) {
        text = status;
        status = 500;
    }
    if (status >= 400) logger.debug("sendReply:", status, text);
    this.sendStatus(res, { status: status || 200, message: typeof text == "string" ? text : String(text || "") });
}

// Send file back to the client, res is Express response object
api.sendFile = function(req, file, redirect)
{
    file = this.normalize(file);
    fs.stat(file, function(err, st) {
        logger.debug("sendFile:", file, st);
        if (req.method == 'HEAD') return req.res.set("Content-Length", err ? 0 : st.size).set("Content-Type", core.mime.lookup(file)).status(!err ? 200 : 404).send();
        if (!err) return req.res.sendFile(file, { root: core.home });
        if (redirect) return req.res.redirect(redirect);
        req.res.sendStatus(404);
    });
}

// API stats if running
api.bkCollectStats = function(options)
{
    if (!api.app) return;
    var m = metrics.toJSON(api.metrics, { reset: 1, take: /_count$/ });
    options.stats.api_req_count = m.req.meter.count;
    options.stats.api_req_rate = m.req.meter.rate;
    options.stats.api_res_time = m.req.histogram.med;
    options.stats.api_que_size = m.que.med;
    for (const p in m) {
        if (p.endsWith("_count")) options.stats["api_" + p] = m[p];
    }
}

require(__dirname + "/api/acl")
require(__dirname + "/api/auth")
require(__dirname + "/api/hooks")
require(__dirname + "/api/utils")

