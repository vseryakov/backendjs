//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var path = require('path');
var stream = require('stream');
var util = require('util');
var fs = require('fs');
var os = require('os');
var http = require('http');
var https = require('https');
var cluster = require('cluster');
var url = require('url');
var qs = require('qs');
var crypto = require('crypto');
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('cookie-session');
var serveStatic = require('serve-static');
var formidable = require('formidable');
var ws = require("ws");
var mime = require('mime');
var passport = require('passport');
var consolidate = require('consolidate');
var domain = require('domain');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + '/ipc');
var msg = require(__dirname + '/msg');
var db = require(__dirname + '/db');
var app = require(__dirname + '/app');
var metrics = require(__dirname + '/metrics');
var logger = require(__dirname + '/logger');
var utils = require(__dirname + '/build/Release/backend');

// HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
// incorporates the Express server which is exposed as api.app object, the master server spawns Web workers which perform actual operations and monitors
// the worker processes if they die and restart them automatically. How many processes to spawn can be configured via `-server-max-workers` config parameter.
//
// When an HTTP request arrives it goes over Express middleware, but before processing any registered routes there are several steps performed:
// - the `req` object which is by convention is a Request object, assigned with common backend properties to be used later:
//   - account - an empty object which will be filled ater by signature verification method, if successful, properties form the `bk_auth` table will be set
//   - options - an object with internal state and control parameters. Every request always has an options object attached very
//     early with some properties always present:
//      - ip - cached IP address
//      - host - cached host header from the request
//      - path - parsed request url path
//      - apath - an array with the path split by /
//      - secure - if the request is encrypted, like https
//      - userAgent - combined app name and version in the form name/version
//      - appName - parsed app version provided in the header or user agent
//      - appVersion - parsed app version from the header or uer agent
//      - coreVersion - special core version provided in the header
//      - timezoneOffset - milliseconds offset from the UTC provided in the header by the app
// - access verification, can the request be satisfied without proper signature, i.e. is this a public request
// - autherization, check the signature and other global or account specific checks
// - when a API route found by the request url, it is called as any regular Connect middlware
//   - if there are registered pre processing callback they will be called during access or autherization phases
//   - if inside the route a response was returned using `api.sendJSON` method, registered post process callbacks will be called for such response
//
var api = {

    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path" },
           { name: "images-s3", descr: "S3 bucket name where to store and retrieve images" },
           { name: "images-raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and account id in the image name" },
           { name: "images-s3-options", type:" json", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
           { name: "images-ext", descr: "Default image extension to use when saving images" },
           { name: "files-s3", descr: "S3 bucket name where to store files uploaded with the File API" },
           { name: "max-latency", type: "number", min: 11, descr: "Max time in ms for a request to wait in the queue, if exceeds this value server returns too busy error" },
           { name: "max-cpu-util", type: "number", min: 0, descr: "Max CPU utilization allowed, if exceeds this value server returns too busy error" },
           { name: "max-memory-heap", type: "number", min: 0, descr: "Max number of bytes of V8 heap allowed, if exceeds this value server returns too busy error" },
           { name: "max-memory-rss", type: "number", min: 0, descr: "Max number of bytes in RSS memory allowed, if exceeds this value server returns too busy error" },
           { name: "max-request-queue", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns too busy error" },
           { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
           { name: "access-log-file", descr: "File for access logging" },
           { name: "salt", descr: "Salt to be used for scrambling credentials or other hashing activities" },
           { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
           { name: "static-options", type: "json", descr: "Options to be passed to the serve-static module for static content handling" },
           { name: "no-templating", type: "bool", descr: "Disable templating engine completely" },
           { name: "templating", descr: "Templating engne to use, see consolidate.js for supported engines" },
           { name: "no-session", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
           { name: "session-age", type: "int", descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-secret", descr: "Secret for session cookies, session support enabled only if it is not empty" },
           { name: "query-token-secret", descr: "Name of the property to be used for encrypting tokens for pagination or other sensitive data, any property from bk_auth can be used, if empty no secret is used, if not a valid property then it is used as the secret" },
           { name: "app-header-name", descr: "Name for the app name/version query parameter or header, it is can be used to tell the server about the application version" },
           { name: "version-header-name", descr: "Name for the access version query parameter or header, this is the core protocol version that can be sent to specify which core functionality a client expects" },
           { name: "no-signature", type: "bool", descr: "Disable signature verification for requests" },
           { name: "tz-header-name", descr: "Name for the timezone offset header a client can send for time sensitive requests, the backend decides how to treat this offset" },
           { name: "signature-header-name", descr: "Name for the access signature query parameter, header and session cookie" },
           { name: "signature-age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
           { name: "access-token-name", descr: "Name for the access token query parameter or header" },
           { name: "access-token-secret", descr: "A secret to be used for access token signatures, additional enryption on top of the signature to use for API access without signing requests, it is required for access tokens to be used" },
           { name: "access-token-age", type: "int", descr: "Access tokens age in milliseconds, for API requests with access tokens only" },
           { name: "disable-session", type: "regexpobj", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-admin", type: "regexpobj", descr: "URLs which can be accessed by admin accounts only, can be partial urls or Regexp, this is a convenient option which registers `AuthCheck` callback for the given endpoints" },
           { name: "allow-account-([a-z]+)", type: "regexpobj", obj: "allow-account", descr: "URLs which can be accessed by specific account type only, can be partial urls or Regexp, this is a convenient option which registers AuthCheck callback for the given endpoints and only allow access to the specified account types" },
           { name: "express-options", type: "json", descr: "Set Express config options during initialization,example: `-api-express-options { \"trust proxy\": 1, \"strict routing\": true }`" },
           { name: "allow-ip", type: "regexpobj", set: 1, descr: "Regexp for IPs that dont need credentials, replaces the whole access list. It is checked before endpoint access list" },
           { name: "deny-ip", type: "regexpobj", set: 1, descr: "Regexp for IPs that will be denied access, replaces the whole access list. It is checked before endpoint access list." },
           { name: "allow", type: "regexpobj", set: 1, descr: "Regexp for URLs that dont need credentials, replaces the whole access list" },
           { name: "allow-path", type: "regexpobj", key: "allow", descr: "Add to the list of allowed URL paths without authentication, return result before even checking for the signature" },
           { name: "disallow-path", type: "regexpobj", key: "allow", del: 1, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove `^/account/add$` to disable open registration" },
           { name: "allow-anonymous", type: "regexpobj", descr: "Add to the list of allowed URL paths that can be served with or without valid account, the difference with `allow-path` is that it will check for signature and an account but will continue if no login is provided, return error in case of wrong account or not account found" },
           { name: "allow-ssl", type: "regexpobj", descr: "Add to the list of allowed URL paths using HTTPs only, plain HTTP requests to these urls will be refused" },
           { name: "redirect-ssl", type: "regexpobj", descr: "Add to the list of the URL paths to be redirected to the same path but using HTTPS protocol, for proxy mode the proxy server will perform redirects" },
           { name: "redirect-url", type: "regexpmap", descr: "Add to the list a JSON object with property name defining the host/path regexp to be matched against in order to redirect using the value of the property, if the regexp starts with !, that means negative match, 2 variables can be used for substitution: @HOST@, @PATH@, @URL@, example: { '^[^/]+/path/$': '/path2/index.html', '.+/$': '@PATH@/index.html' } " },
           { name: "deny", type:" regexpobj", set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", type: "regexpobj", key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events before closing the connection, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 0, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "collect-host", descr: "The backend URL where all collected statistics should be sent over, if set to `pool` then each web worker will save metrics directly into the statistics database pool" },
           { name: "collect-pool", descr: "Database pool where to save collected statistics" },
           { name: "collect-interval", type: "number", min: 30, descr: "How often to collect statistics and metrics in seconds" },
           { name: "collect-send-interval", type: "number", min: 60, descr: "How often to send collected statistics to the master server in seconds" },
           { name: "secret-policy", type: "regexpmap", descr : "An JSON object with list of regexps to validate account password, each regexp comes with an error message to be returned if such regexp fails, `api.checkAccountSecret` performs the validation, example: { '[a-z]+': 'At least one lowercase letter', '[A-Z]+': 'At least one upper case letter' }" },
           { name: "cors-origin", descr: "Origin header for CORS requests" },
           { name: "url-metrics-([a-z]+)", type: "int", obj: "url-metrics", descr: "Defines the length of an API request path to be stored in the statistics, set by the first component of endpoint URL, example: -api-url-metrics-image 2 -api-url-metrics-account 3" },
           { name: "rlimits-([a-zA-Z0-9/_]+)-max", type: "int", obj: "rlimits", descr: "Set max/burst rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-([a-zA-Z0-9/_]+)-rate", type: "int", obj: "rlimits", descr: "Set fill/normal rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-([a-zA-Z0-9/_]+)-interval", type: "int", obj: "rlimits", descr: "Set rate interval in ms by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-total", type:" int", obj: "rlimits", descr: "Total number of servers used in the rate limiter behind a load balancer, rates will be divided by this number so each server handles only a portion of the total rate limit" },
           { name: "rlimits-interval", type:" int", obj: "rlimits", descr: "Interval in ms for all rate limiters, defines the time unit, default is 1000 ms" },
           { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10, descr: "Max size for uploads, bytes"  },
    ],

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the account has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: {},

    // No authentication for these urls
    allow: lib.toRegexpObj(null, ["^/$",
                                      "\\.html$",
                                      "\\.ico$", "\\.gif$", "\\.png$", "\\.jpg$", "\\.svg$",
                                      "\\.ttf$", "\\.eof$", "\\.woff$",
                                      "\\.js$", "\\.css$",
                                      "^/js/",
                                      "^/css/",
                                      "^/fonts/",
                                      "^/public/",
                                      "^/account/add$",
                                      "^/login$",
                                      "^/logout$",
                                      "^/ping" ]),
    // Only for admins
    allowAdmin: {},
    // Allow by account type
    allowAccount: {},
    // Allow accounts and anonymous users
    allowAnonymous: {},
    // Allow only HTTPS requests
    allowSsl: {},
    redirectSsl: {},
    // Refuse access to these urls
    deny: {},
    // IP access lists
    allowIp: {},
    denyIp: {},
    // Rate limits
    rlimits: {},
    // Global redirect rules, each rule must match host/path to be redirected
    redirectUrl: [],

    // A list of regexp expresions for account pasword verification
    secretPolicy: lib.toRegexpMap(null,
                                  {
                                      '[a-z]+': 'requires at least one lower case letter',
                                      '[A-Z]+': 'requires at least one upper case letter',
                                      '[0-9]+': 'requires at least one digit',
                                      '.{8,}': 'requires at least 8 characters'
                                  }),

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    filesS3: '',
    imagesExt: "jpg",

    disableSession: {},
    templating: "ejs",
    expressOptions: {},

    // All listening servers
    servers: [],

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 1800000,
    subscribeInterval: 3000,

    // Collect body MIME types as binary blobs
    mimeBody: [],

    // Static content options
    staticOptions: { maxAge: 3600 * 1000 },

    // Web session age
    sessionAge: 86400 * 14 * 1000,
    // How old can a signtature be to consider it valid, for clock drifts
    signatureAge: 0,
    signatureHeaderName: "bk-signature",
    appHeaderName: "bk-app",
    versionHeaderName: "bk-version",
    tzHeaderName: "bk-tz",
    corsOrigin: "*",

    // Separate age for access token
    accessTokenAge: 86400 * 7 * 1000,
    accessTokenSecret: "",
    accessTokenName: 'bk-access-token',

    // Default busy latency 1 sec
    maxLatency: 1000,
    maxMemoryHeap: 0,
    maxMemoryRss: 0,
    maxCpuUtil: 0,
    // Cached process stats, updated every sample interval in the getStatistics
    cpuItil: 0,
    loadAvge: os.loadavg(),
    memoryUsage: process.memoryUsage(),

    // Metrics and stats
    metrics: new metrics.Metrics('id', '',
                                 'ip', '',
                                 'mtime', Date.now(),
                                 'ctime', 0,
                                 'type', '',
                                 'host', '',
                                 'pid', 0,
                                 'instance', '',
                                 'worker', '',
                                 'latency', 0,
                                 'cpus', 0,
                                 'mem', 0),

    // This object tells how long the metric name should be using the leading component of the url.
    urlMetrics: { image: 2 },

    // Collector of statistics, seconds
    collectInterval: 30,
    collectSendInterval: 300,
    collectErrors: 0,
    collectQuiet: false,

    // Query options, special parameters that start with the underscore in the req.query, shared between all routes and
    // can perform special actions or to influence the results, in most cases these are used in the db queries.
    controls: {
        accounts: { type: "bool" },
        consistent: { type: "bool" },
        desc: { type: "bool" },
        total: { type: "bool" },
        connected: { type: "bool" },
        check: { type: "bool" },
        noscan: { type: "bool" },
        noprocessrows: { type: "bool" },
        noconvertrows: { type: "bool" },
        noreference: { type: "bool" },
        nocounter: { type: "bool" },
        publish: { type: "bool" },
        archive: { type: "bool" },
        trash: { type: "bool" },
        session: { type: "bool" },
        accesstoken: { type: "bool" },
        force: { type: "bool" },
        continue: { type: "bool" },
        name: { type: "string" },
        alias: { type: "string" },
        format: { type: "string" },
        separator: { type: "string" },
        pool: { type: "string" },
        cleanup: { type: "string" },
        sort: { type: "string" },
        ext: { type: "string" },
        encoding: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        quality: { type: "number" },
        round: { type: "number" },
        interval: { type: "number" },
        timeout: { type: "number" },
        count: { type: "number", float: 0, dflt: 25, min: 0 },
        page: { type: "number", float: 0, dflt: 0, min: 0 },
        tm: { type: "timestamp" },
        ops: { type: "map" },
        start: { type: "token" },
        token: { type: "token" },
        select: { type: "list" },
    },

    tables: {
        // Authentication by login, only keeps id and secret to check the siganture
        bk_auth: { login: { primary: 1 },                              // Account login
                   id: {},                                             // Auto generated UUID to be linked with other records
                   alias: {},                                          // Account alias
                   status: {},                                         // Status of the account
                   type: { admin: 1 },                                 // Account type: admin, ....
                   secret: { secure: 1 },                              // Signature secret, not a password
                   auth_secret: { admin: 1, secure: 1 },               // Code for 2-factor authentication
                   token_secret: { admin: 1, secure: 1 },              // Secret for access tokens
                   salt: { secure: 1 },                                // Salt for passwords
                   password: { secure: 1},                             // Hashed with salt
                   acl_deny: { admin: 1, secure: 1 },                  // Deny access to matched url, a regexp
                   acl_allow: { admin: 1, secure: 1 },                 // Only grant access if path matches this regexp
                   query_deny: { admin: 1, secure: 1 },                // Ignore these query params, a regexp
                   rlimits_max: { type: "int" },                       // Burst/max reqs/sec rate allowed for this account, 0 to disable
                   rlimits_rate: { type: "int" },                      // Fill/normal reqs/sec rate for this account, 0 to disable
                   expires: { type: "bigint", admin: 1, secure: 1 },   // Deny access to the account if this value is before current date, milliseconds
                   mtime: { type: "bigint", now: 1 } },

        // Collected metrics per worker process, basic columns are defined in the table to be collected like
        // api and db request rates(.rmean), response times(.hmean) and total number of requests(_0).
        // Counters ending with `_0` are snapshots, i.e. they must be summed up for any given interval.
        // All other counters are averages. Only subset of all available API endpoints is defined here
        // for example purposes, for SQL databases all columns must be defined but for NoSQL this is not required,
        // depending on the database that is used for collection the metrics must be added to the table. All `url_` columns
        // are the API requests, not the DB calls made by the app, the length of URL path to be stored is defined in the API module
        // by the `api-url-metrics-` config parameter.
        bk_collect: { id: { primary: 1 },
                       mtime: { type: "bigint", primary: 1 },
                       app: {},
                       ip: {},
                       type: {},
                       instance: {},
                       worker: {},
                       pid: { type: "int" },
                       latency: { type: "int" },
                       cpus: { type: "int" },
                       mem: { type: "bigint" },
                       rss_hmean: { type: "real" },
                       heap_hmean: { type: "real" },
                       avg_hmean: { type: "real" },
                       free_hmean: { type: "real" },
                       util_hmean: { type: "real" },
                       api_req_rmean: { type: "real" },
                       api_req_hmean: { type: "real" },
                       api_req_0: { type: "real" },
                       api_err_0: { type: "real" },
                       api_bad_0: { type: "real" },
                       api_400_0: { type: "real" },
                       api_401_0: { type: "real" },
                       api_403_0: { type: "real" },
                       api_417_0: { type: "real" },
                       api_429_0: { type: "real" },
                       api_que_rmean: { type: "real" },
                       api_que_hmean: { type: "real" },
                       pool_req_rmean: { type: "real" },
                       pool_req_hmean: { type: "real" },
                       pool_req_0: { type: "real" },
                       pool_err_0: { type: "real" },
                       pool_que_rmean: { type: "real" },
                       pool_que_hmean: { type: "real" },
                       ctime: { type: "bigint" } },

    }, // tables
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
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    // Performance statistics
    self.initStatistics();

    self.app = express();
    options.api = self;
    options.app = self.app;

    // Setup busy timer to detect when our requests waiting in the queue for too long
    if (this.maxLatency) utils.initBusy(this.maxLatency);

    // Early request setup and checks
    self.app.use(function(req, res, next) {
        // Latency watcher
        if (self.maxLatency && utils.isBusy()) {
            self.metrics.Counter('busy_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        // CPU utilization
        if (self.maxCpuUtil && self.cpuItil > self.maxUtil) {
            self.metrics.Counter('util_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        // Memory watcher
        if (self.maxMemoryHeap && self.memoryUsage.heapUsed > self.maxMemoryHeap) {
            self.metrics.Counter('heap_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        if (self.maxMemoryRss && self.memoryUsage.rss > self.maxMemoryRss) {
            self.metrics.Counter('rss_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        // Request queue size
        if (self.maxRequestQueue && self.metrics.Counter("api_nreq").toJSON() >= self.maxRequestQueue) {
            self.metrics.Counter('full_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        // Setup request common/required properties
        self.prepareRequest(req);

        // Rate limits by IP address and path, early before all other filters
        self.checkRateLimits(req, { type: "ip" }, function(err) {
            if (err) {
                self.metrics.Counter('ip_0').inc();
                return self.sendReply(res, err);
            }

            self.checkRateLimits(req, { type: "path" }, function(err) {
                if (!err) return next();
                self.metrics.Counter('path_0').inc();
                self.sendReply(res, err);
            });
        });
    });

    // Allow cross site requests
    self.app.use(function(req, res, next) {
        res.header('Server', core.name + '/' + core.version + " " + core.appName + "/" + core.appVersion);
        res.header('Access-Control-Allow-Origin', self.corsOrigin);
        res.header('Access-Control-Allow-Headers', 'content-type, ' + self.signatureHeaderName + ', ' + self.appHeaderName + ', ' + self.versionHeaderName);
        res.header('Access-Control-Allow-Methods', 'OPTIONS, HEAD, GET, POST, PUT, DELETE');
        if (logger.level >= logger.DEBUG) logger.debug('handleServerRequest:', core.port, req.options.ip, req.connection.remoteAddress, req.method, req.options.path, req.get('content-type') || "", req.get(self.appHeaderName) || "", req.get(self.signatureHeaderName) || "", req.get("x-forwarded-for") || "");
        next();
    });

    // Acccess logging, always goes into api.accessLog, it must be a stream
    if (!self.noAccessLog) {
        self.configureAccessLog();

        self.app.use(function(req, res, next) {
            req._startTime = new Date;
            var end = res.end;
            res.end = function(chunk, encoding) {
                res.end = end;
                res.end(chunk, encoding);
                if (!self.accessLog) return;
                var now = new Date();
                var line = req.options.ip + " - " +
                        (logger.syslog ? "-" : '[' +  now.toUTCString() + ']') + " " +
                        req.method + " " +
                        (req.accessLogUrl || req.originalUrl || req.url) + " " +
                        (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                        res.statusCode + " " +
                        (res.get("Content-Length") || '-') + " - " +
                        (now - req._startTime) + " ms - " +
                        (req.headers[self.appHeaderName] || req.headers['user-agent'] || "-") + " " +
                        (req.account.id || "-" ) + "\n";
                self.accessLog.write(line);
            }
            next();
        });
    }

    // Redirect before processing the request
    self.app.use(function(req, res, next) {
        var location = self.checkRedirect(req, req.options);
        if (location) return self.sendStatus(res, location);
        next();
    });

    // Metrics starts early, always enabled
    self.app.use(function(req, res, next) { return self.handleMetrics(req, res, next); });

    // Request parsers
    self.app.use(cookieParser());
    self.app.use(function(req, res, next) { return self.checkQuery(req, res, next); });
    self.app.use(function(req, res, next) { return self.checkBody(req, res, next); });

    // Keep session in the cookies
    if (!self.noSession) {
        self.app.use(session({ key: self.signatureHeaderName, secret: self.sessionSecret || core.name, cookie: { path: '/', httpOnly: true, maxAge: self.sessionAge || null } }));
    }

    // Check the signature, for virtual hosting, supports only the simple case when running the API and static web sites on the same server
    if (!self.noSignature) {
        self.app.use(function(req, res, next) {
            // Verify limits using the login from the signature before going into full signature verification
            self.checkRateLimits(req, { type: "login" }, function(err) {
                if (!err) return self.handleSignature(req, res, next);
                self.metrics.Counter('login_0').inc();
                return self.sendReply(res, err);
            });
        });
    }

    // Config options for Express
    for (var p in self.expressOptions) {
        self.app.set(p, self.expressOptions[p]);
    }

    // Assign custom middleware just after the security handler, if the signature is disabled then the middleware
    // handler may install some other authentication module and in such case must setup `req.account` with the current user record
    core.runMethods("configureMiddleware", options, function() {

        // Rate limits for an account, at this point we have verified account record
        self.app.use(function(req, res, next) {
            self.checkRateLimits(req, { type: "id" }, function(err) {
                if (err) self.metrics.Counter('id_0').inc();
                if (err) return self.sendReply(res, err);
                next();
            });
        });

        // Default API calls
        self.configureDefaultAPI();

        // Setup routes from the loaded modules
        core.runMethods("configureWeb", options, function(err) {
            if (err) return callback.call(self, err);

            // No API routes matched, cleanup stats
            self.app.use(function(req, res, next) {
                req._noRoute = 1;
                next();
            });

            // Templating engine setup
            if (!self.noTemplating) {
                self.app.engine('html', consolidate[self.templating]);
                self.app.set('view engine', 'html');
                // Use app specific views path if created even if it is empty
                self.app.set('views', core.path.views && core.path.views[0] == "/" ? core.path.views :
                                      core.path.views && fs.existsSync(core.path.views) ? core.path.views :
                                      fs.existsSync(core.home + "/views") ? core.home + "/views" :
                                      fs.existsSync(core.path.web + "/../views") ? core.path.web + "/../views" : __dirname + '/views');
                logger.debug("templating:", self.templating, "views:", self.app.get("views"));
            }

            // Serve from default web location in the package or from application specific location
            if (!self.noStatic) {
                self.app.use(serveStatic(core.path.web, self.staticOptions));
                self.app.use(serveStatic(__dirname + "/web", self.staticOptions));
                logger.debug("static:", core.path.web, __dirname + "/web");
            }

            // Default error handler to show errors in the log
            self.app.use(function(err, req, res, next) {
                logger.error('api:', req.options.path, err.stack);
                self.sendReply(res, err);
            });

            // Start http server
            if (core.port) {
                self.server = core.createServer({ name: "http", port: core.port, bind: core.bind, restart: "web", timeout: core.timeout }, self.handleServerRequest);
            }

            // Start SSL server
            if (core.ssl.port && (core.ssl.key || core.ssl.pfx)) {
                self.sslServer = core.createServer({ name: "https", ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: "web", timeout: core.timeout }, self.handleServerRequest);
            }

            // WebSocket server, by default uses the http port
            if (core.ws.port) {
                var server = core.ws.port == core.port ? self.server : core.ws.port == core.ssl.port ? self.sslServer : null;
                if (!server) server = core.createServer({ ssl: core.ws.ssl ? core.ssl : null, port: core.ws.port, bind: core.ws.bind, restart: "web" }, function(req, res) { res.send(200, "OK"); });
                if (server) {
                    var opts = { server: server, verifyClient: function(data, callback) { self.checkWebSocketRequest(data, callback); } };
                    if (core.ws.path) opts.path = core.ws.path;
                    self.wsServer = new ws.Server(opts);
                    self.wsServer.serverName = "ws";
                    self.wsServer.serverPort = core.ws.port;
                    self.wsServer.on("error", function(err) { logger.error("api.init: ws:", err.stack)});
                    self.wsServer.on('connection', function(socket) { self.handleWebSocketConnect(socket); });
                }
            }

            // Notify the master about new worker server
            ipc.sendMsg("api:ready", { id: cluster.isWorker ? cluster.worker.id : process.pid, pid: process.pid, port: core.port, ready: true });

            callback.call(self);
        });
        self.exiting = false;
    });
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    var self = this;
    if (this.exiting) return;
    if (typeof callback != "function") callback = lib.noop;
    this.exiting = true;
    logger.log('api.shutdown: started');
    var timeout = callback ? setTimeout(callback, self.shutdownTimeout || 30000) : null;
    lib.parallel([
        function(next) {
            if (!self.wsServer) return next();
            try { self.wsServer.close(); next(); } catch(e) { logger.error("api.shutdown:", e.stack); next() }
        },
        function(next) {
            if (!self.sslServer) return next();
            try { self.sslServer.close(function() { next() }); } catch(e) { logger.error("api.shutdown:", e.stack); next() }
        },
        function(next) {
            if (!self.server) return next();
            try { self.server.close(function() { next() }); } catch(e) { logger.error("api.shutdown:", e.stack); next() }
        },
        ], function(err) {
            core.runMethods("shutdownWeb", function() {
                clearTimeout(timeout);
                callback(err);
            })
        });
}

// Allow access to API table in worker processes
api.configureWorker = function(options, callback)
{
    db.initTables(options, callback);
}

// Access to the API table in the shell
api.configureShell = function(options, callback)
{
    db.initTables(options, callback);
}

// Setup access log stream
api.configureAccessLog = function()
{
    var self = this;
    if (logger.syslog) {
        this.accessLog = new stream.Stream();
        this.accessLog.writable = true;
        this.accessLog.write = function(data) { logger.printSyslog('info:local5', data); return true; };
    } else
    if (this.accessLogFile) {
        this.accessLog = fs.createWriteStream(path.join(core.path.log, this.accessLogFile), { flags: 'a' });
        this.accessLog.on('error', function(err) { logger.error('accessLog:', err); self.accessLog = null; });
    } else {
        this.accessLog = logger;
    }
}

// Start Express middleware processing wrapped in the node domain
api.handleServerRequest = function(req, res)
{
    logger.dev("handleServerRequest:", core.port, req.url);
    var api = core.modules.api;
    var d = domain.create();
    d.on('error', function(err) {
        logger.error('handleServerRequest:', core.port, req.path, err.stack);
        if (!res.headersSent) api.sendReply(res, err);
        if (api.exitOnError) api.shutdown(function() { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    d.run(function() {
        api.app(req, res);
    });
}

// Process incoming proxy request, can be overriden for custom logic with frontend proxy server. If any
// response is sent or an error returned in the calback
// then the request will be aborted and will not be forwarded to the web processes
api.handleProxyRequest = function(req, res, callback)
{
    callback(null, req, res);
}

// Called on new socket connection, supports all type of sockets
api.setupSocketConnection = function(socket) {}

// Called when a socket connections is closed to cleanup all additional resources associated with it
api.cleanupSocketConnection = function(socket) {}

// Called before allowing the WebSocket connection to be authorized
api.checkWebSocketRequest = function(data, callback) { callback(true); }

// Wrap external WeSocket connection into the Express routing, respond on backend command
api.handleWebSocketConnect = function(socket)
{
    var self = this;

    this.setupSocketConnection(socket);

    socket.on("error", function(err) {
        logger.error("socket:", err);
    });

    socket.on("close", function() {
        self.closeWebSocketRequest(this);
        self.cleanupSocketConnection(this);
    });

    socket.on("message", function(url, flags) {
        self.createWebSocketRequest(this, url, function(data) { this.send(data); })
        self.handleServerRequest(this._requests[0], this._requests[0].res);
    });
}

// Wrap WebSocket into HTTP request to be proceses by the Express routes
api.createWebSocketRequest = function(socket, url, reply)
{
    logger.debug("socketRequest:", url);

    var req = new http.IncomingMessage();
    req.get = req.header = function(name) { return this.headers[name.toLowerCase()]; }
    req.__defineGetter__('ip', function() { return this.socket.ip; });
    req.socket = new net.Socket();
    req.socket.__defineGetter__('remoteAddress', function() { return this.ip; });
    req.connection = req.socket;
    req.httpVersionMajor = req.httpVersionMinor = 1;
    req.httpProtocol = "WS";
    req.method = "GET";
    req.url = String(url);
    req.path = url.parse(req.url).pathname;
    req.accessLogUrl = req.url.split("?")[0];
    req._body = true;
    if (socket.upgradeReq) {
        if (socket.upgradeReq.headers) req.headers = socket.upgradeReq.headers;
        if (socket.upgradeReq.connection) req.socket.ip = socket.upgradeReq.connection.remoteAddress;
    }

    req.res = new http.ServerResponse(req);
    req.res.assignSocket(req.socket);
    req.res.wsock = socket;
    req.res.end = function(body) {
        reply.call(this.wsock, body);
        this.wsock._requests.splice(this.wsock._requests.indexOf(this.req), 1);
        this.req.res = null;
        this.req = null;
        this.wsock = null;
        this.emit("finish");
    };
    if (!socket._requests) socket._requests = [];
    socket._requests.unshift(req);
    return req;
}

// Close all pending requests, this is called on socket close or disconnect
api.closeWebSocketRequest = function(socket)
{
    if (!socket._requests) return;
    while (socket._requests.length > 0) {
        var x = socket._requests.pop();
        x.emit("close");
        x.res.end();
    }
}

// Prepare request options that the API routes will merge with, can be used by pre process hooks, initialize
// required properties for subsequent use
api.prepareRequest = function(req)
{
    // Cache the path so we do not need reparse it every time
    var path = req.path || "/";
    var apath = path.substr(1).split("/");
    req.account = {};
    req.options = { ops: {}, noscan: 1,
        ip: req.ip, host: req.hostname, path: path, apath: apath, secure: req.secure,
        cleanup: "bk_" + apath[0],
        userAgent: "", appName: "", appVersion: "",
    };

    // Parse application version, extract first product and version only
    var v = req.query[this.appHeaderName] || req.headers[this.appHeaderName] || req.headers['user-agent'];
    if (v && (v = v.match(/^([^\/]+)\/([0-9a-zA-Z_\.\-]+)/))) {
        req.options.userAgent = v[1] + "/" + v[2];
        req.options.appName = v[1];
        req.options.appVersion = v[2];
    }
    // Core protocol version to be used in the request if supported
    req.options.coreVersion = req.query[this.versionHeaderName] || req.headers[this.versionHeaderName] || "";
    // Timezone offset from UTC passed by the client, we just keep it, how to use it is up to the application
    req.options.timezoneOffset = lib.toNumber(req.query[this.tzHeaderName] || req.headers[this.tzHeaderName], { dflt: 0, min: -720, max: 720 }) * 60000;
}

// This is supposed to be called at the beginning of request processing to start metrics and install the handler which
// will be called at the end to finalize the metrics and call the cleanup handlers
api.handleMetrics = function(req, res, next)
{
    var self = this;
    var path = "url_" + req.options.apath.slice(0, this.urlMetrics[req.options.apath[0]] || 2).map(function(x) { return x.replace("_", "__")}).join("_");
    this.metrics.Histogram('api_que').update(this.metrics.Counter('api_nreq').inc());
    req.metric1 = self.metrics.Timer('api_req').start();
    req.metric2 = self.metrics.Timer(path).start();
    // Path counters, total and errors
    this.metrics.Counter(path +'_0').inc();
    if (res.statusCode >= 400 && res.statusCode < 500) this.metrics.Counter(path +'_bad_0').inc();
    if (res.statusCode >= 500) self.metrics.Counter(path + "_err_0").inc();
    var end = res.end;
    res.end = function(chunk, encoding) {
        res.end = end;
        res.end(chunk, encoding);
        self.metrics.Counter('api_nreq').dec();
        self.metrics.Counter("api_req_0").inc();
        if (res.statusCode >= 400 && res.statusCode < 500) self.metrics.Counter("api_bad_0").inc();
        if (res.statusCode >= 500) self.metrics.Counter("api_err_0").inc();
        self.metrics.Counter("api_" + res.statusCode + "_0").inc();
        req.metric1.end();
        req.metric2.end();

        // Ignore external or not handled urls
        if (req._noRoute || req._noSignature) {
            delete self.metrics[path];
            delete self.metrics[path + '_0'];
        }

        // Call cleanup hooks
        var hooks = self.findHook('cleanup', req.method, req.options.path);
        lib.forEachSeries(hooks, function(hook, next) {
            logger.debug('cleanup:', req.method, req.options.path, hook.path);
            hook.callback.call(self, req, function() { next() });
        }, function() {
            // Cleanup request explicitely
            for (var p in req.options) delete req.options[p];
            for (var p in req.account) delete req.account[p];
        });
    }
    next();
}

// Perform authorization of the incoming request for access and permissions
api.handleSignature = function(req, res, next)
{
    var self = this;

    self.checkAccess(req, function(status) {
        // Status is given, return an error or proceed to the next module
        if (status) {
            if (status.status == 200) return next();
            if (status.status) self.sendStatus(res, status);
            return;
        }

        // Verify account signature
        self.checkSignature(req, function(status) {
            // Determine what to do with the request even if the status is not success, a hook may deal with it differently,
            // the most obvious case is for a Web app to perform redirection on authentication failure
            self.checkAuthorization(req, status, function(status) {
                if (status && status.status != 200) return self.sendStatus(res, status);
                next();
            });
        });
    });
}

// Parse incoming query parameters
api.checkQuery = function(req, res, next)
{
    var self = this;
    if (req._body) return next();
    req.body = req.body || {};
    req.query = req.query || {};

    var type = (req.get("content-type") || "").split(";")[0];
    switch (type) {
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (self.mimeBody.indexOf(type) == -1) return next();
        req.setEncoding('binary');
    }

    req._body = true;
    var buf = '', size = 0;
    var sig = self.parseSignature(req);

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > self.uploadLimit) return req.destroy();
        buf += chunk;
    });
    req.on('end', function() {
        try {
            // Verify data checksum before parsing
            if (sig && sig.checksum && lib.hash(buf) != sig.checksum) {
                var err = lib.newError("invalid data checksum");
                err.status = 400;
                return next(err);
            }
            switch (type) {
            case 'application/json':
                if (req.method != "POST") break;
                req.body = lib.jsonParse(buf, { obj: 1, debug: 1 });
                req.query = req.body;
                break;

            case 'application/x-www-form-urlencoded':
                if (req.method != "POST") break;
                req.body = buf.length ? qs.parse(buf) : {};
                req.query = req.body;
                sig.query = buf;
                break;

            default:
                req.body = buf;
            }
            next();
        } catch (err) {
            err.status = 400;
            err.title = "checkQuery";
            next(err);
        }
    });
}

// Parse multipart forms for uploaded files
api.checkBody = function(req, res, next)
{
    var self = this;
    if (req._body) return next();
    req.files = req.files || {};

    if ('GET' == req.method || 'HEAD' == req.method) return next();
    var type = (req.get("content-type") || "").split(";")[0];
    if (type != 'multipart/form-data') return next();
    req._body = true;

    var data = {}, files = {}, done;
    var form = new formidable.IncomingForm({ uploadDir: core.path.tmp, keepExtensions: true });

    function ondata(name, val, data) {
        if (Array.isArray(data[name])) {
            data[name].push(val);
        } else
        if (data[name]) {
            data[name] = [data[name], val];
        } else {
            data[name] = val;
        }
    }

    form.on('field', function(name, val) { ondata(name, val, data); });
    form.on('file', function(name, val) { ondata(name, val, files); });
    form.on('error', function(err) { next(err); done = true; });
    form.on('end', function() {
        if (done) return;
        try {
            req.body = qs.parse(data);
            req.files = qs.parse(files);
            if (req.method == "POST" && !Object.keys(req.query).length) req.query = req.body;
            next();
        } catch (err) {
            err.status = 400;
            err.title = "checkBody";
            next(err);
        }
    });
    form.parse(req);
}

// Perform URL based access checks, this is called before the signature verification, very early in the request processing step.
//
// Checks access permissions, calls the callback with the following argument:
// - nothing if checkSignature needs to be called
// - an object with status: 200 to skip authorization and proceed with other routes
// - an object with status: 0 means response has been sent, just stop
// - an object with status other than 0 or 200 to return the status and stop request processing,
//    for statuses 301,302 there should be url property in the object returned
api.checkAccess = function(req, callback)
{
    var self = this;
    if (this.denyIp.rx && req.options.ip.match(this.denyIp.rx)) return callback({ status: 403, message: "Access denied" });
    if (this.deny.rx && req.options.path.match(this.deny.rx)) return callback({ status: 403, message: "Access denied" });
    if (this.allowIp.rx && req.options.ip.match(this.allowIp.rx)) return callback({ status: 200, message: "" });
    if (this.allow.rx && req.options.path.match(this.allow.rx)) return callback({ status: 200, message: "" });

    // Call custom access handler for the endpoint
    var hooks = this.findHook('access', req.method, req.options.path);
    if (hooks.length) {
        lib.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAccess:', req.method, req.options.path, hook.path);
            hook.callback.call(self, req, next);
        }, callback);
        return;
    }
    callback();
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed,
// in case of a custom authentication middlware this must be called at the end and use the status object returned in the callback to
// return an error or proceed with the request. In any case the result of this function is the final.
//
// - req is Express request object
// - status contains the signature verification status, an object with status: and message: properties, can be null.
//    if status property is not 200 it will be returned immeditately to the client stopping the middlware chain. For stopping without an error
//    return a status in the range 200-299.
// - callback is a function(status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    var self = this;

    // Ignore no login error if allowed
    if (status && status.status == 417 && this.allowAnonymous.rx && req.options.path.match(this.allowAnonymous.rx)) status = null;
    // Status for hooks is never null
    if (!status) status = { status: 200, message: "ok" };

    // Disable access to endpoints if session exists, meaning Web app
    if (self.disableSession.rx) {
        if (req.signature.source == "s" && req.options.path.match(self.disableSession.rx)) return callback({ status: 401, message: "Not authorized" });
    }
    // Verify access by account type
    if (!self.checkAccountType(req.account, "admin")) {
        // Admin only
        if (self.allowAdmin.rx) {
            if (req.options.path.match(self.allowAdmin.rx)) return callback({ status: 401, message: "Restricted access" });
        }
        // Specific account type only
        for (var p in self.allowAccount) {
            if (self.allowAccount[p].rx) {
                if (!self.checkAccountType(req.account, p) && req.options.path.match(self.allowAccount[p].rx)) {
                    return callback({ status: 401, message: "Access is not allowed" });
                }
            }
        }
    }

    var hooks = this.findHook('auth', req.method, req.options.path);
    if (hooks.length) {
        lib.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAuthorization:', req.method, req.options.path, hook.path, req.account.id);
            hook.callback.call(self, req, status, function(err) {
                if (err && err.status != 200) return next(err);
                next();
            });
        }, callback);
        return;
    }
    // Pass the status back to the checkRequest
    callback(status);
}

// Check a request for possible redirection condition based on the configuration, this can be SSL checks or
// defined redirect rules. This is used by API servers and proxy servers for early redirections. It returns null
// if no redirects or errors happend, otherwise an object with status that is expected by the `api.sendStatus` method.
// The options is expected to contain the following cached request properties:
// - path - from req.path or the request pathname only
// - host - from req.host or the hostname part only
// - port - port from the host: header if specified
// - secure - if the protocol is https
api.checkRedirect = function(req, options)
{
    var self = this;
    // Auto redirect to SSL
    if (this.redirectSsl.rx) {
        if (!options.secure && options.path.match(this.redirectSsl.rx)) return { status: 302, url: "https://" + options.host + req.url };
    }
    // SSL only access, deny access without redirect
    if (this.allowSsl.rx) {
        if (!options.secure && options.path.match(this.allowSsl.rx)) return { status: 400, message: "SSL only access" };
    }
    // Simple redirect rules
    var location = options.host + req.url;
    for (var i = 0; i < self.redirectUrl.length; i++) {
        if (this.redirectUrl[i].rx.test(location)) {
            var url = this.redirectUrl[i].value.replace(/@(HOST|PATH|URL)@/g, function(m) {
                return m[0] == "H" ? options.host : m[0] == "P" ? options.path : m[0] == "U" ? req.url : "";
            });
            logger.debug("redirect:", location, "=>", url, this.redirectUrl[i]);
            return { status: 302, url: url };
        }
    }
    return null;
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkSignature = function(req, callback)
{
    var self = this;
    var now = Date.now();
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };
    if (!callback) callback = function(x) { return x; }

    // Extract all signature components from the request
    var sig = self.parseSignature(req);

    if (logger.level >= logger.DEBUG) logger.debug('checkSignature:', sig, 'hdrs:', req.headers, 'session:', JSON.stringify(req.session));

    // Sanity checks, required headers must be present and not empty
    if (!sig.method || !sig.host) {
        return callback({ status: 415, message: "Invalid request" });
    }

    // Bad or empty signature result in empty login
    if (!sig.login) {
        req._noSignature = 1;
        return callback({ status: 417, message: "No login provided" });
    }

    // Make sure the request is not expired, it must be in milliseconds
    if (sig.expires < now - this.signatureAge) {
        return callback({ status: 406, message: "Expired request, check your clock, server time is " + lib.strftime(now, "%m/%d/%Y %H:%M:%S GMT", 1) });
    }

    // Check the signature version consistency, do not accept wrong signatures in the unexpected places
    switch (sig.version) {
    case 2:
        if (sig.source != "s") return callback({ status: 416, message: "Invalid request" });
        break;
    case 3:
        if (sig.source != "t") return callback({ status: 416, message: "Invalid request" });
        break;
    default:
        if (sig.source == "t" || sig.source == "s") return callback({ status: 416, message: "Invalid request" });
    }

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    db.get("bk_auth", { login: sig.login }, function(err, account) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account record found" });

        // Account expiration time
        if (account.expires && account.expires < now) {
            return callback({ status: 412, message: "This account has expired" });
        }

        // Verify ACL regex if specified, test the whole query string as it appears in the request query line
        if (account.acl_deny && sig.url.match(account.acl_deny)) {
            return callback({ status: 403, message: "Access denied" });
        }
        if (account.acl_allow && !sig.url.match(account.acl_allow)) {
            return callback({ status: 403, message: "Not permitted" });
        }

        // Deal with encrypted body, use our account secret to decrypt, this is for raw data requests
        // if it is JSON or query it needs to be reparsed in the application
        if (req.body && req.get("content-encoding") == "encrypted") {
            req.body = lib.decrypt(account.secret, req.body);
        }

        // Now we can proceed with signature verification, all other conditions are met
        if (!self.verifySignature(sig, account)) {
            return callback({ status: 401, message: "Not authenticated" });
        }

        // Cleanup not allowed parameters
        if (account.query_deny) {
            var rx = new RegExp(account.opts_deny, "i");
            for (var p in req.query) {
                if (rx.test(p)) delete req.query[p];
            }
            if (req.query != req.body) {
                for (var p in req.body) {
                    if (rx.test(p)) delete req.body[p];
                }
            }
        }

        // Save account and signature in the request, it will be used later
        req.signature = sig;
        req.account = account;
        req.options.account = { id: req.account.id, login: req.account.login, alias: req.account.alias, type: req.account.type };
        return callback({ status: 200, message: "Ok" });
    });
}

// Check login and cleatext password from a client
api.checkLogin = function(req, callback)
{
    // Make sure we will not crash on wrong object
    if (!req || !req.query) req = { query: {} };

    // Required values must be present and not empty
    if (!req.query.login || !req.query.password) {
        req._noSignature = 1;
        return callback({ status: 417, message: "No login provided" });
    }
    // Create a signature from the login data
    req.signature = this.newSignature(req);
    req.signature.version = 5;
    req.signature.expires = Date.now() + this.signatureAge + 1000;
    req.signature.login = req.query.login;
    req.signature.signature = req.query.password;
    req.query.login = req.query.password = "";
    this.checkSignature(req, callback);
}

// Returns a new signature object with all required properties filled form the request object
api.newSignature = function(req)
{
    var rc = { version: 1, expires: 0, now: Date.now() };
    var url = (req.url || req.originalUrl || "/").split("?");
    rc.path = url[0];
    rc.query = url[1] || "";
    rc.method = req.method || "";
    rc.host = (req.headers.host || "").split(':').shift().toLowerCase();
    rc.type = (req.headers['content-type'] || "").toLowerCase();
    return rc;
}

// Parse incoming request for signature and return all pieces wrapped in an object, this object will be used by `verifySignature` function.
//
// If the signature successfully recognized it is saved in the request as `req.signature`
api.parseSignature = function(req)
{
    if (req.signature) return req.signature;
    var rc = this.newSignature(req);
    rc.signature = req.query[this.signatureHeaderName] || req.headers[this.signatureHeaderName] || "";
    if (!rc.signature) {
        rc.signature = req.query[this.accesTokenName] || req.headers[this.accessTokenName];
        if (rc.signature) {
            rc.signature = lib.decrypt(this.accessTokenSecret, rc.signature, "", "hex");
            rc.source = "t";
        }
    }
    if (!rc.signature) {
        rc.signature = req.session ? req.session[this.signatureHeaderName] : "";
        if (rc.signature) rc.source = "s";
    }
    var d = String(rc.signature).match(/([^\|]+)\|([^\|]*)\|([^\|]+)\|([^\|]+)\|([^\|]+)\|([^\|]*)\|([^\|]*)/);
    if (!d) return rc;
    rc.version = lib.toNumber(d[1]);
    if (d[2]) rc.tag = d[2];
    if (d[3]) rc.login = d[3].trim();
    if (d[4]) rc.signature = d[4];
    rc.expires = lib.toNumber(d[5]);
    rc.checksum = d[6] || "";
    req.signature = rc;
    return rc;
}

// Returns true if the signature `sig` matches given account secret or password. `account` object must be a `bk_auth` record.
api.verifySignature = function(sig, account)
{
    // Verify the signature
    var secret = account.secret;
    var query = (sig.query).split("&").sort().filter(function(x) { return x != "" && x.substr(0, 12) != this.signatureHeaderName }).join("&");
    switch (sig.version) {
    case 1:
        sig.str = "";
        sig.str = sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha1");
        break;

    case 3:
        secret += ":" + (account.token_secret || "");
    case 2:
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + "*" + "\n" + lib.domainName(sig.host) + "\n" + "/" + "\n" + "*" + "\n" + sig.expires + "\n*\n*\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 4:
        if (account.auth_secret) secret += ":" + account.auth_secret;
        sig.str = sig.version + "\n" + (sig.tag || "") + "\n" + sig.login + "\n" + sig.method + "\n" + sig.host + "\n" + sig.path + "\n" + query + "\n" + sig.expires + "\n" + sig.type + "\n" + sig.checksum + "\n";
        sig.hash = lib.sign(secret, sig.str, "sha256");
        break;

    case 5:
        sig.hash = lib.sign(account.salt, sig.signature, "sha256");
        sig.signature = account.password;
        break;

    default:
        sig.hash = NaN;
    }
    if (sig.signature != sig.hash) {
        logger.info('verifySignature:', 'failed', sig, account);
        return false;
    }
    return true;
}

// Create secure signature for an HTTP request. Returns an object with HTTP headers to be sent in the response.
//
// The options may contains the following:
//  - expires is absolute time in milliseconds when this request will expire, default is 30 seconds from now
//  - version a version number defining how the signature will be signed
//  - type - content-type header, may be omitted
//  - tag - a custom tag, vendor specific, opaque to the bkjs, can be used for passing additional account or session inforamtion
//  - checksum - SHA1 digest of the whole content body, may be omitted
//  - query - on object with query parameters to use instead of parameters in the uri
api.createSignature = function(login, secret, method, host, uri, options)
{
    if (!login || !secret) return {};
    if (!options) options = {};
    var now = Date.now();
    var expires = options.expires || 0;
    if (!expires) expires = now + 30000;
    if (expires < now) expires += now;
    var ver = options.version || 4;
    var tag = String(options.tag || "");
    var ctype = String(options.type || "").toLowerCase();
    var checksum = String(options.checksum || "");
    var hostname = String(host || "").split(":").shift().toLowerCase();
    var q = String(uri || "/").split("?");
    var path = q[0];
    var query = options.query || q[1] || "";
    if (typeof query == "object") query = url.format({ query: options.query });
    query = query.split("&").sort().filter(function(x) { return x != ""; }).join("&");
    var rc = {}, str, hmac;
    switch (ver) {
    case 1:
        str = String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(String(secret), str, "sha1")
        break;

    case 2:
    case 3:
        path = "/";
        method = query = "*";
        rc['bk-domain'] = hostname = lib.domainName(hostname);
        rc['bk-max-age'] = Math.floor((expires - now)/1000);
        rc['bk-expires'] = expires;
        rc['bk-path'] = path;
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n*\n*\n";
        hmac = lib.sign(String(secret), str, "sha256")
        break;

    case 5:
        hmac = secret;
        break;

    case 4:
    default:
        str = ver + '\n' + tag + '\n' + String(login) + "\n" + String(method) + "\n" + hostname + "\n" + path + "\n" + query + "\n" + String(expires) + "\n" + ctype + "\n" + checksum + "\n";
        hmac = lib.sign(String(secret), str, "sha256")
    }
    rc[this.signatureHeaderName] = ver + '|' + tag + '|' + String(login) + '|' + hmac + '|' + expires + '|' + checksum + '|';
    logger.debug('createSignature:', rc);
    return rc;
}

// Setup session cookies or access token for automatic authentication without signing, req must be complete with all required
// properties after successful authorization.
api.handleSessionSignature = function(req, options)
{
    logger.debug("handleSessionSignature:", options);

    if (typeof options.accesstoken != "undefined") {
        if (options.accesstoken && req.account && req.account.login && req.account.secret && req.headers) {
            var sig = this.createSignature(req.account.login, req.account.secret + ":" + (req.account.token_secret || ""), "", req.headers.host, "", { version: 3, expires: options.sessionAge || this.accessTokenAge });
            req.account[this.accessTokenName] = lib.encrypt(this.accessTokenSecret, sig[this.signatureHeaderName], "", "hex");
            req.account[this.accessTokenName + '-age'] = options.sessionAge || this.accessTokenAge;
        } else {
            delete req.account[this.accessTokenName];
            delete req.account[this.accessTokenName + '-age'];
        }
    }
    if (typeof options.session != "undefined" && req.session) {
        if (options.session && req.account && req.account.login && req.account.secret && req.headers) {
            var sig = this.createSignature(req.account.login, req.account.secret, "", req.headers.host, "", { version: 2, expires: options.sessionAge || this.sessionAge });
            req.session[this.signatureHeaderName] = sig[this.signatureHeaderName];
        } else {
            delete req.session[this.signatureHeaderName];
        }
    }
}

// Return true if the current user belong to the specified type, account type may contain more than one type
api.checkAccountType = function(row, type)
{
    if (!lib.isObject(row)) return false;
    row._types = lib.strSplit(row._types || row.type);
    return row._types.indexOf(type) > -1;
}

// Perform rate limiting by specified property, if not given no limiting is done.
//
// The following options properties can be used:
//  - type - predefined: `ip,  path, login, id`, determines by which property to perform rate limiting, when using account properties
//     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
//     custom type and used as is.
//     **This property is required.**
//
//     The predefined types:
//     - ip - limit number of requests per configured interval for an IP address
//     - path - limit number of requests per configured interval for an API path and IP address, must be configured like: `-api-rlimits-/api/path-rate=2`
//     - id - limit number of requests per configured interval for an account id
//     - login - limit number of requests per configured interval for a login from the signature, this is called
//         before the account record is pulled from the DB
//
//  - ip - to use the specified IP address for type=ip
//  - max - max capacity to be used by default
//  - rate - fill rate to be used by default
//  - interval - interval in ms within which the rate is measured, default 1000 ms
//  - message - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
//  - total - apply this factor to the rate, it is used in case of multiple servers behind a loadbalancer, so for
//     total 3 servers in the cluster the factor will be 3, i.e. each individual server checks for a third of the total request rate
//
// The metrics are kept in the LRU cache in the master process.
//
// When used for accounts, it is possible to override rate limits for each account in the `bk_auth` table by setting `rlimit_max` and `rlimit_rate`
// columns. To enable account rate limits the global defaults still must be set with the config paramaters `-api-rlimit-login-max` and `-api-rlimit-login-rate`
// for example.
//
// Example:
//
//       api.checkLimit(req, { type: "ip", rate: 100, interval: 60000 }, function(err) {
//          if (err) return api.sendReply(err);
//          ...
//       });
//
api.checkRateLimits = function(req, options, callback)
{
    var self = this;
    if (typeof callback != "function") callback = lib.noop;
    if (!options || !options.type) return callback();

    switch (options.type) {
    case "ip":
        var rate = options.rate || this.rlimits['ipRate'] || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimits['ipMax'] || rate;
        var interval = options.interval || this.rlimits['ipInterval'] || this.rlimits.interval || 1000;
        var key = 'TBip:' + (options.ip || req.options.ip);
        break;

    case 'path':
        var path = options.path || req.options.path;
        var rate = options.rate || this.rlimits[path + 'Rate'] || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimits[path + 'Max'] || rate;
        var interval = options.interval || this.rlimits[path + 'Interval'] || 1000;
        var key = 'TBreq:' + (options.ip || req.options.ip) + path;
        break;

    case "login":
        var rate = options.rate || this.rlimits['loginRate'] || 0;
        if (!rate) return callback();
        var sig = self.parseSignature(req);
        if (!sig || !sig.login) return callback();
        var max = options.max || this.rlimits['loginMax'] || rate;
        var interval = options.interval || this.rlimits['loginInterval'] || this.rlimits.interval || 1000;
        var key = 'TBlogin:' + sig.login;
        break;

    case "id":
        if (!req.account || !req.account.id) return callback();
        var rate = options.rate || req.account.rlimits_rate || this.rlimits['idRate'] || 0;
        if (!rate) return callback();
        var max = options.max || req.account.rlimits_max || this.rlimits['idMax'] || rate;
        var interval = options.interval || req.account.rlimits_interval || this.rlimits['idInterval'] || 1000;
        var key = 'TBid:' + req.account.id;
        break;

    default:
        var rate = options.rate || this.rlimits[options.type + 'Rate'] || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimits[options.type + 'Max'] || rate;
        var interval = options.interval || this.rlimits[options.type + 'Interval'] || this.rlimits.interval || 1000;
        var key = 'TB' + type;
    }

    // Divide by total number of servers in the cluster, because a load balancer distributes the load equally each server can only
    // check for a portion of the total request rate
    var total = options.total || this.rlimits.total || 0;
    if (total > 1 && total < rate) {
        max /= total;
        rate /= total;
        if (!rate) return callback();
    }

    // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
    // in master mode use direct access to the LRU cache
    var msg = { name: key, rate: rate, max: max, interval: interval };
    ipc.sendMsg("rlimits:check", msg, function(m) {
        callback(m.consumed ? null : { status: 429, message: options.message || "access limit reached, please try again later" });
    });
}

// Convert query options into internal options, such options are prepended with the underscore to
// distinguish control parameters from query parameters.
// For security purposes this is the only place that translates special control query parameters into the options properties,
// all the supported options are defined in the `api.controls` and can be used by the apps freely.
api.getOptions = function(req)
{
    var params = lib.toParams(req.query, this.controls, { prefix: "_", data: { token: { secret: this.getTokenSecret(req) } } });
    if (!req.options) req.options = {};
    for (var p in params) req.options[p] = params[p];
    return req.options;
}

// Return a secret to be used for enrypting tokens, it uses the account property if configured or the global API token
// to be used to encrypt data and pass it to the clients. `-api-query-token-secret` can be configured and if a column in the `bk_auth`
// with such name exists it is used as a secret, otherwise the value of this property is used as a secret.
api.getTokenSecret = function(req)
{
    if (!this.queryTokenSecret) return "";
    return req.account[this.queryTokenSecret] || this.queryTokenSecret;
}

// Return an object to be returned to the client as a page of result data with possibly next token
// if present in the info. This result object can be used for pagination responses.
api.getResultPage = function(req, options, rows, info)
{
    if (options.total) return { count: rows.length && rows[0].count ? rows[0].count : 0 };
    var token = { count: rows.length, data: rows };
    if (info && info.next_token) token.next_token = lib.jsonToBase64(info.next_token, this.getTokenSecret(req));
    return token;
}

// Columns that are allowed to be visible, used in select to limit number of columns to be returned by a query
//  - pub property means public column
//
// options may be used to define the following properties:
// - columns - list of public columns to be returned, overrides the public columns in the definition list
api.getPublicColumns = function(table, options)
{
    if (options && Array.isArray(options.columns)) {
        return options.columns.filter(function(x) { return x.pub }).map(function(x) { return x.name });
    }
    var cols = this.getColumns(table, options);
    return Object.keys(cols).filter(function(x) { return cols[x].pub });
}

// Process records and keep only public properties as defined in the table columns. This method is supposed to be used in the post process
// callbacks after all records have been processes and are ready to be returned to the client, the last step would be to cleanup
// all non public columns if necessary.
//
// `table` can be a single table name or a list of table names which combined public columns need to be kept in the rows. List of request tables
// is kept in the `req.options.cleanup` which by default is a table name of the API endpoint, for example for /account/get it will contain bk_account, for
// /connection/get - bk_connection.
//
// In the `options` account object can be present to detect account own records which will not be cleaned and all properties will be returned, by default `id`
// property is used to detect current account but can be specified by the `options.account_key` property.
//
// By default primary keys are not kept and must be marked with `pub` property in the table definition to be returned.
//
// If any column is marked with `secure` property this means never return that column in the result even for the owner of the record
//
// If any column is marked with `admin` or `admins` property and the current account is an admin this property will be returned as well. the `options.admin`
// can be used to make it an artificial admin.
//
// The `options.strict` will enforce that all columns not present in the table definition will be skipped as well, by default all
// new columns or columns created on the fly are returned to the client.
//
// The `options.pool` property must match the actual rowset to be applied properly, in case the records have been retrieved for the different
// database pool.
api.checkResultColumns = function(table, rows, options)
{
    if (!table || !rows) return;
    if (!options) options = {};
    var cols = {}, row;
    var admin = options.admin || this.checkAccountType(options.account, "admin");
    var tables = lib.strSplit(table);
    for (var i = 0; i < tables.length; i++) {
        var c = db.getColumns(tables[i], options);
        for (var p in c) cols[p] = c[p].pub ? 1 : c[p].secure ? -1 : c[p].admin || c[p].admins ? admin : 0;
    }
    if (!Array.isArray(rows)) rows = [ rows ];
    logger.debug("checkResultColumns:", table, cols, rows.length, admin, options);
    for (var i = 0; i < rows.length; i++) {
        // For personal records, skip only special columns
        row = rows[i];
        var owner = options.account && options.account.id == row[options.account_key || 'id'];
        for (var p in row) {
            if (typeof cols[p] == "undefined") {
                if (options.strict) delete row[p];
                continue;
            }
            // Owners only skip secure columns
            if (owner && cols[p] < 0) delete row[p];
            if (!owner && cols[p] <= 0) delete row[p];
        }
    }
}

// Clear request query properties specified in the table definition, if any columns for the table contains the property `name` nonempty, then
// all request properties with the same name as this column name will be removed from the query. This for example is used for the `bk_auth`
// table to disable updating properties by the user which can only be set by an admin.
//
// The options can have a property in the form `keep_{name}` which will prevent from clearing the query for the name, this is for dynamic enabling/disabling
// this functionality without clearing table column definitions.
//
// The `options.reverse` will make the logic opposite: clear all properties that do not have the property `name` in the object.
//
// There can be more than one name specified
//
//  Example:
//
//        api.clearQuery(req.query, "bk_account", "admin")
//        api.clearQuery(req.query, "bk_auth", "admin", "secure")
//
api.clearQuery = function(query, table, name, options)
{
    var reverse = options && options.reverse ? 1 : 0;
    var cols = db.getColumns(table, options);
    for (var i = 3; i < arguments.length; i++) {
        var name = arguments[i];
        if (options && options['keep_' + name]) continue;
        for (var p in cols) {
            if ((!reverse && cols[p][name]) || (reverse && !cols[p][name])) delete query[p];
        }
    }
}

// Find registered hooks for given type and path
api.findHook = function(type, method, path)
{
    var hooks = [];
    var bucket = type;
    var routes = this.hooks[bucket];
    if (!routes) return hooks;
    method = method.toLowerCase();
    for (var i = 0; i < routes.length; ++i) {
        if ((!routes[i].method || routes[i].method == method) && routes[i].path.test(path)) {
            hooks.push(routes[i]);
        }
    }
    return hooks;
}

// Register a hook callback for the type and method and request url, if already exists does nothing.
api.addHook = function(type, method, path, callback)
{
    var bucket = type;
    var hooks = this.findHook(type, method, path);
    if (hooks.some(function(x) { return x.method == method && String(x.path) === String(path) })) return false;
    var rx = util.isRegExp(path) ? path : new RegExp("^" + path + "$");
    if (!this.hooks[bucket]) this.hooks[bucket] = [];
    this.hooks[bucket].push({ method: method.toLowerCase(), path: rx, callback: callback });
    logger.debug("addHook:", type, method, path);
    return true;
}

// Register a handler to check access for any given endpoint, it works the same way as the global accessCheck function and is called before
// validating the signature or session cookies. No account information is available at this point yet.
//
//  - method can be '' in such case all methods will be matched
//  - path is a string or regexp of the request URL similar to registering Express routes
//  - callback is a function with the following parameters: function(req, cb) {}, to indicate an error condition pass an object
//    with the callback with status: and message: properties, status != 200 means error
//
// Example:
//
//          api.registerAccessCheck('', 'account', function(req, cb) { cb({ status: 500, message: "access disabled"}) }))
//
//          api.registerAccessCheck('POST', '/account/add', function(req, cb) {
//             if (!req.query.invitecode) return cb({ status: 400, message: "invitation code is required" });
//             cb();
//          });
//
api.registerAccessCheck = function(method, path, callback)
{
    this.addHook('access', method, path, callback);
}

// Similar to `registerAccessCheck` but this callback will be called after the signature or session is verified but before
// the API route method is called. The `req.account` object will always exist at this point but may not contain the user in case of an error.
//
// The purpose of this hook is to perform some preparations or check permissions of a valid user to resources or in case of error perform any other action
// like redirection or returning something explaining what to do in case of failure. The callback for this call is different then in `checkAccess` hooks.
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function(req, status, cb) where status is an object { status:..., message: ..} passed from the checkSignature call, if status != 200 it means
//   an error condition, the callback must pass the same or modified status object in its own `cb` callback
//
// Example:
//
//           api.registerPreProcess('GET', '/account/get', function(req, status, cb) {
//                if (status.status != 200) status = { status: 302, url: '/error.html' };
//                cb(status)
//           });
//
// Example with admin access only:
//
//          api.registerPreProcess('POST', '/data/', function(req, status, cb) {
//              if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
//              cb();
//          });
//
api.registerPreProcess = function(method, path, callback)
{
    this.addHook('auth', method, path, callback);
}

// Register a callback to be called after successfull API action, status 200 only. To trigger this callback the primary response handler must return
// results using `api.sendJSON` or `api.sendFormatted` methods.
//
// The purpose is to perform some additional actions after the standard API completed or to customize the result
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similar to registering Express routes
// - callback is a function with the following parameters: function(req, res, rows) where rows is the result returned by the API handler,
//   the callback may not return data back to the client, in this case next post-process hook will be called and eventually the result will be sent back to the client.
//   **To indicate that this hook will send the result eventually it must return true, otherwise the rows will be sent afer all hooks are called**
//
// Note: the `req.account` object may become empty if any callback decided to do some async action, in such cases make a copy of the account object if it will needed
//
// Example, just update the rows, it will be sent at the end of processing all post hooks
//
//          api.registerPostProcess('', '/data/', function(req, res, rows) {
//              rows.forEach(function(row) { ...});
//          });
//
// Example, add data to the rows and return result after it
//
//          api.registerPostProcess('', '/data/', function(req, res, row) {
//              db.get("bk_account", { id: row.id }, function(err, rec) {
//                  row.name = rec.name;
//                  res.json(row);
//              });
//              return true;
//          });
//
api.registerPostProcess = function(method, path, callback)
{
    this.addHook('post', method, path, callback);
}

// Register a cleanup callback that will be called at the end of a request, all registered cleanup callbacks will be called in the order
// of registration. At this time the result has been sent so connection is not valid anymore but the request and account objects are still available.
//
// Example, do custom logging of all requests
//
//          api.registerCleanup('', '/data/', function(req, next) {
//              db.add("log", req.query, next);
//          });
//
api.registerCleanup = function(method, path, callback)
{
    this.addHook('cleanup', method, path, callback);
}

// Given passport strategy setup OAuth callbacks and handle the login process by creating a mapping account for each
// OAUTH authenticated account.
// The callback if specified will be called as function(req, options, info) with `req.user` signifies the successful
// login and hold the account properties. If given it is up to the callback to perform any redirects reqauired for
// completion of the login process.
//
// The following options properties are accepted:
//  - cliendID,
//  - clientSecret,
//  - callbackURL - passport OAUTH properties
//  - session - setup cookie session on success
//  - successUrl - redirect url on success if no callback is specified
//  - failureUrl - redirect url on failure if no callback is specified
//  - fetchAccount - a new function to be used instead of api.fetchAccount for new account creation or mapping
//     for the given authenticated profile. This is for processing or customizing new account properties and doing
//     some post processing work after the account has been created.
//     For any function, `query._profile`, `query._accessToken`, `query._refreshToken` will be set for the authenticated profile object from the provider.
api.registerOAuthStrategy = function(strategy, options, callback)
{
    var self = this;
    if (!options || !options.clientID || !options.clientSecret) return;

    // Initialize passport on first call
    if (!this._passport) {
        this._passport = 1;
        // Keep only user id in the passport session
        passport.serializeUser(function(user, done) {
            done(null, user.id);
        });
        passport.deserializeUser(function(user, done) {
            done(null, user);
        });
        this.app.use(passport.initialize());
    }

    strategy = new strategy(options, function(accessToken, refreshToken, profile, done) {
        // Refuse to login if no account method exists
        var cb = options.fetchAccount || self.fetchAccount;
        if (typeof cb != "function") return done(lib.newError("OAuth login is not configured"));
        var query = {};
        query.login = profile.provider + ":" + profile.id;
        query.secret = lib.uuid();
        query.name = query.alias = profile.displayName;
        query.gender = profile.gender;
        query.email = profile.email;
        if (!query.email && profile.emails && profile.emails.length) query.email = profile.emails[0].value;
        // Deal with broken or not complete implementations
        if (profile.photos && profile.photos.length) query.icon = profile.photos[0].value || profile.photos[0];
        if (!query.icon && profile._json && profile._json.picture) query.icon = profile._json.picture;
        query._accessToken = accessToken;
        query._refreshToken = refreshToken;
        query._profile = profile;
        // Login or create new account for the profile
        cb.call(self, query, options, function(err, user) {
            logger[err ? "error" : "debug"]('registerOAuthStrategy: user:', strategy.name, err || "", user, profile)
            done(err, user);
        });
    });
    // Accessing internal properties is not good but this will save us an extra name to be passed arround
    if (!strategy._callbackURL) strategy._callbackURL = 'http://localhost:' + core.port + '/oauth/callback/' + strategy.name;
    passport.use(strategy);

    // Make sure we allow oauth paths without authentication
    if (!this.allow.rx.test("/oauth/")) {
        this.allow = lib.toRegexpObj(this.allow, "^/oauth/");
    }

    this.app.get('/oauth/' + strategy.name, passport.authenticate(strategy.name, options));
    this.app.get('/oauth/callback/' + strategy.name, function(req, res, next) {
        passport.authenticate(strategy.name, function(err, user, info) {
            logger.debug("registerOAuthStrategy: authenticate:", err, user, info)
            if (err) return next(err);
            if (!user) {
                if (options.failureRedirect) return res.redirect(options.failureRedirect);
                if (typeof callback == "function") return callback(req, options, info);
                next();
            }
            req.logIn(user, function(err) {
                if (err) return next(err);
                if (user.id) req.account = user;
                self.handleSessionSignature(req, options);
                if (options.successRedirect) return res.redirect(options.successRedirect);
                if (typeof callback == "function") return callback(req, options, info);
                next();
            });
        })(req, res, next);
    });
    logger.debug("registerOAuthStrategy:", strategy.name, options.clientID, strategy._callbackURL);
}

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
// If err is not null the error message is returned immediately.
api.sendJSON = function(req, err, rows)
{
    var self = this;
    if (err) return this.sendReply(req.res, err);

    // Do not cache API results by default, routes that send directly have to handle cache explicitely
    if (!req.res.get("cache-control")) {
        req.res.header("cache-control", "max-age=0, no-cache, no-store");
        req.res.header("pragma", "no-cache");
    }

    if (!rows) rows = [];
    var sent = 0;
    var hooks = this.findHook('post', req.method, req.options.path);
    lib.forEachSeries(hooks, function(hook, next) {
        try { sent = hook.callback.call(self, req, req.res, rows); } catch(e) { logger.error('sendJSON:', req.options.path, e.stack); }
        logger.debug('sendJSON:', req.method, req.options.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, function(err) {
        if (sent || req.res.headersSent) return;
        // Keep only public columns for the combination of all tables specified
        if (req.options.cleanup) {
            self.checkResultColumns(req.options.cleanup, rows && rows.count && rows.data ? rows.data : rows, req.options);
        }
        req.res.json(rows);
    });
}

// Send formatted JSON reply to API client, if status is an instance of Error then error message with status 500 is sent back
api.sendReply = function(res, status, text)
{
    if (status instanceof Error || status instanceof Object) {
        text = status.message || "Error occured";
        status = typeof status.status == "number" ? status.status : typeof status.code == "number" ? status.code : 500;
    }
    if (typeof status == "string" && status) text = status, status = 500;
    if (!status) status = 200, text = "";
    return this.sendStatus(res, { status: status, message: String(text || "") });
}

// Send result back formatting according to the options properties:
//  - format - json, csv, xml, JSON is default
//  - separator - a separator to use for CSV and other formats
api.sendFormatted = function(req, err, data, options)
{
    if (err) return this.sendReply(req.res, err);
    if (!options) options = req.options;
    if (!data) data = [];

    switch (options.format) {
    case "xml":
        if (req.options.cleanup) this.checkResultColumns(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var xml = "<data>\n";
        if (data.next_token) xml += "<next_token>" + data.next_token + "</next_token>\n";
        xml += lib.toFormat(options.format, data, options);
        xml += "</data>";
        req.res.set('Content-Type', 'application/xml');
        req.res.send(200, xml);
        break;

    case "csv":
        if (req.options.cleanup) this.checkResultColumns(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var rows = Array.isArray(data) ? data : (data.data || []);
        var csv = Object.keys(rows[0]).join(options.separator || "|") + "\n";
        csv += lib.toFormat(options.format, rows, options);
        req.res.set('Content-Type', 'text/csv');
        req.res.send(200, csv);
        break;

    case "json":
        if (req.options.cleanup) this.checkResultColumns(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        csv += lib.toFormat(options.format, data, options);
        req.res.set('Content-Type', 'text/plain');
        req.res.send(200, csv);
        break;

    default:
        this.sendJSON(req, err, data);
    }
}

// Return reply to the client using the options object, it cantains the following properties:
// - status - defines the respone status code
// - message  - property to be sent as status line and in the body
// - type - defines Content-Type header, the message will be sent in the body
// - url - for redirects when status is 301 or 302
api.sendStatus = function(res, options)
{
    if (res.headersSent) return;
    if (!options) options = { status: 200, message: "" };
    if (!options.status) options.status = 200;
    try {
        switch (options.status) {
        case 301:
        case 302:
            res.redirect(options.status, options.url);
            break;

        default:
            if (options.type) {
                res.type(type);
                res.send(options.status, options.message || "");
            } else {
                res.status(options.status).json(options);
            }
        }
    } catch(e) {
        logger.error('sendStatus:', res.req.url, e.stack);
    }
    return false;
}

// Send file back to the client, res is Express response object
api.sendFile = function(req, res, file, redirect)
{
    fs.exists(file, function(yes) {
        if (req.method == 'HEAD') return res.send(yes ? 200 : 404);
        if (yes) return res.sendFile(file, { root: core.home });
        if (redirect) return res.redirect(redirect);
        res.sendStatus(404);
    });
}

// Subscribe for events, this is used by `/acount/subscribe` API call but can be used in generic way, if no options
// provided by default it will listen on req.account.id, the default API implementation for Connection, Counter, Messages publish
// events using account id as a key.
// - req is always an Express request object
// - optons may contain the following propertis:
//    - key - alternative key to subscribe for
//    - timeout - how long to wait before dropping the connection, default 15 mins
//    - interval - how often send notifications to the client, this allows buffering several events and notify about them at once instead triggering
//       event condition every time, useful in case of very frequent events
//    - match - a regexp that matched the message text, if not matched these events will be dropped
api.subscribe = function(req, options)
{
    var self = this;
    if (!options) options = {};
    req.msgKey = options.key || req.account.id;
    // Ignore not matching events, the whole string is checked
    req.msgMatch = options.match ? new RegExp(options.match) : null;
    req.msgInterval = options.subscribeInterval || this.subscribeInterval;
    req.msgTimeout = options.timeoput || this.subscribeTimeout;
    ipc.subscribe(req.msgKey, function(k, d, n) { self.sendEvent(req, k, d, n); });

    // Listen for timeout and ignore it, this way the socket will be alive forever until we close it
    req.res.on("timeout", function() {
        logger.debug('subscribe:', 'timeout', req.msgKey);
        setTimeout(function() { req.socket.destroy(); }, req.msgTimeout);
    });
    req.on("close", function() {
        logger.debug('subscribe:', 'close', req.msgKey);
        ipc.unsubscribe(req.msgKey);
    });
    logger.debug('subscribe:', 'start', req.msgKey);
}

// Disconnect from subscription service. This forces disconnect even for persistent connections like websockets.
api.unsubscribe = function(req, options)
{
    if (req && req.msgKey) ipc.unsubscribe(req.msgKey);
}

// Publish an event for an account, key is account id or other key used for subscription, event is a string or an object
api.publish = function(key, event, options)
{
    ipc.publish(key, event);
}

// Process a message received from subscription server or other even notifier, it is used by `api.subscribe` method for delivery events to the clients
api.sendEvent = function(req, key, data, next)
{
    logger.debug('subscribe:', key, data, 'sent:', req.res.headersSent, 'match:', req.msgMatch, 'timeout:', req.msgTimeout);
    // If for any reasons the response has been sent we just bail out
    if (req.res.headersSent) {
        ipc.unsubscribe(key);
        return next && next();
    }

    if (typeof data != "string") data = JSON.stringify(data);
    // Filter by matching the whole message text
    if (req.msgMatch && !data.match(req.mgMatch)) return next && next();
    if (!req.msgData) req.msgData = [];
    req.msgData.push(data);
    if (req.msgTimeout) clearTimeout(req.msgTimeout);
    if (!req.msgInterval) {
        req.res.type('application/json').send("[" + req.msgData.join(",") + "]");
        if (!req.httpProtocol) ipc.unsubscribe(key);
    } else {
        req.msgTimeout = setTimeout(function() {
            if (!req.res.headersSent) req.res.type('application/json').send("[" + req.msgData.join(",") + "]");
            if (!req.httpProtocol) ipc.unsubscribe(key);
        }, req.msgInterval);
    }
    if (next) next();
}
