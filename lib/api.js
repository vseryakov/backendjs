/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const stream = require('stream');
const fs = require('fs');
const domain = require('domain');
const http = require('http');
const https = require('https');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const metrics = require(__dirname + '/metrics');
const logger = require(__dirname + '/logger');

/**
 * @module api
 */

const api =

/**
 * HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
 * incorporates the Express app which is exposed as __api.app__ object with router as __api.Router__, the server spawns Web workers to perform actual operations, monitors
 * the worker processes if they die and restart them automatically.
 *
 * How many processes to spawn can be configured via __-server-max-workers__ config parameter.
 *
 * When an HTTP request arrives it goes over Express middleware, but before processing any registered routes there are several steps performed:
 * - the __req__ object which is by convention is a Request object, assigned with common backend properties to be used later:
 *   - user - an empty object which will be filled after by signature verification method, if successful, properties from the __bk_user__ table will be set
 *   - options - an object with internal state and control parameters. Every request always has an options object attached very
 *     early with some properties always present:
 *      - ip - cached IP address
 *      - host - cached host header from the request
 *      - hostname - cached host header without port
 *      - location - hostname + path
 *      - domain - domain part from the host
 *      - origin - full origin with protocol + host
 *      - path - parsed request url path
 *      - apath - an array with the path split by /
 *      - secure - if the request is encrypted, like https
 *      - length - Content-Length header as a number
 *      - contentType - Content-Type header value
 * - access verification, can the request be satisfied without proper signature, i.e. is this a public request
 * - autherization, check the signature and other global or user specific checks
 * - when a API route found by the request url, it is called as any regular Express middlware
 *   - if there are registered pre processing callback they will be called during access or autherization phases
 *   - if inside the route a response was returned using __api.sendJSON__ method, registered post process callbacks will be called for such response
 *
 * Every request has the __trace__ property, either fake or X-Ray depending on the config, see metrics for usage
 *
 * ### Health enquiry
 *
 * When running with AWS load balancer there should be a url that a load balancer polls all the time and this must be very quick and lightweight request. For this
 * purpose there is an API endpoint __/ping__ that just responds with status 200. It is open by default in the default __api-allow-path__ config parameter.
 *
 */

