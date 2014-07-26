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
var async = require('async');
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
var metrics = require(__dirname + '/metrics');
var printf = require('printf');
var logger = require(__dirname + '/logger');
var backend = require(__dirname + '/build/Release/backend');

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
                      alias: { pub: 1 },
                      status: {},
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
                      geohash: { location: 1 },                         // To prevent regular account updates
                      latitude: { type: "real", location: 1 },          // overriding location columns
                      longitude: { type: "real", location: 1 },
                      location: { location: 1 },
                      ltime: { type: "bigint", location: 1 },           // Last location update time
                      ctime: { type: "bigint", readonly: 1, now: 1 },   // Create time
                      mtime: { type: "bigint", now: 1 } },              // Last update time

       // Status/presence support
       bk_status: { id: { primary: 1 },                               // account id
                    status: { value: "online" },                      // status, online, offline, away
                    mtime: { type: "bigint", now: 1 }},               // last status change time

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
       bk_location: { geohash: { primary: 1 },                    // geohash, minDistance defines the size
                      id: { primary: 1, pub: 1 },                 // my account id, part of the primary key for pagination
                      latitude: { type: "real" },
                      longitude: { type: "real" },
                      alias: { pub: 1 },
                      mtime: { type: "bigint", now: 1 }},

       // All connections between accounts: like,dislike,friend...
       bk_connection: { id: { primary: 1, pub: 1 },                    // my account_id
                        type: { primary: 1, pub: 1 },                  // type:connection
                        connection: {},                                // other id of the connection
                        status: {},
                        mtime: { type: "bigint", now: 1, pub: 1 }},

       // References from other accounts, likes,dislikes...
       bk_reference: { id: { primary: 1, pub: 1 },                    // account_id
                       type: { primary: 1, pub: 1 },                  // type:connection
                       connection: {},                                // other id of the connection
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

       // Collected stats
       bk_collect: { id: { primary: 1 },
                     mtime: { type: "bigint", primary: 1 },
                     ctime: { type: "bigint" },
                     type: {},
                     ip: {},
                     instance: {},
                     latency: { type: "int" },
                     cpus: { type: "int" },
                     api: { type: "json" },
                     pool: { type: "json" },
                     urls: { type: "json" },
                     connections: { type: "json" },
                     accounts: { type: "json" },
                     messages: { type: "json" },
                     rss: { type: "json" },
                     heap: { type: "json" },
                     loadavg: { type: "json" },
                     freemem: { type: "json" },
                     totalmem: { type: "json" },
                     util: { type: "json" },
                     cache: { type: "json" },
                     data: { type: "json" }},

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
    // Refuse access to these urls
    deny: {},

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    filesS3: '',

    // Disabled API endpoints
    disable: [],
    disableSession: {},
    caching: [],
    unsecure: [],
    templating: "ejs",

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

    // Intervals between updating presence status table
    statusInterval: 900,

    // Default busy latency 1 sec
    busyLatency: 1000,

    // API related limts
    allowConnection: {},
    iconLimit: {},

    // Metrics and stats
    metrics: new metrics.Metrics('host', '', 'pid', process.pid, 'ip', '', 'instance', '', 'latency', 0, 'cpus', 0, 'ctime', 0, 'mtime', Date.now(),
                                 'api', new metrics.Metrics(),
                                 'urls', new metrics.Metrics(),
                                 'accounts', new metrics.Metrics(),
                                 'messages', new metrics.Metrics(),
                                 'connections', new metrics.Metrics()),

    // Default endpoints
    endpoints: { "account": 'initAccountAPI',
                 "status": "initStatusAPI",
                 "connection": 'initConnectionAPI',
                 "location": 'initLocationAPI',
                 "counter": 'initCounterAPI',
                 "icon": 'initIconAPI',
                 "message": 'initMessageAPI',
                 "system": "initSystemAPI",
                 "data": 'initDataAPI' },

    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path and trailing slash at the end" },
           { name: "images-s3", descr: "S3 bucket name where to store and retrieve images" },
           { name: "images-raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and account id in the image name" },
           { name: "images-s3-options", type:" json", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
           { name: "files-s3", descr: "S3 bucket name where to store files" },
           { name: "busy-latency", type: "number", min: 11, descr: "Max time in ms for a request to wait in the queue, if exceeds this value server returns too busy error" },
           { name: "access-log", descr: "File for access logging" },
           { name: "no-access-log", type: "bool", descr: "Disable access logging in both file or syslog" },
           { name: "no-static", type: "bool", descr: "Disable static files from /web folder, no .js or .html files will be served by the server" },
           { name: "no-templating", type: "bool", descr: "Disable templating engine completely" },
           { name: "templating", descr: "Templating engne to use, see consolidate.js for supported engines, default is ejs" },
           { name: "no-session", type: "bool", descr: "Disable cookie session support, all requests must be signed for Web clients" },
           { name: "session-age", type: "int", descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-secret", descr: "Secret for session cookies, session support enabled only if it is not empty" },
           { name: "unsecure", type: "list", array: 1, descr: "Allow API functions to retrieve and show all columns, not just public, this exposes the database to every authenticated call, use with caution" },
           { name: "disable", type: "list", descr: "Disable default API by endpoint name: account, message, icon....." },
           { name: "disable-session", type: "regexpmap", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-connection", type: "map", descr: "Map of connection type to operations to be allowed only, once a type is specified, all operations must be defined, the format is: type:op,type:op..." },
           { name: "allow-admin", type: "regexpmap", descr: "URLs which can be accessed by admin accounts only, can be partial urls or Regexp, this is a convenient options which registers AuthCheck callback for the given endpoints" },
           { name: "icon-limit", type: "intmap", descr: "Set the limit of how many icons by type can be uploaded by an account, type:N,type:N..., type * means global limit for any icon type" },
           { name: "allow", type: "regexpmap", set: 1, descr: "Regexp for URLs that dont need credentials, replace the whole access list" },
           { name: "allow-path", type: "regexpmap", key: "allow", descr: "Add to the list of allowed URL paths without authentication" },
           { name: "disallow-path", type: "regexpmap", key: "allow", del: 1, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove ^/account/add$ to disable open registration" },
           { name: "allow-ssl", type: "regexpmap", descr: "Add to the list of allowed URL paths using HTRPs only, plain HTTP requetss to these urls will be refused" },
           { name: "deny", type:" regexpmap", set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", type: "regexpmap", key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events before closing the connection, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 0, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
           { name: "status-interval", type: "number", descr: "Number of seconds between status record updates" },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10, descr: "Max size for uploads, bytes"  }],
}

module.exports = api;

// Initialize API layer, this must be called before the `api` module can be used but it is called by the server module automatically so `api.init` is
// rearely need to called directly, only for new server implementation or if using in the shell for testing.
//
// During the init sequence, this function calls `api.initMiddleware` and `api.initApplication` methods which by default are empty but can be redefined in the user aplications.
//
// The backend.js uses its own request parser that places query parameters into `req.query` or `req.body` depending on the method.
//
// For GET method, `req.query` contains all url-encoded parameters, for POST method `req.body` contains url-encoded parameters or parsed JSON payload or multipart payload.
//
// The reason not to do this by default is that this may not be the alwayse wanted case and distinguishing data coming in the request or in the body may be desirable,
// also, this will needed only for Express handlers `.all`, when registering handler by method like `.get` or `.post` then the handler needs to deal with only either source of the request data.
//
api.init = function(callback)
{
    var self = this;
    var db = core.context.db;

    // Performance statistics
    self.initStatistics();

    self.app = express();

    // Setup toobusy timer to detect when our requests waiting in the queue for too long
    if (this.busyLatency) backend.initBusy(this.busyLatency);

    // Latency watcher
    self.app.use(function(req, res, next) {
        if (self.busyLatency && backend.isBusy()) {
            self.metrics.api.Counter('busy').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        next();
    });

    // Allow cross site requests
    self.app.use(function(req, res, next) {
        res.header('Server', core.name + '/' + core.version + " " + core.appVersion);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'bk-signature');
        next();
    });

    // Metrics starts early
    self.app.use(function(req, res, next) {
        self.metrics.api.Histogram('queue').update(self.metrics.api.Counter('count').inc());
        req.metric1 = self.metrics.api.Timer('response').start();
        req.metric2 = self.metrics.urls.Timer(req.path).start();
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.end = end;
            res.end(chunk, encoding);
            self.metrics.api.Counter('count').dec();
            req.metric1.end();
            req.metric2.end();
            // Ignore not allowed
            if (req._noEndpoint || req._noSignature) delete self.metrics.urls.metrics[req.path];
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
                       (req.account.id || "-") + "\n";
            self.accesslog.write(line);
        }
        next();
    });

    // Request parsers
    self.app.use(cookieParser());
    self.app.use(function(req, res, next) { return self.checkQuery(req, res, next); });
    self.app.use(function(req, res, next) { return self.checkBody(req, res, next); });

    // Keep session in the cookies
    if (!self.noSession) {
        self.app.use(session({ key: 'bk_sid', secret: self.sessionSecret || core.name, cookie: { path: '/', httpOnly: false, maxAge: self.sessionAge || null } }));
    }

    // Check the signature
    self.app.use(function(req, res, next) { return self.checkRequest(req, res, next); });

    // Assign custom middleware just after the security handler
    self.initMiddleware.call(self);

    // Custom routes
    self.app.use(self.app.router);

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
        res.send(200);
    });

    // Return images by prefix, id and possibly type
    self.app.all(/^\/image\/([a-z]+)\/([a-z0-9-]+)\/?([0-9])?$/, function(req, res) {
        req.query.prefix = req.params[0];
        req.query.type = req.params[2];
        self.getIcon(req, res, req.params[1], {});
    });

    // Managing accounts, basic functionality
    for (var p in self.endpoints) {
        if (self.disable.indexOf(p) == -1) self[self.endpoints[p]].call(this);
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
    self.initApplication.call(self, function(err) {
        // Setup all tables
        self.initTables(function(err) {

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

            if (callback) callback.call(self, err);
        });
    });
    self.exiting = false;
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    var self = this;
    if (this.exiting) return;
    this.exiting = true;
    logger.log('api.shutdown: started');
    var timeout = callback ? setTimeout(callback, self.shutdownTimeout || 30000) : null;
    var db = core.context.db;
    async.parallel([
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
            var pools = db.getPools();
            try {
                async.forEachLimit(pools, pools.length, function(pool, next) { db.dbpool[pool.name].shutdown(next); }, callback);
            } catch(e) {
                logger.error("api.shutdown:", e.stack);
                if (callback) callback();
            }
        });
}

// Start Express middleware processing wrapped in the node domain
api.handleServerRequest = function(req, res)
{
    var api = core.context.api;
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

// This handler is called after the Express server has been setup and all default API endpoints initialized but the server
// is not ready for incoming requests yet. This handler can setup additional API endpoints, add/modify table descriptions.
api.initApplication = function(callback) { callback() };

// This handler is called during the Express server initialization just after the security middleware.
// this.app refers to the Express instance.
api.initMiddleware = function() {};

// This handler is called during the master server startup, this is the process that monitors the worker jobs and performs jobs scheduling
api.initMasterServer = function() {}

// This handler is called during the Web server startup, this is the master process that creates Web workers for handling Web requests, this process
// interacts with the Web workers via IPC sockets between processes and relaunches them if any Web worker dies.
api.initWebServer = function() {}

// This handler is called on job worker instance startup after the tables are intialized and it is ready to process the job
api.initWorker = function(callback) { callback() }

// Perform authorization of the incoming request for access and permissions
api.checkRequest = function(req, res, callback)
{
    var self = this;

    // Request options that the API routes will merge with, can be used by pre process hooks
    var path = req.path.split("/");
    req.options = { ops: {}, noscan: 1, path: [ path[1] || "", path[2] || "", path[3] || "" ], cleanup: "bk_" + path[1] };
    req.account = {};

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
            // the most obvous case is for a Web app to perform redirection on authentication failure
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
            next(err);
        }
    });
    form.parse(req);
}

