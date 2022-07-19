//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const stream = require('stream');
const util = require('util');
const fs = require('fs');
const cluster = require('cluster');
const cookieParser = require('cookie-parser');
const url = require('url');
const domain = require('domain');
const qs = require("qs");
const mime = require("mime");
const formidable = require('formidable');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const db = require(__dirname + '/db');
const metrics = require(__dirname + '/metrics');
const logger = require(__dirname + '/logger');

// HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
// incorporates the Express server which is exposed as api.app object, the master server spawns Web workers which perform actual operations and monitors
// the worker processes if they die and restart them automatically. How many processes to spawn can be configured via `-server-max-workers` config parameter.
//
// When an HTTP request arrives it goes over Express middleware, but before processing any registered routes there are several steps performed:
// - the `req` object which is by convention is a Request object, assigned with common backend properties to be used later:
//   - account - an empty object which will be filled after by signature verification method, if successful, properties from the `bk_user` table will be set
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
//      - appLocale - a language provided in the header
//      - apiVersion - app specific version provided in the header
// - access verification, can the request be satisfied without proper signature, i.e. is this a public request
// - autherization, check the signature and other global or account specific checks
// - when a API route found by the request url, it is called as any regular Connect middlware
//   - if there are registered pre processing callback they will be called during access or autherization phases
//   - if inside the route a response was returned using `api.sendJSON` method, registered post process callbacks will be called for such response
//