module.exports = {
    name: "api",

    /**
     * @var {ConfigOptions[]} args
     */
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "port", type: "number", min: 0, descr: "port to listen for the HTTP server, this is global default" },
        { name: "bind", descr: "Bind to this address only, if not specified listen on all interfaces" },
        { name: "backlog", type: "int", descr: "The maximum length of the queue of pending connections, used by HTTP server in listen." },
        { name: "reuse-port", type: "bool", descr: "Allow multiple sockets on the same host to bind to the same port" },
        { name: "ssl", type: "map", obj: 'ssl', merge: 1, descr: "SSL params: port, bind, key, cert, pfx, ca, passphrase, crl, ciphers" },
        { name: "accesslog-disable", obj: "accesslog", type: "bool", descr: "Disable access logging in both file or syslog" },
        { name: "accesslog-file", obj: "accesslog", descr: "File for access logging" },
        { name: "accesslog-level", obj: "accesslog", type: "int", descr: "Syslog level priority, default is local5.info, 21 * 8 + 6" },
        { name: "accesslog-fields", obj: "accesslog", array: 1, type: "list", descr: "Additional fields from the request or user to put in the access log, prefix defines where the field is lcoated: q: - query, h: - headers, u: - user otherwise from the request", example: "api-log-fields = h:Referer,u:name,q:action" },
        { name: "errlog-max", obj: "errlog", type: "int", descr: "How many error messages to put in the log before throttling kicks in" },
        { name: "errlog-interval", obj: "errlog", type: "int", descr: "Interval for error log limiter, max errors per this interval" },
        { name: "errlog-ignore", obj: "errlog", type: "regexpobj", descr: "Do not show errors that match the regexp" },
        { name: "errlog-codes", obj: "errlog", type: "regexpobj", descr: "Error codes in exceptions to return in the response to the user, if not matched the errlog.message will be returned", example: "# For development it may be useful to see all exceptions\napi-errlog-codes = 4|5" },
        { name: "token-secret", descr: "A generic secret to be used for API sessions, signatures, passkeys" },
        { name: "allow-configure-(web|middleware)", type: "regexp", descr: "Modules allowed to call configureWeb or Middleware, i.e. only allowed endpoints" },
        { name: "express-options", type: "json", obj: "express-options", merge: 1, logger: "warn", descr: "Set Express config options during initialization", example: '-api-express-options { "trust proxy": 1, "strict routing": true }' },
        { name: "body-methods", obj: "body", type: "list", upper: 1, descr: "HTTP methods allowed to have body" },
        { name: "body-types", obj: "body", type: "regexpobj", descr: "Collect full request body in the req.body property for the given MIME types in addition to default json/form posts, this is for custom body processing" },
        { name: "body-multipart", obj: "body", type: "regexpobj", descr: "Paths that expect multipart/form-data payloads, parsing will happen after the signature processed automatically, other routes need to call api.handleMultipart explicitely", example: "api-allow-multipart = ^/upload" },
        { name: "body-allow", obj: "body", type: "regexpobj", descr: "Paths that expect JSON/form payloads, parsing will happen before the signature processed, by default all requests are parsed, if defined only matched paths will be processed, the rest will have to use api.handleBody explicitely", example: "api-body-allow = ^/api" },
        { name: "cors-origin", obj: "cors", descr: "Origin header for CORS requests" },
        { name: "cors-allow", obj: "cors", type: "regexpobj", descr: "Enable CORS requests if a request host/path matches the given regexp" },
        { name: "server-header", descr: "Custom Server: header to return for all requests" },
        { name: "rlimits-([a-z]+)$", obj: "rlimits", make: "$1", autotype: 1, descr: "Default rate limiter parameters, default interval is 1s, `ttl` is to expire old cache entries, message for error, default cache is local" },
        { name: "rlimits-(rate|max|interval|ttl|ip|delay|multiplier|queue)-(.+)", autotype: 1, obj: "rlimitsMap.$2", make: "$1", descr: "Rate limiter parameters by type for Token Bucket algorithm. `queue` to use specific queue, ttl` is to expire cache entries, `ip` is to limit by IP address as well", example: "api-rlimits-ip-ip=10\napi-rlimits-rate-/path=1\napi-rlimits-rate-GET/path=1" },
        { name: "rlimits-map-(.+)", type: "map", obj: "rlimitsMap.$1", merge: 1, descr: "Rate limiter parameters for Token Bucket algorithm. set all at once", example: "api-rlimits-map-/url=rate:1,interval:2000\napi-rlimits-map-GET/url=rate:10" },
        { name: "limits-(query|header|upload)-size", obj: "limits", type: "number", descr: "Max size for query/headers/uploads, bytes" },
        { name: "limits-(files|fields)", obj: "limits", type: "number", descr: "Max number of files or fields in uploads" },
        { name: "limits-queue-size", obj: "limits", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns too busy error" },
        { name: "limits-requests-per-socket", obj: "limits", type: "int", min: 0, descr: "The maximum number of requests a socket can handle before closing keep alive connection" },
        { name: "limits-timeout", obj: "limits", type: "number", min: 0, max: 3600000, descr: "HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests" },
        { name: "limits-keep-alive-timeout", obj: "limits", type: "int", descr: "Number of milliseconds to keep the HTTP conection alive" },
        { name: "limits-request-timeout", obj: "limits", type: "int", min: 0, descr: "Number of milliseconds to receive the entire request from the client" },
        { name: "response-headers", type: "regexpmap", json: 1, descr: "An JSON object with list of regexps to match against the location and set response headers defined as a list of pairs name, value...", example: 'api-response-headers={ "^/": ["x-frame-options","sameorigin","x-xss-protection","1; mode=block"] }' },
        { name: "cleanup-rules-(.+)", obj: "cleanupRules.$1", type: "map", merge: 1, nocamel: 1, descr: "Rules for the cleanupResult per table, ex. api-cleanup-rules-bk_user=email:0,phone:1" },
        { name: "cleanup-strict", type: "bool", descr: "Default mode for cleanup results" },
        { name: "request-cleanup", type: "list", array: 1, descr: "List of fields to explicitely cleanup on request end" },
        { name: "query-defaults-([a-z0-9_]+)-(.+)", obj: "queryDefaults.$2", make: "$1", autotype: 1, descr: "Global query defaults for getQuery, can be path specific", example: "-api-query-defaults-max-name 128 -api-query-defaults-max-/endpoint-name 255" },
        { name: "delays-(.+)", type: "int", obj: "delays", nocamel: 1, descr: "Delays in ms by status and code, useful for delaying error responses to slow down brute force attacks", example: "-api-delays-401 1000 -api-delays-403:DENY -1" },
        { name: "restart-hours", type: "list", datatype: "int", descr: "List of hours when to restart api workers, only done once for each hour" },
        { name: "trace-options", type: "map", obj: "trace-options", merge: 1, descr: "Options for tracing, host where to send if not local, path:regexp for URLs to be traced, interval:Interval in ms how often to trace requests, must be > 0 to enable tracing" },
        { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
        { name: "restart", descr: "On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts" },
        { name: "proxy-(.+)", obj: "proxy", type: "regexp", make: "$1", nocamel: 1, descr: "Proxy matched requests by path to given host" },
    ],

    /** @var {int} port - HTTP port to listen to for Express app,
     * @default 8000
     */
    port: process.env.BKJS_PORT || 8000,

    /** @var {string} bind - listen on the specified local interfcae,
     * @default 0.0.0.0
     */
    bind: '0.0.0.0',

    backlog: 5000,

    ssl: {
        port: 443,
        bind: '0.0.0.0'
    },

    // All listening servers
    servers: [],

    traceOptions: {},

    // Rate limits
    rlimits: {
        ttl: 86400000,
        message: "Access limit reached, please try again later in %s.",
        cache: "local",
    },
    rlimitsMap: {},

    accessTokenSecret: "",
    delays: {},

    responseHeaders: [],

    body: {
        methods: ["POST", "PUT", "PATCH"],
    },

    /** @var {object} expressOptions - set Express settings on start */
    expressOptions: {
        "trust proxy": 1,
        "x-powered-by": false
    },

    /** @var {object} limits - incoming and server limits */
    limits: {
        files: 10,
        fields: 100,

        /** @var {int} limits.uploadSize - file limit for multi-part uploads
        * @default
        */
        uploadSize: 25000000,

        /** @var {int} limits.querySize - toal size of request query
        * @default
        */
        querySize: 64000,

        /** @var {int} limits.headerSize - total size of all headers
        * @default
        */
        headerSize: 64000,

        timeout: 30000,
        keepAliveTimeout: 61000,
        requestTimeout: 0,
    },

    cors: {
        origin: "*",
        credentials: true,
        methods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },

    // Properties to be cleaned up on finish
    requestCleanup: ["options", "user", "signature", "body", "trace"],
    cleanupRules: {},

    restart: "server,web,process",

    // Metrics and stats
    metrics: {
        req: new metrics.Timer(),
        que: new metrics.Histogram(),
        running: 0,
        busy_count: 0,
        bad_count: 0,
        err_count: 0,
    },

    accesslog: {
        fields: [],
        level: 174,
    },

    // Error reporter throttle
    errlog: {
        max: 100,
        interval: 30000,
        ignore: lib.toRegexpObj(null, [ "Range Not Satisfiable", "Precondition Failed" ]),
    },

    /** @var {object} - used by {@link module:api.toParams} global defaults, passed as data */
    queryDefaults: {
        "*": {
            maxlist: 512,
        },
        "*.json": {
            max: 4000,
        },
        "*.token": {
            max: 2000,
        },
        "*.string": {
            max: 512,
        },
        "*.text": {
            max: 512,
        },
        "*.obj": {
            max: 32000
        },
        "*.object": {
            max: 32000
        },
        "*.array": {
            max: 32000
        },
    },

    errInternalError: "Internal error occurred, please try again later",
    errTooLarge: "Unable to process the request, it is too large",
};

