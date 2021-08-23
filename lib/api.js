//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const stream = require('stream');
const util = require('util');
const fs = require('fs');
const os = require('os');
const http = require('http');
const cluster = require('cluster');
const cookie = require("cookie");
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

    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path" },
           { name: "images-s3", descr: "S3 bucket name where to store and retrieve images" },
           { name: "images-raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and account id in the image name" },
           { name: "images-s3-options", type: "json", logger: "warn", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
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
           { name: "no-access-token", type: "bool", descr: "Disable access tokens support" },
           { name: "access-time-interval", type: "int", min: 0, descr: "Intervals to refresh last access time for accounts, only updates the cache if `bk_user` is configured to be cached" },
           { name: "access-token-name", descr: "Name for the access token query parameter or header" },
           { name: "access-token-secret", descr: "A secret to be used for access token signatures, additional enryption on top of the signature to use for API access without signing requests, it is required for access tokens to be used" },
           { name: "access-token-age", type: "int", min: 0, descr: "Access tokens age in milliseconds, for API requests with access tokens only" },
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
           { name: "platform-match", type: "regexpmap", regexp: "i", descr: "An JSON object with list of regexps to match user-agent header for platform detection, example: { 'ios|iphone|ipad': 'ios', 'android': 'android' }" },
           { name: "cors-origin", descr: "Origin header for CORS requests" },
           { name: "cors-allow", type: "regexpobj", descr: "Enable CORS requests if a request host/path matches the given regexp" },
           { name: "server-header", descr: "Custom Server: header to return for all requests" },
           { name: "error-message", descr: "Default error message to return in case of exceptions" },
           { name: "restart", descr: "On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts" },
           { name: "allow-error-code", type: "regexpobj", descr: "Error codes in exceptions to return in the response to the user, if not matched the error-message will be returned" },
           { name: "rlimits-max-(.+)", type: "int", obj: "rlimits-max", descr: "Set max/burst rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, opath, id, login" },
           { name: "rlimits-rate-(.+)", type: "int", obj: "rlimits-rate", descr: "Set fill/normal rate limit by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, opath, id, login" },
           { name: "rlimits-ttl-(.+)", type: "int", obj: "rlimits-ttl", descr: "Set expiration TTL by the given property, 0 to keep in the cache forever, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, opath, id, login" },
           { name: "rlimits-interval-(.+)", type: "int", obj: "rlimits-interval", descr: "Set rate interval in ms by the given property, it is used by the request rate limiter using Token Bucket algorithm. Predefined types: ip, path, opath, id, login" },
           { name: "rlimits-queue-(.+)", obj: "rlimits-queue", descr: "Queue to use for the given property" },
           { name: "rlimits-total", type: "int", obj: "rlimits", descr: "Total number of servers used in the default rate limiter behind a load balancer, rates will be divided by this number so each server handles only a portion of the total rate limit" },
           { name: "rlimits-interval", type: "int", obj: "rlimits", descr: "Default interval in ms for all rate limiters, defines the time unit, default is 1000 ms" },
           { name: "rlimits-ttl", type: "int", obj: "rlimits", descr: "Default expiration TTL in ms for all rate limiters" },
           { name: "rlimits-message", descr: "Message to show when any limits reached" },
           { name: "exit-on-error", type: "bool", descr: "Exit on uncaught exception in the route handler" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*100, descr: "Max size for uploads, bytes" },
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
    authMesage: "ok",
    pathErrmsg: {},
    aclErrmsg: {},
    // Rate limits
    rlimits: { ttl: 86400000 },
    rlimitsMax: {},
    rlimitsRate: {},
    rlimitsTtl: {},
    rlimitsQueue: {},
    rlimitsInterval: {},
    rlimitsMessage: "Access limit reached, please try again later.",
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
    templating: "",
    expressOptions: {},

    // All listening servers
    servers: [],

    // Proxy target
    proxyUrl: {},
    proxyHost: null,
    proxyWorkers: [],

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 1800000,
    subscribeInterval: 1000,

    // Collect body MIME types as binary blobs
    mimeBody: {},
    mimeIgnore: {},
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

    corsAllow: null,
    corsOrigin: "*",
    corsCredentials: true,
    corsMethods: ['OPTIONS', 'HEAD', 'GET', 'POST', 'PUT', 'DELETE'],

    // Separate age for access token
    accessTokenAge: 86400 * 7 * 1000,
    accessTokenSecret: "",
    accessTokenName: 'bk-access-token',

    // Properties to be cleaned up on finish
    requestCleanup: ["options", "account", "signature", "body", "raw_body"],
    cleanupRules: {},

    // User agent patterns by platform
    platformMatch: lib.toRegexpMap(null, { "darwin|cfnetwork|iphone|ipad": "ios", "android": "android", }, { regexp: "i" }),

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

    limiterQueue: "local",

    accessLogFields: [],
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
        accesstoken: { type: "bool" },
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

    // Setup busy timer to detect when our requests waiting in the queue for too long
    if (this.maxLatency) lib.busyTimer("init", this.maxLatency);

    // Fake i18n methods
    this.app.use(function apiLocales(req, res, next) {
        req.__ = res.__ = res.locals.__ = lib.__;
        next();
    });

    // Early request setup and checks
    this.app.use(this.startServerRequest.bind(this));

    // Acccess logging, always goes into api.accessLog, it must be a stream
    if (!this.noAccessLog) {
        this.configureAccessLog();
        this.app.use(this.handleAccessLog.bind(this));
    }

    this.app.use(this.handleResponseHeaders.bind(this));

    // Redirect before processing the request
    this.app.use(function(req, res, next) {
        var location = api.checkRedirect(req, req.options);
        if (location) return api.sendStatus(res, location);
        next();
    });

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
    core.runMethods("configureMiddleware", options, function() {

        // Check for access and authorization
        api.app.use(api.handleSignature.bind(api));

        // Setup routes from the loaded modules
        core.runMethods("configureWeb", options, function(err) {
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
    logger.log('api.shutdown: started');
    if (typeof callback != "function") callback = lib.noop;
    const timeout = callback ? setTimeout(callback, api.shutdownTimeout || 30000) : null;

    // Make workers not ready during the shutdown
    ipc.sendMsg("api:shutdown", { id: cluster.isWorker ? cluster.worker.id : process.pid, pid: process.pid, port: core.port });

    lib.forEach([ api.wsServer, api.server, api.sslServer ], (server, next) => {
        if (!server) return next();
        try {
            server.close();
            logger.log("api.shutdown:", "closed", server.serverName);
            next();
        } catch (e) {
            logger.error("api.shutdown:", "closed", server.serverName, e);
            next();
        }
    }, () => {
        clearTimeout(timeout);
        callback();
    });
}

// Gracefully close all database pools when the shutdown is initiated by a Web process
api.shutdownWeb = function(options, callback)
{
    this.shutdown(() => {
        var pools = db.getPools();
        lib.forEachLimit(pools, pools.length, (pool, next) => {
            db.pools[pool.name].shutdown(() => (next()));
        }, callback);
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
        }, api.handleServerRequest);
    }

    // WebSocket server, by default uses the http port
    if (core.ws.port) {
        var server = core.ws.port == core.port ? api.server : core.ws.port == core.ssl.port ? api.sslServer : null;
        if (!server) {
            var opts = { name: "ws", ssl: core.ws.ssl ? core.ssl : null, port: core.ws.port, bind: core.ws.bind, restart: api.restart };
            server = core.createServer(opts, (req, res) => { res.status(200).send("OK") });
        }
        if (server) {
            server.on("upgrade", api.handleWebSocketUpgrade.bind(api));

            var ws = require("ws");
            api.wsServer = new ws.Server({ noServer: true });
            api.wsServer.serverName = "ws";
            api.wsServer.serverPort = core.ws.port;
            api.wsServer.connections = {};
            api.wsServer.on('connection', api.handleWebSocketConnect.bind(api));
            api.wsServer.on("error", (err) => { logger.error("ws:", err) });
            api.wsServer.on("close", () => {
                api.wsServer.connections = {};
                clearInterval(api.wsServer.pingInterval);
            });
            api.wsServer.pingInterval = setInterval(() => {
                api.wsServer.clients.forEach((ws) => {
                    if (ws.alive === false) return ws.terminate();
                    ws.alive = false;
                    ws.ping(lib.noop);
                });
            }, core.ws.ping);
            if (core.ws.queue) {
                ipc.subscribe("ws:queue", { queueName: core.ws.queue }, (msg) => {
                    if (typeof msg == "string") msg = lib.jsonParse(msg, { logger: "info" });
                    api.wsBroadcast(msg.q, msg.m);
                });
            }
        }
    }
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
                if (api.vhostPath[p].test(req.options.host)) {
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
        this.accessLog.write = function(data) { logger.printSyslog('info:local5', data); return true; };
    } else
    if (this.accessLogFile) {
        this.accessLog = fs.createWriteStream(path.join(core.path.log, this.accessLogFile), { flags: 'a' });
        this.accessLog.on('error', function(err) { logger.error('accessLog:', err); api.accessLog = null; });
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
                   (logger.syslog ? "-" : '[' + now.toUTCString() + ']') + " " +
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
    if (!req.res.locals) req.res.locals = {};
    req.res.locals.__ = req.res.__ = lib.__.bind(req.res);

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
        req.res.locale = req.options.appLocale;
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
    logger.debug('serverRequest:', core.port, req.method, req.connection.remoteAddress, req.options, req.headers);
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
    });
}

// Parse incoming query parameters
api.checkQuery = function(req, res, next)
{
    if (req._body) return next();
    req.body = req.body || {};
    req.query = req.query || {};

    var type = lib.strSplit(req.get("content-type"), ";")[0];
    if (lib.testRegexpObj(type, this.mimeIgnore)) return next();

    var sig = this.getSignature(req);
    var clen = lib.toNumber(req.get("content-length"));
    if (clen > 0 && clen > this.uploadLimit * 2) {
        return next(lib.newError({ message: "too large", _msg: "Unable to process the request, it is too large", status: 413, length: clen }));
    }

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
        if (!this.mimeBody.rx || !this.mimeBody.rx.test(type)) return next();
        req.setEncoding('binary');
    }

    req._body = true;
    var buf = '', size = 0;

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > api.uploadLimit) {
            if (size > api.uploadLimit * 2) {
                return next(lib.newError({ message: "too large", _msg: "Unable to process the request, it is too large", status: 413, length: clen }));
            }
            buf = null;
        } else {
            buf += chunk;
        }
    });
    req.on('end', function() {
        try {
            if (size > api.uploadLimit) {
                return next(lib.newError({ message: "too large", _msg: "Unable process the request, it is too large", status: 413, length: size }));
            }
            // Verify data checksum before parsing
            if (sig && sig.checksum && lib.hash(buf) != sig.checksum) {
                return next(lib.newError("invalid data checksum"));
            }
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

    var form = new formidable.IncomingForm({ uploadDir: core.path.tmp, keepExtensions: true, maxFileSize: api.uploadLimit });
    var data = {}, files = {}, done;

    function ondata(name, val, data) {
        if (name == "__proto__") return;
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
        if (err && /maxFileSize/.test(err.message)) err._msg = "Cannot process the request, it is too large";
        next(err);
        done = true;
    });
    form.on('progress', function(bytesReceived, bytesExpected) {
        if (bytesExpected > api.uploadLimit) {
            next(lib.newError({ message: "too large", _msg: "Cannot process the request, it is too large", status: 413, length: bytesExpected }));
            done = true;
        }
    });
    form.on('end', function() {
        if (done) return;
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
//  - type - predefined: `ip,  path, opath, login, id`, determines by which property to perform rate limiting, when using account properties
//     the rate limiter should be called after the request signature has been parsed. Any other value is treated as
//     custom type and used as is. If it is an array all items will be checked sequentially.
//     **This property is required.**
//
//     The predefined types:
//     - ip - limit number of requests per configured interval for an IP address
//     - path - limit number of requests per configured interval for an API path and IP address, must be configured like: `-api-rlimits-/api/path-rate=2`
//
//  - ip - to use the specified IP address for type=ip
//  - max - max capacity to be used by default
//  - rate - fill rate to be used by default
//  - interval - interval in ms within which the rate is measured, default 1000 ms
//  - message - more descriptive text to be used in the error message for the type, if not specified a generic error message is used
//  - total - apply this factor to the rate, it is used in case of multiple servers behind a loadbalancer, so for
//     total 3 servers in the cluster the factor will be 3, i.e. each individual server checks for a third of the total request rate
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
    if (!req || !options || !options.type) return callback();
    var types = Array.isArray(options.type) ? options.type : [ options.type ];
    var ip = options.ip || req.options && req.options.ip;
    lib.forEachSeries(types, (type, next) => {
        var name, key = type;
        switch (type) {
        case "ip":
            name = ip;
            break;

        case 'path':
        case 'opath':
            key = options[type] || req.options && req.options[type];
            name = key + ip;
            break;

        default:
            name = type;
        }

        var rate = options.rate || this.rlimitsRate[key];
        if (!rate) return next();
        var max = options.max || this.rlimitsMax[key] || rate;
        var interval = options.interval || this.rlimitsInterval[key] || this.rlimits.interval || 1000;
        var ttl = options.ttl || this.rlimitsTtl[key] || this.rlimits.ttl;
        var queue = options.queue || this.rlimitsQueue[key] || this.limiterQueue;

        // Divide by total number of servers in the cluster, because a load balancer distributes the load equally each server can only
        // check for a portion of the total request rate
        var total = options.total || this.rlimits.total || 0;
        if (total > 1 && total < rate) {
            max /= total;
            rate /= total;
            if (!rate) return next();
        }

        // Use process shared cache to eliminate race condition for the same cache item from multiple processes on the same instance,
        // in master mode use direct access to the LRU cache
        var limit = { name: "TB:" + name, rate: rate, max: max, interval: interval, ttl: ttl, queueName: queue };
        ipc.limiter(limit, (delay, info) => {
            if (!delay) return next();
            logger.debug("checkRateLimits:", options, limit, info);
            callback({ status: 429, message: options.message || lib.__(api.rlimitsMessage), type: name != type ? type : "type" }, info);
        });
    }, callback);
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
        if (req.__delay > 0) return setTimeout(function() { req.res.json(rows) }, req.__delay);
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
        var csv = Object.keys(rows[0]).join(options.separator || "|") + "\n";
        csv += lib.toFormat(options.format, rows, options);
        req.res.set('Content-Type', 'text/csv');
        req.res.status(200).send(csv);
        break;

    case "json":
        if (req.options.cleanup) this.cleanupResult(req.options.cleanup, data.count && data.data ? data.data : data, req.options);
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
                if (options.type) {
                    res.type(options.type);
                    res.status(options.status).send(res.__(options.message || ""));
                } else {
                    for (var p in options) {
                        if (typeof options[p] == "string") options[p] = res.__(options[p]);
                    }
                    res.status(options.status).json(options);
                }
            });
        }
    } catch (e) {
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

// Check if the request is allowed to upgrade to Websocket
api.handleWebSocketUpgrade = function(req, socket, head)
{
    logger.debug("handleWebSocketUpgrade:", req.socket.remoteAddress, req.url, req.headers);

    if (core.ws.path && !core.ws.path.test(req.url)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return socket.destroy();
    }

    // Prepare request/response for signature verification, have to similate Express middleware flow
    Object.setPrototypeOf(req, this.app.request);
    req.body = req.query = qs.parse(url.parse(req.url).query, api.qsOptions);
    req.cookies = cookie.parse(req.headers.cookie || "");

    var res = req.res = new http.ServerResponse(req);
    Object.setPrototypeOf(res, this.app.response);
    res.assignSocket(req.socket);
    res.req = req;

    api.prepareRequest(req);
    api.handleSignature(req, req.res, () => {
        core.runMethods("configureWebsocket", req, () => {
            this.wsServer.handleUpgrade(req, socket, head, (ws) => {
                this.wsServer.emit('connection', ws, req);
            });
        });
    });
}

// Wrap external WebSocket connection into the Express routing, respond on backend command
api.handleWebSocketConnect = function(ws, req)
{
    logger.debug("handleWebSocketConnect:", req.socket.remoteAddress, req.path, req.query, req.account.id);

    ws.wsid = lib.uuid();
    ws.path = req.path;
    ws.remoteAddress = req.ip;
    ws.signature = lib.objClone(req.signature);
    ws.account = lib.objClone(req.account);
    ws.query = lib.objClone(req.query);
    ws.alive = true;
    ws.secure = req.secure;
    ws.hostname = req.hostname;

    ws.on('pong', () => { ws.alive = true });

    ws.on("error", (err) => {
        logger.error("handleWebSocketConnect:", ws.wsid, err);
    });

    ws.on("close", () => {
        ipc.emit("ws:close", { wsid: ws.wsid, path: ws.path, query: ws.query, account: ws.account });
        delete api.wsServer.connections[ws.wsid];
    });

    ws.on("message", this.handleWebSocketRequest.bind(this, ws));

    this.wsServer.connections[ws.wsid] = ws;
    ipc.emit("ws:open", { wsid: ws.wsid, path: ws.path, query: ws.query, account: ws.account });
}

// Wrap WebSocket into HTTP request to be proceses by the Express routes
api.handleWebSocketRequest = function(ws, data)
{
    logger.debug("handleWebSocketRequest:", ws.wsid, ws.path, ws.query, ws.account.id, data);

    var req = new http.IncomingMessage();
    req.account = lib.objClone(ws.account);
    req.signature = lib.objClone(ws.signature);
    req.connection = { remoteAddress: ws.remoteAddress };
    req.httpVersionMajor = req.httpVersionMinor = 1;
    req.httpProtocol = "WS";
    req.method = "GET";
    req.url = ws.path;
    req.wsid = ws.wsid;
    req.hostname = ws.hostname;
    req.secure = ws.secure;
    req._body = true;

    if (data[0] == "/") {
        req.url = data;
        req.body = req.query = qs.parse(url.parse(data).query, api.qsOptions);
    } else
    if (data[0] == "{" || data[0] == "[") {
        req.body = req.query = lib.jsonParse(data, { datatype: "obj", logger: "error" });
    } else {
        req.body = req.query = { data: data };
    }

    var res = new http.ServerResponse(req);
    res.end = function(chunk, encoding) {
        if (chunk && chunk.length) {
            try { ws.send(chunk.toString()) } catch (e) { logger.error("handleWebSocketRequest:", ws.wsid, ws.path, ws.account.id, e) }
        }
        res.emit("finish");
    }
    this.handleServerRequest(req, res);
}

// Update a Websocket connection properties:
// - query - set query with a new object, this is used in the wsNotify broadcasts to match who can receive messages. Initially it is set to the
//    query from the first connection.
// - account - update the current socket account object with new properties
api.wsSet = function(type, req, value)
{
    if (!req || !this.wsServer) return;
    var ws = this.wsServer.connections[req.wsid];
    logger.debug("wsSet:", req.wsid, type, value);
    if (!ws) return;
    switch (type) {
    case "query":
    case "account":
        if (lib.isObject(value) && !lib.isEmpty(value)) ws[type] = lib.objClone(value);
        break;
    }
}

// Send to a websocket inside an api server directly
api.wsSend = function(wsid, msg)
{
    if (!this.wsServer) return;
    var ws = this.wsServer.connections[wsid];
    if (!ws) return;
    if (typeof msg != "string") msg = lib.stringify(msg);
    try { ws.send(msg) } catch (e) { logger.error("wsSend:", ws.wsid, ws.path, ws.account.id, e, msg) }
}

// Broadcast a message according to the options, if no websocket queue is defined send directly using `wsBroadcast`
api.wsNotify = function(options, msg, callback)
{
    if (!core.ws.queue) return this.wsBroadcast(options, msg);
    ipc.broadcast("ws:queue", { q: options, m: msg }, { queueName: core.ws.queue }, callback);
}

// Send a message to all websockets inside an api process that match the criteria from the options:
// - path - a regexp to match initial Websocket connection url
// - account_id - send to websockets belonginh to the account, can be a list as well to notify multiple accounts
// - account - an object to  be used for condition against Websocket's accounts, `lib.isMatched` is used for comparison
// - wsid - send to the specific websocket(s), can be a list
// - query - an object to be used for condition against Websocket's query, `lib.isMatched` is used for comparison
// - cleanup - a table name to be used for message cleanup using `api.cleanupResult`, if it is an array then
//   the first item is a table and the second item is the property name inside the `msg` to be cleanup only, eg. cleanup: ["bk_user","user"].
//   All properties starting with `is`` or `cleanup_`` will be passed to the cleanupResult.
// - preprocess - a function(ws, options, msg) to be called before sending in order to possibly modify the message for this
//    particular account, i.e. for permissions checks, if it needs to be modified return a copy otherwise the original will be used, returning
//    null will skip this socket
// - method - a string in the format `module.method` to run the same way as the `preprocess` function, this is a more
//    reliable way to be use preprocess with `wsNotify`
api.wsBroadcast = function(options, msg)
{
    if (!this.wsServer || !this.wsServer.clients) return;
    if (!options || !msg) return;
    logger.debug("wsBroadcast:", core.role, options, "msg:", msg);
    var d, data = typeof msg == "string" ? msg : lib.stringify(msg);
    var opts, optsRx = /^is[A-Z]|^cleanup_/;
    var preprocess = typeof options.preprocess == "function" && options.preprocess;
    if (!preprocess && options.method) {
        var method = options.method.split('.');
        preprocess = core.modules[method[0]] && typeof core.modules[method[0]][method[1]] == "function" && core.modules[method[0]][method[1]];
    }

    for (const ws of this.wsServer.clients) {
        if ((!options.wsid || options.wsid == ws.wsid || lib.isFlag(options.wsid, ws.wsid)) &&
            (!options.account_id || options.account_id == ws.account.id || lib.isFlag(options.account_id, ws.account.id)) &&
            (!options.path || lib.testRegexp(ws.path, options.path)) &&
            (lib.isMatched(ws.account, options.account) && lib.isMatched(ws.query, options.query))) {
            d = data;
            if (preprocess) {
                d = preprocess(ws, options, msg);
                if (d === null) continue;
                d = !d ? data : typeof d == "string" ? d : lib.stringify(d);
            }
            if (options.cleanup) {
                opts = {};
                for (const p in ws.account) if (p[0] == "i" && p[1] == "s" && p[2] >= 'A' && p[2] <= 'Z') opts[p] = ws.account[p];
                for (const p in options) if (optsRx.test(p)) opts[p] = options[p];
                opts.account = ws.account;
                opts.cleanup_copy = 1;

                if (Array.isArray(options.cleanup)) {
                    const o = msg[options.cleanup[1]];
                    const m = api.cleanupResult(options.cleanup[0], o, opts);
                    if (m != o) {
                        d = { [options.cleanup[1]]: m };
                        for (const p in msg) if (typeof d[p] == "undefined") d[p] = msg[p];
                        d = lib.stringify(d);
                    }
                } else {
                    const m = api.cleanupResult(options.cleanup, msg, opts);
                    if (m != msg) d = lib.stringify(m);
                }
            }
            logger.debug("wsBroadcast:", "send:", ws.wsid, ws.path, ws.account.id, d);
            try { ws.send(d) } catch (e) { logger.error("wsBroadcast:", ws.wsid, ws.path, ws.account.id, e) }
        }
    }
}