// Perform URL based access checks
// Check access permissions, calls the callback with the following argument:
// - nothing if checkSignature needs to be called
// - an object with status: 200 to skip authorization and proceed with the next module
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
        async.forEachSeries(hooks, function(hook, next) {
            logger.debug('checkAccess:', req.method, req.path, hook.path);
            hook.callbacks.call(self, req, function(err) {
                if (err && err.status != 200) return next(err);
                next();
            });
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
        async.forEachSeries(hooks, function(hook, next) {
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

    // Make sure it is not expired, it may be milliseconds or ISO date
    if (sig.expires <= Date.now()) {
        return callback({ status: 406, message: "Expired request" });
    }

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    core.context.db.get("bk_auth", { login: sig.login }, function(err, account) {
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
        if (!core.checkSignature(sig, account)) {
            logger.debug('checkSignature:', 'failed', sig, account);
            return callback({ status: 401, message: "Not authenticated" });
        }

        // Save account and signature in the request, it will be used later
        req.signature = sig;
        req.account = account;
        req.options.account = { id: req.account.id, login: req.account.login, alias: req.account.alias };
        logger.debug(req.path, req.account, req.query);
        return callback({ status: 200, message: "Ok" });
    });
}

// Account management
api.initAccountAPI = function()
{
    var self = this;
    var db = core.context.db;

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
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select/icon":
            if (!req.query.id) req.query.id = req.account.id;
            req.query.prefix = "account";
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
    var db = core.context.db;

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
    var db = core.context.db;

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

// Messaging management
api.initMessageAPI = function()
{
    var self = this;
    var db = core.context.db;

    this.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            self.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            self.getMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, rows, info));
            });
            break;

        case "get/sent":
            self.getSentMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, rows, info));
            });
            break;

        case "get/archive":
            self.getArchiveMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, self.getResultPage(req, rows, info));
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
    var db = core.context.db;

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
    var db = core.context.db;

    this.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        switch (req.params[1]) {
        case "add":
        case "put":
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
        case "select":
            options.op = req.params[0];
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
    var db = core.context.db;

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
    var db = core.context.db;

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

        case "stats":
            res.json(self.getStatistics());
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.send('init:msg');
                break;
            }
            break;

        case "collect":
            db.put("bk_collect", req.query, options, function(err) {
                res.json({});
            });
            break;

        case "log":
            self.putFile(req, "data", { name: req.ip + "/" + core.strftime(Date.now(), "%Y-%m-%d-%H:%M"), ext: ".log" }, function(err) {
                if (err) logger.error("log:", err);
                res.json({});
            });
            break;

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
    var db = core.context.db;

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
                var token = { count: rows.length, data: rows };
                if (info.next_token) token.next_token = info.next_token;
                self.sendJSON(req, err, token);
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
    var db = core.context.db;

    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};

    db.initTables(this.tables, options, function(err) {
        // Make sure we only assign callbacks once because this can be called multiple times
        if (!self._processRow) {
            self._processRow = true;

            db.setProcessRow("bk_account", function(row, options, cols) {
                if (row.birthday) row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
            });

            function onMessageRow(row, options, cols) {
                var mtime = row.mtime.split(":");
                row.mtime = core.toNumber(mtime[0]);
                row.id = row.sender = mtime[1];
                delete row.recipient;
                if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime; else delete row.icon;
            }
            db.setProcessRow("bk_message", options, onMessageRow);
            db.setProcessRow("bk_archive", options, onMessageRow);

            db.setProcessRow("bk_sent", options, function(row, options, cols) {
                var mtime = row.mtime.split(":");
                row.mtime = core.toNumber(mtime[0]);
                row.id = row.recipient = mtime[1];
                delete row.sender;
                if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime; else delete row.icon;
            });

            function onConnectionRow(row, options, cols) {
                var type = row.type.split(":");
                row.type = type[0];
                row.id = type[1];
            }
            db.setProcessRow("bk_connection", options, onConnectionRow);
            db.setProcessRow("bk_reference", options, onConnectionRow);
            db.setProcessRow("bk_icon", options, self.checkIcon);
        }
        if (callback) callback(err);
    });
}