/**
 * Initialize API layer, this must be called before the `api` module can be used but it is called by the server module automatically so `api.init` is
 * rearely need to called directly, only for new server implementation or if using in the shell for testing.
 *
 * During the init sequence, this function calls `configureMiddleware` and `configureWeb` methods of all modules.
 *
 * The api uses its own request parser that places query parameters into `req.query` or `req.body` depending on the method.
 *
 * For GET method, `req.query` contains all url-encoded parameters, for POST method `req.body`
 * contains url-encoded parameters or parsed JSON payload or multipart payload.
 *
 * @memberof module:api
 * @method init
 */
api.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Shutdown signal from the server process
    if (app.isWorker) {
        ipc.on("api:restart", () => {
            api.shutdown(() => { process.exit(0) });
        });
    }

    lib.series([
        function(next) {
            api.express = lib.tryRequire('express');
            if (!api.express) return next("Express is unavailable");

            api.app = api.express();
            api.Router = api.express.Router;
            api.Static = api.express.static;

            // Config options for Express
            for (const p in api.expressOptions) {
                api.app.set(p, api.expressOptions[p]);
            }

            // Acccess logging, always goes into api.accessLog, it must be a stream
            if (!api.accesslog.disable) {
                api.configureAccessLog();
                api.app.use(api.handleAccessLog.bind(api));
            }

            // Early request setup and checks
            api.app.use(api.startServerRequest.bind(api));

            // Proxies must be setup early before to keep all data in the stream
            if (!lib.isEmpty(api.proxy)) {
                api.app.use((req, res, next) => {
                    if (api.checkProxy("web", req, res)) return;
                    next();
                });
            }

            api.app.use(api.handleHeaders.bind(api));

            // Metrics starts early, always enabled
            api.app.use(api.startMetrics.bind(api));

            // Default JSON body parser
            api.app.use((req, res, next) => {
                if (api.body.allow && !lib.testRegexpObj(req.options.path, api.body.allow)) return next();
                api.handleBody(req, res, next);
            });

            // Assign custom middleware including security, if the signature is disabled then the middleware
            // handler may install some other authentication module and in such case
            // must setup `req.user` with the current user record
            app.runMethods("configureMiddleware", options, { allow: api.allowConfigureMiddleware }, next);
        },

        function(next) {

            // Parse multipart payload, depends on formidable availability, disable if not found
            _formidable = lib.tryRequire('formidable', { logger: "debug", message: "multipart uploads are disabled" });

            if (_formidable) {
                api.app.use((req, res, next) => {
                    if (!req.is('multipart/form-data')) return next();
                    if (!lib.testRegexpObj(req.options.path, api.body.multipart)) return next();
                    api.handleMultipart(req, res, next);
                });
            }

            // Setup routes from the loaded modules
            app.runMethods("configureWeb", options, { allow: api.allowConfigureWeb }, next);
        },

        function(next) {
            // For health checks
            api.app.get("/ping", (req, res) => {
                api.sendStatus(res, { contentType: "text/plain" });
            });

            // Static paths and templating setup
            app.runMethods("configureStaticWeb", options, { allow: api.allowConfigureMiddleware }, next);
        },

        function(next) {
            // Default error handler to show errors in the log, throttle the output to keep the log from overflow
            if (api.errlog.max && api.errlog.interval) {
                api.errlog.token = new metrics.TokenBucket(api.errlog.max, 0, api.errlog.interval);
            }

            // The last route is to return an error
            api.app.use((err, req, res, next) => {
                api.sendReply(res, err);
            });

            api.configureWebServers();

            // Notify the server about new worker server
            ipc.sendMsg("api:ready", { id: app.workerId || process.pid, port: api.port, ready: true });

            // Performs graceful web worker restart
            api._restartInterval = setInterval(() => {
                if (lib.isFlag(api.restartHours, new Date().getHours())) {
                    logger.info('restarting web workers:', api.restartHours);
                    ipc.sendMsg("api:restart");
                }
            }, 3600000);

            next();
        },
    ], callback, true);
}

