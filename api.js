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
var redis = require('redis');
var mime = require('mime');
var consolidate = require('consolidate');
var domain = require('domain');
var core = require(__dirname + '/core');
var ipc = require(__dirname + '/ipc');
var msg = require(__dirname + '/msg');
var app = require(__dirname + '/app');
var metrics = require(__dirname + '/metrics');
var logger = require(__dirname + '/logger');
var utils = require(__dirname + '/build/Release/backend');

// HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
// incorporates the Express server which is exposed as api.app object, the master server spawns Web workers which perform actual operations and monitors
// the worker processes if they die and restart them automatically. How many processes to spawn can be configured via `-server-max-workers` config parameter.
var api = {

    // Main tables to support default endpoints
    tables: {
        // Authentication by login, only keeps id and secret to check the siganture
        bk_auth: { login: { primary: 1 },                   // Account login
                   id: {},                                  // Auto generated UUID
                   alias: {},                               // Account alias
                   secret: {},                              // Account password
                   status: {},                              // Status of the account
                   type: { admin: 1 },                      // Account type: admin, ....
                   acl_deny: { admin: 1 },                  // Deny access to matched url
                   acl_allow: { admin: 1 },                 // Only grant access if matched this regexp
                   expires: { type: "bigint", admin: 1 },   // Deny access to the account if this value is before current date, milliseconds
                   mtime: { type: "bigint", now: 1 } },

        // Basic account information
        bk_account: { id: { primary: 1, pub: 1 },
                      login: {},
                      name: {},
                      first_name: {},
                      last_name: {},
                      alias: { pub: 1 },
                      status: { value: "ok" },
                      type: { admin: 1 },
                      email: {},
                      phone: {},
                      website: {},
                      birthday: {},
                      gender: {},
                      address: {},
                      city: {},
                      state: {},
                      zipcode: {},
                      country: {},
                      device_id: {},                                    // Device for notifications
                      geohash: { location: 1 },                         // To prevent regular account updates
                      latitude: { type: "real", location: 1 },          // overriding location columns
                      longitude: { type: "real", location: 1 },
                      location: { location: 1 },
                      ltime: { type: "bigint", location: 1 },           // Last location update time
                      ctime: { type: "bigint", readonly: 1, now: 1 },   // Create time
                      mtime: { type: "bigint", now: 1 } },              // Last update time

       // Status/presence support
       bk_status: { id: { primary: 1 },                               // account id
                    status: {},                                       // status, online, offline, away
                    alias: {},
                    atime: { type: "bigint", now: 1 },                // last access time
                    mtime: { type: "bigint" }},                       // last status save to db time

       // Keep track of icons uploaded
       bk_icon: { id: { primary: 1 },                         // Account id
                  type: { primary: 1, pub: 1 },               // prefix:type
                  prefix: {},                                 // icon prefix/namespace
                  acl_allow: {},                              // Who can see it: all, auth, id:id...
                  ext: {},                                    // Saved image extension
                  descr: {},
                  geohash: {},                                // Location associated with the icon
                  latitude: { type: "real" },
                  longitude: { type: "real" },
                  mtime: { type: "bigint", now: 1 }},         // Last time added/updated

       // Locations for all accounts to support distance searches
       bk_location: { geohash: { primary: 1 },                    // geohash, core.minDistance defines the size
                      id: { primary: 1, pub: 1 },                 // my account id, part of the primary key for pagination
                      latitude: { type: "real" },
                      longitude: { type: "real" },
                      alias: { pub: 1 },
                      mtime: { type: "bigint", now: 1 }},

       // All connections between accounts: like,dislike,friend...
       bk_connection: { id: { primary: 1, pub: 1 },                    // my account_id
                        type: { primary: 1, pub: 1 },                  // type:connection
                        connection: { pub: 1 },                        // other id of the connection
                        alias: { pub: 1 },
                        status: {},
                        mtime: { type: "bigint", now: 1, pub: 1 }},

       // References from other accounts, likes,dislikes...
       bk_reference: { id: { primary: 1, pub: 1 },                    // account_id
                       type: { primary: 1, pub: 1 },                  // type:connection
                       connection: { pub: 1 },                        // other id of the connection
                       alias: { pub: 1 },
                       status: {},
                       mtime: { type: "bigint", now: 1, pub: 1 }},

       // New messages
       bk_message: { id: { primary: 1 },                         // my account_id
                     mtime: { primary: 1 },                      // mtime:sender
                     sender: { index: 1 },                       // Sender id
                     alias: {},                                  // Sender alias
                     acl_allow: {},                              // Who has access: all, auth, id:id...
                     msg: {},                                    // Text of the message
                     icon: { type: "int" }},                     // 1 - icon present, 0 - no icon

       // Archived messages
       bk_archive: { id: { primary: 1, index: 1 },               // my account_id
                     mtime: { primary: 1 },                      // mtime:sender
                     sender: { index: 1 },                       // Sender id
                     alias: {},                                  // Sender alias
                     msg: {},                                    // Text of the message
                     icon: { type: "int" }},                     // 1 - icon present, 0 - no icon

       // Messages sent
       bk_sent: { id: { primary: 1, index: 1 },                // my account
                  mtime: { primary: 1 },                       // mtime:recipient
                  recipient: { index: 1 },                     // Recipient id
                  alias: {},                                   // Recipient alias
                  msg: {},                                     // Text of the message
                  icon: { type: "int" }},                      // 1 - icon present, 0 - no icon

       // All accumulated counters for accounts
       bk_counter: { id: { primary: 1, pub: 1 },                               // account id
                     ping: { type: "counter", value: 0, pub: 1 },              // public column to ping the buddy with notification
                     like0: { type: "counter", value: 0, autoincr: 1 },        // who i like
                     like1: { type: "counter", value: 0, autoincr: 1 },        // reversed, who likes me
                     follow0: { type: "counter", value: 0, autoincr: 1 },      // who i follow
                     follow1: { type: "counter", value: 0, autoincr: 1 }},     // reversed, who follows me

       // Collected metrics per worker process, basic columns are defined in the table to be collected like
       // api and db request rates(.rmean), response times(.hmean) and total number of requests(_0).
       // Counters ending with _0 are snapshots, i.e. they must be summed up for any given interval.
       // All other counters are averages.
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
                     api_errors_0: { type: "real" },
                     api_bad_0: { type: "real" },
                     api_que_rmean: { type: "real" },
                     api_que_hmean: { type: "real" },
                     pool_req_rmean: { type: "real" },
                     pool_req_hmean: { type: "real" },
                     pool_req_hmean: { type: "real" },
                     pool_req_0: { type: "real" },
                     pool_errors_0: { type: "real" },
                     pool_que_rmean: { type: "real" },
                     pool_que_hmean: { type: "real" },
                     url_account_get_rmean: { type: "real" },
                     url_account_get_hmean: { type: "real" },
                     url_account_get_0: { type: "real" },
                     url_account_select_rmean: { type: "real" },
                     url_account_select_hmean: { type: "real" },
                     url_account_select_0: { type: "real" },
                     url_account_update_rmean: { type: "real" },
                     url_account_update_hmean: { type: "real" },
                     url_account_update_0: { type: "real" },
                     url_message_get_rmean: { type: "real" },
                     url_message_get_hmean: { type: "real" },
                     url_message_get_0: { type: "real" },
                     url_message_add_rmean: { type: "real" },
                     url_message_add_hmean: { type: "real" },
                     url_message_add_0: { type: "real" },
                     url_counter_incr_rmean: { type: "real" },
                     url_counter_incr_hmean: { type: "real" },
                     url_counter_incr_0: { type: "real" },
                     url_connection_get_rmean: { type: "real" },
                     url_connection_get_hmean: { type: "real" },
                     url_connection_get_0: { type: "real" },
                     url_connection_select_rmean: { type: "real" },
                     url_connection_select_hmean: { type: "real" },
                     url_connection_select_0: { type: "real" },
                     url_connection_add_rmean: { type: "real" },
                     url_connection_add_hmean: { type: "real" },
                     url_connection_add_0: { type: "real" },
                     url_connection_incr_rmean: { type: "real" },
                     url_connection_incr_hmean: { type: "real" },
                     url_connection_incr_0: { type: "real" },
                     url_connection_del_rmean: { type: "real" },
                     url_connection_del_hmean: { type: "real" },
                     url_connection_del_0: { type: "real" },
                     url_location_get_rmean: { type: "real" },
                     url_location_get_hmean: { type: "real" },
                     url_location_get_0: { type: "real" },
                     url_location_put_rmean: { type: "real" },
                     url_location_put_hmean: { type: "real" },
                     url_location_put_0: { type: "real" },
                     url_icon_get_rmean: { type: "real" },
                     url_icon_get_hmean: { type: "real" },
                     url_icon_get_0: { type: "real" },
                     url_image_account_rmean: { type: "real" },
                     url_image_account_hmean: { type: "real" },
                     url_image_account_0: { type: "real" },
                     url_image_message_rmean: { type: "real" },
                     url_image_message_hmean: { type: "real" },
                     url_image_message_0: { type: "real" },
                     ctime: { type: "bigint" }},

    }, // tables

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the account has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: { access: [], auth: [], post: [] },

    // No authentication for these urls
    allow: core.toRegexpMap(null, ["^/$", "\\.html$", "\\.ico$", "\\.gif$", "\\.png$", "\\.jpg$", "\\.svg$", "\\.ttf$", "\\.eof$", "\\.woff$", "\\.js$", "\\.css$", "^/public", "^/account/add$" ]),
    // Only for admins
    allowAdmin: {},
    // Allow only HTTPS requests
    allowSsl: {},
    redirectSsl: {},
    // Refuse access to these urls
    deny: {},

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    filesS3: '',

    // Disabled API endpoints
    disable: [],
    disableSession: {},
    unsecure: [],
    templating: "ejs",
    expressEnable: [],

    // All listening servers
    servers: [],

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 1800000,
    subscribeInterval: 3000,

    // Collect body MIME types as binary blobs
    mimeBody: [],

    // Sessions
    sessionAge: 86400 * 14 * 1000,
    signatureAge: 0,

    // Intervals between updating presence status table
    statusInterval: 900000,

    // Default busy latency 1 sec
    busyLatency: 1000,

    // API related limts
    allowConnection: {},
    iconLimit: {},

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

    // URL metrics, how long the metric path should be for an API endpoint URL, by default only first 2 components of the URL path are used.
    // This object tells how long the metric name should be using the leading component of the url. The usual place to set this will be in the
    // overridden api.initMiddleware() method in the application.
    urlMetrics: { image: 2 },

    // Collector of statistics, seconds
    collectInterval: 30,
    collectSendInterval: 300,
    collectErrors: 0,
    collectQuiet: false,

    // Default endpoints
    endpoints: { "account": 'initAccountAPI',
                 "status": "initStatusAPI",
                 "connection": 'initConnectionAPI',
                 "location": 'initLocationAPI',
                 "counter": 'initCounterAPI',
                 "icon": 'initIconAPI',
                 "file": 'initFileAPI',
                 "message": 'initMessageAPI',
                 "system": "initSystemAPI",
                 "data": 'initDataAPI' },

    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path and trailing slash at the end" },
           { name: "images-s3", descr: "S3 bucket name where to store and retrieve images" },
           { name: "images-raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and account id in the image name" },
           { name: "images-s3-options", type:" json", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
           { name: "domain", type: "regexp", descr: "Regexp of the domains or hostnames to be served by the API, if not matched the requests will be only served by the other middleware configured in the Express" },
           { name: "files-s3", descr: "S3 bucket name where to store files uploaded with the File API" },
           { name: "busy-latency", type: "number", min: 11, descr: "Max time in ms for a request to wait in the queue, if exceeds this value server returns too busy error" },
           { name: "access-log", descr: "File for access logging" },
           { name: "init-tables", type: "bool", key: 'dbInitTables', descr: "Initialize/create API tables in the shell/worker or other non-API modules" },
           { name: "salt", descr: "Salt to be used for scrambling credentials or other hashing activities" },
           { name: "notifications", type: "bool", descr: "Initialize notifications in the API Web worker process to allow sending push notifications from the API handlers" },
           { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
           { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
           { name: "no-templating", type: "bool", descr: "Disable templating engine completely" },
           { name: "templating", descr: "Templating engne to use, see consolidate.js for supported engines, default is ejs" },
           { name: "no-session", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
           { name: "session-age", type: "int", descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-secret", descr: "Secret for session cookies, session support enabled only if it is not empty" },
           { name: "token-secret", descr: "Name of the property to be used for encrypting tokens, any property from bk_auth can be used, if empty no secret is used, if not a valid property then it is used as the secret" },
           { name: "unsecure", type: "list", array: 1, descr: "Allow API functions to retrieve and show all columns, not just public, this exposes the database to every authenticated call, use with caution, usually combined with -allow-admin" },
           { name: "disable", type: "list", descr: "Disable default API by endpoint name: account, message, icon....." },
           { name: "disable-session", type: "regexpmap", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-connection", type: "map", descr: "Map of connection type to operations to be allowed only, once a type is specified, all operations must be defined, the format is: type:op,type:op..." },
           { name: "allow-admin", type: "regexpmap", descr: "URLs which can be accessed by admin accounts only, can be partial urls or Regexp, this is a convenient options which registers AuthCheck callback for the given endpoints" },
           { name: "icon-limit", type: "intmap", descr: "Set the limit of how many icons by type can be uploaded by an account, type:N,type:N..., type * means global limit for any icon type" },
           { name: "express-enable", type: "list", descr: "Enable/set Express config option(s), can be a list of options separated by comma or pipe |, to set value user name=val,... to just enable use name,...." },
           { name: "allow", type: "regexpmap", set: 1, descr: "Regexp for URLs that dont need credentials, replace the whole access list" },
           { name: "allow-path", type: "regexpmap", key: "allow", descr: "Add to the list of allowed URL paths without authentication" },
           { name: "disallow-path", type: "regexpmap", key: "allow", del: 1, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove ^/account/add$ to disable open registration" },
           { name: "allow-ssl", type: "regexpmap", descr: "Add to the list of allowed URL paths using HTTPs only, plain HTTP requests to these urls will be refused" },
           { name: "redirect-ssl", type: "regexpmap", descr: "Add to the list of the URL paths to be redirected to the same path but using HTTPS protocol, for proxy cases Express 'trust proxy' option should be enabled" },
           { name: "deny", type:" regexpmap", set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", type: "regexpmap", key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events before closing the connection, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 0, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
           { name: "status-interval", type: "number", descr: "Number of milliseconds between status record updates, presence is considered offline if last access was more than this interval ago" },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "collect-host", descr: "The backend URL where all collected statistics should be sent over, if set to `pool` then each web worker will save metrics directly into the statistics database pool" },
           { name: "collect-pool", descr: "Database pool where to save collected statistics" },
           { name: "collect-interval", type: "number", min: 30, descr: "How often to collect statistics and metrics in seconds" },
           { name: "collect-send-interval", type: "number", min: 60, descr: "How often to send collected statistics to the master server in seconds" },
           { name: "signature-age", type: "int", descr: "Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts" },
           { name: "select-limit", type: "int", descr: "Max value that can be passed in the _count parameter, limits how many records can be retrieved in one API call from the database" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10, descr: "Max size for uploads, bytes"  }],
}

module.exports = api;

// Initialize API layer, this must be called before the `api` module can be used but it is called by the server module automatically so `api.init` is
// rearely need to called directly, only for new server implementation or if using in the shell for testing.
//
// During the init sequence, this function calls `api.initMiddleware` and `api.initApplication` methods which by default are empty but can be redefined in the user aplications.
//
// The backendjs.js uses its own request parser that places query parameters into `req.query` or `req.body` depending on the method.
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
    if (!options) options = {};

    var db = core.modules.db;

    // Performance statistics
    self.initStatistics();

    self.app = express();
    options.api = self;
    options.app = self.app;

    // Setup toobusy timer to detect when our requests waiting in the queue for too long
    if (this.busyLatency) utils.initBusy(this.busyLatency);

    // Latency watcher
    self.app.use(function(req, res, next) {
        if (self.busyLatency && utils.isBusy()) {
            self.metrics.Counter('busy_0').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        next();
    });

    // Allow cross site requests
    self.app.use(function(req, res, next) {
        res.header('Server', core.name + '/' + core.version + " " + core.appName + "/" + core.appVersion);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'bk-signature');
        next();
    });

    // Metrics starts early
    self.app.use(function(req, res, next) {
        var paths = req.path.substr(1).split("/");
        var path = "url_" + paths.slice(0, self.urlMetrics[paths[0]] || 2).join("_");
        self.metrics.Histogram('api_que').update(self.metrics.Counter('api_nreq').inc());
        req.metric1 = self.metrics.Timer('api_req').start();
        req.metric2 = self.metrics.Timer(path).start();
        self.metrics.Counter(path +'_0').inc();
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.end = end;
            res.end(chunk, encoding);
            self.metrics.Counter('api_nreq').dec();
            self.metrics.Counter("api_req_0").inc();
            if (res.statusCode >= 400 && res.statusCode < 500) self.metrics.Counter("api_bad_0").inc();
            if (res.statusCode >= 500) self.metrics.Counter("api_errors_0").inc();
            req.metric1.end();
            req.metric2.end();
            // Ignore external or not handled urls
            if (req._noEndpoint || req._noSignature) {
                delete self.metrics[path];
                delete self.metrics[path + '_0'];
            }
        }
        next();
    });

    // Access log via file or syslog
    if (logger.syslog) {
        self.accesslog = new stream.Stream();
        self.accesslog.writable = true;
        self.accesslog.write = function(data) { logger.printSyslog('info:local5', data); return true; };
    } else
    if (self.accessLog) {
        self.accesslog = fs.createWriteStream(path.join(core.path.log, self.accessLog), { flags: 'a' });
        self.accesslog.on('error', function(err) { logger.error('accesslog:', err); self.accesslog = logger; })
    } else {
        self.accesslog = logger;
    }

    self.app.use(function(req, res, next) {
        if (self.noAccessLog || req._accessLog) return next();
        req._accessLog = true;
        req._startTime = new Date;
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.end = end;
            res.end(chunk, encoding);
            var now = new Date();
            var line = (req.ip || (req.socket.socket ? req.socket.socket.remoteAddress : "-")) + " - " +
                       (logger.syslog ? "-" : '[' +  now.toUTCString() + ']') + " " +
                       req.method + " " +
                       (req.logUrl || req.originalUrl || req.url) + " " +
                       (req.httpProtocol || "HTTP") + "/" + req.httpVersionMajor + "/" + req.httpVersionMinor + " " +
                       res.statusCode + " " +
                       (res.get("Content-Length") || '-') + " - " +
                       (now - req._startTime) + " ms - " +
                       (req.headers['user-agent'] || "-") + " " +
                       (req.headers['version'] || "-") + " " +
                       (req.account ? (req.account.id || "-") : "-") + "\n";
            self.accesslog.write(line);
        }
        next();
    });

    // Auto redirect to SSL
    if (self.redirectSsl.rx) {
        self.app.use(function(req, res, next) {
            if (req.path.match(self.redirectSsl.rx) && !req.secure) return res.redirect("https://" + req.headers.host + req.url);
            next();
        });
    }

    // Request parsers
    self.app.use(cookieParser());
    self.app.use(function(req, res, next) { return self.checkQuery(req, res, next); });
    self.app.use(function(req, res, next) { return self.checkBody(req, res, next); });

    // Keep session in the cookies
    if (!self.noSession) {
        self.app.use(session({ key: 'bk_sid', secret: self.sessionSecret || core.name, cookie: { path: '/', httpOnly: false, maxAge: self.sessionAge || null } }));
    }

    // Check the signature, for virtual hosting, supports only the simple case when running the API and static web sistes on the same server
    self.app.use(function(req, res, next) {
        if (!self.domain || req.host.match(self.domain)) return self.checkRequest(req, res, next);
        req._noBackend = 1;
        next();
    });

    // Config options
    self.expressEnable.forEach(function(x) {
        x = x.split("=");
        if (x.length == 1) self.app.enable(x);
        if (x.length == 2 ) self.app.set(x[0], x[1]);
    });

    // Assign custom middleware just after the security handler
    core.runMethods("configureMiddleware", options, function() {

        // Custom routes, if host defined only server API calls for matched domains
        var router = self.app.router;
        self.app.use(function(req, res, next) {
            if (req._noBackend) return next();
            return router(req, res, next);
        });

        // No API routes matched, cleanup stats
        self.app.use(function(req, res, next) {
            req._noEndpoint = 1;
            next();
        });

        // Templating engine setup
        if (!self.noTemplating) {
            self.app.engine('html', consolidate[self.templating || 'ejs']);
            self.app.set('view engine', 'html');
            // Use app specific views path if created even if it is empty
            self.app.set('views', fs.existsSync(core.path.web + "/views") ? core.path.web + "/views" : __dirname + '/views');
        }

        // Serve from default web location in the package or from application specific location
        if (!self.noStatic) {
            self.app.use(serveStatic(core.path.web));
            self.app.use(serveStatic(__dirname + "/web"));
        }

        // Default error handler to show errors in the log
        self.app.use(function(err, req, res, next) {
            logger.error('app:', req.path, err, err.stack);
            self.sendReply(res, err);
        });

        // For health checks
        self.app.all("/ping", function(req, res) {
            if (!req.query.file) return res.json({});
            fs.stat(core.path.web + "/public/" + req.query.file, function(err, stats) {
                if (err) return res.send(404);
                res.json({ size: stats.size, mtime: stats.mtime.getTime(), atime: stats.atime.getTime(), ctime: stats.ctime.getTime() });
            });
        });

        // Return images by prefix, id and possibly type
        self.app.all(/^\/image\/([a-zA-Z0-9_\.\:-]+)\/([^\/ ]+)\/?([^\/ ]+)?$/, function(req, res) {
            var options = self.getOptions(req);
            options.prefix = req.params[0];
            options.type = req.params[2] || "";
            self.sendIcon(req, res, req.params[1], options);
        });

        // Managing accounts, basic functionality
        for (var p in self.endpoints) {
            if (self.disable.indexOf(p) == -1) self[self.endpoints[p]].call(self);
        }

        // Disable access to endpoints if session exists, meaning Web app
        if (self.disableSession.rx) {
            self.registerPreProcess('', self.disableSession.rx, function(req, status, cb) {
                if (req.session && req.session['bk-signature']) return cb({ status: 401, message: "Not authorized" });
                cb();
            });
        }

        // Admin only access
        if (self.allowAdmin.rx) {
            self.registerPreProcess('', self.allowAdmin.rx, function(req, status, cb) {
                if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
                cb();
            });
        }

        // SSL only access
        if (self.allowSsl.rx) {
            self.registerPreProcess('', self.allowSsl.rx, function(req, status, cb) {
                if (req.socket.server != self.sslserver) return cb({ status: 404, message: "ssl only" });
                cb();
            });
        }

        // Custom application logic
        core.runMethods("configureWeb", options, function(err) {

            // Setup all tables
            self.initTables(options, function(err) {

                // Synchronously load external api modules
                core.loadModules("web", options);

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
                ipc.command({ op: "api:ready", value: { id: cluster.isWorker ? cluster.worker.id : process.pid, pid: process.pid, port: core.port, ready: true } });

                // Allow push notifications in the API handlers
                if (self.notifications) {
                    msg.init(function() {
                        if (callback) callback.call(self, err);
                    });
                } else {
                    if (callback) callback.call(self, err);
                }
            });
        });
        self.exiting = false;

    });
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    var self = this;
    if (this.exiting) return;
    this.exiting = true;
    logger.log('api.shutdown: started');
    var timeout = callback ? setTimeout(callback, self.shutdownTimeout || 30000) : null;
    var db = core.modules.db;
    core.parallel([
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
            clearTimeout(timeout);
            core.runMethods("shutdownWeb", callback);
        });
}

// Allow access to API table in worker processes
api.configureWorker = function(options, callback)
{
    if (!this.dbInitTables) return callback();
    this.initTables(options, callback);
}

// Access to the API table in the shell
api.configureShell = function(options, callback)
{
    if (!this.dbInitTables) return callback();
    this.initTables(options, callback);
}

// Start Express middleware processing wrapped in the node domain
api.handleServerRequest = function(req, res)
{
    var api = core.modules.api;
    var d = domain.create();
    d.on('error', function(err) {
        logger.error('api:', req.path, err.stack);
        api.sendReply(res, err);
        api.shutdown(function() { process.exit(0); });
    });
    d.add(req);
    d.add(res);
    d.run(function() { api.app(req, res); });
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
    req.socket = new net.Socket();
    req.socket.__defineGetter__('remoteAddress', function() { return this.ip; });
    req.connection = req.socket;
    req.httpVersionMajor = req.httpVersionMinor = 1;
    req.httpProtocol = "WS";
    req.method = "GET";
    req.url = String(url);
    req.logUrl = req.url.split("?")[0];
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

// Perform authorization of the incoming request for access and permissions
api.checkRequest = function(req, res, callback)
{
    var self = this;

    // Request options that the API routes will merge with, can be used by pre process hooks
    var path = req.path.split("/");
    req.options = { ops: {}, noscan: 1, path: [ path[1] || "", path[2] || "", path[3] || "" ], cleanup: "bk_" + path[1] };
    req.account = {};

    // Parse user agent application version, extract first product and version only
    var d = (req.headers['user-agent'] || "").match(/^([^\/]+)\/([0-9a-zA-Z_\.\-]+)/);
    if (d) {
        req.options.appName = d[1];
        req.options.appVersion = d[2];
    }

    self.checkAccess(req, function(rc1) {
        // Status is given, return an error or proceed to the next module
        if (rc1) {
            if (rc1.status == 200) return callback();
            if (rc1.status) self.sendStatus(res, rc1);
            return;
        }

        // Verify account access for signature
        self.checkSignature(req, function(rc2) {
            res.header("cache-control", "no-cache");
            res.header("pragma", "no-cache");

            // Determine what to do with the request even if the status is not success, a hook may deal with it differently,
            // the most obvious case is for a Web app to perform redirection on authentication failure
            self.checkAuthorization(req, rc2, function(rc3) {
                if (rc3 && rc3.status != 200) return self.sendStatus(res, rc3);
                callback();
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
    var sig = core.parseSignature(req);

    req.on('data', function(chunk) {
        size += chunk.length;
        if (size > self.uploadLimit) return req.destroy();
        buf += chunk;
    });
    req.on('end', function() {
        try {
            // Verify data checksum before parsing
            if (sig && sig.checksum && core.hash(buf) != sig.checksum) {
                var err = new Error("invalid data checksum");
                err.status = 400;
                return next(err);
            }
            switch (type) {
            case 'application/json':
                if (req.method != "POST") break;
                req.body = core.jsonParse(buf, { obj: 1, debug: 1 });
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

// Perform URL based access checks
// Check access permissions, calls the callback with the following argument:
// - nothing if checkSignature needs to be called
// - an object with status: 200 to skip authorization and proceed with routes processing
// - an object with status: 0 means response has been sent, just stop
// - an object with status other than 0 or 200 to return the status and stop request processing
api.checkAccess = function(req, callback)
{
    var self = this;
    if (this.deny.rx && req.path.match(this.deny.rx)) return callback({ status: 403, message: "Access denied" });
    if (this.allow.rx && req.path.match(this.allow.rx)) return callback({ status: 200, message: "" });

    // Call custom access handler for the endpoint
    var hooks = this.findHook('access', req.method, req.path);
    if (hooks.length) {
        core.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAccess:', req.method, req.path, hook.path);
            hook.callbacks.call(self, req, next);
        }, callback);
        return;
    }
    callback();
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed
// - req is Express request object
// - status contains the signature verification status, an object with status: and message: properties
// - callback is a function(status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    var self = this;
    var hooks = this.findHook('auth', req.method, req.path);
    if (hooks.length) {
        core.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAuthorization:', req.method, req.path, hook.path);
            hook.callbacks.call(self, req, status, function(err) {
                if (err && err.status != 200) return next(err);
                next();
            });
        }, callback);
        return;
    }
    // Pass the status back to the checkRequest
    callback(status);
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkSignature = function(req, callback)
{
    var self = this;
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };
    if (!callback) callback = function(x) { return x; }

    // Extract all signature components from the request
    var sig = core.parseSignature(req);

    logger.debug('checkSignature:', sig, 'hdrs:', req.headers, 'session:', JSON.stringify(req.session));

    // Sanity checks, required headers must be present and not empty
    if (!sig.login || !sig.method || !sig.host || !sig.expires || !sig.login || !sig.signature) {
        req._noSignature = 1;
        return callback({ status: 400, message: "Invalid request: " + (!sig.login ? "no login provided" :
                                                                       !sig.method ? "no method provided" :
                                                                       !sig.host ? "no host provided" :
                                                                       !sig.login ? "no login provided" :
                                                                       !sig.expires ? "no expiration provided" :
                                                                       !sig.signature ? "no signature provided" : "") });
    }

    // Make sure it is not expired, it must be in milliseconds
    if (sig.expires < Date.now() - this.signatureAge) {
        return callback({ status: 406, message: "Expired request" });
    }

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    core.modules.db.get("bk_auth", { login: sig.login }, function(err, account) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account record found" });

        // Account expiration time
        if (account.expires && account.expires < Date.now()) {
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
            req.body = core.decrypt(account.secret, req.body);
        }

        // Verify the signature with account secret
        if (!core.verifySignature(sig, account)) {
            logger.debug('checkSignature:', 'failed', sig, account);
            return callback({ status: 401, message: "Not authenticated" });
        }

        // Save account and signature in the request, it will be used later
        req.signature = sig;
        req.account = account;
        req.options.account = { id: req.account.id, login: req.account.login, alias: req.account.alias };
        return callback({ status: 200, message: "Ok" });
    });
}

// Account management
api.initAccountAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/account\/([a-z\/]+)$/, function(req, res, next) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "get":
            self.getAccount(req, options, function(err, data, info) {
                self.sendJSON(req, err, data);
            });
            break;

        case "add":
            self.addAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "update":
            self.updateAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.deleteAccount(req.account.id, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "subscribe":
            self.subscribe(req);
            break;

        case "select":
            self.selectAccount(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "put/secret":
            self.setAccountSecret(req, options, function(err) {
                self.sendJSON(req, err, {});
            });
            break;

        case "select/location":
            options.table = "bk_account";
            self.getLocation(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get/icon":
            if (!req.query.id) req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            req.query.prefix = 'account';
            options.cleanup = "bk_icon";
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select/icon":
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = "account";
            options.cleanup = "bk_icon";
            self.selectIcon(req, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "put/icon":
        case "del/icon":
            options.op = req.params[0].substr(0, 3);
            req.query.prefix = 'account';
            req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            self.handleIconRequest(req, res, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Status/presence
api.initStatusAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/status\/([a-z\/]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "get":
            self.getStatus(!req.query.id ? req.account.id : core.strSplit(req.query.id), options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "put":
            req.query.id = req.account.id;
            req.query.alias = req.account.alias;
            self.putStatus(req.query, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "del":
            db.del("bk_status", { id: req.account.id }, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Generic icon management
api.initIconAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        if (!req.query.prefix) return self.sendReply(res, 400, "prefix is required");
        if (!req.query.id) req.query.id = req.account.id;
        if (!req.query.type) req.query.type = "";
        switch (req.params[0]) {
        case "get":
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select":
            self.selectIcon(req, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "upload":
            options.force = true;
            options.type = req.query.type;
            options.prefix = req.query.prefix;
            self.putIcon(req, req.account.id, options, function(err, icon) {
                var row = self.formatIcon({ id: req.account.id, type: req.query.prefix + ":" + req.query.type }, options);
                self.sendJSON(req, err, row);
            });
            break;

        case "del":
        case "put":
            options.op = req.params[0];
            self.handleIconRequest(req, res, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Generic file management
api.initFileAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/file\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        if (!req.query.name) return self.sendReply(res, 400, "name is required");
        if (!req.query.prefix) return self.sendReply(res, 400, "prefix is required");
        var file = req.query.prefix.replace("/", "") + "/" + req.query.name.replace("/", "");
        if (options.tm) file += options.tm;

        switch (req.params[0]) {
        case "get":
            self.getFile(req, res, file, options);
            break;

        case "add":
        case "put":
            options.name = file;
            options.prefix = req.query.prefix;
            self.putFile(req, req.query._name || "data", options, function(err) {
                self.sendReply(res, err);
            });
            break;

        case "del":
            self.delFile(file, options, function(err) {
                self.sendReply(res, err);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Messaging management
api.initMessageAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            self.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            options.cleanup = "";
            self.getMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "get/sent":
            options.cleanup = "";
            self.getSentMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "get/archive":
            options.cleanup = "";
            self.getArchiveMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
            });
            break;

        case "archive":
            self.archiveMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "add":
            self.addMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del/archive":
            self.delArchiveMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del/sent":
            self.delSentMessage(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Counters management
api.initCounterAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/counter\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "put":
        case "update":
            req.query.id = req.account.id;

        case "incr":
            options.op = req.params[0];
            self.incrCounter(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get":
            var id = req.query.id || req.account.id;
            db.get("bk_counter", { id: id }, options, function(err, row) {
                self.sendJSON(req, err, row);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Connections management
api.initConnectionAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[1]) {
        case "add":
        case "put":
        case "incr":
        case "update":
            options.op = req.params[1];
            self.putConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get":
            options.op = req.params[0];
            options.cleanup = "";
            self.getConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "select":
            options.op = req.params[0];
            options.cleanup = "";
            self.selectConnection(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Geo locations management
api.initLocationAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/location\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "put":
            self.putLocation(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "get":
            self.getLocation(req, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// API for internal provisioning and configuration
api.initSystemAPI = function()
{
    var self = this;

    // Return current statistics
    this.app.all(/^\/system\/([^\/]+)\/?(.+)?/, function(req, res) {
        var options = self.getOptions(req);
        switch (req.params[0]) {
        case "restart":
            ipc.send("api:restart");
            res.json({});
            break;

        case "config":
            ipc.send('init:' + req.params[1]);
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:msg');
                break;
            }
            break;

        case "stats":
            switch (req.params[1]) {
            case 'get':
                res.json(self.getStatistics());
                break;

            case "send":
                res.json(self.sendStatistics());
                break;

            case 'put':
                self.saveStatistics(self.getStatistics({ clear: true }), function(err) {
                    self.sendReply(res, err);
                });
                break;

            case 'collect':
                if (!req.query.id || !req.query.ip || !req.query.pid || !req.query.mtime) return self.sendReply(res, 400, "invalid format: " + req.query.id +","+ req.query.ip +"," + req.query.pid + ","+ req.query.mtime);
                self.saveStatistics(req.query, function(err) {
                    self.sendReply(res, err);
                });
                break;

            case 'calc':
                self.calcStatistics(req.query, options, function(err, data) {
                    if (err) return self.sendReply(res, err);
                    res.json(data);
                });
                break;

            default:
                self.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        case "profiler":
            switch(req.params[1]) {
            case 'start':
            case 'stop':
                core.profiler("cpu", req.params[1]);
                res.json({});
                break;

            case 'get':
                // Sent profiler data to the master
                if (core.cpuProfile) {
                    res.json(core.cpuProfile);
                    core.cpuProfile = null;
                } else {
                    res.json({});
                }
                break;
            }
            break;

        case "log":
            logger.log(req.query);
            res.json({});

        case "cache":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:cache');
                break;
            case 'stats':
                ipc.stats(function(data) { res.json(data) });
                break;
            case "keys":
                ipc.keys(function(data) { res.json(data) });
                break;
            case "get":
                ipc.get(req.query.name, function(data) { res.json({ value: data }); });
                break;
            case "clear":
                ipc.clear();
                res.json({});
                break;
            case "del":
                ipc.del(req.query.name);
                res.json({});
                break;
            case "incr":
                ipc.incr(req.query.name, core.toNumber(req.query.value));
                res.json({});
                break;
            case "put":
                ipc.put(req.query.name, req.query.value);
                res.json({});
                break;
            default:
                self.sendReply(res, 400, "Invalid command:" + req.params[1]);
            }
            break;

        default:
            self.sendReply(res, 400, "Invalid command:" + req.params[0]);
        }
    });
}

// API for full access to all tables
api.initDataAPI = function()
{
    var self = this;
    var db = core.modules.db;

    // Return table columns
    this.app.all(/^\/data\/columns\/?([a-z_0-9]+)?$/, function(req, res) {
        var options = self.getOptions(req);
        if (req.params[0]) {
            return res.json(db.getColumns(req.params[0], options));
        }
        // Cache columns and return
        db.cacheColumns(options, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table keys
    this.app.all(/^\/data\/keys\/([a-z_0-9]+)$/, function(req, res) {
        var options = self.getOptions(req);
        res.json(db.getKeys(req.params[0], options));
    });

    // Basic operations on a table
    this.app.all(/^\/data\/(select|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res) {
        // Table must exist
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return self.sendReply(res, "Unknown table");

        var options = self.getOptions(req);

        db[req.params[0]](req.params[1], req.query, options, function(err, rows, info) {
            switch (req.params[0]) {
            case "select":
            case "search":
                self.sendJSON(req, err, self.getResultPage(req, options, rows, info));
                break;
            default:
                self.sendJSON(req, err, rows);
            }
        });
    });

}

// Called in the master process to create/upgrade API related tables
api.initTables = function(options, callback)
{
    var self = this;
    var db = core.modules.db;

    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    db.initTables(this.tables, options, function(err) {
        // Make sure we only assign callbacks once because this can be called multiple times
        if (!self._processRow) {
            self._processRow = true;

            function onMessageRow(row, options, cols) {
                delete row.recipient;
                if (row.mtime) {
                    var mtime = row.mtime.split(":");
                    row.mtime = core.toNumber(mtime[0]);
                    row.id = row.sender = mtime[1];
                }
                if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime; else delete row.icon;
            }

            function onSentRow(row, options, cols) {
                delete row.sender;
                if (row.mtime) {
                    var mtime = row.mtime.split(":");
                    row.mtime = core.toNumber(mtime[0]);
                    row.id = row.recipient = mtime[1];
                }
                if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime; else delete row.icon;
            }

            function onConnectionRow(row, options, cols) {
                if (row.type) {
                    var type = row.type.split(":");
                    row.type = type[0];
                    row.id = type[1];
                }
            }

            function onAccountRow(row, options, cols) {
                if (row.birthday) {
                    row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
                }
            }

            db.setProcessRow("bk_account", options, onAccountRow);
            db.setProcessRow("bk_sent", options, onSentRow);
            db.setProcessRow("bk_message", options, onMessageRow);
            db.setProcessRow("bk_archive", options, onMessageRow);
            db.setProcessRow("bk_connection", options, onConnectionRow);
            db.setProcessRow("bk_reference", options, onConnectionRow);
            db.setProcessRow("bk_icon", options, self.checkIcon);
        }
        if (typeof callback == "function") callback(err);
    });
}

// Convert query options into database options, most options are the same as for `db.select` but prepended with underscore to
// distinguish control parameters from query parameters.
api.getOptions = function(req)
{
    // Boolean parameters that can be passed with 0 or 1
    ["details", "consistent", "desc", "total", "connected", "check", "noreference", "nocounter", "publish", "archive", "trash"].forEach(function(x) {
        if (typeof req.query["_" + x] != "undefined") req.options[x] = core.toBool(req.query["_" + x]);
    });
    if (req.query._session) req.options.session = core.toNumber(req.query._session);
    if (req.query._select) req.options.select = req.query._select;
    if (req.query._count) req.options.count = core.toNumber(req.query._count, 0, 50, 0, this.selectLimit);
    if (req.query._start) req.options.start = core.base64ToJson(req.query._start, this.getTokenSecret(req));
    if (req.query._token) req.options.token = core.base64ToJson(req.query._token, this.getTokenSecret(req));
    if (req.query._sort) req.options.sort = req.query._sort;
    if (req.query._page) req.options.page = core.toNumber(req.query._page, 0, 0, 0);
    if (req.query._width) req.options.width = core.toNumber(req.query._width);
    if (req.query._height) req.options.height = core.toNumber(req.query._height);
    if (req.query._ext) req.options.ext = req.query._ext;
    if (req.query._encoding) req.options.encoding = req.query._encoding;
    if (req.query._tm) req.options.tm = core.strftime(Date.now(), "%Y-%m-%d-%H:%M:%S.%L");
    if (req.query._quality) req.options.quality = core.toNumber(req.query._quality);
    if (req.query._round) req.options.round = core.toNumber(req.query._round);
    if (req.query._interval) req.options.interval = core.toNumber(req.query._interval);
    if (req.query._alias) req.options.alias = req.query._alias;
    if (req.query._name) req.options.name = req.query._name;
    if (req.query._ops) {
        var ops = core.strSplit(req.query._ops);
        for (var i = 0; i < ops.length -1; i+= 2) req.options.ops[ops[i]] = ops[i+1];
    }
    // Disable check public verification and allow any pool to be used
    if (this.unsecure.indexOf(req.options.path[0]) > -1) {
        ["pool", "cleanup"].forEach(function(x) {
            if (typeof req.query['_' + x] != "undefined") req.options[x] = req.query['_' + x];;
        });
        ["noscan", "noprocessrows", "noconvertrows"].forEach(function(x) {
            if (typeof req.query["_" + x] != "undefined") req.options[x] = core.toBool(req.query["_" + x], req.options[x]);
        });
    }
    return req.options;
}

// Return a secret to be used for enrypting tokens
api.getTokenSecret = function(req)
{
    if (!this.tokenSecret) return "";
    return req.account[this.tokenSecret] || this.tokenSecret;
}

// Return an object to be returned to the client as a page of result data with possibly next token
// if present in the info. This result object can be used for pagination responses.
api.getResultPage = function(req, options, rows, info)
{
    if (options.total) return { count: rows.length && rows[0].count ? rows[0].count : 0 };
    var token = { count: rows.length, data: rows };
    if (info && info.next_token) token.next_token = core.jsonToBase64(info.next_token, this.getTokenSecret(req));
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
// callbacks after all records have been procersses and are ready to be returned to the client, the last step would be to cleanup all non public columns if necessary.
//
// `table` can be a single table name or a list of table names which combined public columns need to be kept in the rows. List of request tables
// is kept in the `req.options.cleanup` which is by default is table name of the API endpoint, for example for /account/get it will contain bk_account, for
// /connection/get - bk_connection.
//
// In the `options` account object can be present to detect account own records which will not be cleaned and all properties will be returned, by default `id`
// property is used to detect current account but can be specified by the `options.key` property.
//
// By default primary keys are not kept and must be marked with `pub` property in the table definition to be returned.
//
api.checkPublicColumns = function(table, rows, options)
{
    if (!table || !rows || !rows.length) return;
    if (!options) options = {};
    var db = core.modules.db;
    var cols = {};
    core.strSplit(table).forEach(function(x) {
        var c = db.getColumns(x, options);
        for (var p in c) cols[p] = c[p].pub || 0;
    });
    if (!Array.isArray(rows)) rows = [ rows ];
    logger.debug("checkPublicColumns:", table, cols, rows.length, options);
    rows.forEach(function(row) {
        // Skip personal account records, all data is returned
        if (options.account && options.account.id == row[options.key || 'id']) return;
        for (var p in row) {
            if (typeof cols[p] == "undefined") continue;
            if (!cols[p]) delete row[p];
        }
    });
}

// Define new tables or extend/customize existing tables. Table definitions are used with every database operation,
// on startup, the backend read all existing table columns from the database and cache them in the memory but some properties
// like public columns are only specific to the backend so to mark such columns the table with such properties must be described
// using this method. Only columns with changed properties need to be specified, other columns will be left as it is.
//
// Example
//
//          api.describeTables({ bk_account: { name: { pub: 1 } },
//
//                               test: { id: { primary: 1, type: "int" },
//                                       name: { pub: 1, index: 1 } });
//
api.describeTables = function(tables)
{
    var self = this;
    for (var p in tables) {
        if (!self.tables[p]) self.tables[p] = {};
        for (var c in tables[p]) {
            if (!self.tables[p][c]) self.tables[p][c] = {};
            // Merge columns
            for (var k in tables[p][c]) {
                self.tables[p][c][k] = tables[p][c][k];
            }
        }
    }
}

// Clear request query properties specified in the table definition, if any columns for the table contains the property `name` nonempty, then
// all request properties with the same name as this column name will be removed from the query. This for example is used for the `bk_account`
// table to disable updating location related columns because speial location API maintains location data and updates the accounts table.
//
// The options can have a property in the form `keep_{name}` which will prevent from clearing the query for the name, this is for dynamic enabling/disabling
// this functionality without clearing table column definitions.
api.clearQuery = function(query, options, table, name)
{
    for (var i = 3; i < arguments.length; i++) {
        var name = arguments[i];
        if (options && options['keep_' + name]) continue;
        var cols = core.modules.db.getColumns(table, options);
        for (var p in cols) {
            if (cols[p][name]) delete query[p];
        }
    }
}

// Find registered hooks for given type and path
api.findHook = function(type, method, path)
{
    var hooks = [];
    var routes = this.hooks[type];
    if (!routes) return hooks;
    for (var i = 0; i < routes.length; ++i) {
        if ((!routes[i].method || routes[i].method == method) && routes[i].match(path)) {
            hooks.push(routes[i]);
        }
    }
    return hooks;
}

// Register a hook callback for the type and method and request url, if already exists does nothing.
api.addHook = function(type, method, path, callback)
{
    var hooks = this.findHook(type, method, path);
    if (hooks.some(function(x) { return x.method == method && x.path == path })) return false;
    this.hooks[type].push(new express.Route(method, path, callback));
    return true;
}

// Register a handler to check access for any given endpoint, it works the same way as the global accessCheck function and is called before
// validating the signature or session cookies.
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similar to registering Express routes
// - callback is a function with the following parameters: function(req, cb) {}, to indicate an error condition pass an object
//   with the callback with status: and message: properties, status != 200 means error
//
// Example:
//
//          api.registerAccessCheck('', 'account', function(req, cb) { cb({status:500,message:"access disabled"}) }))
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
// the API route method is called.
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

// Register a callback to be called after successfull API action, status 200 only.
// The purpose is to perform some additional actions after the standard API completed or to customize the result
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similar to registering Express routes
// - callback is a function with the following parameters: function(req, res, rows) where rows is the result returned by the API handler,
//   the callback may not return data back to the client, in this next post process hook will be called and eventually the result will be sent back to the client.
//   **To indicate that this hook will send the result eventually it must return true, otherwise the rows will be sent afer all hooks are called**
//
// Example, just update the rows, it will be sent
//
//          api.registerPostProcess('', '/data/', function(req, res, rows) {
//              rows.forEach(function(row) { ...});
//          });
//
// Example, add data to the rows
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

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
// If err is not null the error message is returned immediately.
api.sendJSON = function(req, err, rows)
{
    var self = this;
    if (err) return this.sendReply(req.res, err);

    if (!rows) rows = [];
    var sent = 0;
    var hooks = this.findHook('post', req.method, req.path);
    core.forEachSeries(hooks, function(hook, next) {
        try { sent = hook.callbacks.call(self, req, req.res, rows); } catch(e) { logger.error('sendJSON:', req.path, e.stack); }
        logger.debug('sendJSON:', req.method, req.path, hook.path, 'sent:', sent || req.res.headersSent, 'cleanup:', req.options.cleanup);
        next(sent || req.res.headersSent);
    }, function(err) {
        if (sent || req.res.headersSent) return;
        // Keep only public columns for the combination of all tables specified
        if (req.options.cleanup) {
            self.checkPublicColumns(req.options.cleanup, rows && rows.count && rows.data ? rows.data : rows, req.options);
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

// Return reply to the client using the options object, it cantains the following properties:
// - status - defines the respone status code
// - message  - property to be sent as status line and in the body
// - type - defines Content-Type header, the message will be sent in the body
// - url - for redirects when status is 301 or 302
api.sendStatus = function(res, options)
{
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
                res.json(options.status, options);
            }
        }
    } catch(e) {
        logger.error('sendStatus:', res.req.path, e.stack);
    }
    return false;
}

// Send file back to the client, res is Express response object
api.sendFile = function(req, res, file, redirect)
{
    fs.exists(file, function(yes) {
        if (req.method == 'HEAD') return res.send(yes ? 200 : 404);
        if (yes) return res.sendfile(file);
        if (redirect) return res.redirect(redirect);
        res.send(404);
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
    ipc.subscribe(req.msgKey, this.sendEvent, req);

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
api.sendEvent = function(req, key, data)
{
    logger.debug('subscribe:', key, data, 'sent:', req.res.headersSent, 'match:', req.msgMatch, 'timeout:', req.msgTimeout);
    // If for any reasons the response has been sent we just bail out
    if (req.res.headersSent) return ipc.unsubscribe(key);

    if (typeof data != "string") data = JSON.stringify(data);
    // Filter by matching the whole message text
    if (req.msgMatch && !data.match(req.mgMatch)) return;
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
}

// Full path to the icon, perform necessary hashing and sharding, id can be a number or any string
api.iconPath = function(id, options)
{
    if (!options) options = {};
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = String(id).replace(/[^0-9]/g, '');
    var ext = options.ext || "jpg";
    var name = (options.type ? options.type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return path.join(core.path.images, options.prefix || "", num.substr(-2), num.substr(-4, 2), name);
}

// Download image and convert into JPG, store under core.path.images
// Options may be controlled using the properties:
// - force - force rescaling for all types even if already exists
// - id - id for the icon
// - type - type for the icon, prepended to the icon id
// - prefix - where to store all scaled icons
// - verify - check if the original icon is the same as at the source
api.downloadIcon = function(uri, options, callback)
{
    var self = this;

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('getIcon:', uri, options);

    if (!uri || (!options.id && !options.type)) return (callback ? callback(new Error("wrong args")) : null);
    var id = options.id || "";

    // Verify image size and skip download if the same
    if (options.verify) {
        var imgfile = this.iconPath(id, options);
        fs.stat(imgfile, function(err, stats) {
            logger.debug('getIcon:', id, imgfile, 'stats:', stats, err);
            // No image, get a new one
            if (err) return self.downloadIcon(uri, id, core.delObj(options, 'verify'), callback);

            core.httpGet(uri, { method: 'HEAD' }, function(err2, params) {
                if (err) logger.error('getIcon:', id, imgfile, 'size1:', stats.size, 'size2:', params.size, err);
                // Not the same, get a new one
                if (params.size !== stats.size) return self.downloadIcon(uri, id, core.delObj(options, 'verify'), callback);
                // Same, just verify types
                self.saveIcon(imgfile, id, options, callback);
            });
        });
        return;
    }

    // Download into temp file, make sure dir exists
    var opts = url.parse(uri);
    var tmpfile = path.join(core.path.tmp, core.random().replace(/[\/=]/g,'') + path.extname(opts.pathname));
    core.httpGet(uri, { file: tmpfile }, function(err, params) {
        // Error in downloading
        if (err || params.status != 200) {
            fs.unlink(tmpfile, function() {});
            if (err) logger.error('getIcon:', id, uri, 'not found', 'status:', params.status, err);
            return (callback ? callback(err || new Error('Status ' + params.status)) : null);
        }
        // Store in the proper location
        self.saveIcon(tmpfile, id, options, function(err2) {
            fs.unlink(tmpfile, function() {});
            if (callback) callback(err2);
        });
    });
}

// Save original or just downloaded file in the proper location according to the types for given id,
// this function is used after downloading new image or when moving images from other places. On success
// the callback will be called with the second argument set to the output file name where the image has been saved.
// Valid properties in the options:
// - type - icon type, this will be prepended to the name of the icon
// - prefix - top level subdirectory under images/
// - force - to rescale even if it already exists
// - width, height, filter, ext, quality for backend.resizeImage function
api.saveIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('putIcon:', id, file, options);

    options.outfile = self.iconPath(id, options);

    // Filesystem based icon storage, verify local disk
    fs.exists(options.outfile, function(yes) {
        // Exists and we do not need to rescale
        if (yes && !options.force) return callback();
        // Make new scaled icon
        self.scaleIcon(file, options, function(err) {
            if (err) logger.error("putIcon:", id, file, 'path:', options, err);
            if (callback) callback(err, options.outfile);
        });
    });
}

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new image dimensions
//          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
//          - if any is 0 that means keep the original size
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg, jp2
//     - flip - flip horizontally
//     - flop - flip vertically
//     - blue_radius, blur_sigma - perform adaptive blur on the image
//     - crop_x, crop_y, crop_width, crop_height - perform crop using given dimensions
//     - sharpen_radius, sharpen_sigma - perform sharpening of the image
//     - brightness - use thing to change brightness of the image
//     - contrast - set new contrast of the image
//     - rotate - rotation angle
//     - bgcolor - color for the background, used in rotation
//     - quantized - set number of colors for quantize
//     - treedepth - set tree depth for quantixe process
//     - dither - set 0 or 1 for quantixe and posterize processes
//     - posterize - set number of color levels
//     - normalize - normalize image
//     - opacity - set image opacity
api.scaleIcon = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    utils.resizeImage(infile, options, function(err, data) {
        if (err) logger.error('scaleIcon:', Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, err);
        if (callback) callback(err, data);
    });
}

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
// Verify icon limits before adding new icons
api.handleIconRequest = function(req, res, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var op = options.op || "put";

    options.force = true;
    options.type = req.query.type || "";
    options.prefix = req.query.prefix || "account";
    if (!req.query.id) req.query.id = req.account.id;

    // Max number of allowed icons per type or globally
    var limit = self.iconLimit[options.type] || self.iconLimit['*'];
    var icons = [];

    core.series([
       function(next) {
           options.ops = { type: "begins_with" };
           db.select("bk_icon", { id: req.query.id, type: options.prefix + ":" }, options, function(err, rows) {
               if (err) return next(err);
               switch (op) {
               case "put":
                   // We can override existing icon but not add a new one
                   if (limit > 0 && rows.length >= limit && !rows.some(function(x) { return x.type == options.type })) {
                       return next({ status: 400, message: "No more icons allowed" });
                   }
                   break;
               }
               icons = rows;
               next();
           });
       },

       function(next) {
           options.ops = {};
           req.query.type = options.prefix + ":" + options.type;
           if (options.ext) req.query.ext = options.ext;
           if (req.query.latitude && req.query.longitude) req.query.geohash = core.geoHash(req.query.latitude, req.query.longitude);

           db[op]("bk_icon", req.query, options, function(err, rows) {
               if (err) return next(err);

               switch (op) {
               case "put":
                   self.putIcon(req, req.query.id, options, function(err, icon) {
                       if (err || !icon) return db.del('bk_icon', req.query, options, function() { next(err || { status: 500, message: "Upload error" }); });
                       // Add new icons to the list which will be returned back to the client
                       if (!icons.some(function(x) { return x.type == options.type })) icons.push(self.formatIcon(req.query, options))
                       next();
                   });
                   break;

               case "del":
                   self.delIcon(req.query.id, options, function() {
                       icons = icons.filter(function(x) { return x.type != options.type });
                       next();
                   });
                   break;

               default:
                   next({ status: 500, message: "invalid op" });
               }
           });
       }], function(err) {
            if (callback) callback(err, icons);
    });
}

// Return formatted icon URL for the given account, verify permissions
api.formatIcon = function(row, options)
{
    var self = this;
    if (!options) options = row;
    var type = row.type.split(":");
    row.type = type.slice(1).join(":");
    row.prefix = type[0];

    if ((this.imagesUrl || options.imagesUrl) && (this.imagesRaw || options.imagesRaw)) {
        row.url = (options.imagesUrl || this.imagesUrl) + this.iconPath(row.id, row);
    } else
    if ((this.imagesS3 || options.imagesS3) && (this.imagesS3Options || options.imagesS3Options)) {
        this.imagesS3Options.url = true;
        row.url = core.modules.aws.signS3("GET", options.imagesS3 || this.imagesS3, this.iconPath(row.id, row), options.imagesS3Options || this.imagesS3Options);
    } else
    if ((!row.acl_allow || row.acl_allow == "all") && this.allow.rx && ("/image/" + row.prefix + "/").match(this.allow.rx)) {
        row.url = (options.imagesUrl || this.imagesUrl) + '/image/' + row.prefix + '/' + row.id + '/' + row.type;
    } else {
        if (row.prefix == "account") {
            row.url = (options.imagesUrl || this.imagesUrl) + '/account/get/icon?';
            if (row.type != '0') row.url += 'type=' + row.type;
        } else {
            row.url = (options.imagesUrl || this.imagesUrl) + '/icon/get?prefix=' + row.prefix + "&type=" + row.type;
        }
        if (options && options.account && row.id != options.account.id) row.url += "&id=" + row.id;
    }
    return row;
}

// Verify icon permissions and format for the result, used in setProcessRow for the bk_icon table
api.checkIcon = function(row, options, cols)
{
    var self = this;
    var id = options.account ? options.account.id : "";

    if (row.acl_allow && row.acl_allow != "all") {
        if (row.acl_allow == "auth") {
            if (!id) return true;
        } else
        if (acl) {
            if (!row.acl_allow.split(",").some(function(x) { return x == id })) return true;
        } else
        if (row.id != id) return true;
    }
    // Use direct module reference due to usage in the callback without proper context
    api.formatIcon(row, options);
}

// Return list of icons for the account, used in /icon/get API call
api.selectIcon = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    options.ops = { type: "begins_with" };
    db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + (req.query.type || "") }, options, function(err, rows) {
        callback(err, rows);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.modules.db;

    db.get("bk_icon", { id: id, type: req.query.prefix + ":" + req.query.type }, options, function(err, row) {
        if (err) return self.sendReply(res, err);
        if (!row) return self.sendReply(res, 404, "Not found or not allowed");
        if (row.ext) options.ext = row.ext;
        options.prefix = req.query.prefix;
        options.type = req.query.type;
        self.sendIcon(req, res, id, options);
    });
}

// Send an icon to the client, only handles files
api.sendIcon = function(req, res, id, options)
{
    var self = this;
    if (!options) options = {};
    var aws = core.modules.aws;
    var icon = this.iconPath(id, options);
    logger.debug('sendIcon:', icon, id, options);

    if (options.imagesS3 || self.imagesS3) {
        var opts = {};
        var params = url.parse(aws.signS3("GET", options.imagesS3 || self.imagesS3, icon, opts));
        params.headers = opts.headers;
        var s3req = http.request(params, function(s3res) {
            s3res.pipe(res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendIcon:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        self.sendFile(req, res, icon);
    }
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property to define type for each icon, for
    // only one uploaded file req.query.type still will be used
    var nfiles = req.files ? Object.keys(req.files).length : 0;
    if (nfiles) {
        var outfile = null, type = options.type || req.query.type;
        core.forEachSeries(Object.keys(req.files), function(f, next) {
            var opts = core.extendObj(options, 'type', req.body[f + '_type'] || (type && nfiles == 1 ? type : ""));
            self.storeIcon(req.files[f].path, id, opts, function(err, ofile) {
                outfile = ofile;
                next(err);
            });
        }, function(err) {
            callback(err, outfile);
        });
    } else
    // JSON object submitted with .icon property
    if (typeof req.body == "object" && req.body.icon) {
        var icon = new Buffer(req.body.icon, "base64");
        this.storeIcon(icon, id, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query.icon) {
        var icon = new Buffer(req.query.icon, "base64");
        this.storeIcon(icon, id, options, callback);
    } else {
        return callback();
    }
}

// Place the icon data to the destination, if api.imagesS3 or options.imagesS3 specified then plave the image on the S3 drive
api.storeIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.imagesS3 || options.imagesS3) {
        var icon = this.iconPath(id, options);
        this.scaleIcon(file, options, function(err, data) {
            if (err) return callback ? callback(err) : null;

            core.modules.aws.s3PutFile(options.imagesS3 || self.imagesS3, icon, data, function(err) {
                if (callback) callback(err, icon);
            });
        });
    } else {
        this.saveIcon(file, id, options, callback);
    }
}

// Delete an icon for account, .type defines icon prefix
api.delIcon = function(id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = this.iconPath(id, options);
    logger.debug('delIcon:', id, options);

    if (this.imagesS3 || options.imagesS3) {
        var aws = core.modules.aws;
        aws.queryS3(options.imagesS3 || self.imagesS3, icon, { method: "DELETE" }, function(err) {
            if (callback) callback();
        });
    } else {
        fs.unlink(icon, function(err) {
            if (err) logger.error('delIcon:', id, err, options);
            if (callback) callback();
        });
    }
}

// Send a file to the client
api.getFile = function(req, res, file, options)
{
    var self = this;
    if (!options) options = {};
    var aws = core.modules.aws;
    logger.debug('sendFile:', file, options);

    if (options.imagesS3 || self.imagesS3) {
        var opts = {};
        var params = url.parse(aws.signS3("GET", options.filesS3 || self.filesS3, file, opts));
        params.headers = opts.headers;
        var s3req = http.request(params, function(s3res) {
            s3res.pipe(res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendFile:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        self.sendFile(req, res, file);
    }
}

// Upload file and store in the filesystem or S3, try to find the file in multipart form, in the body or query by the given name
// - name is the name property to look for in the multipart body or in the request body or query
// - callback will be called with err and actual filename saved
// Output file name is built according to the following options properties:
// - name - defines the basename for the file, no extention, if not given same name as property will be used
// - prefix - the folder prefix where the file will be uploaded, all leading folders will be created automatically
// - ext - what file extention to use, appended to name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
// - extkeep - tells always to keep actual extention from the uploaded file
// - encoding - encoding of the body, default is base64
api.putFile = function(req, name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var btype = core.typeName(req.body);
    var outfile = path.join(options.prefix || "", path.basename(options.name || name) + (options.ext || ""));

    logger.debug("putFile:", name, outfile, options);

    if (req.files && req.files[name]) {
        if (!options.ext || options.extkeep) outfile += path.extname(req.files[name].name || req.files[name].path);
        self.storeFile(req.files[name].path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        var data = new Buffer(req.body[name], options.encoding || "base64");
        self.storeFile(data, outfile, options, callback);
    } else
    // Save a buffer as is
    if (btype == "buffer") {
        self.storeFile(req.body, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        var data = new Buffer(req.query[name], options.encoding || "base64");
        self.storeFile(data, outfile, options, callback);
    } else {
        return callback();
    }
}

// Place the uploaded tmpfile to the destination pointed by outfile
api.storeFile = function(tmpfile, outfile, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    logger.debug("storeFile:", outfile);

    if (this.filesS3 || options.filesS3) {
        core.modules.aws.s3PutFile(options.filesS3 || this.filesS3, outfile, tmpfile, callback);
    } else {
        outfile = path.join(core.path.files, outfile);
        core.makePath(path.dirname(outfile), function(err) {
            if (err) return callback ? callback(err) : null;
            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, function(err) {
                    if (err) logger.error('storeFile:', outfile, err);
                    if (callback) callback(err, outfile);
                });
            } else {
                core.moveFile(tmpfile, outfile, true, function(err) {
                    if (err) logger.error('storeFile:', outfile, err);
                    if (callback) callback(err, outfile);
                });
            }
        });
    }
}

// Delete file by name from the local filesystem or S3 drive if filesS3 is defined in api or options objects
api.delFile = function(file, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.filesS3 || options.filesS3) {
        var aws = core.modules.aws;
        aws.queryS3(options.filesS3 || this.filesS3, file, { method: "DELETE" }, function(err) {
            if (callback) callback(err, outfile);
        });
    } else {
        fs.unlink(path.join(core.path.files, file), function(err) {
            if (err) logger.error('delFile:', file, err);
            if (callback) callback(err, outfile);
        })
    }
}

// Returns status record for given account, used in /status/get API call.
// It always returns status object even if it was never set before, on return the record contains
// a property `online` set to true of false according to the idle period and actual status.
//
// If id is an array, then return all status records for specified list of account ids.
//
// If status was explicitely set to `offline` then it is considered offline until changed to to other value,
// for other cases `status` property is not used, it is supposed for the application extention.
//
api.getStatus = function(id, options, callback)
{
    var self = this;
    var now = Date.now();
    var db = core.modules.db;

    if (Array.isArray(id)) {
        db.list("bk_status", id, options, function(err, rows) {
            if (err) return callback(err);
            rows = rows.filter(function(x) {
                row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            });
            callback(err, rows);
        });
    } else {
        db.get("bk_status", { id: id }, options, function(err, row) {
            if (err) return callback(err);
            if (!row) row = { id: id, status: "", online: false, mtime: 0 };
            row.online = now - row.atime < self.statusInterval && row.status != "offline" ? true : false;
            callback(err, row);
        });
    }
}

// Maintain online status, update to db every status-interval seconds, if options.check is given only update db if last update happened
// longer than status-interval seconds ago, keep atime up-to-date in the cache on every status update.
// On return the row will have a property `saved` if it was flushed to db.
api.putStatus = function(obj, options, callback)
{
    var self = this;
    var now = Date.now();
    var db = core.modules.db;

    // Read the current record, check is handled differently in put
    self.getStatus(obj.id, options, function(err, row) {
        if (err) return callback(err);
        // Force db flush if last update was long time ago, otherwise just update the cache with the latest access time
        if (options.check && row.online && now - row.mtime < self.statusInterval * 1.5) {
            row.atime = now;
            db.putCache("bk_status", row, options);
            return callback(err, row);
        }
        for (var p in obj) row[p] = obj[p];
        row.atime = row.mtime = now;
        row.saved = true;
        db.put("bk_status", row, function(err) {
            callback(err, row);
        });
    });
}

// Increase a counter, used in /counter/incr API call, options.op can be set to 'put'
api.incrCounter = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var op = options.op || "incr";

    // Remove non public columns when updating other account
    if (req.query.id && req.query.id != req.account.id) {
        var obj = { id: req.query.id };
        this.getPublicColumns("bk_counter").forEach(function(x) { if (req.query[x]) obj[x] = req.query[x]; });
    } else {
        var obj = req.query;
        obj.id = req.account.id;
    }

    db[op]("bk_counter", obj, options, function(err, rows) {
        if (err) return callback(err);

        // Notify only the other account
        if (obj.id != req.account.id && options.publish) {
            self.publish(obj.id, { path: req.path, mtime: now, alias: (options.account ||{}).alias, type: Object.keys(obj).join(",") }, options);
        }

        callback(null, rows);
    });
}

// Update auto counter for account and type
api.incrAutoCounter = function(id, type, num, options, callback)
{
    var self = this;
    var db = core.modules.db;

    if (!id || !type || !num) return callback(null, []);
    var col = db.getColumn("bk_counter", type, options);
    if (!col || col.autoincr) return callback(null, []);
    db.incr("bk_counter", core.newObj('id', id, type, num), options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/get` API call.
api.getConnection = function(req, options, callback)
{
    var self = this;
    if (!req.query.id || !req.query.type) return callback({ status: 400, message: "id and type are required"});
    this.readConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/select` API call.
api.selectConnection = function(req, options, callback)
{
    var self = this;
    this.queryConnection(req.account.id, req.query, options, function(err, rows, info) {
        callback(null, self.getResultPage(req, options, rows, info));
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call with query parameters coming from the Express request.
api.putConnection = function(req, options, callback)
{
    var self = this;
    var op = options.op || 'put';

    if (!req.query.id || !req.query.type) return callback({ status: 400, message: "id and type are required"});
    if (req.query.id == req.account.id) return callback({ status: 400, message: "cannot connect to itself"});

    // Check for allowed connection types
    if (self.allowConnection[req.query.type] && !self.allowConnection[req.query.type][op]) return callback({ status: 400, message: "invalid connection type"});

    this.makeConnection(req.account.id, req.query, options, callback)
}

// Delete a connection, this function is called by the `/connection/del` API call
api.delConnection = function(req, options, callback)
{
    var self = this;
    self.deleteConnection(req.account.id, req.query, options, callback);
}

// Return all connections for the account id with optional query properties, obj.type should not include :
api.queryConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var query = { id: id, type: obj.type ? (obj.type + ":" + (obj.id || "")) : "" };
    for (var p in obj) if (p != "id" && p != "type") query[p] = obj[p];

    if (!options.ops) options.ops = {};
    if (!options.ops.type) options.ops.type = "begins_with";

    db.select("bk_" + (options.op || "connection"), query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        // Just return connections
        if (!core.toNumber(options.details)) return callback(null, rows, info);

        // Get all account records for the id list
        self.listAccount(rows, options, callback);
    });
}

// Return one connection for given id, obj must have .id and .type properties defined,
// if options.details is 1 then combine with account record.
api.readConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var query = { id: id, type: obj.type + ":" + obj.id };
    for (var p in obj) if (p != "id" && p != "type") query[p] = obj[p];

    db.get("bk_" + (options.op || "connection"), query, options, function(err, row) {
        if (err) return callback(err, {});
        if (!row) return callback({ status: 404, message: "no connection" }, {});

        // Just return connections
        if (!core.toNumber(options.details)) return callback(err, row);

        // Get account details for connection
        self.listAccount([ row ], options, function(err, rows) {
            callback(null, row);
        });
    });
}

// Lower level connection creation with all counters support, can be used outside of the current account scope for
// any two accounts and arbitrary properties, `id` is the primary account id, `obj` contains id and type for other account
// with other properties to be added. `obj` is left untouched.
//
// To maintain aliases for both sides of the connection, set alias in the obj for the bk_connection and options.alias for bk_reference.
//
// The following properties can alter the actions:
// - publish - send notification via pub/sub system if present
// - nocounter - do not update auto increment counters
// - noreference - do not create reference part of the connection
// - connected - return existing connection record for the same type from the other account
// - alias - an alias for the reference record for cases wen connecting 2 different accounts, it has preference over options.account.
// - account - an object with account properties like id, alias to be used in the connection/reference records, specifically options.account.alias will
//   be used for the reference record to show the alias of the other account, for the primary connection obj.alias is used if defined.
api.makeConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var op = options.op || 'put';
    var query = core.cloneObj(obj);
    var result = {};

    core.series([
        function(next) {
            // Primary connection
            if (options.noconnection) return next();
            query.id = id;
            query.type = obj.type + ":" + obj.id;
            query.mtime = now;
            db[op]("bk_connection", query, options, function(err) {
                if (err) return next(err);
                self.metrics.Counter(op + "_" + obj.type + '_0').inc();
                next();
            });
        },
        function(next) {
            // Reverse connection, a reference
            if (options.noreference) return next();
            query.id = obj.id;
            query.type = obj.type + ":"+ id;
            if (options.alias) query.alias = options.alias;
            db[op]("bk_reference", query, options, function(err) {
                // Remove on error
                if (err && (op == "add" || op == "put")) return db.del("bk_connection", { id: id, type: obj.type + ":" + obj.id }, function() { next(err); });
                next(err);
            });
        },
        function(next) {
            // Keep track of all connection counters
            if (options.nocounter || (op != "add" && op != "put")) return next();
            self.incrAutoCounter(id, obj.type + '0', 1, options, function(err) { next() });
        },
        function(next) {
            if (options.nocounter || (op != "add" && op != "put")) return next();
            self.incrAutoCounter(obj.id, obj.type + '1', 1, options, function(err) { next(); });
        },
        function(next) {
            // Notify about connection the other side
            if (!options.publish) return next();
            self.publish(obj.id, { path: "/connection/" + op, mtime: now, alias: options.alias || obj.alias, type: obj.type }, options);
            next();
        },
        function(next) {
            // We need to know if the other side is connected too, this will save one extra API call later
            if (!options.connected) return next();
            db.get("bk_connection", { id: obj.id, type: obj.type + ":" + id }, options, function(err, row) {
                if (row) result = row;
                next(err);
            });
        },
        ], function(err) {
            callback(err, result);
    });
}

// Lower level connection deletion, for given account `id`, the other id and type is in the `obj`, performs deletion of all
// connections. If any of obj.id or obj.type are not specified then perform a query for matching connections and delete only matched connection.
api.deleteConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();

    function del(row, cb) {
        self.metrics.Counter('del_' + row.type + '_0').inc();

        core.series([
           function(next) {
               db.del("bk_connection", { id: id, type: row.type + ":" + row.id }, options, next);
           },
           function(next) {
               if (options.nocounter) return next();
               self.incrAutoCounter(id, row.type + '0', -1, options, function() { next(); });
           },
           function(next) {
               if (options.noreference) return next();
               db.del("bk_reference", { id: row.id, type: row.type + ":" + id }, options, next);
           },
           function(next) {
               if (options.nocounter) return next();
               if (options.noreference) return next();
               self.incrAutoCounter(row.id, row.type + '1', -1, options, function() { next() });
           }
           ], function(err) {
               cb(err, []);
        });
    }

    // Check for allowed connection types
    if (obj.type) {
        if (self.allowConnection[obj.type] && !self.allowConnection[obj.type]['del']) return callback({ status: 400, message: "cannot delete connection"});
    }

    // Single deletion
    if (obj.id && obj.type) return del(obj, callback);

    // Delete by query, my records
    db.select("bk_connection", { id: id, type: obj.type ? (obj.type + ":" + (obj.id || "")) : "" }, options, function(err, rows) {
        if (err) return callback(err, []);

        core.forEachSeries(rows, function(row, next) {
            if (obj.id && row.id != obj.id) return next();
            if (obj.type && row.type != obj.type) return next();
            // Silently skip connections we cannot delete
            if (self.allowConnection[row.type] && !self.allowConnection[row.type]['del']) return next();
            del(row, next);
        }, function(err) {
            callback(err, []);
        });
    });
}

// Perform locations search, request comes from the Express server, callback will takes err and data to be returned back to the client, this function
// is used in `/location/get` request. It can be used in the applications with customized input and output if neccesary for the application specific logic.
//
// Example
//
//          # Request will look like: /recent/locations?latitude=34.1&longitude=-118.1&mtime=123456789
//          this.app.all(/^\/recent\/locations$/, function(req, res) {
//              var options = self.getOptions(req);
//              options.keys = ["geohash","mtime"];
//              options.ops = { mtime: 'gt' };
//              options.details = true;
//              self.getLocations(req, options, function(err, data) {
//                  self.sendJSON(req, err, data);
//              });
//          });
//
api.getLocation = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var table = options.table || "bk_location";

    // Continue pagination using the search token, it carries all query and pagination info
    if (options.token && options.token.geohash && options.token.latitude && options.token.longitude) {
        var token = options.token;
        delete options.token;
        for (var p in token) options[p] = token[p];
        req.query.latitude = options.latitude;
        req.query.longitude = options.longitude;
        req.query.distance = options.distance;
    }

    // Perform location search based on hash key that covers the whole region for our configured max distance
    if (!req.query.latitude && !req.query.longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Limit the distance within our configured range
    req.query.distance = core.toNumber(req.query.distance, 0, core.minDistance, core.minDistance, core.maxDistance);

    // Rounded distance, not precise to keep from pin-pointing locations
    if (typeof options.round == "undefined") options.round = core.minDistance;

    db.getLocations(table, req.query, options, function(err, rows, info) {
        logger.debug("getLocations:", req.account.id, 'GEO:', req.query.latitude, req.query.longitude, req.query.distance, options.geohash || "", 'NEXT:', info || '', 'ROWS:', rows.length);
        // Return accounts with locations
        if (core.toNumber(options.details) && rows.length && table != "bk_account") {

            self.listAccount(rows, { select: options.select }, function(err, rows) {
                if (err) return self.sendReply(res, err);
                callback(null, self.getResultPage(req, options, rows, info));
            });
        } else {
            callback(null, self.getResultPage(req, options, rows, info));
        }
    });
}

// Save location coordinates for current account, this function is called by the `/location/put` API call
api.putLocation = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var table = options.table || "bk_location";

    var latitude = req.query.latitude, longitude = req.query.longitude;
    if (!latitude || !longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Get current location
    db.get("bk_account", { id: req.account.id }, function(err, old) {
        if (err || !old) return callback(err ? err : { status: 404, mesage: "account not found"});

        // Build new location record
        var geo = core.geoHash(latitude, longitude);

        // Skip if within minimal distance
        if (old.latitude || old.longitude) {
            var distance = utils.geoDistance(old.latitude, old.longitude, latitude, longitude);
            if (distance == null || distance <= core.minDistance) {
                return callback({ status: 305, message: "ignored, min distance: " + core.minDistance});
            }
        }

        req.query.ltime = now;
        req.query.id = req.account.id;
        req.query.geohash = geo.geohash;
        // Return new and old coordinates
        req.query.old = { geohash: old.geohash, latitude: old.latitude, longitude: old.longtiude };

        var obj = { id: req.account.id, geohash: geo.geohash, latitude: latitude, longitude: longitude, ltime: now, location: req.query.location };
        db.update("bk_account", obj, function(err) {
            if (err) return callback(err);

            // Just keep accounts with locations or if we use accounts as the location storage
            if (options.nolocation || table == "bk_account") return callback(null, req.query);

            // Update all account columns in the location, they are very tightly connected and custom filters can
            // be used for filtering locations based on other account properties like gender.
            var cols = db.getColumns("bk_location", options);
            for (var p in cols) if (old[p] && !req.query[p]) req.query[p] = old[p];

            db.put("bk_location", req.query, function(err) {
                if (err) return callback(err);

                // Never been updated yet, nothing to delete
                if (!old.geohash || old.geohash == geo.geohash) return callback(null, req.query);

                // Delete the old location, ignore the error but still log it
                db.del("bk_location", old, function() {
                    callback(null, req.query);
                });
            });
        });
    });
}

// Return archived messages, used in /message/get API call
api.getArchiveMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
api.getSentMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_sent", req.query, options, callback);
}

// Return new/unread messages, used in /message/get API call
api.getMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";
    options.noprocessrows = 1;

    // If asked for a total with _archive/_trash we have to retrieve all messages but return only the count
    var total = core.toBool(options.total);
    if (total && core.toBool(options.archive) || core.toBool(options.trash)) {
        options.total = 0;
    }
    function del(rows, next) {
        core.forEachLimit(rows, options.concurrency || 1, function(row, next2) {
            db.del("bk_message", row, options, function() { next2() });
        }, next);
    }

    function details(rows, info, next) {
        if (options.total) return next(null, rows, info);
        if (total) return next(null, [{ count: rows.count }], info);
        if (!core.toNumber(options.details)) return next(null, rows, info);
        self.listAccount(rows, { key: 'sender', select: options.select }, function(err, rows) { next(err, rows, info); });
    }

    db.select("bk_message", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        options.ops = null;
        // Move to archive
        if (core.toBool(options.archive)) {
            core.forEachSeries(rows, function(row, next) {
                db.put("bk_archive", row, options, next);
            }, function(err) {
                if (err) return callback(err, []);

                // Delete from the new after we archived it
                del(rows, function() {
                    if (!options.noprocessrows) db.processRows(null, "bk_message", rows, options);
                    details(rows, info, callback);
                });
            });
        } else

        // Delete after read, if we crash now new messages will never be delivered
        if (core.toBool(options.trash)) {
            del(rows, function() {
                db.processRows(null, "bk_message", rows, options);
                details(rows, info, callback);
            });
        } else {
            db.processRows(null, "bk_message", rows, options);
            details(rows, info, callback);
        }
    });
}

// Mark a message as archived, used in /message/archive API call
api.archiveMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    if (!req.query.sender || !req.query.mtime) return callback({ status: 400, message: "sender and mtime are required" });

    req.query.id = req.account.id;
    req.query.mtime = req.query.mtime + ":" + req.query.sender;
    db.get("bk_message", req.query, options, function(err, row, info) {
        if (err) return callback(err, []);
        if (!row) return callback({ status: 404, message: "not found" }, []);

        options.ops = null;
        row.mtime += ":" + row.sender;
        db.put("bk_archive", row, options, function(err) {
            if (err) return callback(err, []);

            db.del("bk_message", row, options, function(err) {
                callback(err, row, info);
            });
        });
    });
}

// Add new message, used in /message/add API call
api.addMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var now = Date.now();
    var info = {};
    var op = options.op || "add";
    var sent = core.cloneObj(req.query);
    var obj = core.cloneObj(req.query);

    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    core.series([
        function(next) {
            obj.sender = req.account.id;
            obj.alias = req.account.alias;
            obj.mtime = now + ":" + pbj.sender;
            self.putIcon(req, obj.id, { prefix: 'message', type: obj.mtime }, function(err, icon) {
                obj.icon = icon ? 1 : 0;
                next(err);
            });
        },
        function(next) {
            db[op]("bk_message", obj, options, function(err, rows, info2) {
                info = info2;
                next(err);
            });
        },
        function(next) {
            if (options.nocounter) return next();
            self.incrAutoCounter(req.account.id, 'msg0', 1, options, function() { next(); });
        },
        function(next) {
            if (options.nocounter) return next();
            self.incrAutoCounter(req.query.id, 'msg1', 1, options, function() { next(); });
        },
        function(next) {
            sent.id = req.account.id;
            sent.recipient = req.query.id;
            sent.mtime = now + ':' + sent.recipient;
            if (options.nosent) return next();
            db[op]("bk_sent", sent, options, function(err, rows) {
                if (err) return db.del("bk_message", req.query, function() { next(err); });
                next();
            });
        },
        function(next) {
            if (!options.publish || req.query.id == req.account.id) return next();
            self.publish(req.query.id, { path: req.path, mtime: now, alias: req.account.alias, msg: (req.query.msg || "").substr(0, 128) }, options);
            next();
        },
        ], function(err) {
            if (err) return callback(err);
            self.metrics.Counter('msg_add_0').inc();
            if (options.nosent) {
                db.processRows("", "bk_message", obj, options);
                callback(null, obj, info);
            } else {
                db.processRows("", "bk_sent", sent, options);
                callback(null, sent, info);
            }
    });
}

// Delete a message or all messages for the given account from the given sender, used in /message/del` API call
api.delMessage = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    var table = options.table || "bk_message";
    var sender = options.sender || "sender";

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    // Single deletion
    if (req.query.mtime && req.query[sender]) {
        return db.del(table, { id: req.account.id, mtime: req.query.mtime + ":" + req.query[sender] }, options, function(err) {
            if (err || !req.query.icon) return callback(err, []);
            self.delIcon(req.account.id, { prefix: "message", type: req.query.mtime + ":" + req.query[sender] }, callback);
        });
    }

    // Delete by query
    db.select(table, { id: req.account.id, mtime: (req.query.mtime ? (req.query.mtime + ":") + (req.query[sender] || "") : "") }, options, function(err, rows) {
        if (err) return callback(err, []);

        options.ops = null;
        core.forEachSeries(rows, function(row, next) {
            if (req.query[sender] && row[sender] != req.query[sender]) return next();
            row.mtime += ":" + row[sender];
            db.del(table, row, function(err) {
                if (err || !row.icon) return next(err);
                self.delIcon(req.account.id, { prefix: "message", type: row.mtime }, next);
            });
        }, callback);
    });
}

// Delete the messages in the archive, used in /message/del/archive` API call
api.delArchiveMessage = function(req, options, callback)
{
    var self = this;
    options.table = "bk_archive";
    options.sender = "sender";
    this.delMessage(req, options, callback);
}

// Delete the messages i sent, used in /message/del/sent` API call
api.delSentMessage = function(req, options, callback)
{
    var self = this;
    options.table = "bk_sent";
    options.sender = "recipient";
    this.delMessage(req, options, callback);
}

// Return an account, used in /account/get API call
api.getAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    if (!req.query.id) {
        db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) return callback({ status: 404, message: "account not found" });

            // Setup session cookies for automatic authentication without signing
            if (typeof req.options.session != "undefined" && req.session) {
                if (options.session) {
                    var sig = core.signRequest(req.account.login, req.account.secret, "", req.headers.host, "", { sigversion: 2, expires: self.sessionAge });
                    req.session["bk-signature"] = sig["bk-signature"];
                } else {
                    delete req.session["bk-signature"];
                }
            }
            callback(null, row, info);
        });
    } else {
        db.list("bk_account", req.query.id, options, callback);
    }
}

// Send Push notification to the account, the actual transport delivery must be setup before calling this and passed in the options
// as handler: property which accepts the same arguments as this function. The delivery is not guaranteed, only will be sent if the account is considered
// "offline" according to the status and/or idle time. If the messages was queued for delivery, the row returned will contain the property sent:.
// The options may contain the following:
//  - msg - message text to send
//  - badge - a badge number to be sent
//  - prefix - prepend the message with this prefix
//  - check - check the account status, if not specified the message will be sent unconditionally otherwise only if idle
//  - allow - the account property to check if notifications are enabled, must be a boolean true or number > 0 to flag it is enabled, if it is an Array then
//      all properties in the array are checked against the account properties and all must allow notifications. If it is an object then only the object properties and values are checked.
//  - skip - Array or an object with account ids which should be skipped, this is for mass sending in order to reuse the same options
//  - logging - logging level about the notification send status, default is debug, can be any valid logger level, must be a string, not a number
//  - service - name of the standard delivery service supported by the backend, it is be used instead of custom handler, one of the following: apple, google
//  - device_id - the device to send the message to instesd of the device_id property fro the account record
//
// In addition the device_id can be saved in the format service://id where the service is one of the supported delivery services, this way the notification
// system will pick the right delivery service depending on the device id, the default service is apple.
api.notifyAccount = function(id, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var ipc = core.modules.ipc;
    if (!id || !options) return callback({ status: 500, message: "invalid arguments, id, and options.handler must be provided" }, {});

    options = core.cloneObj(options);
    // Skip this account
    switch (core.typeName(options.skip)) {
    case "array":
        if (options.skip.indexOf(id) > -1) return callback({ status: 400, message: "skipped" }, {});
        break;
    case "object":
        if (options.skip[id]) return callback({ status: 400, message: "skipped" }, {});
        break;
    }

    this.getStatus(id, {}, function(err, status) {
        if (err || (options.check && status.online)) return callback(err, status);

        db.get("bk_account", { id: id }, function(err, account) {
            if (err || !account) return callback(err || { status: 404, message: "account not found" }, status);
            if (!account.device_id && !options.device_id) return callback({ status: 404, message: "device not found" }, status);

            switch (core.typeName(options.allow)) {
            case "array":
                if (options.allow.some(function(x) { return !account[x] })) return callback({ status: 401, message: "not allowed" }, status);
                break;

            case "object":
                for (var p in options.allow) if (!options.allow[x]) return callback({ status: 401, message: "not allowed" }, status);
                break;

            case "string":
                if (!account[options.allow]) return callback({ status: 401, message: "not allowed" }, status);
                break;
            }

            // Ready to send now, set additional properties, if if the options will be reused we overwrite the same properties for each account
            options.status = status;
            options.account = account;
            if (!options.device_id) options.device_id = account.device_id;
            if (options.prefix) options.msg = options.prefix + " " + (options.msg || "");
            msg.send(options, function(err) {
                status.device_id = account.device_id;
                status.sent = err ? false : true;
                logger.logger(err ? "error" : (options.logging || "debug"), "notifyAccount:", id, account.alias, account.device_id, status, err || "");
                callback(err, status);
            });
        });
    });
}

// Return account details for the list of rows, options.key specified the column to use for the account id in the `rows`, or `id` will be used.
// The result accounts are cleaned for public columns, all original properties from the `rows` are kept as is.
// If options.existing is 1 then return only record with found accounts, all other records in the rows will be deleted
api.listAccount = function(rows, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var key = options.key || "id";
    var map = {};
    rows.forEach(function(x) { if (!map[x[key]]) map[x[key]] = []; map[x[key]].push(x); });
    db.list("bk_account", Object.keys(map).map(function(x) { return { id: x } }), { select: options.select }, function(err, list, info) {
        if (err) return callback(err, []);

        self.checkPublicColumns("bk_account", list, options);
        list.forEach(function(x) {
            map[x.id].forEach(function(row) {
                for (var p in x) if (!row[p]) row[p] = x[p];
                if (options.existing) row._id = 1;
            });
        });
        // Remove rows without account info
        if (options.existing) rows = rows.filter(function(x) { return x._id; }).map(function(x) { delete x._id; return x; });
        callback(null, rows, info);
    });
}

// Query accounts, used in /accout/select API call, simple wrapper around db.select but can be replaced in the apps while using the same API endpoint
api.selectAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    db.select("bk_account", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);
        callback(err, self.getResultPage(req, options, rows, info));
    });
}

// Register new account, used in /account/add API call
api.addAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    // Verify required fields
    if (!req.query.name) return callback({ status: 400, message: "name is required"});
    if (!req.query.alias) req.query.alias = req.query.name;
    req.query.id = core.uuid();
    req.query.mtime = req.query.ctime = Date.now();

    core.series([
       function(next) {
           if (options.noauth) return next();
           if (!req.query.secret) return next({ status: 400, message: "secret is required"});
           if (!req.query.login) return next({ status: 400, message: "login is required"});
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = core.cloneObj(req.query);
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");
           self.clearQuery(query, options, "bk_auth", "priv");
           db.add("bk_auth", query, options, next);
       },
       function(next) {
           var query = core.cloneObj(req.query);
           // Only admin can add accounts with admin properties
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_account", "admin");
           self.clearQuery(query, options, "bk_account", "priv");
           self.clearQuery(query, options, "bk_account", "location");

           db.add("bk_account", query, function(err) {
               // Remove the record by login to make sure we can recreate it later
               if (err && !options.noauth) return db.del("bk_auth", { login: req.query.login }, function() { next(err); });
               next(err);
           });
       },
       function(next) {
           self.metrics.Counter('auth_add_0').inc();
           db.processRows(null, "bk_account", req.query, options);
           // Link account record for other middleware
           req.account = req.query;
           // Set all default values because we return in-memory record, not from the database
           var cols = db.getColumns("bk_account", options);
           for (var p in cols) if (typeof cols[p].value != "undefined") req.query[p] = cols[p].value;
           // Some dbs require the record to exist, just make one with default values
           db.put("bk_counter", req.query, function() { next(); });
       },
       ], function(err) {
            callback(err, req.query);
    });
}

// Update existing account, used in /account/update API call
api.updateAccount = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;
    req.query.mtime = Date.now();
    req.query.id = req.account.id;
    // Cannot reset account alias
    if (!req.query.alias) delete req.query.alias;

    core.series([
       function(next) {
           if (options.noauth) return next();
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = core.cloneObj(req.query);
           // Skip admin properties if any
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");
           self.clearQuery(query, options, "bk_auth", "priv");
           query.login = req.account.login;
           // Avoid updating bk_auth and flushing cache if nothing to update
           var obj = db.getQueryForKeys(Object.keys(db.getColumns("bk_auth", options)), query, { all_columns: 1, skip_columns: ["id","login","mtime"] });
           if (!Object.keys(obj).length) return callback(err, rows, info);
           db.update("bk_auth", query, next);
       },
       function(next) {
           self.clearQuery(req.query, options, "bk_account", "priv");
           self.clearQuery(req.query, options, "bk_account", "location");

           // Skip admin properties if any
           if (req.account.type != "admin") self.clearQuery(req.query, options, "bk_account", "admin");
           db.update("bk_account", req.query, next);
       },
       ], function(err) {
            callback(err, []);
    });
}

// Change account secret, used in /account/put/secret API call
api.setAccountSecret = function(req, options, callback)
{
    var db = core.modules.db;
    if (!req.query.secret) return callback({ status: 400, message: "secret is required" });
    req.account.secret = req.query.secret;
    db.update("bk_auth", req.account, options, callback);
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain keep: {} object with table names to be kept without the bk_ prefix, for example
// delete an account but keep all messages and location: keep: { message: 1, location: 1 }
api.deleteAccount = function(id, options, callback)
{
    var self = this;

    if (!id) return callback({ status: 400, message: "id must be specified" });

    var db = core.modules.db;
    if (!options.keep) options.keep = {};
    options.count = 1000000;

    db.get("bk_account", { id: id }, options, function(err, obj) {
        if (err) return callback(err);
        if (!obj) return callback({ status: 404, message: "No account found" });

        core.series([
           function(next) {
               if (options.keep.auth || !obj.login) return next();
               db.del("bk_auth", { login: obj.login }, options, next);
           },
           function(next) {
               if (options.keep.account) return next();
               db.del("bk_account", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.counter) return next();
               db.del("bk_counter", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.connection) return next();
               db.select("bk_connection", { id: obj.id }, options, function(err, rows) {
                   if (err) return next(err)
                   core.forEachSeries(rows, function(row, next2) {
                       db.del("bk_reference", { id: row.id, type: row.type + ":" + obj.id }, options, function(err) {
                           db.del("bk_connection", { id: obj.id, type: row.type + ":" + row.id }, options, next2);
                       });
                   }, function() { next() });
               });
           },
           function(next) {
               if (options.keep.message) return next();
               db.delAll("bk_message", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.archive) return next();
               db.delAll("bk_archive", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.sent) return next();
               db.delAll("bk_sent", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.status) return next();
               db.del("bk_status", { id: obj.id }, options, function() { next() });
           },
           function(next) {
               if (options.keep.icon) return next();
               db.delAll("bk_icon", { id: obj.id }, options, function(err, rows) {
                   if (options.keep.images) return next();
                   // Delete all image files
                   core.forEachSeries(rows, function(row, next2) {
                       self.formatIcon(row);
                       self.delIcon(obj.id, row, next2);
                   }, function() { next() });
               });
           },
           function(next) {
               if (options.keep.location || !obj.geohash) return next();
               db.del("bk_location", obj, options, function() { next() });
           }],
           function(err) {
                if (!err) self.metrics.Counter('auth_del_0').inc();
                callback(err, obj);
        });
    });
}

// Setup statistics collections
api.initStatistics = function()
{
    var self = this;
    // Add some delay to make all workers collect not at the same time
    var delay = core.randomShort();

    self.getStatistics();
    setInterval(function() { self.getStatistics(); }, self.collectInterval * 1000);
    setInterval(function() { self.sendStatistics() }, self.collectSendInterval * 1000 - delay);

    logger.debug("initStatistics:", "delay:",  delay, "interval:", self.collectInterval, self.collectSendInterval);
}

// Updates metrics with the current values and returns an object ready to be saved in the database, i.e. flattened ito one object
// where all property names of the complex objects are combined into one name separated by comma.
api.getStatistics = function(options)
{
    var self = this;
    var now = Date.now();
    var cpus = os.cpus();
    var util = cpus.reduce(function(n, cpu) { return n + (cpu.times.user / (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq)); }, 0);
    var avg = os.loadavg();
    var mem = process.memoryUsage();
    // Cache stats are always behind
    ipc.stats(function(data) { self.metrics.cache = data });
    this.metrics.mtime = now;
    this.metrics.app = core.appName + "/" + core.appVersion;
    this.metrics.ip = core.ipaddr;
    this.metrics.pid = process.pid;
    this.metrics.ctime = core.ctime;
    this.metrics.cpus = core.maxCPUs;
    this.metrics.mem = os.totalmem();
    this.metrics.instance = core.instance.id;
    this.metrics.worker = core.workerId || '0';
    this.metrics.id = core.ipaddr + '-' + process.pid;
    this.metrics.latency = utils.getBusy();
    this.metrics.Histogram('rss').update(mem.rss);
    this.metrics.Histogram('heap').update(mem.heapUsed);
    this.metrics.Histogram('avg').update(avg[2]);
    this.metrics.Histogram('free').update(os.freemem());
    this.metrics.Histogram("util").update(util * 100 / cpus.length);
    this.metrics.pool = core.modules.db.getPool().metrics;

    // Convert into simple object with all deep properties using names concatenated with dots
    var obj = core.flattenObj(this.metrics.toJSON(), { separator: '_' });

    // Clear all counters to make a snapshot and start over, this way in the monitoring station it is only needd to be summed up without
    // tracking any other states, the naming convention is to use _0 for snapshot counters.
    if (options && options.clear) this.metrics.reset(/\_0$/);
    return obj;
}

// Send collected statistics to the collection server, `backend-host` must be configured and possibly `backend-login` and `backend-secret` in case
// the system API is secured, the user can be any valid user registered in the bk_auth table.
api.sendStatistics = function()
{
    var self = this;

    if (!self.collectHost) return {};

    var obj = this.getStatistics({ clear: 1 });

    // Using local db connection, this is usefull in case of distributed database where there is no
    // need for the collection ost in the middle.
    if (self.collectHost == "pool") return self.saveStatistics(obj);

    // Send to the collection host for storing in the special databze or due to security restrictions when
    // only HTTP is open and authentication is required
    core.sendRequest({ url: self.collectHost, method: "POST", postdata: obj, quiet: self.collectQuiet }, function(err) {
        logger.debug("sendStatistics:", self.collectHost, self.collectErrors, err || "");
        if (!err) {
            self.collectErrors = self.collectQuiet = 0;
        } else {
            // Stop reporting about collection errors
            if (++self.collectErrors > 3) self.collectQuiet = 1;
        }
    });
    return obj;
}

// Save collected statistics in the bk_collect table, this can be called via API or directly by the backend, this wrapper
// is supposed to be overrriden by the application with additional logic how the statistics is saved. Columns in the bk_collect table
// must be defined for any metrics to be saved, use api.describeTable with additional columns from the api.metrics object in additional to the default ones.
//
// Example, add pool cache stats to the table
//
//          api.describeTable({ bk_collect: { pool_cache_rmean: { type: "real" },
//                                            pool_cache_hmean: { type: "real" } });
//
api.saveStatistics = function(obj, callback)
{
    var self = this;
    core.modules.db.add("bk_collect", obj, { pool: self.collectPool, skip_null: true }, callback);
}

// Calculate statistics for a period of time, query and options must confirm to the db.select conventions.
api.calcStatistics = function(query, options, callback)
{
    var self = this;
    if (typeof optinons == "function") callback = options, options = null;
    if (!options) options = {};
    var db = core.modules.db;
    // Default sample interval
    if (!options.interval) options.interval = 300000;

    db.select("bk_collect", query, options, function(err, rows) {
        var series = {}, totals = {};
        rows.forEach(function(x) {
            var avg = {}, agg = {};
            // Extract properties to be shown by type
            for (var p in x) {
                if (typeof x[p] != "number") continue;
                if (p.slice(p.length - 2) == "_0") {
                    agg[p] = x[p];
                } else {
                    avg[p] = x[p];
                }
            }

            // Aggregate by specified interval
            var mtime = Math.round(x.mtime/options.interval)*options.interval;
            if (!series[mtime]) {
                series[mtime] = {};
                totals[mtime] = {};
            }
            for (var y in avg) {
                if (!totals[mtime][y]) totals[mtime][y] = 0;
                if (!series[mtime][y]) series[mtime][y] = 0;
                totals[mtime][y]++;
                series[mtime][y] += avg[y];
            }
            for (var y in agg) {
                if (!series[mtime][y]) series[mtime][y] = 0;
                series[mtime][y] += agg[y];
            }
        });
        rows = [];
        Object.keys(series).sort().forEach(function(x) {
            var obj = { mtime: core.toNumber(x) };
            for (var y in series[x]) {
                if (totals[x][y]) series[x][y] /= totals[x][y];
                obj[y] = series[x][y];
            }
            rows.push(obj);
        });
        callback(null, rows);
    });
}