// Convert query options into database options, most options are the same as for `db.select` but prepended with underscore to
// distinguish control parameters from query parameters.
api.getOptions = function(req)
{
    // Boolean parameters that can be passed with 0 or 1
    ["details", "consistent", "desc", "total", "connected", "check", "noreference", "nocounter", "nopublish", "archive", "trash"].forEach(function(x) {
        if (typeof req.query["_" + x] != "undefined") req.options[x] = core.toBool(req.query["_" + x]);
    });
    if (req.query._session) req.options.session = core.toNumber(req.query._session);
    if (req.query._select) req.options.select = req.query._select;
    if (req.query._count) req.options.count = core.toNumber(req.query._count, 0, 50, 0, 100);
    if (req.query._start) req.options.start = core.base64ToJson(req.query._start, req.account.secret);
    if (req.query._token) req.options.token = core.base64ToJson(req.query._token, req.account.secret);
    if (req.query._sort) req.options.sort = req.query._sort;
    if (req.query._page) req.options.page = core.toNumber(req.query._page, 0, 0, 0, 9999);
    if (req.query._width) req.options.width = core.toNumber(req.query._width);
    if (req.query._height) req.options.height = core.toNumber(req.query._height);
    if (req.query._ext) req.options.ext = req.query._ext;
    if (req.query._quality) req.options.quality = core.toNumber(req.query._quality);
    if (req.query._round) req.options.round = core.toNumber(req.query._round);
    if (req.query._ops) {
        var ops = core.strSplit(req.query._ops);
        for (var i = 0; i < ops.length -1; i+= 2) req.options.ops[ops[i]] = ops[i+1];
    }
    // Disable check public verification and allow any pool to be used
    if (this.unsecure.indexOf(req.options.path[0]) > -1) {
        ["pool", "cleanup"].forEach(function(x) {
            if (typeof req.query['_' + x] != "undefined") req.options[x] = req.query['_' + x];;
        });
        ["noscan", "noprocessrows"].forEach(function(x) {
            if (typeof req.query["_" + x] != "undefined") req.options[x] = core.toBool(req.query["_" + x], req.options[x]);
        });
    }
    return req.options;
}