/**
 * Gracefully close all connections, call the callback after that
 * @memberof module:api
 * @method shutdown
 */
var _exiting;

api.shutdown = function(options, callback)
{
    if (_exiting) return lib.tryCall(callback);

    _exiting = true;
    logger.debug("shutdown:", app.name, app.role);

    clearInterval(api._restartInterval);
    delete api._restartInterval;
    api.metrics.req.end();

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: app.workerId || process.pid, pid: process.pid, port: api.port });

    app.runMethods("shutdownServer", { direct: 1, parallel: 1 }, () => {
        delete api.app;
        _exiting = false;
        lib.tryCall(callback);
    });
}

api.shutdownServer = function(options, callback)
{
    lib.forEvery([ "server", "sslServer" ], (name, next) => {
        if (!api[name]) return next();
        var err, server = api[name];
        delete api[name];
        try {
            server.close();
            server.closeAllConnections();
            server.closeIdleConnections();
        } catch (e) {
            err = e
        }
        logger.log("shutdownServer:", api.name, app.role, name, "closed", err);
        next();
    }, callback, true);
}

api.configureWebServers = function(options, callback)
{
    // Start http server
    if (this.port) {
        api.server = this.createWebServer({
            name: "http",
            port: this.port,
            bind: this.bind,
            restart: this.restart,
            timeout: this.limits.timeout,
            keepAliveTimeout: this.limits.keepAliveTimeout,
            requestTimeout: this.limits.requestTimeout,
            maxRequestsPerSocket: this.limits.requestsPerSocket,
            maxHeaderSize: this.limits.headerSize,
            reusePort: this.reusePort,
        }, this.handleServerRequest);
    }

    // Start SSL server
    if (this.ssl?.port && (this.ssl.key || this.ssl.pfx)) {
        api.sslServer = this.createWebServer({
            name: "https",
            ssl: this.ssl,
            port: this.ssl.port,
            bind: this.ssl.bind,
            restart: this.restart,
            timeout: this.limits.timeout,
            keepAliveTimeout: this.limits.keepAliveTimeout,
            requestTimeout: this.limits.requestTimeout,
            maxRequestsPerSocket: this.limits.requestsPerSocket,
            maxHeaderSize: this.limits.headerSize,
            reusePort: this.reusePort,
        }, this.handleServerRequest);
    }

    app.runMethods("configureWebServer", options, { direct: 1 }, callback);
}