const api = {
    name: "api",
    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path" },
           { name: "images-s3", descr: "S3 bucket name where to store and retrieve images" },
           { name: "images-raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and account id in the image name" },
           { name: "images-s3-options", type: "json", logger: "warn", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
           { name: "images-ext", descr: "Default image extension to use when saving images" },
           { name: "images-mod", descr: "Images scaling module, sharp or default bkjs-wand" },
           { name: "files-raw", type: "bool", descr: "Return raw urls for the files, requires files-url to be configured. The path will reflect the actual 2 level structure and account id in the file name" },
           { name: "files-url", descr: "URL where files are stored, for cases of central file server(s), must be full URL with optional path" },
           { name: "files-s3", descr: "S3 bucket name where to store files uploaded with the File API" },
           { name: "max-request-queue", type: "number", min: 0, descr: "Max number of requests in the processing queue, if exceeds this value server returns too busy error" },
           { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
           { name: "access-log-file", descr: "File for access logging" },
           { name: "access-log-level", type: "int", descr: "Syslog level priority, default is local5.info, 21 * 8 + 6" },
           { name: "access-log-fields", array: 1, type: "list", descr: "Additional fields from the request or account to put in the access log, prefix defines where the field is lcoated: q: - query, h: - headers, a: - account otherwise from the request, Example: -api-log-fields h:Referer,a:name,q:action" },
           { name: "salt", descr: "Salt to be used for scrambling credentials or other hashing activities" },
           { name: "qs-options-(.+)", autotype: 1, obj: "qsOptions", strip: "qs-options-", nocamel: 1, descr: "Options to pass to qs.parse: depth, arrayLimit, allowDots, comma, plainObjects, allowPrototypes, parseArrays" },
           { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
           { name: "static-options-(.+)", autotype: 1, obj: "staticOptions", strip: "static-options-", nocamel: 1, descr: "Options to pass to serve-static module: maxAge, dotfiles, etag, redirect, fallthrough, extensions, index, lastModified" },
           { name: "vhost-path-([^/]+)", type: "regexp", obj: "vhostPath", nocamel: 1, strip: "vhost-path-", regexp: "i", descr: "Define a virtual host regexp to be matched against the hostname header to serve static content from a different root, a vhost path must be inside the web directory, if the regexp starts with !, that means negative match, example: api-vhost-path-test_dir=test.com$" },
           { name: "no-vhost-path", type: "regexpobj", descr: "Add to the list of URL paths that should be served for all virtual hosts" },
           { name: "templating", descr: "Templating engine to use, see consolidate.js for supported engines, the 'consolidate' package must be installed to use this" },
           { name: "no-session", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
           { name: "session-age", type: "int", min: 0, descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-domain-(.+)", type: "regexp", obj: "session-domain", nocamel: 1, regexp: "i", descr: "Cookie domain by Host: header, if not matched session is bound to the exact host only, example: -api-session-domain-site.com=site.com$" },
           { name: "session-same-site", descr: "Session SameSite option, for cookie based authentication" },
           { name: "session-cache", descr: "Cache name for session control" },
           { name: "query-token-secret", descr: "Name of the property to be used for encrypting tokens for pagination or other sensitive data, any property from bk_user can be used, if empty no secret is used, if not a valid property then it is used as the secret" },
           { name: "app-header-name", descr: "Name for the app name/version query parameter or header, it is can be used to tell the server about the application version" },
           { name: "version-header-name", descr: "Name for the access version query parameter or header, this is the core protocol version that can be sent to specify which core functionality a client expects" },
           { name: "no-cache-files", type: "regexpobj", descr: "Set cache-control=no-cache header for matching static files", },
           { name: "tz-header-name", descr: "Name for the timezone offset header a client can send for time sensitive requests, the backend decides how to treat this offset" },
           { name: "signature-header-name", descr: "Name for the access signature query parameter, header and session cookie" },
           { name: "lang-header-name", descr: "Name for the language query parameter, header and session cookie, primary language for a client" },
           { name: "signature-age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
           { name: "access-time-interval", type: "int", min: 0, descr: "Intervals to refresh last access time for accounts, only updates the cache if `bk_user` is configured to be cached" },
           { name: "access-token-secret", descr: "A generic secret to be used for API access or signatures" },
           { name: "disable-session", type: "regexpobj", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "disable-session-acl", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-disable-session` parameter" },
           { name: "allow-authenticated", type: "regexpobj", descr: "Add URLs which can be accessed by any authenticated user account, can be partial urls or Regexp, it is checked before any other account types, if matched then no account specific paths will be checked anymore(any of the allow-account-...)" },
           { name: "allow-acl-authenticated", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-allow-authenticated` parameter" },
           { name: "allow-admin", type: "regexpobj", descr: "Add URLs which can be accessed by admin accounts only, can be partial urls or Regexp" },
           { name: "allow-acl-admin", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-allow-admin` parameter" },
           { name: "allow-account-([a-z0-9_]+)", type: "regexpobj", obj: "allow-account", descr: "Add URLs which can be accessed by specific account type, can be partial urls or Regexp" },
           { name: "allow-acl-([a-z0-9_]+)", type: "rlist", obj: "allow-acl", descr: "Combine regexps from the specified acls for allow checks for the specified account type" },
           { name: "only-account-([a-z0-9_,]+)", type: "regexpobj", obj: "only-account", descr: "Add URLs which can be accessed by specific account type only, can be partial urls or Regexp" },
           { name: "only-acl-([a-z0-9_,]+)", type: "rlist", obj: "only-acl", descr: "Combine regexps from the specified acls allowed for the specified account type only" },
           { name: "deny-authenticated", type: "regexpobj", descr: "Add URLs which CAN NOT be accessed by any authenticated user account, can be partial urls or Regexp, it is checked before any other account types, if matched then no account specific paths will be checked anymore(any of the deny-account-...)" },
           { name: "deny-acl-authenticated", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-deny-authenticated` parameter" },
           { name: "deny-account-([a-z0-9_]+)", type: "regexpobj", obj: "deny-account", descr: "Add URLs which CAN NOT be accessed by specific account type, can be partial urls or Regexp, this is checked before any allow parameters" },
           { name: "deny-acl-([a-z0-9_]+)", type: "list", obj: "deny-acl", descr: "Combine regexps from the specified acls for deny checks for the specified account type" },
           { name: "acl-([a-z0-9_]+)", type: "regexpobj", obj: "acl", descr: "Add URLs to the named ACL which can be used in allow/deny rules per account" },
           { name: "allow", type: "regexpobj", set: 1, descr: "Regexp for URLs that dont need credentials, replaces the whole access list" },
           { name: "allow-path", type: "regexpobj", key: "allow", descr: "Add to the list of allowed URL paths without authentication, adds to the `-api-allow` parameter" },
           { name: "allow-acl", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-allow` parameter" },
           { name: "deny", type: "regexpobj", set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list" },
           { name: "deny-path", type: "regexpobj", key: "deny", descr: "Add to the list of URL paths to be denied without authentication, adds to the `-api-deny` parameter" },
           { name: "deny-acl", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-api-deny` parameter" },
           { name: "allow-anonymous", type: "regexpobj", descr: "Add to the list of allowed URL paths that can be served with or without valid account, the difference with `-api-allow-path` is that it will check for signature and an account but will continue if no login is provided, return error in case of wrong account or not account found" },
           { name: "allow-acl-anonymous", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-allow-anonymous` parameter" },
           { name: "allow-empty", type: "regexpobj", descr: "Regexp for URLs that should return empty responses if not found, for example return nothing for non-existent javascript files or css files" },
           { name: "ignore-allow", type: "regexpobj", descr: "Regexp for URLs that should be ignored by the allow rules, the processing will continue" },
           { name: "ignore-allow-path", type: "regexpobj", key: "ignore-allow", descr: "Add to the list of URL paths which should be ignored by the allow rules, in order to keep allow/deny rules simple, for example to keep some js files from open to all: -allow-path \\.js -ignore-allow-path /secure/" },
           { name: "ignore-allow-acl", type: "list", descr: "Combine regexps from the specified acls for the check explained by `-ignore-allow-path` parameter" },
           { name: "allow-ip", type: "regexpobj", descr: "Add to the list of regexps for IPs that dont need credentials. It is checked before endpoint access list" },
           { name: "deny-ip", type: "regexpobj", descr: "Add to the list of regexps for IPs that will be denied access. It is checked before endpoint access list." },
           { name: "path-errmsg-(.+)", type: "regexpobj", obj: "path-errmsg", reverse: 1, descr: "Error message to return for the specified path for authentication failures" },
           { name: "acl-errmsg-([a-z0-9_]+)", obj: "acl-errmsg", descr: "Error message to return for the specified acl for authentication failures" },
           { name: "allow-ssl", type: "regexpobj", descr: "Add to the list of allowed locations using HTTPs only, plain HTTP requests to these urls will be refused" },
           { name: "ignore-ssl", type: "regexpobj", descr: "Allow plain HTTP from matched IP addresss or locations" },
           { name: "redirect-ssl", type: "regexpobj", descr: "Add to the list of the locations to be redirected to the same path but using HTTPS protocol, for proxy mode the proxy server will perform redirects" },
           { name: "express-options", type: "json", logger: "warn", descr: "Set Express config options during initialization,example: `-api-express-options { \"trust proxy\": 1, \"strict routing\": true }`" },
           { name: "mime-body", type: "regexpobj", descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "mime-ignore", type: "regexpobj", descr: "Ignore the body for the following MIME content types, request body will not be parsed at all" },
           { name: "mime-map-(.+)", obj: "mime-map", descr: "File extension to MIME content type mapping, this is used by static-serve, example: -api-mime-map-mobileconfig application/x-apple-aspen-config" },
           { name: "ignore-content-type", type: "regexpobj", descr: "Ignore the content type for the following endpoint paths, keep the body unparsed" },
           { name: "platform-match", type: "regexpmap", regexp: "i", descr: "An JSON object with list of regexps to match user-agent header for platform detection, example: { 'ios|iphone|ipad': 'ios', 'android': 'android' }" },
           { name: "cors-origin", descr: "Origin header for CORS requests" },
           { name: "cors-allow", type: "regexpobj", descr: "Enable CORS requests if a request host/path matches the given regexp" },
           { name: "server-header", descr: "Custom Server: header to return for all requests" },
           { name: "error-message", descr: "Default error message to return in case of exceptions" },
           { name: "restart", descr: "On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts" },
           { name: "allow-error-code", type: "regexpobj", descr: "Error codes in exceptions to return in the response to the user, if not matched the error-message will be returned" },
           { name: "rlimits-(rate|max|interval|ttl|ip)-(.+)", type: "int", obj: "rlimitsMap.$2", make: "$1", descr: "Rate limiter parameters for Token Bucket algorithm. `ttl` is to expire cache entries, `ip` is to limit by IP address as well, ex. -api-rlimits-ip-ip=10, -api-rlimits-rate-/path=1" },
           { name: "rlimits-queue-(.+)", obj: "rlimitsMap.$1", make: "queue", descr: "Queue to use for the given path" },
           { name: "rlimits-(interval|ttl)", type: "int", obj: "rlimits", make: "$1", descr: "Default rate limiter parameters, default interval is 1s, `ttl` is to expire old cache entries" },
           { name: "rlimits-message", obj: "rlimits", descr: "Message to show when any limits reached" },
           { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
           { name: "upload-limit", type: "number", descr: "Max size for uploads, bytes" },
           { name: "query-limit", type: "number", descr: "Max size for posts and queries, bytes" },
           { name: "limiter-queue", descr: "Name of an ipc queue for API rate limiting" },
           { name: "errlog-limiter-max", type: "int", descr: "How many error messages to put in the log before throttling kicks in" },
           { name: "errlog-limiter-interval", type: "int", descr: "Interval for error log limiter, max errors per this interval" },
           { name: "errlog-limiter-ignore", type: "regexpobj", descr: "Do not show errors that match the regexp" },
           { name: "proxy-reverse", type: "url", descr: "A Web server where to proxy requests not macthed by the url patterns or host header, in the form: http://host[:port]" },
           { name: "proxy-url-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'proxy-url', descr: "URL regexp to be passed to other web server running behind, each parameter defines an url regexp and the destination in the value in the form http://host[:port], example: -api-proxy-url-^/api http://127.0.0.1:8080" },
           { name: "proxy-host-(.+)", type: "regexpobj", reverse: 1, obj: 'proxy-host', lower: /.+/, descr: "Virtual host mapping, to match any Host: header, each parameter defines a host name and the destination in the value in the form http://host[:port], example: -api-proxy-host-www.myhost.com http://127.0.0.1:8080" },
           { name: "routing-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'routing', descr: "Locations to be re-routed to other path, this is done inside the server at the beginning, only the path is replaced, same format and placeholders as in redirect-url, use ! in front of regexp to remove particular redirect from the list, example: -api-routing-^/account/get /acount/read" },
           { name: "ignore-routing", type: "regexpobj", descr: "Ignore locations from the routing" },
           { name: "auth-routing-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: 'auth-routing', descr: "URL path to be re-routed to other path after the authentication is successful, this is done inside the server, only the path is replaced, same format and placeholders as in redirect-url, example: -api-routing-auth-^/account/get /acount/read" },
           { name: "redirect-url", type: "regexpmap", descr: "Add to the list a JSON object with property name defining a location regexp to be matched early against in order to redirect using the value of the property, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location, example: { '^[^/]+/path/$': '/path2/index.html', '.+/$': '301:@PATH@/index.html' } " },
           { name: "login-redirect-(.+)", type: "regexpobj", reverse: 1, nocamel: 1, obj: "login-redirect", descr: "Define a location where to redirect if no login is provided, same format and placeholders as in redirect-url, example: api-login-redirect-^/admin/=/login.html" },
           { name: "auth-status", type: "int", descr: "Default authenticated status, if no auth rules matched but valid signature this is the status returned" },
           { name: "auth-message:", descr: "Default authenticated message to be returned the default auth status" },
           { name: "reset-acl", type: "callback", callback: function(v) { if (v) this.resetAcl() }, descr: "Reset all ACL related rules and permissions" },
           { name: "response-headers", type: "regexpmap", json: 1, descr: "An JSON object with list of regexps to match against the location and set response headers defined as a ist of pairs name, value..., api-response-headers={ \"^/\": [\"x-frame-options\",\"sameorigin\",\"x-xss-protection\",\"1; mode=block\"] }" },
           { name: "cleanup-rules-(.+)", obj: "cleanup-rules", type: "map", datatype: "auto", nocamel: 1, descr: "Rules for the cleanupResult per table, ex. api-cleanup-rules-bk_user=email:0,phone:1" },
           { name: "request-cleanup", type: "list", array: 1, descr: "List of fields to explicitely cleanup on request end" },
    ],

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the account has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: {},

    // No authentication for these urls
    allow: {},
    ignoreAllow: {},
    allowEmpty: {},
    // Only for admins
    allowAdmin: {},
    // Allow/deny by account type
    allowAccount: {},
    allowAcl: {},
    allowAnonymous: {},
    allowAuthenticated: {},
    onlyAccount: {},
    onlyAcl: {},
    denyAccount: {},
    denyAcl: {},
    denyAuthenticated: {},
    acl: {},
    // Allow only HTTPS requests
    allowSsl: {},
    ignoreSsl: {},
    redirectSsl: {},
    // Refuse access to these urls
    deny: {},
    // IP access lists
    allowIp: {},
    denyIp: {},
    // Default authenticated access
    authStatus: 200,
    authMessage: "ok",
    pathErrmsg: {},
    aclErrmsg: {},
    // Rate limits
    rlimitsMap: {},
    rlimits: {
        ttl: 86400000,
        message: "Access limit reached, please try again later.",
    },
    // Global redirect rules, each rule must match host/path to be redirected
    redirectUrl: [],
    routing: {},
    authRouting: {},
    loginRedirect: {},
    responseHeaders: [],
    rxSignature: /([^|]+)\|([^|]*)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]*)/,

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    filesS3: '',
    imagesExt: "jpg",

    disableSession: {},
    expressOptions: {},

    // All listening servers
    servers: [],

    // Proxy target
    proxyUrl: {},
    proxyHost: null,
    proxyWorkers: [],

    // Upload limit, bytes
    queryLimit: 128*1024,
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 1800000,
    subscribeInterval: 1000,

    // Collect body MIME types as binary blobs
    mimeMap: {},
    qsOptions: {},

    // Static content options
    staticOptions: {
        maxAge: 3600 * 1000,
        setHeaders: function(res, file) {
            var ext = path.extname(file), type = core.modules.api.mimeMap[ext.substr(1)];
            if (type) res.setHeader("content-type", type);
            if (lib.testRegexpObj(file, core.modules.api.noCacheFiles)) {
                res.setHeader("cache-control", "max-age=0, no-cache, no-store");
            }
        }
    },
    vhostPath: {},
    noVhostPath: {},
    noCacheFiles: {},

    // Web session age
    sessionAge: 86400 * 14 * 1000,
    sessionSameSite: "strict",
    // How old can a signtature be to consider it valid, for clock drifts
    signatureAge: 0,
    signatureHeaderName: "bk-signature",
    appHeaderName: "bk-app",
    versionHeaderName: "bk-version",
    tzHeaderName: "bk-tz",
    langHeaderName: "bk-lang",
    accessTokenSecret: "",

    corsAllow: null,
    corsOrigin: "*",
    corsCredentials: true,
    corsMethods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'DELETE'],

    // Properties to be cleaned up on finish
    requestCleanup: ["options", "account", "signature", "body", "raw_body"],
    cleanupRules: {},

    // User agent patterns by platform
    platformMatch: lib.toRegexpMap(null, { "darwin|cfnetwork|iphone|ipad": "ios", "android": "android", }, { regexp: "i" }),

    restart: "master,server,web,process",

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

    maxRequestQueue: 0,
    limiterQueue: "local",

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
        apiVersion: { ignore: 1 },
        noscan: { ignore: 1 },
        total: { type: "bool" },
        session: { type: "bool" },
        format: { type: "string" },
        separator: { type: "string" },
        encoding: { type: "string" },
        page: { type: "int", dflt: 0, min: 0 },
        count: { type: "int", dflt: 32, min: 0, max: 999 },
        distance: { type: "number", min: 0, dflt: 1000, max: 999 },
        latitude: { type: "real", },
        longitude: { type: "real" },
        latlon: { type: "string", regexp: /^[0-9]+(\.[0-9]+)?,[0-9]+(\.[0-9]+)?$/ },
        tm: { type: "timestamp" },
        ext: { type: "string" },
        ops: { type: "map" },
        start: { type: "token" },
        token: { type: "token" },
        select: { type: "list" },
        desc: { type: "bool" },
        sort: { type: "string" },
        join: { type: "string" },
        joinOps: { type: "map" },
    },
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
    this.express = require('express');
    this.app = this.express();

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

    // Request parsers
    this.app.use(cookieParser());
    this.app.use(this.checkQuery.bind(this));
    this.app.use(this.checkBody.bind(this));

    // Config options for Express
    for (var p in this.expressOptions) {
        this.app.set(p, this.expressOptions[p]);
    }

    // Assign custom middleware just after the security handler, if the signature is disabled then the middleware
    // handler may install some other authentication module and in such case must setup `req.account` with the current user record
    core.runMethods("configureMiddleware", options, () => {

        // Check for access and authorization
        api.app.use(api.handleSignature.bind(api));

        // Setup routes from the loaded modules
        core.runMethods("configureWeb", options, (err) => {
            if (err) return callback.call(api, err);

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
                return res.set("Content-Type", mime.getType(req.options.path)).status(200).send();
            });

            // The last route is to return an error
            api.app.use(function apiErr(err, req, res, next) {
                api.sendReply(res, err);
            });

            api.configureServers();

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
    this.exiting = true;
    logger.log("api.shutdown:", core.role, "started");
    const timeout = typeof callback == "function" ? setTimeout(callback, api.shutdownTimeout || 30000) : null;

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: cluster.isWorker ? cluster.worker.id : process.pid, pid: process.pid, port: core.port });

    lib.forEach([ api.wsServer, api.server, api.sslServer ], (server, next) => {
        if (!server) return next();
        try {
            server.close();
            logger.log("api.shutdown:", core.role, "closed", server.serverName);
            next();
        } catch (e) {
            logger.error("api.shutdown:", core.role, "closed", server.serverName, e);
            next();
        }
    }, () => {
        clearTimeout(timeout);
        typeof callback == "function" && callback();
    }, true);
}

// Gracefully close all database pools when the shutdown is initiated by a Web process
api.shutdownWeb = function(options, callback)
{
    this.shutdown(() => {
        var pools = db.getPools();
        lib.forEachLimit(pools, pools.length, (pool, next) => {
            db.pools[pool.name].shutdown(() => (next()));
        }, callback, true);
    });
}

api.configureServers = function()
{
    // Start http server
    if (core.port) {
        api.server = core.createServer({
            name: "http",
            port: core.port,
            bind: core.bind,
            restart: api.restart,
            timeout: core.timeout,
            keepAliveTimeout: core.keepAliveTimeout,
            requestTimeout: core.requestTimeout,
            maxRequestsPerSocket: core.maxRequestsPerSocket,
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
            timeout: core.timeout,
            keepAliveTimeout: core.keepAliveTimeout,
            requestTimeout: core.requestTimeout,
            maxRequestsPerSocket: core.maxRequestsPerSocket,
        }, api.handleServerRequest);
    }

    // WebSocket server, by default uses the http port
    if (core.ws.port) api.createWebsocketServer();
}

// Templating and static paths
api.configureStatic = function()
{
    if (api.templating) {
        const consolidate = require('consolidate');
        api.app.engine('html', consolidate[api.templating]);
        api.app.set('view engine', 'html');
        // Use app specific views path if created even if it is empty
        api.app.set('views', core.path.views.concat([core.home + "/views", __dirname + '/../views']));
        logger.debug("templating:", api.templating, "views:", api.app.get("views"));
    }

    // Serve from default web location in the package or from application specific location
    if (!api.noStatic) {
        api.app.use(function apiVHost(req, res, next) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            if (lib.testRegexpObj(req.options.path, api.noVhostPath)) return next();
            for (const p in api.vhostPath) {
                if (lib.testRegexp(req.options.host, api.vhostPath[p])) {
                    req.url = "/" + p + req.options.path;
                    logger.debug("vhost:", req.options.host, "rerouting to", req.url);
                    break;
                }
            }
            next();
        });

        for (var i = 0; i < core.path.web.length; i++) {
            api.app.use(api.express.static(core.path.web[i], api.staticOptions));
        }
        api.app.use(api.express.static(__dirname + "/../web", api.staticOptions));
        logger.debug("static:", core.path.web, __dirname + "/../web");
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
        if (!api.accessLog) return;
        var now = new Date();
        var line = req.options.ip + " - " +
                   (this.accessLogFile ? '[' + now.toUTCString() + ']' : "-") + " " +
                   req.method + " " +
                   (req.accessLogUrl || req.originalUrl || req.url) + " " +
                   (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                   res.statusCode + " " +
                   (res.get("Content-Length") || '-') + " - " +
                   (now - startTime) + " ms - " +
                   (req.query[api.appHeaderName] || req.headers[api.appHeaderName] || req.headers['user-agent'] || "-") + " " +
                   (req.account.id || "-");
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
}

api.startServerRequest = function(req, res, next)
{
    // Fake i18n methods
    req.__ = res.__ = res.locals.__ = lib.__;

    // Request queue size
    if (api.maxRequestQueue && api.metrics.Counter("api_nreq").toJSON() >= api.maxRequestQueue) {
        api.metrics.Counter('full_0').inc();
        return api.sendReply(res, 503, "Server is unavailable");
    }
    // Setup request common/required properties
    api.prepareRequest(req);
    api.checkRouting(req, "routing", "ignoreRouting");

    // Rate limits by IP address and path, early before all other filters
    api.checkRateLimits(req, { type: ["ip","path","opath"] }, (err) => {
        if (!err) return next();
        api.metrics.Counter(err.type + '_0').inc();
        api.sendReply(res, err);
    });
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
        api.shutdown(function() { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    d.run(api.app, req, res);
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
        host: (req.hostname || "").toLowerCase(),
        domain: lib.domainName(req.hostname),
        path: path,
        apath: apath,
        secure: req.secure,
        mtime: Date.now(),
    };
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
    // Parse application version, extract first product and version only
    if (!req.options.appName || req.query[this.appHeaderName]) {
        var uagent = req.headers['user-agent'];
        var v = req.query[this.appHeaderName] || req.headers[this.appHeaderName] || uagent;
        if (v && (v = v.match(/^([^/]+)\/?([0-9a-zA-Z_.-]+)?\/?([a-zA-Z0-9_.-]+)?/))) {
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
    }

    // API protocol version to be used in the request if supported
    if (!req.options.apiVersion || req.query[this.versionHeaderName]) {
        req.options.apiVersion = req.query[this.versionHeaderName] || req.headers[this.versionHeaderName] || "";
    }

    // Timezone offset from UTC passed by the client, we just keep it, how to use it is up to the application
    if (!req.options.appTimezone || req.query[this.tzHeaderName]) {
        req.options.appTimezone = lib.toNumber(req.query[this.tzHeaderName] || req.headers[this.tzHeaderName], { dflt: 0, min: -720, max: 720 }) * 60000;
    }

    // Localization from the supplied language
    if (!req.options.appLocale || req.query[this.langHeaderName]) {
        req.options.appLocale = req.query[this.langHeaderName] || req.headers[this.langHeaderName] || (req.headers['accept-language'] || "").toLowerCase().split(/[,;-]/)[0] || "";
        req.locale = req.options.appLocale;
        if (req.res) req.res.locale = req.options.appLocale;
    }

    // Authorization user or token
    var auth = req.headers.authorization;
    if (auth) {
        var idx = auth.indexOf(" ");
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

const corsHeaders = ['content-type', api.signatureHeaderName, api.appHeaderName, api.versionHeaderName, api.langHeaderName, api.tzHeaderName].join(", ");
const corsMethods = api.corsMethods.join(", ");

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
        res.header('Access-Control-Allow-Headers', corsHeaders);
        res.header('Access-Control-Allow-Methods', corsMethods);
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
    location = api.checkRedirect(req, req.options);
    if (location) return api.sendStatus(res, location);

    next();
}

// This is supposed to be called at the beginning of request processing to start metrics and install the handler which
// will be called at the end to finalize the metrics and call the cleanup handlers
api.startMetrics = function(req, res, next)
{
    this.metrics.Histogram('api_que').update(this.metrics.Counter('api_nreq').inc());
    var timer = this.metrics.Timer('api_req').start();
    var end = res.end;
    res.end = function(chunk, encoding) {
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

    if (req.res.statusCode >= 400 && req.res.statusCode < 500) {
        this.metrics.Counter("api_bad_0").inc();
    }
    if (req.res.statusCode >= 500) {
        this.metrics.Counter("api_err_0").inc();
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
        for (const p in req) {
            if ((p[0] == "_" && p[1] == "_") || api.requestCleanup.indexOf(p) > -1) {
                for (const c in req[p]) delete req[p][c];
                if (!lib.isObject(req[p])) delete req[p];
            }
        }
        for (const p in req.files) {
            if (req.files[p] && req.files[p].path) {
                fs.unlink(req.files[p].path, function(err) { if (err) logger.error("cleanup:", err); });
            }
        }
    }, true);
}

// Parse incoming query parameters
api.checkQuery = function(req, res, next)
{
    if (req._body) return next();
    req.body = req.body || {};
    req.query = req.query || {};

    var type = lib.strSplit(req.get("content-type"), ";")[0];
    if (lib.testRegexpObj(type, this.mimeIgnore)) return next();

    switch (type) {
    case "text/json":
    case 'application/json':
    case 'application/x-www-form-urlencoded':
    case "text/xml":
    case "application/xml":
        req.setEncoding('utf8');
        break;

    default:
        // Custom types to be collected
        if (!lib.testRegexpObj(type, this.mimeBody)) return next();
        req.setEncoding('binary');
    }
    var clen = lib.toNumber(req.get("content-length"));
    if (clen > 0 && clen > this.queryLimit*2) {
        return next(lib.newError({ message: "too large", _msg: "Unable to process the request, it is too large", status: 413, length: clen }));
    }

    req._body = true;
    var buf = '', size = 0;
    var sig = this.getSignature(req);

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > api.queryLimit) {
            if (size > api.queryLimit * 2) {
                return next(lib.newError({ message: "too large", _msg: "Unable to process the request, it is too large", status: 413, maxsize: api.queryLimit, length: clen }));
            }
            buf = null;
        } else {
            buf += chunk;
        }
    });
    req.on('end', function() {
        try {
            if (size > api.queryLimit) {
                return next(lib.newError({ message: "too large", _msg: "Unable process the request, it is too large", status: 413, maxsize: api.queryLimit, length: size }));
            }
            // Verify data checksum before parsing
            if (sig?.checksum && lib.hash(buf) != sig.checksum) {
                return next(lib.newError("invalid data checksum"));
            }
            if (lib.testRegexpObj(req.options.path, api.ignoreContentType)) type = null;
            switch (type) {
            case "text/xml":
            case "application/xml":
                if (req.method != "POST") break;
                req.body = lib.xmlParse(buf, { datatype: "object", logger: "debug" });
                req.query = req.body;
                req.raw_body = buf;
                break;

            case "text/json":
            case "application/json":
                if (req.method != "POST") break;
                req.body = lib.jsonParse(buf, { datatype: "object", logger: "debug" });
                req.query = req.body;
                req.raw_body = buf;
                break;

            case "application/x-www-form-urlencoded":
                if (req.method != "POST") break;
                req.body = buf.length ? qs.parse(buf, api.qsOptions) : {};
                req.query = req.body;
                req.raw_body = buf;
                break;

            default:
                req.body = buf;
            }
            api.prepareOptions(req);
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

    if (req.method == 'GET' || req.method == 'HEAD') return next();
    var type = lib.strSplit(req.get("content-type"), ";")[0];
    if (lib.testRegexpObj(type, this.mimeIgnore)) return next();
    if (!req.is('multipart/form-data')) return next();

    req._body = true;

    var form = formidable({ uploadDir: core.path.tmp, keepExtensions: true, maxFileSize: api.uploadLimit, maxFieldsSize: api.queryLimit });
    var data = {}, files = {}, done;

    form.on('field',(name, val) => {
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
    form.once('error', (err) => {
        if (done) return;
        done = true;
        if (err && /maxFileSize/.test(err.message)) err._msg = "Cannot process the request, it is too large";
        next(err);
    });
    form.on('progress', (bytesReceived, bytesExpected) => {
        if (done) return;
        if (bytesExpected > api.uploadLimit) {
            done = true;
            next(lib.newError({ message: "too large", _msg: "Cannot process the request, it is too large", status: 413, maxsize: api.uploadLimit, length: bytesExpected }));
        }
    });
    form.once('end', () => {
        if (done) return;
        done = true;
        try {
            req.body = qs.parse(data, api.qsOptions);
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
            var u = url.parse(req.url);
            req.options.opath = req.options.path;
            u.pathname = req.options.path = this.checkRedirectPlaceholders(req, p);
            u.path = null;
            req.signatureUrl = req.url;
            req.url = url.format(u);
            req.options.apath = req.options.path.substr(1).split("/");
            logger.debug("checkRouting:", name, location, "switch to:", p, req.options.path);
            break;
        }
    }
}

// Replace redirect placeholders
api.checkRedirectPlaceholders = function(req, pathname)
{
    return pathname.replace(/@(HOST|DOMAIN|PATH([1-9])?|URL|BASE|FILE|DIR|SUBDIR|EXT|QUERY)@/g, function(_, m) {
        return m[0] == "H" ? req.options.host :
               m[0] == "N" ? lib.domainName(req.options.host) :
               m[0] == "P" ? m[4] > 0 ? req.options.apath.slice(m[4]).join("/") : req.options.path :
               m[0] == "I" ? req.options.ip :
               m[0] == "U" ? req.url :
               m[0] == "Q" ? qs.stringify(req.query) :
               m[0] == "F" ? path.basename(req.options.path) :
               m[0] == "E" ? path.extname(req.options.path) :
               m[0] == "S" ? path.dirname(req.options.path).split("/").pop() :
               m[0] == "D" ? path.dirname(req.options.path) :
               m[0] == "B" ? path.basename(req.options.path).split(".").shift() : "";
    });
}

// Check a request for possible redirection condition based on the configuration, this can be SSL checks or
// defined redirect rules. This is used by API servers and proxy servers for early redirections. It returns null
// if no redirects or errors happend, otherwise an object with status that is expected by the `api.sendStatus` method.
// The options is expected to contain the following cached request properties:
// - path - from req.path or the request pathname only
// - host - from req.hostname or the hostname part only
// - port - port from the host: header if specified
// - secure - if the protocol is https
api.checkRedirect = function(req, options)
{
    var url = req.url, location = options.host + url;
    // Auto redirect to SSL
    if (this.redirectSsl.rx) {
        if (!options.secure && (this.redirectSsl.rx.test(url) || this.redirectSsl.rx.test(location))) {
            return { status: 302, url: "https://" + options.host + url };
        }
    }
    // SSL only access, deny access without redirect
    if (this.allowSsl.rx) {
        if (!options.secure && (this.allowSsl.rx.test(url) || this.allowSsl.rx.test(location))) {
            if (!this.ignoreSsl.rx || !(this.ignoreSsl.rx.test(options.ip) || this.ignoreSsl.rx.test(options.path) || this.ignoreSsl.rx.test(location))) {
                return { status: 403, message: "This location requires SSL" };
            }
        }
    }
    return this.checkRedirectRules(req, options, "redirectUrl");
}

// Redirect rules, supports regexpobj and regexpmap parameters
api.checkRedirectRules = function(req, options, name)
{
    var url = req.url, location = options.host + url;
    var rules = this[name];
    for (var i in rules) {
        const rx = util.isRegExp(rules[i].rx) ? rules[i].rx : util.isRegExp(rules[i]) ? rules[i] : null;
        if (rx && (rx.test(url) || rx.test(location))) {
            let loc = !lib.isNumeric(i) ? i : rules[i].value || "";
            if (!loc) continue;
            var status = 302;
            if (loc[0]== "3" && loc[1] == "0" && loc[3] == ":") {
                status = lib.toNumber(loc.substr(0, 3), { dflt: 302 });
                loc = loc.substr(4);
            }
            loc = this.checkRedirectPlaceholders(req, loc);
            logger.debug("checkRedirectRules:", name, location, options.path, "=>", status, loc, "rule:", i, rules[i]);
            return { status: status, url: loc };
        }
    }
    return null;
}

// Perform rate limiting by specified property, if not given no limiting is done.
//
// The following options properties can be used:
//  - type - predefined: `ip,  path, opath`, determines by which property to perform rate limiting, when using account properties
//     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
//     custom type and used as is. If it is an array all items will be checked sequentially.
//     **This property is required.**
//
//     The predefined types checked for every request:
//     - ip - check every IP address
//     - opath - same as path but uses original path before routing
//     - path - limit number of requests for an API path by IP address, * can be used at the end to match only the beginning
//
//         -api-rlimits-rate-ip=100
//         -api-rlimits-rate-/api/path=2
//         -api-rlimits-ip-/api/path=1
//         -api-rlimits-rate-/api/path/*=1
//
//  - ip - to use the specified IP address
//  - max - max capacity to be used by default
//  - rate - fill rate to be used by default
//  - interval - interval in ms within which the rate is measured, default 1000 ms
//  - message - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
//  - queue - which queue to use instead of the default, some limits is more useful with global queues like Redis instead of the default
//
// The metrics are kept in the LRU cache in the master process by default.
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
    var opts = req.options || lib.empty;
    var ip = options.ip || opts.ip;
    lib.forEachSeries(types, (type, next) => {
        var name = type, key = type;
        switch (type) {
        case "ip":
            name = ip;
            break;

        case 'path':
        case 'opath':
            key = options[type] || opts[type];
            if (!key) break;
            if (!this.rlimitsMap[key]) {
                for (const p in this.rlimitsMap) {
                    if (p[p.length - 1] == "*" && p.slice(0, -1) == key.substr(0, p.length - 1)) {
                        key = p;
                        break;
                    }
                }
            }
            name = key + ip;
            break;
        }

        var map = this.rlimitsMap[key];
        var rate = options.rate || map?.rate;
        logger.debug("checkRateLimits:", type, key, name, options, map);
        if (!rate) return next();
        var max = options.max || map?.max || rate;
        var interval = options.interval || map?.interval || this.rlimits.interval || 1000;
        var ttl = options.ttl || map?.ttl || this.rlimits.ttl;
        var queue = options.queue || map?.queue || this.limiterQueue;

        // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
        // in master mode use direct access to the LRU cache
        var limit = { name: "TB:" + name, rate: rate, max: max, interval: interval, ttl: ttl, queueName: queue };
        ipc.limiter(limit, (delay, info) => {
            if (!delay) return next();
            logger.debug("checkRateLimits:", options, limit, info);
            callback({ status: 429, message: options.message || lib.__(api.rlimits.message) }, info);
        });
    }, callback, true);
}

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
// If err is not null the error message is returned immediately.
api.sendJSON = function(req, err, rows)
{
    if (err) return this.sendReply(req.res, err);

    // Do not cache API results by default, routes that send directly have to handle cache explicitely
    if (!req.res.get("cache-control")) {
        req.res.header("pragma", "no-cache");
        req.res.header("cache-control", "max-age=0, no-cache, no-store");
        req.res.header('last-modified', new Date().toUTCString());
    }

    if (!rows) rows = [];
    var sent = 0;
    var hooks = this.findHook('post', req.method, req.options.path);
    lib.forEachSeries(hooks, function(hook, next) {
        try {
            sent = hook.callback.call(api, req, req.res, rows);
        } catch (e) {
            logger.error('sendJSON:', req.options.path, e.stack);
        }
        logger.debug('sendJSON:', req.method, req.options.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, function(err) {
        if (sent || req.res.headersSent) return;
        // Keep only public columns for the combination of all tables specified
        if (req.options.cleanup) {
            api.cleanupResult(req.options.cleanup, rows.count && rows.data ? rows.data : rows, req.options);
        }
        req.res.json(rows);
    }, true);
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
api.sendStatus = function(res, options)
{
    if (res.headersSent) return;
    if (!options) options = { status: 200, message: "" };
    if (!options.status) options.status = 200;
    try {
        switch (options.status) {
        case 301:
        case 302:
        case 303:
        case 307:
        case 308:
            res.redirect(options.status, options.url);
            break;

        default:
            var req = res.req, sent = 0;
            var hooks = this.findHook('status', req.method, req.options.path);
            lib.forEachSeries(hooks, function(hook, next) {
                try {
                    sent = hook.callback.call(api, req, res, options);
                } catch (e) {
                    logger.error('sendStatus:', req.options.path, e.stack);
                }
                logger.debug('sendStatus:', req.method, req.options.path, hook.path, 'sent:', sent || res.headersSent);
                next(sent || res.headersSent);
            }, function(err) {
                if (sent || res.headersSent) return;
                if (options.contentType) {
                    res.type(options.contentType);
                    res.status(options.status).send(res.__(options.message || ""));
                } else {
                    for (const p in options) {
                        if (typeof options[p] == "string") options[p] = res.__(options[p]);
                    }
                    res.status(options.status).json(options);
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
    if (util.isError(status)) {
        // Do not show runtime errors
        if (status.message && !this.errlogLimiterIgnore.rx.test(status.message)) {
            if (!this.errlogLimiterToken || this.errlogLimiterToken.consume(1)) {
                logger.error("sendReply:", res.req.url, status.message, res.req.headers, res.req.query, res.req.options, lib.traceError(status));
            }
        }
        text = lib.testRegexpObj(status.code, this.allowErrorCode) ? res.__(status.message) :
               status._msg ? res.__(status._msg) :
               this.errorMessage || res.__("Internal error occurred, please try again later");
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
    if (status >= 400) logger.debug("sendReply:", status, text);
    this.sendStatus(res, { status: status || 200, message: String(text || "") });
}

// Send file back to the client, res is Express response object
api.sendFile = function(req, file, redirect)
{
    fs.stat(file, function(err, st) {
        if (req.method == 'HEAD') return req.res.set("Content-Length", err ? 0 : st.size).set("Content-Type", mime.getType(file)).status(!err ? 200 : 404).send();
        if (!err) return req.res.sendFile(file, { root: core.home });
        if (redirect) return req.res.redirect(redirect);
        req.res.sendStatus(404);
    });
}

require(__dirname + "/api/auth")
require(__dirname + "/api/files")
require(__dirname + "/api/hooks")
require(__dirname + "/api/icons")
require(__dirname + "/api/proxy")
require(__dirname + "/api/session")
require(__dirname + "/api/utils")
require(__dirname + "/api/ws")