// Return an object to be returned to the client as a page of result data with possibly next token
// if present in the info. This result object can be used for pagination responses.
api.getResultPage = function(req, rows, info)
{
    var token = { count: rows.length, data: rows };
    if (info && info.next_token) token.next_token = core.jsonToBase64(info.next_token, req.account.secret);
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
    var db = core.context.db;
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

// Define new tables or extned/customize existing tables. Table definitions are used with every database operation,
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
        var cols = core.context.db.getColumns(table, options);
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
    async.forEachSeries(hooks, function(hook, next) {
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
api.sendReply = function(res, status, msg)
{
    if (status instanceof Error || status instanceof Object) {
        msg = status.message || "Error occured";
        status = typeof status.status == "number" ? status.status : typeof status.code == "number" ? status.code : 500;
    }
    if (typeof status != "number") msg = status, status = 500;
    if (!status) status = 200, msg = "";
    return this.sendStatus(res, { status: status, message: String(msg || "") });
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

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
// Verify icon limits before adding new icons
api.handleIconRequest = function(req, res, options, callback)
{
    var self = this;
    var db = core.context.db;
    var op = options.op || "put";

    options.force = true;
    options.type = req.query.type || "";
    options.prefix = req.query.prefix || "account";
    if (!req.query.id) req.query.id = req.account.id;

    // Max number of allowed icons per type or globally
    var limit = self.iconLimit[options.type] || self.iconLimit['*'];
    var icons = [];

    async.series([
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
    if (!options) options = row;
    var type = row.type.split(":");
    row.type = type.slice(1).join(":");
    row.prefix = type[0];

    if ((this.imagesUrl || options.imagesUrl) && (this.imagesRaw || options.imagesRaw)) {
        row.url = (options.imagesUrl || this.imagesUrl) + core.iconPath(row.id, row);
    } else
    if ((this.imagesS3 || options.imagesS3) && (this.imagesS3Options || options.imagesS3Options)) {
        this.imagesS3Options.url = true;
        row.url = core.context.aws.signS3("GET", options.imagesS3 || this.imagesS3, core.iconPath(row.id, row), options.imagesS3Options || this.imagesS3Options);
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
    api.formatIcon(row, options);
}

// Return list of icons for the account, used in /icon/get API call
api.selectIcon = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    options.ops = { type: "begins_with" };
    db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + (req.query.type || "") }, options, function(err, rows) {
        callback(err, rows);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.context.db;

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
    var aws = core.context.aws;
    var icon = core.iconPath(id, options);
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
            req.abort();
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
        async.forEachSeries(Object.keys(req.files), function(f, next) {
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
        var aws = core.context.aws;
        var icon = core.iconPath(id, options);
        core.scaleIcon(file, options, function(err, data) {
            if (err) return callback ? callback(err) : null;

            var headers = { 'content-type': 'image/' + (options.ext || "jpeg") };
            aws.queryS3(options.imagesS3 || self.imagesS3, icon, { method: "PUT", postdata: data, headers: headers }, function(err) {
                if (callback) callback(err, icon);
            });
        });
    } else {
        core.putIcon(file, id, options, callback);
    }
}

// Delete an icon for account, .type defines icon prefix
api.delIcon = function(id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = core.iconPath(id, options);
    logger.debug('delIcon:', id, options);

    if (this.imagesS3 || options.imagesS3) {
        var aws = core.context.aws;
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

// Upload file and store in the filesystem or S3, try to find the file in multipart form, in the body or query by the given name
// - name is the name property to look for in the multipart body or in the request body or query
// - callback will be called with err and actual filename saved
// Output file name is built according to the following options properties:
// - name - defines the basename for the file, no extention, if not given same name as property will be used
// - ext - what file extention to use, appended to name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
// - extkeep - tells always to keep actual extention from the uploaded file
// - encoding - encoding of the body, default is base64
api.putFile = function(req, name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var btype = core.typeName(req.body);
    var outfile = (options.name || name) + (options.ext || "");
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.filesS3 || options.filesS3) {
        var aws = core.context.aws;
        var headers = { 'content-type': mime.lookup(outfile) };
        var params = { method: "PUT", headers: headers }
        params[Buffer.isBuffer(tmpfile) ? 'postdata' : 'postfile'] = tmpfile;
        aws.queryS3(options.filesS3 || this.filesS3, outfile, params, function(err) {
            if (callback) callback(err, outfile);
        });
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.filesS3 || options.filesS3) {
        var aws = core.context.aws;
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
// if no options.check is set then just return the status record otherwise if the last status update is older than
// the status-interval seconds ago then the row returned is null.
// If id is an array, then return all status records for specified list of account ids, if options.check is set then only
// return status records witch last status update ocured less than status-interval seconds ago.
api.getStatus = function(id, options, callback)
{
    var self = this;
    var now = Date.now();
    var db = core.context.db;

    if (Array.isArray(id)) {
        db.list("bk_status", id, options, function(err, rows) {
            if (!err && options.check) rows = rows.filter(function(x) { return now - row.mtime <= self.statusInterval * 1000 });
            callback(err, rows);
        });
    } else {
        db.get("bk_status", { id: id }, options, function(err, row) {
            if (!err && row && options.check) {
                if (now - row.mtime > self.statusInterval * 1000) row = null;
            }
            callback(err, row);
        });
    }
}

// Maintain online status , update every status-interval seconds, if options.check is given only update if last update happened
// longer than status-interval seconds ago
api.putStatus = function(obj, options, callback)
{
    var self = this;
    var db = core.context.db;

    obj.mtime = Date.now();

    // Just update uncoditionally
    if (!options.check) return db.put("bk_status", obj, function(err) { callback(err, obj); });

    this.getStatus(obj.id, options, function(err, row) {
        if (!err && !row) {
            db.put("bk_status", obj, function(err) { callback(err, obj); });
        } else {
            callback(err, row);
        }
    });
}

// Increase a counter, used in /counter/incr API call, options.op can be set to 'put'
api.incrCounter = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
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
        if (obj.id != req.account.id && !options.nopublish) {
            self.publish(obj.id, { path: req.path, mtime: now, alias: (options.account ||{}).alias, type: Object.keys(obj).join(",") }, options);
        }

        callback(null, rows);
    });
}

// Update auto counter for account and type
api.incrAutoCounter = function(id, type, num, options, callback)
{
    var self = this;
    var db = core.context.db;

    if (!id || !type || !num) return callback(null, []);
    var col = db.getColumn("bk_counter", type, options) || {};
    if (!col.autoincr) return callback(null, []);
    db.incr("bk_counter", core.newObj('id', id, type, num), options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/get` API call.
api.selectConnection = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    req.options.cleanup = "";
    if (req.query.type) req.query.type += ":" + (req.query.id || "");
    req.query.id = req.account.id;

    if (!options.ops) options.ops = {};
    options.ops.type = "begins_with";

    db.select("bk_" + (options.op || "connection"), req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        // Just return connections
        if (!core.toNumber(options.details)) return callback(null, self.getResultPage(req, rows, info));

        // Get all account records for the id list
        self.listAccount(rows, options, function(err, rows) {
            callback(null, self.getResultPage(req, rows, info));
        });
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

// Lower level connection creation with all counters support, can be used outside of the current account scope for
// any two accounts and arbitrary properties, `id` is the primary account id, `obj` contains id and type for other account
// with other properties to be added. `obj` is left untouched.
// The following properties can alter the actions:
// - nopublish - do not send notification via pub/sub system if present
// - nocounter - do not update auto increment counters
// - noreference - do not create reference part of the connection
// - connected - return existing connection record for the same type from the other account
api.makeConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();
    var op = options.op || 'put';
    var query = core.cloneObj(obj);
    var result = {};

    async.series([
        function(next) {
            // Primary connection
            if (options.noconnection) return next();
            query.id = id;
            query.type = obj.type + ":" + obj.id;
            query.mtime = now;
            db[op]("bk_connection", query, options, function(err) {
                if (err || op == 'update') return next(err);
                self.metrics.connections.Meter(op + ":" + obj.type).mark();
                next();
            });
        },
        function(next) {
            // Reverse connection, a reference
            if (options.noreference) return next();
            query.id = obj.id;
            query.type = obj.type + ":"+ id;
            db[op]("bk_reference", query, options, function(err) {
                if (err || op == 'update') return next(err);
                // Remove on error
                if (err) return db.del("bk_connection", { id: id, type: obj.type + ":" + obj.id }, function() { next(err); });
                next();
            });
        },
        function(next) {
            // Keep track of all connection counters
            if (options.nocounter) return next();
            self.incrAutoCounter(id, obj.type + '0', 1, options, function(err) { next() });
        },
        function(next) {
            if (options.nocounter) return next();
            self.incrAutoCounter(obj.id, obj.type + '1', 1, options, function(err) { next(); });
        },
        function(next) {
            // Notify about connection change
            if (options.nopublish) return next();
            self.publish(obj.id, { path: "/connection/" + op, mtime: now, alias: (options.account || {}).alias, type: obj.type }, options);
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

// Return one connection for given id, obj must have .id and .type properties defined,
// if options.details is 1 then combine with account record.
api.readConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.context.db;

    var query = { id: id, type: obj.type + ":" + obj.id };
    for (var p in obj) if (p != "id" && p != "type") query[p] = obj[p];

    db.get("bk_connection", query, options, function(err, row) {
        if (err || !row) return callback(err, row);

        // Just return connections
        if (!core.toNumber(options.details)) return callback(err, row);

        // Get all account records for the id list
        self.listAccount([ row ], options, function(err, rows) {
            callback(null, row);
        });
    });
}

// Lower level connection deletion, for given account `id`, the other id and type is in the `obj`, performs deletion of all
// connections. If any of obj.id or obj.type are not specified then perform a query for matching connections and delete only matched connection.
api.deleteConnection = function(id, obj, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();

    function del(row, cb) {
        self.metrics.connections.Meter('del:' + row.type).mark();

        async.series([
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
               if (options.noreference) return next();
               if (options.nocounter) return next();
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

        async.forEachSeries(rows, function(row, next) {
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
    var db = core.context.db;
    var table = options.table || "bk_location";

    // Continue pagination using the search token
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
        logger.debug("getLocations:", req.account.id, 'GEO:', info.latitude, info.longitude, info.distance, info.geohash, 'NEXT:', info.start ||'', 'ROWS:', rows.length);
        // Next token is the whole options as oppose to regular tokens in non location requests to maintain the whole state
        var token = { count: rows.length, data: rows };
        if (info.more) token.next_token = core.jsonToBase64(info, req.account.secret);

        // Return accounts with locations
        if (core.toNumber(options.details) && rows.length && table != "bk_account") {

            self.listAccount(rows, { select: options.select }, function(err, rows) {
                if (err) return self.sendReply(res, err);
                token.count = rows.length;
                token.data = rows;
                callback(null, token);
            });
        } else {
            callback(null, token);
        }
    });
}

// Save location coordinates for current account, this function is called by the `/location/put` API call
api.putLocation = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
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
            var distance = backend.geoDistance(old.latitude, old.longitude, latitude, longitude);
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
    var db = core.context.db;

    req.options.cleanup = "";
    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
api.getSentMessage = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    req.options.cleanup = "";
    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_sent", req.query, options, callback);
}

// Return new/unread messages, used in /message/get API call
api.getMessage = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    req.options.cleanup = "";
    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";
    options.noprocessrows = 1;

    function del(rows, next) {
        async.forEachLimit(rows, options.concurrency || 1, function(row, next2) {
            db.del("bk_message", row, options, function() { next2() });
        }, next);
    }

    function details(rows, info, next) {
        if (!core.toNumber(options.details)) return next(null, rows, info);
        self.listAccount(rows, { key: 'sender', select: options.select }, function(err, rows) { next(err, rows, info); });
    }

    db.select("bk_message", req.query, options, function(err, rows, info) {
        if (err) return self.sendReply(res, err);

        options.ops = null;
        // Move to archive
        if (core.toBool(options.archive)) {
            async.forEachSeries(rows, function(row, next) {
                db.put("bk_archive", row, options, next);
            }, function(err) {
                if (err) return callback(err, []);

                // Delete from the new after we archived it
                del(rows, function() {
                    db.processRows(null, "bk_message", rows, options);
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
    var db = core.context.db;
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
    var db = core.context.db;
    var now = Date.now();
    var info = {}, sent = core.cloneObj(req.query);

    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    async.series([
        function(next) {
            req.query.sender = req.account.id;
            req.query.alias = req.account.alias;
            req.query.mtime = now + ":" + req.query.sender;
            self.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime }, function(err, icon) {
                req.query.icon = icon ? 1 : 0;
                next(err);
            });
        },
        function(next) {
            db.add("bk_message", req.query, options, function(err, rows, info2) {
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
            db.add("bk_sent", sent, options, function(err, rows) {
                if (err) return db.del("bk_message", req.query, function() { next(err); });
                next();
            });
        },
        function(next) {
            if (options.nopublish || req.query.id == req.account.id) return next();
            self.publish(req.query.id, { path: req.path, mtime: now, alias: (options.account || {}).alias, msg: (req.query.msg || "").substr(0, 128) }, options);
            next();
        },
        ], function(err) {
            if (err) return callback(err);
            self.metrics.messages.Meter('add').mark();
            db.processRows("", "bk_sent", sent, options);
            callback(null, sent, info);
    });
}

// Delete a message or all messages for the given account from the given sender, used in /message/del` API call
api.delMessage = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    var table = options.table || "bk_message";
    var sender = options.sender || "sender";

    req.query.id = req.account.id;
    if (!options.ops) options.ops = {};
    if (!options.ops.mtime) options.ops.mtime = "gt";

    // Single deletion
    if (req.query.mtime && req.query[sender]) {
        return db.del(table, { id: req.account.id, mtime: req.query.mtime + ":" + req.query[sender] }, options, callback);
    }

    // Delete by query
    db.select(table, { id: req.account.id, mtime: (req.query.mtime ? (req.query.mtime + ":") + (req.query[sender] || "") : "") }, options, function(err, rows) {
        if (err) return callback(err, []);

        options.ops = null;
        async.forEachSeries(rows, function(row, next) {
            if (req.query[sender] && row[sender] != req.query[sender]) return next();
            row.mtime += ":" + row[sender];
            db.del(table, row, next);
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
    var db = core.context.db;
    if (!req.query.id) {
        db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) return callback({ status: 404, message: "account not found" });

            // Setup session cookies for automatic authentication without signing
            if (req.options.session && req.session) {
                switch (options.session) {
                case 1:
                    var sig = core.signRequest(req.account.login, req.account.secret, "", req.headers.host, "", { sigversion: 2, expires: self.sessionAge });
                    req.session["bk-signature"] = sig["bk-signature"];
                    break;

                case 0:
                    delete req.session["bk-signature"];
                    break;
                }
            }
            callback(null, row, info);
        });
    } else {
        db.list("bk_account", req.query.id, options, callback);
    }
}

// Return account details for the list of rows, options.key specified the column to use for the account id in the `rows`, or `id` will be used.
// The result accounts are cleaned for public columns, all original properties from the `rows` are kept as is.
// If options.existing is 1 then return only record with found accounts, all other records in the rows will be deleted
api.listAccount = function(rows, options, callback)
{
    var self = this;
    var db = core.context.db;
    var key = options.key || "id";
    var map = {};
    rows.forEach(function(x) { if (!map[x[key]]) map[x[key]] = []; map[x[key]].push(x); });
    db.list("bk_account", Object.keys(map).map(function(x) { return { id: x } }), { select: options.select }, function(err, list) {
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
        callback(null, rows);
    });
}

// Query accounts, used in /accout/select API call, simple wrapper around db.select but can be replaced in the apps while using the same API endpoint
api.selectAccount = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    db.select("bk_account", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);
        callback(err, self.getResultPage(req, rows, info));
    });
}

// Register new account, used in /account/add API call
api.addAccount = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    // Verify required fields
    if (!req.query.name) return callback({ status: 400, message: "name is required"});
    if (!req.query.alias) req.query.alias = req.query.name;
    req.query.id = core.uuid();
    req.query.mtime = req.query.ctime = Date.now();

    async.series([
       function(next) {
           if (options.noauth) return next();
           if (!req.query.secret) return next({ status: 400, message: "secret is required"});
           if (!req.query.login) return next({ status: 400, message: "login is required"});
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = core.cloneObj(req.query);
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");

           db.add("bk_auth", query, options, next);
       },
       function(next) {
           var query = core.cloneObj(req.query);
           // Only admin can add accounts with admin properties
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_account", "admin");
           self.clearQuery(query, options, "bk_account", "location");

           db.add("bk_account", query, function(err) {
               // Remove the record by login to make sure we can recreate it later
               if (err && !options.noauth) return db.del("bk_auth", { login: req.query.login }, function() { next(err); });
               next(err);
           });
       },
       function(next) {
           self.metrics.accounts.Meter('add').mark();
           db.processRows(null, "bk_account", req.query, options);
           // Link account record for other middleware
           req.account = req.query;
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
    var db = core.context.db;
    req.query.mtime = Date.now();
    req.query.id = req.account.id;

    async.series([
       function(next) {
           if (options.noauth) return next();
           // Copy for the auth table in case we have different properties that needs to be cleared
           var query = core.cloneObj(req.query);
           // Skip admin properties if any
           if (req.account.type != "admin") self.clearQuery(query, options, "bk_auth", "admin");
           query.login = req.account.login;
           // Avoid updating bk_auth and flushing cache if nothing to update
           var obj = db.getQueryForKeys(Object.keys(db.getColumns("bk_auth", options)), query, { all_columns: 1, skip_columns: ["id","login","mtime"] });
           if (!Object.keys(obj).length) return callback(err, rows, info);
           db.update("bk_auth", query, next);
       },
       function(next) {
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
    var db = core.context.db;
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

    var db = core.context.db;
    if (!options.keep) options.keep = {};
    options.count = 1000000;

    db.get("bk_account", { id: id }, options, function(err, obj) {
        if (err) return callback(err);
        if (!obj) return callback({ status: 404, message: "No account found" });

        async.series([
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
                   async.forEachSeries(rows, function(row, next2) {
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
                   async.forEachSeries(rows, function(row, next2) {
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
                if (!err) self.metrics.accounts.Meter('del').mark();
                callback(err, obj);
        });
    });
}

// Setup statistics collections
api.initStatistics = function()
{
    var self = this;
    var delay = core.randomShort();

    self.collectStatistics();
    setInterval(function() { self.collectStatistics(); }, core.collectInterval * 1000);

    // Add some delay to make all workers collect not at the same time
    if (core.collectHost) {
        setInterval(function() {
            var metrics = self.getStatistics();
            // Sent profiler data to the master
            if (core.cpuProfile) {
                metrics.type = "cpu";
                metrics.data = core.cpuProfile;
                core.cpuProfile = null;
            }
            core.sendRequest({ url: core.collectHost, postdata: metrics });
        }, core.collectSendInterval * 1000 - delay);
    }

    logger.debug("initStatistics:", "delay:",  delay, "interval:", core.collectInterval, core.collectSendInterval);
}

// Returns an object with collected db and api statstics and metrics
api.getStatistics = function()
{
    var self = this;
    var pool = core.context.db.getPool();
    pool.metrics.stats = pool.stats();
    this.metrics.pool = pool.metrics;
    return this.metrics;
}

// Metrics about the process
api.collectStatistics = function()
{
    var self = this;
    var cpus = os.cpus();
    var util = cpus.reduce(function(n, cpu) { return n + (cpu.times.user / (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq)); }, 0);
    var avg = os.loadavg();
    var mem = process.memoryUsage();
    this.metrics.data = null;
    this.metrics.type = "metrics";
    this.metrics.id = core.ipaddr + process.pid;
    this.metrics.ip = core.ipaddr;
    this.metrics.ctime = core.ctime;
    this.metrics.cpus = core.maxCPUs;
    this.metrics.instance = core.instanceId;
    this.metrics.latency = backend.getBusy();
    this.metrics.mtime = Date.now();
    this.metrics.Histogram('rss').update(mem.rss);
    this.metrics.Histogram('heap').update(mem.heapUsed);
    this.metrics.Histogram('loadavg').update(avg[2]);
    this.metrics.Histogram('freemem').update(os.freemem());
    this.metrics.Histogram('totalmem').update(os.totalmem());
    this.metrics.Histogram("util").update(util * 100 / cpus.length);
    ipc.stats(function(data) { self.metrics.cache = data });
}