// Setup access log stream
api.configureAccessLog = function()
{
    if (logger.syslog) {
        this.accesslog.stream = new stream.Stream();
        this.accesslog.stream.writable = true;
        this.accesslog.stream.write = (data) => { logger.syslog.log(api.accesslog.level, data); return true; };
    } else
    if (this.accesslog.file) {
        this.accesslog.stream = fs.createWriteStream(this.accesslog.file, { flags: 'a' });
        this.accesslog.stream.on('error', (err) => { logger.error('accessLog:', err); api.accessLog = null; });
    } else {
        this.accesslog.stream = logger;
    }
}

api.handleAccessLog = function(req, res, next)
{
    var startTime = new Date();
    var end = res.end;
    res.end = function(chunk, encoding) {
        res.end = end;
        res.end(chunk, encoding);
        if (req._accessLog || !api.accesslog.stream) return;
        req._accessLog = true;
        var now = new Date();
        var line = req.options.ip + " - " +
                   (api.accesslog.file ? '[' + now.toUTCString() + ']' : "-") + " " +
                   req.method + " " +
                   (req.accessLogUrl || req.originalUrl || req.url) + " " +
                   (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                   res.statusCode + " " +
                   (req.options.length || '-') + " - " +
                   (now - startTime) + " ms - " +
                   (req.headers['user-agent'] || "-") + " " +
                   (req.user?.id || "-");
        // Append additional fields
        for (let v of api.accesslog.fields) {
            switch (v[1] == ":" ? v[0] : "") {
            case "q":
                v = req.query[v.substr(2)];
                break;
            case "h":
                v = req.get(v.substr(2));
                break;
            case "u":
                v = req.user && req.user[v.substr(2)];
                break;
            default:
                v = req[v];
            }
            if (typeof v == "object") v = "";
            line += " " + (v || "-");
        }
        if (api.accesslog.file) line += "\n";
        api.accesslog.stream.write(line);
    }
    next();
}

api.startServerRequest = function(req, res, next)
{
    // Fake i18n methods
    req.__ = res.__ = res.locals.__ = lib.__;

    // Request queue size
    if (api.limits.queueSize && api.metrics.running >= api.limits.queueSize) {
        api.metrics.busy_count++;
        return api.sendReply(res, 503, "Server is unavailable");
    }

    // Setup request common/required properties
    api.prepareRequest(req);

    // Perform internal routing
    api.routing.check(req, "path");

    // Rate limits by IP address and path, early before all other filters
    api.checkRateLimits(req, { type: ["ip", "path"] }, (err) => {
        if (err) {
            metrics.incr(api.metrics, err.type + '_count');
            return api.sendReply(res, err);
        }
        logger.debug("startServerRequest:", "api", req.options);
        next();
    });
}

// Start Express middleware processing wrapped in the node domain
api.handleServerRequest = function(req, res)
{
    logger.dev("handleServerRequest:", "api", api.port, req.url);
    if (!api.app) return res.end();

    var d = domain.create();
    d.on('error', (err) => {
        logger.error('handleServerRequest:', "api", api.port, req.url, lib.traceError(err));
        if (!res.headersSent) api.sendReply(res, err);
        api.shutdown({}, () => { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    d.run(api.app, req, res);
}

/**
 * Prepare request options that the API routes will merge with, can be used by pre process hooks, initialize
 * required properties for subsequent use
 * @param {IncomingRequest} req
 * @memberof module:api
 * @method prepareRequest
 */
api.prepareRequest = function(req)
{
    // Cache the path so we do not need reparse it every time
    var path = req.path || "/";
    var apath = path.substr(1).split("/");

    // Port can only be 0-65535
    const host = req.host?.toLowerCase() || '';
    const colon = host.search(/:\d{0,6}$/);
    const hostname = colon > 0 ? host.slice(0, colon) : host;

    req.options = {
        ops: {},
        ip: req.ip,
        host,
        hostname,
        domain: lib.domainName(hostname),
        origin: `${req.protocol}://${host}`,
        location: hostname + path,
        path: path,
        apath: apath,
        secure: req.secure ? "s": "",
        mtime: Date.now(),
        length: lib.toNumber(req.get("content-length")),
        contentType: req.get("content-type") || "",
    };

    var sc = req.options.contentType.indexOf(";");
    if (sc > 0) req.options.contentType = req.options.contentType.substr(0, sc).trim();

    req.__ = lib.__.bind(req);
    if (req.res) {
        if (!req.res.locals) req.res.locals = {};
        req.res.locals.__ = req.res.__ = lib.__.bind(req.res);
    }

    this.prepareOptions(req);
    logger.debug("prepareRequest:", "api", req.options);
}

/**
 * Parse or re-parse special headers about app version, language and timezone, it is called early to parse headers first and then
 * right after the query parameters are available, query values have higher priority than headers.
 * @memberof module:api
 * @method prepareOptions
 */
api.prepareOptions = function(req)
{
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

api.handleHeaders = function(req, res, next)
{
    res.header('Server', api.serverHeader || app.version);

    // Allow cross site requests
    if (lib.testRegexpObj(req.options.location, api.cors.allow)) {
        res.header('Access-Control-Allow-Origin', api.cors.origin);
        res.header('Access-Control-Allow-Headers', 'content-type, ' + api.session.header);
        res.header('Access-Control-Allow-Methods', api.cors.methods.join(", "));
        res.header('Access-Control-Allow-Credentials', api.cors.credentials);
        // Return immediately for preflight requests
        if (req.method == 'OPTIONS' && req.get('Access-Control-Request-Method')) {
            return res.sendStatus(204);
        }
    }

    // Set response header by location
    for (const i in api.responseHeaders) {
        const rule = api.responseHeaders[i];
        if (!lib.isArray(rule.value)) continue;

        if (lib.testRegexpObj(req.options.path, rule) || lib.testRegexpObj(req.options.location, rule)) {
            for (let j = 0; j < rule.value.length - 1; j += 2) {
                if (rule.value[j + 1]) res.setHeader(rule.value[j], rule.value[j + 1]); else res.removeHeader(rule.value[j]);
            }
        }
    }
    logger.debug('handleHeaders:', "api", api.port, req.method, req.connection.remoteAddress, req.options, req.headers);

    // Redirect before processing the request
    const location = api.redirect.check(req);
    if (location) return api.sendStatus(res, location);

    next();
}

/**
 * This is supposed to be called at the beginning of request processing to start metrics and install the handler which
 * will be called at the end to finalize the metrics and call the cleanup handlers.
 * @memberof module:api
 * @method startMetrics
 */
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
                    version: app.version,
                },
                annotations: {
                    tag: app.env.tag || app.id,
                    role: app.role,
                }
            };
            if (app.env.type == "aws") {
                opts.aws = {};
                if (app.env.container) {
                    opts.aws.ecs = {
                        container: app.env.container,
                        container_id: app.env.container_id,
                    };
                }
                if (app.env.image) {
                    opts.aws.ec2 = {
                        instance_id: app.env.id,
                        ami_id: app.env.image,
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

/**
 * Finish metrics collection about the current rquest
 * @memberof module:api
 * @method handleMetrics
 */
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

/**
 * Call registered cleanup hooks and clear the request explicitly
 * @memberof module:api
 * @method handleCleanup
 */
api.handleCleanup = function(req)
{
    var hooks = this.hooks.find('cleanup', req.method, req.options.path);
    lib.forEverySeries(hooks, (hook, next) => {
        logger.debug('cleanup:', "api", req.method, req.options.path, hook.path);
        hook.callback(req, next);
    }, () => {
        for (const p in req) {
            if (p.startsWith("__") || api.requestCleanup.includes(p)) {
                for (const c in req[p]) delete req[p][c];
                if (!lib.isObject(req[p])) delete req[p];
            }
        }
        for (const p in req.files) {
            if (req.files[p]?.path) {
                fs.unlink(req.files[p].path, (err) => { if (err) logger.error("cleanup:", err); });
            }
        }
    }, true);
}

/**
 * Parse JSON/x-www-form-urlencoded from in the request body, this is default middleware called early before authentication
 * for all routes if no `api-body-allow` config parameter defined. Otherwise only for matchingh routes.
 *
 * Only methods in `api-body-methods` processed, defaults are POST/PUT/PATCH.
 * Allow to collect other mime types using `api-body-types` config parameter.
 * Store parsed data in the `req.body`.
 * @memberof module:api
 * @method handleBody
 * @example
 *
 * api.app.post("/api", api.handleBody, (req, res, next) => {
 *    if (req.body?.id) ....
 * })
 */
api.handleBody = function(req, res, next)
{
    if (req._body) return next();

    switch (req.options.contentType) {
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (!lib.testRegexpObj(req.options.contentType, this.body.types)) return next();
        req.setEncoding('binary');
    }

    if (req.options.length > 0 && req.options.length >= this.limits.querySize) {
        logger.debug("handleBody:", "api", "too large:", req.url, req.headers);
        return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.limits.querySize, length: req.options.length }));
    }

    req._body = true;
    var buf = '', size = 0;

    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > api.limits.querySize) {
            logger.debug("handleBody:", "api", "too large:", req.url, req.headers, buf);
            return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.limits.querySize, length: size }));
        }
        buf += chunk;
    });

    req.on('end', () => {
        try {
            if (size > api.limits.querySize) {
                logger.debug("handleBody:", "api", "too large:", req.url, req.headers, buf);
                return next(lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.limits.querySize, length: size }));
            }

            // Verify data checksum before parsing
            if (req.signature?.checksum && lib.hash(buf) != req.signature.checksum) {
                return next(lib.newError("invalid data checksum"));
            }

            switch (req.options.contentType) {
            case "text/json":
            case "application/json":
                if (!api.body.methods.includes(req.method)) break;
                req.body = lib.jsonParse(buf, { datatype: "object", logger: "debug" });
                break;

            case "application/x-www-form-urlencoded":
                if (!api.body.methods.includes(req.method)) break;
                req.body = buf.length ? api.app.get('query parser fn')(buf) : {};
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

var _formidable;

/**
 * Parse multipart forms for uploaded files, this must be called explicitly by the endpoints that need uploads.
 * The api module handles uploads automatically for configured paths via `-api-body-multipart` config parameter.
 * @param {object} req - Express Request
 * @param {object} res - Express Response
 * @param {function} next
 *
 * @example
 *
 * api.app.post("/upload", api.handleMultipart, (req, res, next) => {
 *   if (req.files.file) ....
 * })
 *
 * // Another global way to handle uploads for many endpoints is to call it for all known paths at once before the actual upload handlers.
 *
 * api.app.post(/^\/upload\//, api.handleMultipart, (req, res, next) => (next("route")));
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 *
 *
 * @memberof module:api
 * @method handleMultipart
 */
api.handleMultipart = function(req, res, next)
{
    if (!req.is('multipart/form-data')) return next();

    const opts = {
        uploadDir: app.tmpDir,
        allowEmptyFiles: true,
        keepExtensions: true,
        maxFiles: api.limits.files,
        maxFileSize: api.limits.uploadSize,
        maxFields: api.limits.fields,
        maxFieldsSize: api.limits.querySize,
    };

    const form = _formidable.formidable(opts);
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
        if (bytesExpected < api.limits.uploadSize) return;
        form.emit("error", lib.newError({ message: "too large", _msg: api.errTooLarge, status: 413, maxsize: api.limits.uploadSize, length: bytesExpected }));
    });

    form.parse(req, (err) => {
        logger.debug("handleMultipart:", "api", err, req.url, req.headers, data, Object.keys(files));
        if (err) {
            if (err && /maxFile|maxField|maxTotal/.test(err.message)) {
                err._msg = api.errTooLarge;
                err.status = 413;
            }
            trace.stop(err);
            return next(err);
        }
        try {
            req.body = api.app.get('query parser fn')(data);
            req.files = files;
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

/**
 * Web proxy: checkProxy("web", req, res)
 * WS proxy: checkProxy("ws", req, socket, head)
 * @returns {string} - a host matched or undefined
 * @memberof module:api
 * @method checkProxy
 */
api.checkProxy = function(type, ...args)
{
    const req = args[0];
    const path = req.path || req.url;

    for (const host in api.proxy) {
        if (!lib.testRegexp(path, api.proxy[host])) continue;

        if (!api._proxy) {
            api._proxy = require("http-proxy").createProxyServer({});
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
        logger.debug("proxy:", opts, req.options);
        api._proxy[type](...args, opts);
        return host;
    }
}

/**
 * For now just convert cookies into an object so logger can process
 * @memberof module:api
 * @method cleanupHeaders
 */
api.cleanupHeaders = function(headers)
{
    if (!headers) return headers;
    if (headers.cookie) {
        headers.cookie = lib.parseCookies(headers.cookie);
    }
    if (headers["set-cookie"]) {
        headers["set-cookie"] = lib.parseCookies(headers["set-cookie"]);
    }
    return headers;
}

/**
 * Create a Web server with options and request handler, returns a server object.
 *
 * Options can have the following properties:
 * @param {int} port - port number is required
 * @param {string} [bind] - address to bind
 * @param {string} [restart] - name of the processes to restart on address in use error, usually "web"
 * @param {objext} [ssl] - an object with SSL options for TLS createServer call
 * @param {int} [timeout] - number of milliseconds for the request timeout
 * @param {int} [keepAliveTimeout] - number of milliseconds to keep the HTTP connecton alive
 * @param {int} [requestTimeout] - number of milliseconds to receive the entire request from the client
 * @param {int} [maxRequestsPerSocket] - number of requests a socket can handle before closing keep alive connection
 * @param {int} [maxHeaderSize] - maximum length of request headers in bytes
 * @param {boolean} [reusePort] - allows multiple sockets on the same host to bind to the same port
 * @param {string} [name] - server name to be assigned
 * @memberof module:api
 * @method createWebServer
 */
api.createWebServer = function(options, callback)
{
    if (!options?.port) {
        logger.error('createWebServer:', 'invalid options', options);
        return null;
    }
    var server;
    if (options.ssl) {
        var opts = lib.clone(options.ssl);
        for (const p in options) if (p != "ssl") opts[p] = options[p];
        server = https.createServer(opts, callback);
    } else {
        server = http.createServer(options, callback);
    }
    if (options.timeout) {
        server.timeout = options.timeout;
    }
    server.serverPort = options.port;
    if (options.name) {
        server.serverName = options.name;
    }
    if (options.keepAliveTimeout) {
        server.keepAliveTimeout = options.keepAliveTimeout;
        server.headersTimeout = Math.round(options.keepAliveTimeout * 1.25);
    }
    server.requestTimeout = options.requestTimeout || 0;
    server.maxRequestsPerSocket = options.maxRequestsPerSocket || null;
    server.on('error', (err) => {
        logger.error("api", app.role + ':', 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restart) {
            app.killBackend(options.restart, "SIGKILL", () => { process.exit(0) });
        }
    });

    try {
        server.listen({
            port: options.port,
            host: options.bind,
            backlog: options.backlog,
            reusePort: options.reusePort,
        });
    } catch (e) {
        logger.error('server: listen:', options, e);
        server = null;
    }
    logger.log("createWebServer:", "api", options);
    return server;
}

// API stats if running
api.configureCollectStats = function(options)
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

require(__dirname + "/api/util");
