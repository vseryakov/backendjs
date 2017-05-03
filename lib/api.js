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
var domain = require('domain');
var qs = require("qs");
var formidable = require('formidable');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var ipc = require(__dirname + '/ipc');
var msg = require(__dirname + '/msg');
var db = require(__dirname + '/db');
var app = require(__dirname + '/app');
var metrics = require(__dirname + '/metrics');
var logger = require(__dirname + '/logger');

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
//      - appName - parsed app version provided in the header or user agent
//      - appVersion - parsed app version from the header or user agent
//      - appTimezone - milliseconds offset from the UTC provided in the header by the app
//      - appLocale - a language provided in the header or query
//      - appBuild - app version build provided in the header
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
           { name: "files-raw", type: "bool", descr: "Return raw urls for the files, requires files-url to be configured. The path will reflect the actual 2 level structure and account id in the file name" },
           { name: "files-url", descr: "URL where files are stored, for cases of central file server(s), must be full URL with optional path" },
           { name: "files-s3", descr: "S3 bucket name where to store files uploaded with the File API" },
           { name: "max-latency", type: "number", min: 11, descr: "Max time in ms for a request to wait in the queue, if exceeds this value server returns too busy error" },
           { name: "max-cpu-util", type: "number", min: 0, descr: "Max CPU utilization allowed, if exceeds this value server returns too busy error" },
           { name: "max-memory-heap", type: "number", min: 0, descr: "Max number of bytes of V8 heap allowed, if exceeds this value server returns too busy error" },
           { name: "max-memory-rss", type: "number", min: 0, descr: "Max number of bytes in RSS memory allowed, if exceeds this value server returns too busy error" },
           { name: "max-request-queue", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns too busy error" },
           { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
           { name: "access-log-file", descr: "File for access logging" },
           { name: "access-log-fields", array: 1, type: "list", descr: "Additional fields from the request or account to put in the access log, prefix defines where the field is lcoated: q: - query, h: - headers, a: - account otherwise from the request, Example: -api-log-fields h:Referer,a:name,q:action" },
           { name: "salt", descr: "Salt to be used for scrambling credentials or other hashing activities" },
           { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
           { name: "static-options-(.+)", autotype: 1, obj: "staticOptions", strip: "static-options-", nocamel: 1, descr: "Options to pass to serve-static module: maxAge, dotfiles, etag, redirect, fallthrough, extensions, index, lastModified" },
           { name: "static-paths", type: "path", array: 1, descr: "List of additional paths to be used when serving static content" },
           { name: "vhost-path-(.+)", type: "regexp", obj: "vhostPath", nocamel: 1, strip: "vhost-path-", regexp: "i", descr: "Define a virtual host regexp to be matched against the hostname header to serve static content from a different root, if not an absolute path then a vhost dir must be inside the primary web root, if the regexp starts with !, that means negative match, example: api-vhost-path-test_dir=test.com$" },
           { name: "no-templating", type: "bool", descr: "Disable templating engine completely" },
           { name: "templating", descr: "Templating engne to use, see consolidate.js for supported engines" },
           { name: "no-session", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
           { name: "session-age", type: "int", min: 0, descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-secret", descr: "Secret for session cookies, session support enabled only if it is not empty" },
           { name: "query-token-secret", descr: "Name of the property to be used for encrypting tokens for pagination or other sensitive data, any property from bk_auth can be used, if empty no secret is used, if not a valid property then it is used as the secret" },
           { name: "app-header-name", descr: "Name for the app name/version query parameter or header, it is can be used to tell the server about the application version" },
           { name: "version-header-name", descr: "Name for the access version query parameter or header, this is the core protocol version that can be sent to specify which core functionality a client expects" },
           { name: "no-signature", type: "bool", descr: "Disable signature verification for requests" },
           { name: "no-cache-files", type: "regexpobj", descr: "Set cache-control=no-cache header for matching static files", },
           { name: "tz-header-name", descr: "Name for the timezone offset header a client can send for time sensitive requests, the backend decides how to treat this offset" },
           { name: "signature-header-name", descr: "Name for the access signature query parameter, header and session cookie" },
           { name: "lang-header-name", descr: "Name for the language query parameter, header and session cookie, primary language for a client" },
           { name: "signature-age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
           { name: "access-time-interval", type: "int", min: 0, descr: "Intervals to refresh last access time for accounts, only updates the cache if `bk_auth` is configured to be cached" },
           { name: "access-token-name", descr: "Name for the access token query parameter or header" },
           { name: "access-token-secret", descr: "A secret to be used for access token signatures, additional enryption on top of the signature to use for API access without signing requests, it is required for access tokens to be used" },
           { name: "access-token-age", type: "int", min: 0, descr: "Access tokens age in milliseconds, for API requests with access tokens only" },
           { name: "disable-session", type: "regexpobj", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-authenticated", type: "regexpobj", descr: "Add URLs which can be accessed by any authenticated user account, can be partial urls or Regexp, this is a convenient option which registers `AuthCheck` callback for the given endpoints and is checked before any other account types, if matched no account specific paths will be checked anymore(any of the allow-account-...)" },
           { name: "allow-admin", type: "regexpobj", descr: "Add URLs which can be accessed by admin accounts only, can be partial urls or Regexp, this is a convenient option which registers `AuthCheck` callback for the given endpoints" },
           { name: "allow-account-([a-z]+)", type: "regexpobj", obj: "allow-account", descr: "Add URLs which can be accessed by specific account type only, can be partial urls or Regexp, this is a convenient option which registers AuthCheck callback for the given endpoints and only allow access to the specified account types" },
           { name: "deny-account-([a-z]+)", type: "regexpobj", obj: "deny-account", descr: "Add URLs which CAN NOT be accessed by specific account type, can be partial urls or Regexp, this is checked before any allow parameters" },
           { name: "express-options", type: "json", descr: "Set Express config options during initialization,example: `-api-express-options { \"trust proxy\": 1, \"strict routing\": true }`" },
           { name: "allow-ip", type: "regexpobj", set: 1, descr: "Set regexp for IPs that dont need credentials, replaces the whole access list. It is checked before endpoint access list" },
           { name: "deny-ip", type: "regexpobj", set: 1, descr: "Set regexp for IPs that will be denied access, replaces the whole access list. It is checked before endpoint access list." },
           { name: "allow", type: "regexpobj", descr: "Regexp for URLs that dont need credentials, replaces the whole access list" },
           { name: "allow-path", type: "regexpobj", key: "allow", descr: "Add to the list of allowed URL paths without authentication, return result before even checking for the signature" },
           { name: "ignore-allow", type: "regexpobj", descr: "Regexp for URLs that should be ignored by the allow rules, the processing will continue" },
           { name: "ignore-allow-path", type: "regexpobj", key: "ignore-allow", descr: "Add to the list of URL paths which should e ignored by the allow rules, in order to keep allow/deny rules simple, for example to keep some js files from open to all: -allow-path \.js -disallow-path /secure/" },
           { name: "allow-anonymous", type: "regexpobj", descr: "Add to the list of allowed URL paths that can be served with or without valid account, the difference with `allow-path` is that it will check for signature and an account but will continue if no login is provided, return error in case of wrong account or not account found" },
           { name: "allow-ssl", type: "regexpobj", descr: "Add to the list of allowed URL paths using HTTPs only, plain HTTP requests to these urls will be refused" },
           { name: "redirect-ssl", type: "regexpobj", descr: "Add to the list of the URL paths to be redirected to the same path but using HTTPS protocol, for proxy mode the proxy server will perform redirects" },
           { name: "redirect-url", type: "regexpmap", descr: "Add to the list a JSON object with property name defining a host/path regexp to be matched against in order to redirect using the value of the property, if the regexp starts with !, that means negative match, 2 variables can be used for substitution: @HOST@, @PATH@, @URL@, example: { '^[^/]+/path/$': '/path2/index.html', '.+/$': '@PATH@/index.html' } " },
           { name: "deny", type:" regexpobj", set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", type: "regexpobj", key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events before closing the connection, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 0, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "mime-ignore", array: 1, descr: "Ignore the body for the following MIME content types, request body will not be parsed at all" },
           { name: "mime-map-(.+)", obj: "mime-map", descr: "File extension to MIME content type mapping, this is used by static-serve, example: -api-mime-map-mobileconfig application/x-apple-aspen-config" },
           { name: "collect-host", descr: "The backend URL where all collected statistics should be sent over, if set to `pool` then each web worker will save metrics directly into the statistics database pool" },
           { name: "collect-pool", descr: "Database pool where to save collected statistics" },
           { name: "collect-interval", type: "number", min: 30, descr: "How often to collect statistics and metrics in seconds" },
           { name: "collect-send-interval", type: "number", min: 60, descr: "How often to send collected statistics to the master server in seconds" },
           { name: "secret-policy", type: "regexpmap", descr : "An JSON object with list of regexps to validate account password, each regexp comes with an error message to be returned if such regexp fails, `api.checkAccountSecret` performs the validation, example: { '[a-z]+': 'At least one lowercase letter', '[A-Z]+': 'At least one upper case letter' }" },
           { name: "platform-match", type: "regexpmap", regexp: "i", descr : "An JSON object with list of regexps to match user-agent header for platform detection, example: { 'ios|iphone|ipad': 'ios', 'android': 'android' }" },
           { name: "cors-origin", descr: "Origin header for CORS requests" },
           { name: "error-message", descr: "Default erro rmessage to return in case of exceptions" },
           { name: "url-metrics-([a-z]+)", type: "int", obj: "url-metrics", descr: "Defines the length of an API request path to be stored in the statistics, set by the first component of endpoint URL, example: -api-url-metrics-image 2 -api-url-metrics-account 3" },
           { name: "rlimits-max-(.+)", type: "int", obj: "rlimits-max", descr: "Set max/burst rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-rate-(.+)", type: "int", obj: "rlimits-rate", descr: "Set fill/normal rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-interval-(.+)", type: "int", obj: "rlimits-interval", descr: "Set rate interval in ms by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, id, login" },
           { name: "rlimits-total", type:" int", obj: "rlimits", descr: "Total number of servers used in the rate limiter behind a load balancer, rates will be divided by this number so each server handles only a portion of the total rate limit" },
           { name: "rlimits-interval", type:" int", obj: "rlimits", descr: "Interval in ms for all rate limiters, defines the time unit, default is 1000 ms" },
           { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*100, descr: "Max size for uploads, bytes"  },
           { name: "limiter-queue", descr: "Name of an ipc queue for API rate limiting" },
           { name: "errlog-limiter-max", type: "int", descr: "How many error messages to put in the log before throttling kicks in" },
           { name: "errlog-limiter-interval", type: "int", descr: "Interval for error log limiter, max errors per this interval" },
           { name: "errlog-limiter-ignore", type: "regexp", descr: "Do not show errors that match the regexp" },
           { name: "proxy-reverse", type: "url", descr: "A Web server where to proxy requests not macthed by the url patterns or host header, in the form: http://host[:port]" },
           { name: "proxy-url-(.+)", type: "regexpobj", reverse: 1, obj: 'proxy-url', lower: /.+/, descr: "URL regexp to be passed to other web server running behind, each parameter defines an url regexp and the destination in the value in the form http://host[:port], example: -api-proxy-url-^/api http://127.0.0.1:8080" },
           { name: "proxy-host-(.+)", type: "regexpobj", reverse: 1, obj: 'proxy-host', lower: /.+/, descr: "Virtual host mapping, to match any Host: header, each parameter defines a host name and the destination in the value in the form http://host[:port], example: -api-proxy-host-www.myhost.com http://127.0.0.1:8080" },
           { name: "routing-(.+)", type: "regexpobj", reverse: 1, obj: 'routing', lower: /.+/, descr: "URL path to be re-routed to other path, this is done inside the server, only the path is checked and replaced, example: -api-routing-^/account/get /acount/read" },
    ],

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the account has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: {},

    // No authentication for these urls
    allow: lib.toRegexpObj(null, ["^/$",
                                      "\\.html$",
                                      "\\.ico$", "\\.gif$", "\\.png$", "\\.jpg$", "\\.jpeg$", "\\.svg$",
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
    ignoreAllow: {},
    // Only for admins
    allowAdmin: {},
    // Allow/deny by account type
    allowAccount: {},
    denyAccount: {},
    // Allow accounts and anonymous users
    allowAnonymous: {},
    allowAuthenticated: {},
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
    rlimitsMax: {},
    rlimitsRate: {},
    rlimitsInterval: {},
    // Global redirect rules, each rule must match host/path to be redirected
    redirectUrl: [],
    routing: {},

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
    vhostPath: {},

    // All listening servers
    servers: [],

    // Proxy target
    proxyUrl: {},
    proxyHost: null,
    proxyWorkers: [],

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 1800000,
    subscribeInterval: 3000,

    // Collect body MIME types as binary blobs
    mimeBody: [],
    mimeIgnore: [],
    mimeMap: {},

    // Static content options
    staticOptions: {
        maxAge: 3600 * 1000,
        setHeaders: function(res, file) {
            var ext = path.extname(file), type = core.modules.api.mimeMap[ext.substr(1)];
            if (type) res.setHeader("content-type", type);
            if (core.modules.api.noCacheFiles.rx && core.modules.api.noCacheFiles.rx.test(file)) {
                res.setHeader("cache-control", "max-age=0, no-cache, no-store");
            }
        }
    },
    staticPaths: [],
    noCacheFiles: {},

    // Web session age
    sessionAge: 86400 * 14 * 1000,
    // How old can a signtature be to consider it valid, for clock drifts
    signatureAge: 0,
    signatureHeaderName: "bk-signature",
    appHeaderName: "bk-app",
    versionHeaderName: "bk-version",
    tzHeaderName: "bk-tz",
    langHeaderName: "bk-lang",
    corsOrigin: "*",
    corsCredentials: true,
    corsMethods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'DELETE'],

    // Separate age for access token
    accessTokenAge: 86400 * 7 * 1000,
    accessTokenSecret: "",
    accessTokenName: 'bk-access-token',

    // Properties to be cleaned up on finish
    requestCleanup: ["options", "account", "signature", "body"],

    // User agent patterns by platform
    platformMatch: lib.toRegexpMap(null,
                                {
                                    "darwin|cfnetwork|iphone|ipad" : "ios",
                                    "android": "android",
                                }, { regexp: "i" }),

    // Default busy latency 1 sec
    maxLatency: 1000,
    maxRequestQueue: 0,
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

    limiterQueue: "local",

    accessLogFields: [],
    // Error reporter throttle
    errlogLimiterMax: 100,
    errlogLimiterInterval: 30000,
    errlogLimiterIgnore: /Range Not Satisfiable|Precondition Failed/,

    // Collector of statistics, seconds
    collectInterval: 30,
    collectSendInterval: 300,
    collectErrors: 0,
    collectQuiet: false,

    // Query options, special parameters that start with the underscore in the req.query, shared between all routes and
    // can perform special actions or to influence the results, in most cases these are used in the db queries.
    controls: {
        ip: { ignore: 1 },
        host: { ignore: 1 },
        path: { ignore: 1 },
        apath: { ignore: 1 },
        secure: { ignore: 1 },
        mtime: { ignore: 1 },
        cleanup: { ignore: 1 },
        appName: { ignore: 1 },
        appVersion: { ignore: 1 },
        appLocale: { ignore: 1 },
        appPlatform: { ignore: 1 },
        appTimezone: { ignore: 1 },
        appBuild: { ignore: 1 },
        noscan: { ignore: 1 },
        total: { type: "bool" },
        session: { type: "bool" },
        accesstoken: { type: "bool" },
        format: { type: "string" },
        separator: { type: "string" },
        encoding: { type: "string" },
        page: { type: "int", dflt: 0, min: 0 },
        count: { type: "int", dflt: 25, min: 0, max: 999 },
        distance: { type: "number", min: 0, dflt: 1000, max: 999 },
        latitude: { type: "real", },
        longitude: { type: "real" },
        tm: { type: "timestamp" },
        ext: { type: "string" },
        ops: { type: "map" },
        start: { type: "token" },
        token: { type: "token" },
        select: { type: "list" },
        desc: { type: "bool" },
        sort: { type: "string" },
    },

    tables: {
        // Authentication by login, only keeps id and secret to check the siganture
        bk_auth: {
            login: { primary: 1 },                              // Account login
            id: { type: "uuid" },                               // Auto generated UUID to be linked with other records
            name: { type: "text" },                             // Account name
            status: { type: "text" },                           // Status of the account
            type: { type: "text", admin: 1 },                   // Account type: admin, ....
            secret: { secure: 1 },                              // Signature secret, not a password
            auth_secret: { admin: 1, secure: 1 },               // Code for 2-factor authentication
            token_secret: { admin: 1, secure: 1 },              // Secret for access tokens
            salt: { secure: 1 },                                // Salt for passwords
            password: { secure: 1 },                            // Hashed with salt
            acl_deny: { admin: 1, secure: 1 },                  // Deny access to matched url, a regexp
            acl_allow: { admin: 1, secure: 1 },                 // Only grant access if path matches this regexp
            query_deny: { admin: 1, secure: 1 },                // Ignore these query params, a regexp
            rlimits_max: { type: "int" },                       // Burst/max reqs/sec rate allowed for this account, 0 to disable
            rlimits_rate: { type: "int" },                      // Fill/normal reqs/sec rate for this account, 0 to disable
            expires: { type: "bigint", admin: 1, secure: 1 },   // Deny access to the account if this value is before current date, milliseconds
            ctime: { type: "now", readonly: 1 },                // Create time
            mtime: { type: "now" }
        },

        // Collected metrics per worker process, basic columns are defined in the table to be collected like
        // api and db request rates(.rmean), response times(.hmean) and total number of requests(_0).
        // Counters ending with `_0` are snapshots, i.e. they must be summed up for any given interval.
        // All other counters are averages. Only subset of all available API endpoints is defined here
        // for example purposes, for SQL databases all columns must be defined but for NoSQL this is not required,
        // depending on the database that is used for collection the metrics must be added to the table. All `url_` columns
        // are the API requests, not the DB calls made by the app, the length of URL path to be stored is defined in the API module
        // by the `api-url-metrics-` config parameter.
        bk_collect: { id: { primary: 1 },
                       mtime: { type: "now", primary: 1 },
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
                       ctime: { type: "mtime" } },

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
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    // These will not used outside of this call
    var express = require('express');
    var cookieParser = require('cookie-parser');
    var session = require('cookie-session');
    var serveStatic = require('serve-static');

    // Performance statistics
    this.initStatistics();

    this.app = express();

    // Setup busy timer to detect when our requests waiting in the queue for too long
    if (this.maxLatency) lib.busyTimer("init", this.maxLatency);

    // Fake i18n methods
    this.app.use(function apiLocales(req, res, next) {
        req.__ = res.__ = res.locals.__ = lib.__;
        next();
    });

    // Early request setup and checks
    this.app.use(function apiLimits(req, res, next) {
        // Latency watcher
        if (api.maxLatency && lib.busyTimer("busy")) {
            api.metrics.Counter('busy_0').inc();
            return api.sendReply(res, 503, "Server is unavailable");
        }
        // CPU utilization
        if (api.maxCpuUtil && api.cpuItil > api.maxUtil) {
            api.metrics.Counter('util_0').inc();
            return api.sendReply(res, 503, "Server is unavailable");
        }
        // Memory watcher
        if (api.maxMemoryHeap && api.memoryUsage.heapUsed > api.maxMemoryHeap) {
            api.metrics.Counter('heap_0').inc();
            return api.sendReply(res, 503, "Server is unavailable");
        }
        if (api.maxMemoryRss && api.memoryUsage.rss > api.maxMemoryRss) {
            api.metrics.Counter('rss_0').inc();
            return api.sendReply(res, 503, "Server is unavailable");
        }
        // Request queue size
        if (api.maxRequestQueue && api.metrics.Counter("api_nreq").toJSON() >= api.maxRequestQueue) {
            api.metrics.Counter('full_0').inc();
            return api.sendReply(res, 503, "Server is unavailable");
        }
        api.checkRouting(req);
        // Setup request common/required properties
        api.prepareRequest(req);

        // Rate limits by IP address and path, early before all other filters
        api.checkRateLimits(req, { type: "ip" }, function ipLimits(err) {
            if (err) {
                api.metrics.Counter('ip_0').inc();
                return api.sendReply(res, err);
            }

            api.checkRateLimits(req, { type: "path" }, function pathLimits(err) {
                if (!err) return next();
                api.metrics.Counter('path_0').inc();
                api.sendReply(res, err);
            });
        });
    });

    // Allow cross site requests
    var serverHeader = core.name + '/' + core.version + " " + core.appName + "/" + core.appVersion;
    var corsHeaders = ['content-type', api.signatureHeaderName, api.appHeaderName, api.versionHeaderName, api.langHeaderName, api.tzHeaderName].join(", ");
    var corsMethods = api.corsMethods.join(", ");
    this.app.use(function(req, res, next) {
        res.header('Server', serverHeader);
        res.header('Access-Control-Allow-Origin', api.corsOrigin);
        res.header('Access-Control-Allow-Headers', corsHeaders);
        res.header('Access-Control-Allow-Methods', corsMethods);
        res.header('Access-Control-Allow-Credentials', api.corsCredentials);
        if (logger.level >= logger.DEBUG) logger.debug('serverRequest:', core.port, req.options.ip, req.connection.remoteAddress, req.method, req.options.path, req.get('content-type'), req.get(api.appHeaderName), req.get(api.signatureHeaderName), req.get(api.tzHeaderName), req.get("x-forwarded-for"));
        // Return immediately for preflight requests
        if (req.method == 'OPTIONS' && req.get('Access-Control-Request-Method')) return res.sendStatus(204);
        next();
    });

    // Acccess logging, always goes into api.accessLog, it must be a stream
    if (!this.noAccessLog) {
        this.configureAccessLog();

        this.app.use(function apiLogger(req, res, next) {
            var startTime = new Date;
            var end = res.end;
            res.end = function(chunk, encoding) {
                res.end = end;
                res.end(chunk, encoding);
                if (!api.accessLog) return;
                var now = new Date();
                var line = req.options.ip + " - " +
                        (logger.syslog ? "-" : '[' +  now.toUTCString() + ']') + " " +
                        req.method + " " +
                        (req.accessLogUrl || req.originalUrl || req.url) + " " +
                        (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                        res.statusCode + " " +
                        (res.get("Content-Length") || '-') + " - " +
                        (now - startTime) + " ms - " +
                        (req.headers[api.appHeaderName] || req.headers['user-agent'] || "-") + " " +
                        (req.account.id || "-" );
                // Append additional fields
                for (var i in api.accessLogFields) {
                    var v = api.accessLogFields[i];
                    switch (v[1] == ":" ? v[0] : "") {
                    case "q":
                        v = req.query[v.substr(2)];
                        break;
                    case "h":
                        v = req.get(v.substr(2));
                        break;
                    case "a":
                        v = req.account[v.substr(2)];
                        break;
                    default:
                        v = req[v];
                    }
                    if (typeof v == "object") v = "";
                    line += " " + (v || "-");
                }
                line += "\n";
                api.accessLog.write(line);
            }
            next();
        });
    }

    // Redirect before processing the request
    this.app.use(function(req, res, next) {
        var location = api.checkRedirect(req, req.options);
        if (location) return api.sendStatus(res, location);
        next();
    });

    // Metrics starts early, always enabled
    this.app.use(function apiMetrics(req, res, next) { return api.startMetrics(req, res, next); });

    // Request parsers
    this.app.use(cookieParser());
    this.app.use(function apiQuery(req, res, next) { return api.checkQuery(req, res, next); });
    this.app.use(function apiBody(req, res, next) { return api.checkBody(req, res, next); });

    // Keep session in the cookies
    if (!this.noSession) {
        this.app.use(session({ key: api.signatureHeaderName, secret: this.sessionSecret || core.name, cookie: { path: '/', httpOnly: true, maxAge: this.sessionAge || null } }));
    }

    // Check the signature, for virtual hosting, supports only the simple case when running the API and static web sites on the same server
    if (!this.noSignature) {
        this.app.use(function apiSignature(req, res, next) {
            // Verify limits using the login from the signature before going into full signature verification
            api.checkRateLimits(req, { type: "login" }, function(err) {
                if (!err) return api.handleSignature(req, res, next);
                api.metrics.Counter('login_0').inc();
                return api.sendReply(res, err);
            });
        });
    }

    // Config options for Express
    for (var p in this.expressOptions) {
        this.app.set(p, this.expressOptions[p]);
    }

    // Assign custom middleware just after the security handler, if the signature is disabled then the middleware
    // handler may install some other authentication module and in such case must setup `req.account` with the current user record
    core.runMethods("configureMiddleware", options, function() {

        // Rate limits for an account, at this point we have verified account record
        api.app.use(function idLimits(req, res, next) {
            api.checkRateLimits(req, { type: "id" }, function(err) {
                if (err) api.metrics.Counter('id_0').inc();
                if (err) return api.sendReply(res, err);
                next();
            });
        });

        // Default API calls
        api.configureDefaultAPI();

        // Setup routes from the loaded modules
        core.runMethods("configureWeb", options, function(err) {
            if (err) return callback.call(api, err);

            // Templating engine setup
            if (!api.noTemplating) {
                var consolidate = require('consolidate');
                api.app.engine('html', consolidate[api.templating]);
                api.app.set('view engine', 'html');
                // Use app specific views path if created even if it is empty
                api.app.set('views', [core.path.views, core.home + "/views", core.path.web + "/../views", __dirname + '/../views' ]);
                logger.debug("templating:", api.templating, "views:", api.app.get("views"));
            }

            // Serve from default web location in the package or from application specific location
            if (!api.noStatic) {
                for (var p in api.vhostPath) {
                    api.app.use(function(rx, handler) {
                        return function vhost(req, res, next) {
                            if (!rx.test(req.options.host)) return next()
                            handler(req, res, next);
                          }
                    }(api.vhostPath[p], serveStatic(path.join(core.path.web, p), api.staticOptions)));
                }

                for (var i = 0; i < api.staticPaths.length; i++) {
                    api.app.use(serveStatic(api.staticPaths[i], api.staticOptions));
                }
                api.app.use(serveStatic(core.path.web, api.staticOptions));
                api.app.use(serveStatic(__dirname + "/../web", api.staticOptions));
                logger.debug("static:", core.path.web, __dirname + "/../web", api.staticPaths);
            }

            // Default error handler to show errors in the log, throttle the output to keep the log from overflow
            if (api.errlogLimiterMax && api.errlogLimiterInterval) {
                api.errlogLimiterToken = new metrics.TokenBucket(api.errlogLimiterMax, 0, api.errlogLimiterInterval);
            }
            api.app.use(function apiEnd(err, req, res, next) {
                api.sendReply(res, err);
            });

            var restart = core.proxy.port ? "server" : "web";
            // Start http server
            if (core.port) {
                api.server = core.createServer({ name: "http", port: core.port, bind: core.bind, restart: restart, timeout: core.timeout }, api.handleServerRequest);
            }

            // Start SSL server
            if (core.ssl.port && (core.ssl.key || core.ssl.pfx)) {
                api.sslServer = core.createServer({ name: "https", ssl: core.ssl, port: core.ssl.port, bind: core.ssl.bind, restart: restart, timeout: core.timeout }, api.handleServerRequest);
            }

            // WebSocket server, by default uses the http port
            if (core.ws.port) {
                var server = core.ws.port == core.port ? api.server : core.ws.port == core.ssl.port ? api.sslServer : null;
                var opts = { ssl: core.ws.ssl ? core.ssl : null, port: core.ws.port, bind: core.ws.bind, restart: restart };
                if (!server) server = core.createServer(opts, function(req, res) { res.status(200).send("OK"); });
                if (server) {
                    var ws = require("ws");
                    opts = { server: server, verifyClient: function(data, callback) { api.checkWebSocketRequest(data, callback); } };
                    if (core.ws.path) opts.path = core.ws.path;
                    api.wsServer = new ws.Server(opts);
                    api.wsServer.serverName = "ws";
                    api.wsServer.serverPort = core.ws.port;
                    api.wsServer.on("error", function(err) { logger.error("api.init: ws:", lib.traceError(err))});
                    api.wsServer.on('connection', function(socket) { api.handleWebSocketConnect(socket); });
                }
            }

            // Notify the master about new worker server
            ipc.sendMsg("api:ready", { id: cluster.isWorker ? cluster.worker.id : process.pid, port: core.port, ready: true });

            callback.call(api);
        });
        api.exiting = false;
    });
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    if (this.exiting) return;
    if (typeof callback != "function") callback = lib.noop;
    this.exiting = true;
    logger.log('api.shutdown: started');
    var timeout = callback ? setTimeout(callback, api.shutdownTimeout || 30000) : null;

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: cluster.isWorker ? cluster.worker.id : process.pid, pid: process.pid, port: core.port });

    var closing = 0;
    lib.series([
        function(next) {
            lib.forEach([ api.wsServer, api.server, api.sslServer ], function(server, next2) {
                if (!server) return next2();
                try {
                    closing++;
                    server.on("close", function() { closing--; logger.info("api.shutdown:", "closed", server.serverName, closing) });
                    server.close();
                } catch(e) {
                    closing--;
                    logger.error("api.shutdown:", e.stack);
                }
                next2();
            }, next);
        },
        function(next) {
            var n = 0;
            function check() {
                if (!closing || ++n > 500) return next();
                setTimeout(check, 50);
            }
            check();
        },
    ], function(err) {
        core.runMethods("shutdownWeb", function() {
            clearTimeout(timeout);
            callback(err);
        })
    });
}

// Gracefully close all database pools when the shutdown is initiated by a Web process
api.shutdownWeb = function(options, callback)
{
    var pools = db.getPools();
    lib.forEachLimit(pools, pools.length, function(pool, next) {
        db.pools[pool.name].shutdown(function() { next() });
    }, callback);
}

// Setup access log stream
api.configureAccessLog = function()
{
    if (logger.syslog) {
        this.accessLog = new stream.Stream();
        this.accessLog.writable = true;
        this.accessLog.write = function(data) { logger.printSyslog('info:local5', data); return true; };
    } else
    if (this.accessLogFile) {
        this.accessLog = fs.createWriteStream(path.join(core.path.log, this.accessLogFile), { flags: 'a' });
        this.accessLog.on('error', function(err) { logger.error('accessLog:', err); api.accessLog = null; });
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
        logger.error('handleServerRequest:', core.port, req.path, lib.traceError(err));
        if (!res.headersSent) api.sendReply(res, err);
        if (api.exitOnError) api.shutdown(function() { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    if (process.version[1] == "0") return d.run(api.app.bind(api, req, res));
    d.run(api.app, req, res);
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
    this.setupSocketConnection(socket);

    socket.on("error", function(err) {
        logger.error("socket:", err);
    });

    socket.on("close", function() {
        api.closeWebSocketRequest(this);
        api.cleanupSocketConnection(this);
    });

    socket.on("message", function(url, flags) {
        api.createWebSocketRequest(this, url, function(data) { this.send(data); })
        api.handleServerRequest(this._requests[0], this._requests[0].res);
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
    req.res.end = function wsEnd(body) {
        reply.call(this.wsock, body);
        var idx = this.wsock._requests.indexOf(this.req);
        if (idx > -1) this.wsock._requests.splice(idx, 1);
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
    req.options = {
        ops: {},
        noscan: 1,
        ip: req.ip,
        host: req.hostname,
        path: path,
        apath: apath,
        secure: req.secure,
        mtime: Date.now(),
        cleanup: "bk_" + apath[0],
    };

    // Parse application version, extract first product and version only
    var uagent = req.headers['user-agent'];
    var v = req.query[this.appHeaderName] || req.headers[this.appHeaderName] || uagent;
    if (v && (v = v.match(/^([^\/]+)\/([0-9a-zA-Z_\.\-]+)\/?([a-zA-Z0-9_\.-]+)?/))) {
        req.options.appName = v[1];
        req.options.appVersion = v[2];
        req.options.appPlatform = v[3];
    }
    // Detect mobile platform
    if (uagent && !req.options.appPlatform) {
        for (var i in this.platformMatch) {
            if (this.platformMatch[i].rx.test(uagent)) {
                req.options.appPlatform = this.platformMatch[i].value;
                break;
            }
        }
    }
    // Core protocol version to be used in the request if supported
    req.options.appBuild = req.query[this.versionHeaderName] || req.headers[this.versionHeaderName] || "";
    // Timezone offset from UTC passed by the client, we just keep it, how to use it is up to the application
    req.options.appTimezone = lib.toNumber(req.query[this.tzHeaderName] || req.headers[this.tzHeaderName], { dflt: 0, min: -720, max: 720 }) * 60000;
    // Localization from the supplied language
    req.options.appLocale = req.query[this.langHeaderName] || req.headers[this.langHeaderName] || (req.headers['accept-language'] || "").toLowerCase().split(/[,;-]/)[0] || "";
    if (core.locales.length) {
        req.__ = lib.__.bind(req);
        req.res.locals.__ = req.res.__ = lib.__.bind(req.res);
        req.locale = req.options.appLocale;
        req.res.locale = req.options.appLocale;
    }
    logger.debug("prepareRequest:", req.options);
}

// This is supposed to be called at the beginning of request processing to start metrics and install the handler which
// will be called at the end to finalize the metrics and call the cleanup handlers
api.startMetrics = function(req, res, next)
{
    this.metrics.Histogram('api_que').update(this.metrics.Counter('api_nreq').inc());
    var timer = this.metrics.Timer('api_req').start();
    var end = res.end;
    res.end = function endMetrics(chunk, encoding) {
        timer.end();
        res.end = end;
        res.end(chunk, encoding);
        api.handleMetrics(req, timer.elapsed);
        api.handleCleanup(req);
    }
    next();
}

// Finish metrics collection about the current rquest
api.handleMetrics = function(req, elapsed)
{
    this.metrics.Counter('api_nreq').dec();
    this.metrics.Counter("api_req_0").inc();
    this.metrics.Counter("api_" + req.res.statusCode + "_0").inc();
    var path = "url_" + req.options.apath.slice(0, this.urlMetrics[req.options.apath[0]] || 2).map(function(x) { return x.replace("_", "__")}).join("_");

    // Path counters, total and errors
    if (req.res.statusCode >= 200 && req.res.statusCode < 300) {
        this.metrics.Counter(path +'_0').inc();
        if (elapsed > 0) this.metrics.Timer(path).update(elapsed);
    }
    if (req.res.statusCode >= 400 && req.res.statusCode < 500) {
        this.metrics.Counter("api_bad_0").inc();
        // Ignore unknown requests so we do not waste memory with timers
        if (req.res.statusCode != 404) this.metrics.Counter(path +'_bad_0').inc();
    }
    if (req.res.statusCode >= 500) {
        this.metrics.Counter("api_err_0").inc();
        this.metrics.Counter(path + "_err_0").inc();
    }
}

// Call registered cleanup hooks and clear the request explicitly
api.handleCleanup = function(req)
{
    var hooks = this.findHook('cleanup', req.method, req.options.path);
    lib.forEachSeries(hooks, function(hook, next) {
        logger.debug('cleanup:', req.method, req.options.path, hook.path);
        hook.callback.call(api, req, function() { next() });
    }, function() {
        for (var p in req) {
            if ((p[0] == "_" && p[1] == "_") || api.requestCleanup.indexOf(p) > -1) {
                for (var c in req[p]) delete req[p][c];
                if (!lib.isObject(req[p])) delete req[p];
            }
        }
        for (var p in req.files) {
            if (req.files[p] && req.files[p].path) {
                fs.unlink(req.files[p].path, function(err) { if (err) logger.error("cleanup:", err); });
            }
        }
    });
}

// Parse incoming query parameters
api.checkQuery = function(req, res, next)
{
    if (req._body) return next();
    req.body = req.body || {};
    req.query = req.query || {};

    var sig = this.parseSignature(req);
    var clen = lib.toNumber(req.get("content-length"));
    if (clen > 0 && clen > this.uploadLimit * 2) {
        return next(lib.newError({ message: "too large", _msg: "unable to process the request, it is too large", status: 413, length: clen }));
    }

    var type = lib.strSplit(req.get("content-type"), ";")[0];
    switch (type) {
    case 'application/json':
    case 'application/x-www-form-urlencoded':
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (this.mimeBody.indexOf(type) == -1) return next();
        req.setEncoding('binary');
    }

    req._body = true;
    var buf = '', size = 0;

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > api.uploadLimit) {
            if (size > api.uploadLimit * 2) {
                return next(lib.newError({ message: "too large", _msg: "unable to process the request, it is too large", status: 413, length: clen }));
            }
            return buf = null;
        }
        buf += chunk;
    });
    req.on('end', function() {
        try {
            if (size > api.uploadLimit) {
                return next(lib.newError({ message: "too large", _msg: "cannot process the request, it is too large", status: 413, length: size }));
            }
            // Verify data checksum before parsing
            if (sig && sig.checksum && lib.hash(buf) != sig.checksum) {
                return next(lib.newError("invalid data checksum"));
            }
            switch (type) {
            case 'application/json':
                if (req.method != "POST") break;
                req.body = lib.jsonParse(buf, { datatype: "obj", logger: "debug" });
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
    if (req._body) return next();

    if ('GET' == req.method || 'HEAD' == req.method) return next();
    if (!req.is('multipart/form-data')) return next();
    for (var i in this.mimeIgnore) {
        if (req.is(this.mimeIgnore[i])) return next();
    }
    req._body = true;

    var form = new formidable.IncomingForm({ uploadDir: core.path.tmp, keepExtensions: true });
    var data = {}, files = {}, done;

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
    form.on('file', function(name, val) { ondata(name, val.toJSON(), files); });
    form.on('error', function(err) {
        next(err);
        done = true;
    });
    form.on('progress', function(bytesReceived, bytesExpected) {
        if (bytesExpected > api.uploadLimit) {
            next(lib.newError({ message: "too large", _msg: "cannot process the request, it is too large", status: 413, length: bytesExpected }));
            done = true;
        }
    });
    form.on('end', function() {
        if (done) return;
        try {
            req.body = qs.parse(data);
            req.files = files;
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

// Check if the current request must be re-routed to another endpoint
api.checkRouting = function(req)
{
    var path = req.path;
    // Change the url into a new one according to the reroute rule
    for (var p in this.routing) {
        if (this.routing[p].rx && this.routing[p].rx.test(path)) {
            logger.debug("checkRouting:", path, "switch to", p);
            path = p;
            var u = url.parse(req.url);
            u.pathname = path;
            u.path = null;
            req.signatureUrl = req.url;
            req.url = url.format(u);
            break;
        }
    }
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
    for (var i = 0; i < this.redirectUrl.length; i++) {
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

// Return true if the current user belong to the specified type, account type may contain more than one type
api.checkAccountType = function(account, type)
{
    if (!lib.isObject(account)) return false;
    account._types = lib.strSplit(account._types || account.type);
    if (Array.isArray(type)) return type.some(function(x) { return account._types.indexOf(x) > -1 });
    return account._types.indexOf(type) > -1;
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
    if (typeof callback != "function") callback = lib.noop;
    if (!options || !options.type) return callback();

    switch (options.type) {
    case "ip":
        var rate = options.rate || this.rlimitsRate.ip || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimitsMax.ip || rate;
        var interval = options.interval || this.rlimitsInterval.ip || this.rlimits.interval || 1000;
        var key = 'TBip:' + (options.ip || req.options.ip);
        break;

    case 'path':
        var path = options.path || req.options.path;
        var rate = options.rate || this.rlimitsRate[path] || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimitsMax[path] || rate;
        var interval = options.interval || this.rlimitsInterval[path] || 1000;
        var key = 'TBreq:' + (options.ip || req.options.ip) + path;
        break;

    case "login":
        var rate = options.rate || this.rlimitsRate.login || 0;
        if (!rate) return callback();
        var sig = this.parseSignature(req);
        if (!sig || !sig.login) return callback();
        var max = options.max || this.rlimitsMax.login || rate;
        var interval = options.interval || this.rlimitsInterval.login || this.rlimits.interval || 1000;
        var key = 'TBlogin:' + sig.login;
        break;

    case "id":
        if (!req.account || !req.account.id) return callback();
        var rate = options.rate || req.account.rlimits_rate || this.rlimitsRate.id || 0;
        if (!rate) return callback();
        var max = options.max || req.account.rlimits_max || this.rlimitsMax.id || rate;
        var interval = options.interval || req.account.rlimits_interval || this.rlimitsInterval.id || 1000;
        var key = 'TBid:' + req.account.id;
        break;

    default:
        var rate = options.rate || this.rlimitsRate[options.type] || 0;
        if (!rate) return callback();
        var max = options.max || this.rlimitsMax[options.type] || rate;
        var interval = options.interval || this.rlimitsInterval[options.type] || this.rlimits.interval || 1000;
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
    ipc.limiter({ name: key, rate: rate, max: max, interval: interval, queueName: this.limiterQueue }, function(delay) {
        callback(!delay ? null : { status: 429, message: options.message || lib.__("Access limit reached, please try again later.") });
    });
}

// Register access rate limit for a given name, all other rate limit properties will be applied as described in the `checkRateLimits`
api.registerRateLimits = function(name, rate, max, interval)
{
    if (!name) return false;
    if (rate > 0) this.rlimitsRate[name] = rate;
    if (max > 0) this.rlimitsMax[name] = max;
    if (interval > 0) this.rlimitsInterval[name] = interval;
    return true;
}

// Add special control parameters that will be recognized in the query and placed in the `req.options` for every request.
//
// Control params start with underscore and will be converted into the configured type according to the spec.
// The `options` is an object in the format that is used by `lib.toParams`, no default type is allowed, even for string
// it needs to be defined as { type: "string" }.
//
// No existing control parameters will be overridden, also care must be taken when defining new control parameters so they do not
// conflict with the existing ones.
//
// These are default common parameters that can be used by any module:
//  - `_count, _page, _tm, _sort, _select, _ext, _start, _token, _session, _format, _total, _encoding, _ops`
//
// These are the reserved names that cannot be used for parameters, they are defined by the engine for every request:
//   - `path, apath, ip, host, mtime, platform, cleanup, secure, noscan, appName, appVersion, appLocale, appTimezone, appBuild`
//
// NOTE: `noscan` is set to 1 in every request to prevent accidental full scans, this means it cannot be enabled via the API but any module
// can do it in the code if needed.
//
// Example:
//
//      mod.configureMiddleware = function(options, callback) {
//          api.registerControlParams({ notify: { type: "bool" }, level: { type: "int", min: 1, max: 10 } });
//          callback();
//      }
//
//      Then if a request arrives for example as `_notify=true&_level=5`, it will be parsed and placed in the `req.options`:
//
//      mod.configureWeb = function(options, callback) {
//
//         api.app.all("/send", function(req, res) {
//             if (req.options.notify) { ... }
//             if (req.options.level > 5) { ... }
//         });
//         callback()
//      }
api.registerControlParams = function(options)
{
    for (var p in options) {
        if (options[p] && options[p].type && typeof this.controls[p] == "undefined") this.controls[p] = options[p];
    }
}

// Convert query options into internal options, such options are prepended with the underscore to
// distinguish control parameters from the query parameters.
//
// For security purposes this is the only place that translates special control query parameters into the options properties,
// all the supported options are defined in the `api.controls` and can be used by the apps freely but with caution. See `registerControlParams`.
//
// if `controls` is an object it will be used to define additional control parameters or override existing ones for this request only. Same rules as for
// `registerControlParams` apply.
//
//         api.getOptions(req, { count: { min: 5, max: 100 } })
//
//
api.getOptions = function(req, controls)
{
    var opts = { prefix: "_", data: { token: { secret: this.getTokenSecret(req) } } };
    var params = lib.toParams(req.query, controls ? lib.objMerge(this.controls, controls) : this.controls, opts);
    if (!req.options) req.options = {};
    for (var p in params) req.options[p] = params[p];
    return req.options;
}

// Parse query parameters according to the `params`, optionally process control parameters if `controls` si specified, this call combines
// `lib.toParams()` with `api.getOptions`. Returns a query object or an error message, on success all controls will be set in the `req.options`
//
//        var query = api.getQuery(req, { q: { required: 1 } }, { _count: { type: "int", min: 10, max: 25 } });
//
api.getQuery = function(req, params, controls)
{
    var query = lib.toParams(req.query, params);
    if (typeof query != "string") this.getOptions(req, controls);
    return query;
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
//  - admins property means visible to admins and owners only
//
// options may be used to define the following properties:
//  - skip - a regexp with names to be excluded as well
//  - allow - a list of properties which can be checked along with the `pub` property for a column to be considered public
//
//    api.getPublicColumns("bk_account", { allow: ["admins"], skip: /device_id|0$/ });
//
api.getPublicColumns = function(table, options)
{
    var allow = [ "pub" ];
    if (options && options.allow) allow = allow.concat(options.allow);
    var cols = db.getColumns(table, options);
    return Object.keys(cols).filter(function(x) {
        if (options && util.isRegExp(options.skip) && options.skip.test(x)) return false;
        for (var i in allow) if (cols[x][allow[i]]) return true;
        return false;
    });
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
// If any column is marked with `admin` or `admins` property and the current account is an admin this property will be returned as well. The `options.admin`
// can be used to make it an artificial admin.
//
// The `options.cleanup_strict` will enforce that all columns not present in the table definition will be skipped as well, by default all
// new columns or columns created on the fly are returned to the client.
//
// The `options.cleanup_rules` can be an object with property names and the values -1, 0, or 1 which correspond to:
// -1 - never return, 0 return only to the owner, 1 always return.
//
// The `options.pool` property must match the actual rowset to be applied properly, in case the records have been retrieved for the different
// database pool.
api.checkResultColumns = function(table, data, options)
{
    if (!table || !data) return;
    if (!options) options = {};
    var cols = {}, row;
    var rules = options.cleanup_rules || lib.empty;
    var key = options.account_key || 'id';
    var aid = options.account && options.account.id || "";
    var admin = options.admin || this.checkAccountType(options.account, "admin") ? 1 : 0;
    var tables = lib.strSplit(table);
    for (var i = 0; i < tables.length; i++) {
        var c = db.getColumns(tables[i], options);
        for (var p in c) {
            cols[p] = typeof rules[p] != "undefined" ? rules[p] : c[p].pub ? 1 : c[p].secure ? -1 : c[p].admin || c[p].admins ? admin : 0;
        }
    }
    if (!Object.keys(cols).length) return data;
    var rows = Array.isArray(data) ? data : [ data ];
    logger.debug("checkResultColumns:", table, cols, rows.length, aid, admin, options);
    for (var i = 0; i < rows.length; i++) {
        // For personal records, skip only special columns
        row = rows[i];
        var owner = aid == row[key];
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
    return data;
}

// Clear request query properties specified in the table definition, if any columns for the table contains the property `name` nonempty, then
// all request properties with the same name as this column name will be removed from the query. This for example is used for the `bk_auth`
// table to disable updating properties by the user which can only be set by an admin.
//
// There can be more than one name specified
//
// If a name is prefixed with ! then the logic is reversed, keep all except this name
//
//  Example:
//
//        api.clearQuery("bk_account", req.query, "admin")
//        api.clearQuery("bk_account", req.query, ""admin", "secure")
//        api.clearQuery("bk_account", req.query, "admin", "!secure")
//
api.clearQuery = function(table, query, name)
{
    var cols = db.getColumns(table), reverse;
    for (var i = 2; i < arguments.length; i++) {
        name = arguments[i];
        if (!name) continue;
        if (name[0] == "!") {
            reverse = 1;
            name = name.substr(1);
        } else {
            reverse = 0;
        }
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
//    with the callback with status: and message: properties, status != 200 means error,
//    status == 0 means continue processing, ignore this match
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
// - callback is a function(req, status, cb) where status is an object { status:..., message: ..} passed from the checkRequestSignature call, if status != 200 it means
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
// Note: the `req.account,req.options,req.query` objects may become empty if any callback decided to do some async action, they are explicitly emptied at the end of the request,
// in such cases make a copy of the needed objects if it will needed
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
    if (!options || !options.clientID || !options.clientSecret) return;

    var passport = require("passport");
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
        var cb = options.fetchAccount || api.fetchAccount;
        if (typeof cb != "function") return done(lib.newError("OAuth login is not configured"));
        var query = {};
        query.login = profile.provider + ":" + profile.id;
        query.secret = lib.uuid();
        query.name = profile.displayName;
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
        cb.call(api, query, options, function(err, user) {
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
                api.handleSessionSignature(req, options);
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
        try {
            sent = hook.callback.call(api, req, req.res, rows);
        } catch(e) {
            logger.error('sendJSON:', req.options.path, e.stack);
        }
        logger.debug('sendJSON:', req.method, req.options.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, function(err) {
        if (sent || req.res.headersSent) return;
        // Keep only public columns for the combination of all tables specified
        if (req.options.cleanup) {
            api.checkResultColumns(req.options.cleanup, rows && rows.count && rows.data ? rows.data : rows, req.options);
        }
        req.res.json(rows);
    });
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
        req.res.status(200).send(xml);
        break;

    case "csv":
        if (req.options.cleanup) this.checkResultColumns(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        var rows = Array.isArray(data) ? data : (data.data || lib.emptylist);
        var csv = Object.keys(rows[0]).join(options.separator || "|") + "\n";
        csv += lib.toFormat(options.format, rows, options);
        req.res.set('Content-Type', 'text/csv');
        req.res.status(200).send(csv);
        break;

    case "json":
        if (req.options.cleanup) this.checkResultColumns(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
        csv += lib.toFormat(options.format, data, options);
        req.res.set('Content-Type', 'text/plain');
        req.res.status(200).send(csv);
        break;

    default:
        this.sendJSON(req, err, data);
    }
}

// Return reply to the client using the options object, it contains the following properties:
// - status - defines the respone status code
// - message  - property to be sent as status line and in the body
// - type - defines Content-Type header, the message will be sent in the body
// - url - for redirects when status is 301 or 302
//
// **i18n Note:**
//
// The API server attaches fake i18n functions `req.__` and `res.__` which are used automatically for the `message` property
// before sending the response.
//
// With real i18n module these can/will be replaced performing actual translation without
// using `i18n.__` method for messages explicitely in the application code for `sendStatus` or `sendReply` methods.
//
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
                res.status(options.status).send(res.__(options.message || ""));
            } else {
                for (var p in options) {
                    if (typeof options[p] == "string") options[p] = res.__(options[p]);
                }
                res.status(options.status).json(options);
            }
        }
    } catch(e) {
        logger.error('sendStatus:', res.req.url, e.stack);
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
    if (util.isError(status)) {
        // Do not show runtime errors
        if (status.message && !String(status.message).match(this.errlogLimiterIgnore)) {
            if (!this.errlogLimiterToken || this.errlogLimiterToken.consume(1)) {
                logger.error("sendReply:", res.req.url, status.message, res.req.headers, lib.objDescr(res.req.query), lib.traceError(status), (new Error()).stack);
            }
        }
        text = status._msg ? res.__(status._msg) : this.errorMessage || res.__("Internal error occured, please try again later");
        status = status.status > 0 ? status.status : 500;
        return this.sendStatus(res, { status: status || 200, message: String(text || "") });
    }
    if (status instanceof Object) {
        status.status = status.status > 0 ? status.status : 200;
        return this.sendStatus(res, status);
    }
    if (typeof status == "string" && status) {
        text = status;
        status = 500;
    }
    this.sendStatus(res, { status: status || 200, message: String(text || "") });
}

// Send file back to the client, res is Express response object
api.sendFile = function(req, file, redirect)
{
    fs.stat(file, function(err) {
        if (req.method == 'HEAD') return req.res.sendStatus(!err ? 200 : 404);
        if (!err) return req.res.sendFile(file, { root: core.home });
        if (redirect) return req.res.redirect(redirect);
        req.res.sendStatus(404);
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

    if (!options) options = {};
    req.msgKey = options.key || req.account.id;
    // Ignore not matching events, the whole string is checked
    req.msgMatch = options.match ? new RegExp(options.match) : null;
    req.msgInterval = options.subscribeInterval || this.subscribeInterval;
    req.msgTimeout = options.timeoput || this.subscribeTimeout;
    ipc.subscribe(req.msgKey, function(k, d, n) { api.sendEvent(req, k, d, n); });

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

// Process a message received from subscription server or other event notifier, it is used by `api.subscribe` method for delivery events to the clients
api.sendEvent = function(req, key, data, next)
{
    logger.debug('subscribe:', key, data, 'sent:', req.res.headersSent, 'match:', req.msgMatch, 'timeout:', req.msgTimeout);
    // If for any reasons the response has been sent we just bail out
    if (req.res.headersSent) {
        ipc.unsubscribe(key);
        return next && next();
    }

    if (typeof data != "string") data = lib.stringify(data);
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
