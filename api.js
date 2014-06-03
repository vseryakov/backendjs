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
var toobusy = require('toobusy');
var crypto = require('crypto');
var async = require('async');
var express = require('express');
var cookieParser = require('cookie-parser');
var session = require('cookie-session');
var serveStatic = require('serve-static');
var formidable = require('formidable');
var socketio = require("socket.io");
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

    // No authentication for these urls
    allow: ["^/$",
            "\\.html$",
            "\\.(ico|gif|png|jpg|svg)$",
            "\\.(ttf|eof|woff)$",
            "\\.(js|css)$",
            "^/public",
            "^/account/add$" ],

    // Only for admins
    allowAdmin: [],
    // Allow only HTTPS requests
    allowSsl: [],

    // Refuse access to these urls
    deny: [],

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    fileS3: '',

    tables: {
        // Authentication by login, only keeps id and secret to check the siganture
        bk_auth: { login: { primary: 1 },                   // Account login
                   id: {},                                  // Auto generated UUID
                   alias: {},                               // Account alias
                   secret: {},                              // Account password
                   type: {},                                // Account type: admin, ....
                   acl_deny: {},                            // Deny access to matched url
                   acl_allow: {},                           // Only grant access if matched this regexp
                   expires: { type: "bigint" },             // Deny access to the account if this value is before current date, milliseconds
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
                      geohash: { noadd: 1 },
                      location: { noadd: 1 },
                      latitude: { type: "real", noadd: 1 },
                      longitude: { type: "real", noadd: 1 },
                      ltime: { type: "bigint", noadd: 1 },    // Last location updte time
                      ctime: { type: "bigint" },              // Create time
                      mtime: { type: "bigint", now: 1 } },    // Last update time

       // Status/presence support
       bk_status: { id: { primary: 1 },                               // account id
                    status: {},                                       // status
                    mtime: { type: "bigint", now: 1 }},               // last status change time

       // Keep track of icons uploaded
       bk_icon: { id: { primary: 1, pub: 1 },                 // Account id
                  type: { primary: 1, pub: 1 },               // prefix:type
                  acl_allow: {},                              // Who can see it: all, auth, id:id...
                  descr: {},
                  latitude: { type: "real" },
                  longitude: { type: "real" },
                  geohash: {},
                  mtime: { type: "bigint", now: 1 }},         // Last time added/updated

       // Locations for all accounts to support distance searches
       bk_location: { geohash: { primary: 1 },                    // geohash, minDistance defines the size
                      id: { primary: 1, pub: 1 },                 // my account id, part of the primary key for pagination
                      latitude: { type: "real", semipub: 1 },     // for distance must be semipub or no distance and no coordinates
                      longitude: { type: "real", semipub: 1 },
                      mtime: { type: "bigint", now: 1 }},

       // All connections between accounts: like,dislike,friend...
       bk_connection: { id: { primary: 1 },                    // my account_id
                        type: { primary: 1 },                  // type:connection_id
                        state: {},
                        mtime: { type: "bigint", now: 1 }},

       // References from other accounts, likes,dislikes...
       bk_reference: { id: { primary: 1 },                    // connection_id
                       type: { primary: 1 },                  // type:account_id
                       state: {},
                       mtime: { type: "bigint", now: 1 }},

       // New messages
       bk_message: { id: { primary: 1 },                         // my account_id
                     mtime: { primary: 1 },                      // mtime:sender
                     sender: { index: 1 },                       // Sender id
                     acl_allow: {},                              // Who has access: all, auth, id:id...
                     msg: {},                                    // Text of the message
                     icon: { type: "int" }},                     // 1 - icon present, 0 - no icon

       // Archived messages
       bk_archive: { id: { primary: 1, index: 1 },               // my account_id
                     mtime: { primary: 1 },                      // mtime:sender
                     sender: { index: 1 },                       // Sender id
                     msg: {},                                    // Text of the message
                     icon: { type: "int" }},                     // 1 - icon present, 0 - no icon

       // Messages sent
       bk_sent: { id: { primary: 1, index: 1 },                // my account
                  mtime: { primary: 1 },                       // mtime:recipient
                  recipient: { index: 1 },                     // Recipient id
                  msg: {},                                     // Text of the message
                  icon: { type: "int" }},                      // 1 - icon present, 0 - no icon

       // All accumulated counters for accounts
       bk_counter: { id: { primary: 1, pub: 1 },                               // account id
                     ping: { type: "counter", value: 0, pub: 1 },              // public column to ping the buddy with notification
                     like0: { type: "counter", value: 0, autoincr: 1 },        // who i liked
                     like1: { type: "counter", value: 0, autoincr: 1 }},       // reversed, who liked me

       // Keep historic data about account activity
       bk_history: { id: { primary: 1 },
                     mtime: { type: "bigint", primary: 1, now: 1 },
                     type: {},
                     data: {} }
    }, // tables

    // Access handlers to grant access to the endpoint before checking for signature.
    // Authorization handlers after the account has been authenticated.
    // Post process, callbacks to be called after successfull API calls, takes as input the result.
    hooks: { access: [], auth: [], post: [] },

    // Disabled API endpoints
    disable: [],
    disableSession: [],
    caching: [],

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

    // Default busy latency 1 sec
    busyLatency: 1000,

    // Default endpoints
    endpoints: { "account": 'initAccountAPI',
                 "status": "initStatusAPI",
                 "connection": 'initConnectionAPI',
                 "location": 'initLocationAPI',
                 "history": 'initHistoryAPI',
                 "counter": 'initCounterAPI',
                 "icon": 'initIconAPI',
                 "message": 'initMessageAPI',
                 "system": "initSystemAPI",
                 "data": 'initDataAPI' },

    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s)" },
           { name: "images-s3", descr: "S3 bucket name where to store images" },
           { name: "files-s3", descr: "S3 bucket name where to store files" },
           { name: "busy-latency", type: "number", descr: "Max time in ms for a request to wait in the queue, if exceeds this value server returns too busy error" },
           { name: "access-log", descr: "File for access logging" },
           { name: "templating", descr: "Templating engne to use, see consolidate.js for supported engines, default is ejs" },
           { name: "session-age", type: "int", descr: "Session age in milliseconds, for cookie based authentication" },
           { name: "session-secret", descr: "Secret for session cookies, session support enabled only if it is not empty" },
           { name: "data-endpoint-unsecure", type: "bool", descr: "Allow the Data API functions to retrieve and show all columns, not just public, this exposes the database to every authenticated call, use with caution" },
           { name: "disable", type: "list", descr: "Disable default API by endpoint name: account, message, icon....." },
           { name: "disable-session", type: "list", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-admin", array: 1, descr: "URLs which can be accessed by admin accounts only, can be partial urls or Regexp, this is a convenient options which registers AuthCheck callback for the given endpoints" },
           { name: "allow", array: 1, set: 1, descr: "Regexp for URLs that dont need credentials, replace the whole access list" },
           { name: "allow-path", array: 1, key: "allow", descr: "Add to the list of allowed URL paths without authentication" },
           { name: "disallow-path", type: "callback", value: function(v) {this.allow.splice(this.allow.indexOf(v),1)}, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove ^/account/add$ to disable open registration" },
           { name: "allow-ssl", array: 1, descr: "Add to the list of allowed URL paths using HTRPs only, plain HTTP requetss to these urls will be refused" },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "deny", array: 1, set: 1, descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", array: 1, key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events before closing the connection, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 0, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
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
// The simple way of dealing transparently with this is to check for method in the route handler like this:
//
//      if (req.method == "POST") req.query = req.body;
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

    // Latency watcher
    self.app.use(function(req, res, next) {
        if (self.busyLatency && toobusy()) {
            self.metrics.Counter('busy').inc();
            return self.sendReply(res, 503, "Server is unavailable");
        }
        next();
    });

    // Allow cross site requests
    self.app.use(function(req, res, next) {
        res.header('Server', core.name + '/' + core.version);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'b-signature');
        next();
    });

    // Metrics starts early
    self.app.use(function(req, res, next) {
        self.metrics.Meter('rate').mark();
        self.metrics.Histogram('queue').update(self.metrics.Counter('count').inc());
        req.m1 = self.metrics.Timer('response').start();
        req.m2 = self.metrics.Timer(req.path).start();
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.end = end;
            res.end(chunk, encoding);
            self.metrics.Counter('count').dec();
            req.m1.end();
            req.m2.end();
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
        if (req._accessLog) return;
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
                       (req.account ? req.account.login : "-") + "\n";
            self.accesslog.write(line);
        }
        next();
    });

    // Request parsers
    self.app.use(cookieParser());
    self.app.use(function(req, res, next) { return self.checkQuery(req, res, next); });
    self.app.use(function(req, res, next) { return self.checkBody(req, res, next); });

    // Keep session in the cookies
    self.app.use(session({ key: 'bk_sid', secret: self.sessionSecret || core.name, cookie: { path: '/', httpOnly: false, maxAge: self.sessionAge || null } }));

    // Check the signature
    self.app.use(function(req, res, next) { return self.checkRequest(req, res, next); });

    // Assign custom middleware just after the security handler
    self.initMiddleware.call(self);

    // Templating engine setup
    self.app.engine('html', consolidate[self.templating || 'ejs']);
    self.app.set('view engine', 'html');
    // Use app specific views path if created even if it is empty
    self.app.set('views', fs.existsSync(core.path.web + "/views") ? core.path.web + "/views" : __dirname + '/views');

    // Serve from default web location in the package or from application specific location
    self.app.use(serveStatic(core.path.web));
    self.app.use(serveStatic(__dirname + "/web"));

    self.app.use(self.app.router);

    // Default error handler to show errors in the log
    self.app.use(function(err, req, res, next) {
        logger.error('app:', req.path, err, err.stack);
        self.sendReply(res, err);
    });

    // Return images by prefix, id and possibly type
    self.app.all(/^\/image\/([a-z]+)\/([a-z0-9-]+)\/?([0-9])?$/, function(req, res) {
        self.getIcon(req, res, req.params[1], { prefix: req.params[0], type: req.params[2] });
    });

    // Convert allow/deny lists into single regexp
    if (this.allow.length) this.allowRx = new RegExp(this.allow.map(function(x) { return "(" + x + ")"}).join("|"));
    if (this.allowSsl.length) this.allowSslRx = new RegExp(this.allowSsl.map(function(x) { return "(" + x + ")"}).join("|"));
    if (this.deny.length) this.denyRx = new RegExp(this.deny.map(function(x) { return "(" + x + ")"}).join("|"));

    // Managing accounts, basic functionality
    for (var p in self.endpoints) {
        if (self.disable.indexOf(p) == -1) self[self.endpoints[p]].call(this);
    }

    // Remove default API tables for disabled endpoints
    self.disable.forEach(function(x) { delete self.tables['bk_' + x] });
    if (!self.tables.bk_account) delete self.tables.bk_auth;
    if (!self.tables.bk_connection) delete self.tables.bk_reference;

    // Disable access to endpoints if session exists, meaning Web app
    self.disableSession.forEach(function(x) {
        self.registerAuthCheck('', new RegExp(x), function(req, status, cb) {
            if (req.session && req.session['bk-signature']) return cb({ status: 401, message: "Not authorized" });
            cb();
        });
    });

    // Admin only access
    if (self.allowAdmin.length) {
        self.allowAdminRx = new RegExp(self.allowAdmin.map(function(x) { return "(" + x + ")"}).join("|"));
        self.registerAuthCheck('', self.allowAdminRx, function(req, status, cb) {
            if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
            cb();
        });
    }

    // SSL only access
    if (self.allowSsl.length) {
        self.allowSslRx = new RegExp(self.allowSsl.map(function(x) { return "(" + x + ")"}).join("|"));
        self.registerAuthCheck('', self.allowSslRx, function(req, status, cb) {
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

            // Sockets server(s), pass messages into the Express routing by wrapping into req/res objects socket.io server
            if (core.socketio.port) {
                // We must have Redis due to master/worker runtime
                try { self.socketioServer = socketio.listen(core.socketio.port, core.socketio.options); } catch(e) { logger.error('api: init: socket.io:', core.socketio, e); }
                if (self.socketioServer) {
                    var p = core.socketio.options.redisPort || core.redisPort;
                    var h = core.socketio.options.redisHost || core.redisHost;
                    var o = core.socketio.options.redisOptions || core.redisOptions;
                    self.socketioServer.serverName = "socket.io";
                    self.socketioServer.serverPort = core.socketio.port;
                    self.socketioServer.set('store', new socketio.RedisStore({ redisPub: redis.createClient(p, h, o), redisSub: redis.createClient(p, h, o), redisClient: redis.createClient(p, h, o) }));
                    self.socketioServer.set('authorization', function(data, callback) { self.checkSocketIORequest(data, callback); });
                    self.socketioServer.sockets.on('connection', function(socket) { self.handleSocketIOConnect(socket); });
                    // Expose socket.io.js client library for browsers
                    module.children.forEach(function(x) {
                        if (x.id.match(/node_modules\/socket.io\/index.js/)) { self.app.use(serveStatic(path.dirname(x.id) + "/node_modules/socket.io-client/dist")); }
                    });
                }
            }

            // Notify the master about new worker server
            ipc.command({ op: "api:ready", value: { id: cluster.worker.id, pid: process.pid, port: core.port } });

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
            if (!self.socketioServer) return next();
            try { self.socketioServer.server.close(function() { next() }); } catch(e) { logger.error("api.shutdown:", e.stack); next() }
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

// Called before allowing the socket.io connection to be authorized
api.checkSocketIORequest = function(data, callback) { callback(null, true); }

// Wrap external socket.io connection into the Express routing, respond on backend command
api.handleSocketIOConnect = function(socket)
{
    var self = this;

    this.setupSocketConnection(socket);

    socket.on("error", function(err) {
        logger.error("socket:", err);
    });

    socket.on("disconnect", function() {
        self.closeWebSocketRequest(this);
        self.cleanupSocketConnection(this);
    });

    socket.on("message", function(url, callback) {
        var req = self.createWebSocketRequest(this, url, function(data) { if (callback) return callback(data); if (data) this.emit("message", data); });
        req.httpProtocol = "IO";
        req.headers = this.headers || (this.handshake || {}).headers || {};
        req = null;
        self.handleServerRequest(this._requests[0], this._requests[0].res);
    });
}

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
    req.socket.ip = this.remoteAddress;
    req.socket.__defineGetter__('remoteAddress', function() { return this.ip; });
    req.connection = req.socket;
    req.httpVersionMajor = req.httpVersionMinor = 1;
    req.httpProtocol = "WS";
    req.method = "GET";
    req.headers = this.headers || {};
    req.url = String(url);
    req.logUrl = req.url.split("?")[0];
    req._body = true;

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

// Perform authorization of the incoming request for access and permissions
api.checkRequest = function(req, res, callback)
{
    var self = this;

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
                req.body = JSON.parse(buf);
                break;

            case 'application/x-www-form-urlencoded':
                req.body = buf.length ? qs.parse(buf) : {};
                // Keep the parametrs in the body so we can distinguish GET and POST requests but use them in signature verification
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
    if (this.denyRx && req.path.match(this.denyRx)) return callback({ status: 403, message: "Access denied" });
    if (this.allowRx && req.path.match(this.allowRx)) return callback({ status: 200, message: "" });
    // Call custom access handler for the endpoint
    var hook = this.findHook('access', req.method, req.path);
    if (hook) {
        logger.debug('checkAccess:', req.method, req.path, hook);
        return hook.callbacks.call(this, req, callback);
    }
    callback();
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed
// - req is Express request object
// - status contains the signature verification status, an object wth status: and message: properties
// - callback is a function(req, status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    var hook = this.findHook('auth', req.method, req.path);
    if (hook) {
        logger.debug('checkAuthorization:', req.method, req.path, hook);
        return hook.callbacks.call(this, req, status, callback);
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

    // Show request in the log on demand for diagnostics
    if (logger.level >= 1 || req.query._debug) logger.log('checkSignature:', sig, 'hdrs:', req.headers, 'session:', JSON.stringify(req.session));

    // Sanity checks, required headers must be present and not empty
    if (!sig.login || !sig.method || !sig.host || !sig.expires || !sig.login || !sig.signature) {
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
            if (logger.level >= 1 || req.query._debug) logger.log('checkSignature:', 'failed', sig, account);
            return callback({ status: 401, message: "Not authenticated" });
        }

        // Save account and signature in the request, it will be used later
        req.signature = sig;
        req.account = account;
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

        if (req.method == "POST") req.query = req.body;
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
            self.deleteAccount(req.account, options, function(err, data) {
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
            self.getIcon(req, res, req.query.id, { prefix: 'account', type: req.query.type });
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
            if (!req.query.type) req.query.type = '0';
            self.handleIcon(req, res, options);
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

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);

        switch (req.params[0]) {
        case "get":
            if (!req.query.id) req.query.id = req.account.id;
            db.get("bk_status", { id: req.query.id }, options, function(err, row) {
                if (err) return self.sendReply(res, err);
                res.json(row);
            });
            break;

        case "put":
            if (!req.query.status) return self.sendReply(res, 400, "status is required");
            req.query.id = req.account.id;
            db.put("bk_status", req.query, options, function(err, row) {
                self.sendReply(res, err);
            });
            break;

        case "del":
            db.del("bk_status", { id: req.account.id }, options, function(err, row) {
                self.sendReply(res, err);
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

    this.app.all(/^\/icon\/([a-z]+)\/([a-z0-9\.\_\-]+)\/?([a-z0-9\.\_\-])?$/, function(req, res) {

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        if (!req.query.id) req.query.id = req.account.id;
        req.query.prefix = req.params[1];
        req.query.type = req.params[2] || "";

        switch (req.params[0]) {
        case "get":
            self.getIcon(req, res, req.query.id, { prefix: req.query.prefix, type: req.query.type });
            break;

        case "select":
            self.selectIcon(req, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "del":
        case "put":
            options.op = req.params[0];
            self.handleIcon(req, res, options);
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

    function onMessageRow(row, options, cols) {
        var mtime = row.mtime.split(":");
        row.mtime = core.toNumber(mtime[0]);
        row.sender = mtime[1];
        if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime;
        return row;
    }
    db.setProcessRow("bk_message", onMessageRow);
    db.setProcessRow("bk_archive", onMessageRow);

    db.setProcessRow("bk_sent", function(row, options, cols) {
        var mtime = row.mtime.split(":");
        row.mtime = core.toNumber(mtime[0]);
        row.recipient = mtime[1];
        if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime;
        return row;
    });

    this.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        var now = Date.now();

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            self.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            self.getMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, { count: rows.length, data: rows, next_token: info && info.next_token ? core.toBase64(info.next_token) : "" });
            });
            break;

        case "get/sent":
            self.getSentMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, { count: rows.length, data: rows, next_token: info && info.next_token ? core.toBase64(info.next_token) : "" });
            });
            break;

        case "get/archive":
            self.getArchiveMessage(req, options, function(err, rows, info) {
                self.sendJSON(req, err, { count: rows.length, data: rows, next_token: info && info.next_token ? core.toBase64(info.next_token) : "" });
            });
            break;

        case "archive":
            self.archiveMessage(req, options, function(err, rows) {
                self.sendReply(res, err);
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

// History management
api.initHistoryAPI = function()
{
    var self = this;
    var db = core.context.db;

    this.app.all(/^\/history\/([a-z]+)$/, function(req, res) {

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        switch (req.params[0]) {
        case "add":
            if (!req.query.type || !req.query.data) return self.sendReply(res, 400, "type and data are required");
            self.sendReply(res);
            req.query.id = req.account.id;
            req.query.mtime = Date.now();
            db.add("bk_history", req.query);
            break;

        case "get":
            options.ops = { mtime: 'gt' };
            db.select("bk_history", { id: req.account.id, mtime: req.query.mtime || 0 }, options, function(err, rows) {
                res.json(rows);
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

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        var now = Date.now();

        switch (req.params[0]) {
        case "put":
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

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        var now = Date.now();

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
            options.op = req.params[0];
            self.getConnection(req, options, function(err, data) {
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

        if (req.method == "POST") req.query = req.body;
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
        switch (req.params[0]) {
        case "restart":
            ipc.send("api:close");
            res.json("");
            break;

        case "config":
            ipc.configure(req.params[1]);
            break;

        case "stats":
            switch (req.params[1]) {
            case "worker":
                return res.json(self.getStatistics());

            default:
                ipc.command({ op: "metrics" }, function(data) {
                    if (!data) return res.send(404);
                    res.json(data);
                });
            }
            break;

        case "msg":
            switch (req.params[1]) {
            case 'init':
                ipc.configure('msg');
                break;
            }
            break;

        case "cache":
            switch (req.params[1]) {
            case 'init':
                ipc.configure('cache');
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
                res.json("");
                break;
            case "del":
                ipc.del(req.query.name);
                res.json("");
                break;
            case "incr":
                ipc.incr(req.query.name, core.toNumber(req.query.value));
                res.json("");
                break;
            case "put":
                ipc.put(req.query.name, req.query.value);
                res.json("");
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

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);

        // Allow access to all columns and db pools
        if (self.dataEndpointUnsecure) {
            delete options.check_public;
            if (req.query._pool) options.pool = req.query._pool;
        }

        db[req.params[0]](req.params[1], req.query, options, function(err, rows, info) {
            switch (req.params[0]) {
            case "select":
            case "search":
                self.sendJSON(req, err, { count: rows.length, data: rows, next_token: info.next_token });
                break;
            default:
                self.sendJSON(req, err, rows);
            }
        });
    });

}

// Called in the master process to create/upgrade API related tables
api.initTables = function(callback)
{
    core.context.db.initTables(this.tables, callback);
}

// Convert query options into database options, most options are the same as for `db.select` but prepended with underscore to
// distinguish control parameters from query parameters.
api.getOptions = function(req)
{
    var options = { check_public: req.account ? req.account.id : null, ops: {} };
    ["details", "consistent", "desc", "total"].forEach(function(x) {
        if (typeof req.query["_" + x] != "undefined") options[x] = core.toBool(req.query["_" + x]);
    });
    if (req.query._select) options.select = req.query._select;
    if (req.query._count) options.count = core.toNumber(req.query._count, 0, 50);
    if (req.query._start) options.start = core.toJson(req.query._start);
    if (req.query._sort) options.sort = req.query._sort;
    if (req.query._page) options.page = core.toNumber(req.query._page, 0, 0, 0, 9999);
    if (req.query._width) options.width = core.toNumber(req.query._width);
    if (req.query._height) options.height = core.toNumber(req.query._height);
    if (req.query._ext) options.ext = req.query._ext;
    if (req.query._quality) options.quality = core.toNumber(req.query._quality);
    if (req.query._round) options.round = core.toNumber(req.query._round);
    if (req.query._ops) {
        if (!options.ops) options.ops = {};
        var ops = core.strSplit(req.query._ops);
        for (var i = 0; i < ops.length -1; i+= 2) options.ops[ops[i]] = ops[i+1];
    }
    return options;
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
api.clearQuery = function(req, options, table, name)
{
    if (options && options['keep_' + name]) return;
    var cols = core.context.db.getColumns(table, options);
    for (var p in cols) {
        if (cols[p][name]) delete req.query[p];
    }
}

// Find registered hook for given type and path
api.findHook = function(type, method, path)
{
    var routes = this.hooks[type];
    if (!routes) return null;
    for (var i = 0; i < routes.length; ++i) {
        if ((!routes[i].method || routes[i].method == method) && routes[i].match(path)) {
            return routes[i];
        }
    }
    return null;
}

// Register a hook callback for the type and method and request url, if already exists does nothing.
api.addHook = function(type, method, path, callback)
{
    var hook = this.findHook(type, method, path);
    if (hook) return false;
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

// Similar to `registerAccessCheck` but this callback will be called after the signature or session is verified.
// The purpose of this hook is too check permissions of a valid user to resources or in case of error perform any other action
// like redirection or returning something explaining what to do in case of failure. The callback for this call is different then in `checkAccess` hooks.
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function(req, status, cb) where status is an object { status:..., message: ..} passed from the checkSignature call, if status != 200 it means
//   an error condition, the callback must pass the same or modified status object in its own `cb` callback
//
// Example:
//
//           api.registerAuthCheck('GET', '/account/get', function(req, status, cb) {
//                if (status.status != 200) status = { status: 302, url: '/error.html' };
//                cb(status)
//           });
//
// Example with admin access only:
//
//          api.registerAccessCheck('POST', '/data/', function(req, cb) {
//              if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
//              cb();
//          });
//
api.registerAuthCheck = function(method, path, callback)
{
    this.addHook('auth', method, path, callback);
}

// Register a callback to be called after successfull API action, status 200 only.
// The purpose is to perform some additional actions after the standard API completed or to customize the result
// - method can be '' in such case all mathods will be matched
// - path is a string or regexp of the request URL similar to registering Express routes
// - callback is a function with the following parameters: function(req, res, rows) where rows is the result returned by the API handler,
//   the callback MUST return data back to the client or any other status code
api.registerPostProcess = function(method, path, callback)
{
    this.addHook('post', method, path, callback);
}

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in the apps.
// If err is not null the error message is returned immediately.
api.sendJSON = function(req, err, rows)
{
    if (err) return this.sendReply(req.res, err);

    var hook = this.findHook('post', req.method, req.path);
    try {
        if (!hook) return req.res.json(rows);
        hook.callbacks.call(this, req, req.res, rows);
    } catch(e) {
        logger.error('sendJSON:', req.path, e.stack);
    }
}

// Send formatted JSON reply to API client, if status is an instance of Error then error message with status 500 is sent back
api.sendReply = function(res, status, msg)
{
    if (status instanceof Error || status instanceof Object) msg = status.message, status = status.status || 500;
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

// Disconnect from subscription service. This forces disconnect even for persistent connections like socket.io or websockets.
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
api.handleIcon = function(req, res, options)
{
    var self = this;
    var db = core.context.db;
    var op = options.op || "put";

    options.force = true;
    options.prefix = req.query.prefix || "account";
    options.type = req.query.type || "";

    req.query.id = req.account.id;
    req.query.type = options.prefix + ":" + options.type;
    if (req.query.latitude && req.query.longitude) req.query.geohash = core.geoHash(req.query.latitude, req.query.longitude);

    db[op]("bk_icon", req.query, function(err, rows) {
        if (err) return self.sendReply(res, err);

        switch (op) {
        case "put":
            self.putIcon(req, req.account.id, options, function(err, icon) {
                if (err || !icon) db.del('bk_icon', obj);
                self.sendReply(res, err);
            });
            break;

        case "del":
            self.delIcon(req.account.id, options, function(err) {
                self.sendReply(res, err);
            });
            break;
        }
    });
}

// Return formatted icon URL for the given account
api.formatIcon = function(row, account)
{
    var type = row.type.split(":");
    row.type = type.slice(1).join(":");
    row.prefix = type[0];

    // Provide public url if allowed
    if (row.allow && row.allow == "all" && this.allow && ("/image/" + row.prefix + "/").match(this.allow)) {
        row.url = this.imagesUrl + '/image/' + row.prefix + '/' + row.id + '/' + row.type;
    } else {
        if (row.prefix == "account") {
            row.url = this.imagesUrl + '/account/get/icon?type=' + row.type;
        } else {
            row.url = this.imagesUrl + '/icon/get/' + row.prefix + "/" + row.type + "?";
        }
        if (account && row.id != account.id) row.url += "&id=" + row.id;
    }
}

// Return list of icons for the account, used in /icon/get API call
api.selectIcon = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    options.ops = { type: "begins_with" };
    db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + (req.query.type || "") }, options, function(err, rows) {
        if (err) return callback(err, []);
        // Filter out not allowed icons
        rows = rows.filter(function(x) { return self.checkIcon(req, req.query.id, x); });
        rows.forEach(function(x) { self.formatIcon(x, req.account); });
        callback(err, rows);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.context.db;

    db.get("bk_icon", { id: id, type: options.prefix + ":" + options.type }, options, function(err, row) {
        if (err) return self.sendReply(res, err);
        if (!row) return self.sendReply(res, 404, "Not found");
        if (!self.checkIcon(req, id, row)) return self.sendReply(res, 401, "Not allowed");
        self.sendIcon(req, res, id, options);
    });
}

// Send an icon to the client, only handles files
api.sendIcon = function(req, res, id, options)
{
    var self = this;
    var aws = core.context.aws;
    var icon = core.iconPath(id, options);
    logger.log('sendIcon:', icon, id, options)

    if (self.imagesS3) {
        aws.queryS3(self.imagesS3, icon, options, function(err, params) {
            if (err) return self.sendReply(res, err);

            res.type("image/" + (options.ext || "jpeg"));
            res.send(200, params.data);
        });
    } else {
        self.sendFile(req, res, icon);
    }
}

// Verify icon permissions for given account id, returns true if allowed
api.checkIcon = function(req, id, row)
{
    var acl = row.acl_allow || "";
    if (acl == "all") return true;
    if (acl == "auth" && req.account) return true;
    if (acl.split(",").filter(function(x) { return x == id }).length) return true;
    return id == req.account.id;
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback)
{
    var self = this;
    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property to define type for each icon, for
    // only one uploaded file req.query.type still will be used
    var nfiles = req.files ? Object.keys(req.files).length : 0;
    if (nfiles) {
        var outfile = null, type = req.query.type;
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
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = core.iconPath(id, options);
    if (this.imagesS3 || options.imagesS3) {
        var aws = core.context.aws;
        aws.queryS3(options.imagesS3 || this.imagesS3, icon, { method: "DELETE" }, function(err) {
            logger.edebug(err, 'delIcon:', id, options);
            if (callback) callback();
        });
    } else {
        fs.unlink(icon, function(err) {
            logger.edebug(err, 'delIcon:', id, options);
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
api.putFile = function(req, name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var outfile = (options.name || name) + (options.ext || "");
    if (req.files && req.files[name]) {
        if (!options.ext || options.extkeep) outfile += path.extname(req.files[name].name || req.files[name].path);
        self.storeFile(req.files[name].path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (typeof req.body == "object" && req.body[name]) {
        var data = new Buffer(req.body[name], "base64");
        self.storeFile(data, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        var data = new Buffer(req.query[name], "base64");
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

    if (this.fileS3 || options.fileS3) {
        var headers = { 'content-type': mime.lookup(outfile) };
        var ops = { method: "PUT", headers: headers }
        opts[Buffer.isBuffer(tmfile) ? 'postdata' : 'postfile'] = tmpfile;
        aws.queryS3(options.filesS3 || this.fileS3, outfile, opts, function(err) {
            if (callback) callback(err, outfile);
        });
    } else {
        if (Buffer.isBuffer(tmpfile)) {
            fs.writeFile(path.join(core.path.files, outfile), tmpfile, function(err) {
                if (err) logger.error('storeFile:', outfile, err);
                if (callback) callback(err, outfile);
            });
        } else {
            core.moveFile(tmpfile, path.join(core.path.files, outfile), true, function(err) {
                if (err) logger.error('storeFile:', outfile, err);
                if (callback) callback(err, outfile);
            });
        }
    }
}

// Delete file by name from the local filesystem or S3 drive if fileS3 is defined in api or options objects
api.delFile = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.fileS3 || options.fileS3) {
        aws.queryS3(options.fileS3 || this.filesS3, file, { method: "DELETE" }, function(err) {
            if (callback) callback(err, outfile);
        });
    } else {
        fs.unlink(path.join(core.path.files, file), function(err) {
            if (err) logger.error('delFile:', file, err);
            if (callback) callback(err, outfile);
        })
    }
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
        db.getPublicColumns("bk_counter").forEach(function(x) { if (req.query[x]) obj[x] = req.query[x]; });
    } else {
        var obj = req.query;
        obj.id = req.account.id;
    }

    db[op]("bk_counter", obj, options, function(err, rows) {
        if (err) return callback(err);

        // Notify only the other account
        if (obj.id != req.account.id) {
            self.publish(obj.id, { path: req.path, mtime: now, alias: req.account.alias, type: Object.keys(obj).join(",") }, options);
        }

        callback(null, rows);
    });
}

// Update auto counter for account and type
api.incrAutoCounter = function(id, type, num, options, callback)
{
    var db = core.context.db;

    if (!id || !type || !num) return callback(null, []);
    var col = db.getColumn("bk_counter", type, options) || {};
    if (!col.autoincr) return callback(null, []);
    db.incr("bk_counter", core.newObj('id', id, type, num), options, callback);
}

// Return all connections for the current account, this function is called by the `/connection/get` API call.
api.getConnection = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    if (req.query.type) req.query.type += ":" + (req.query.id || "");
    req.query.id = req.account.id;
    options.ops.type = "begins_with";
    db.select("bk_" + (options.op || "connection"), req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        var next_token = info.next_token ? core.toBase64(info.next_token) : "";
        // Split type and reference id
        rows.forEach(function(row) {
            var d = row.type.split(":");
            row.type = d[0];
            row.id = d[1];
        });
        // Just return connections
        if (!core.toNumber(options.details)) return callback(null, { count: rows.length, data: rows, next_token: next_token });

        // Get all account records for the id list
        db.list("bk_account", rows, { select: req.query._select, check_public: req.account.id }, function(err, rows) {
            if (err) return callback(err, []);

            callback(null, { count: rows.length, data: rows, next_token: next_token });
        });
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call.
api.putConnection = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();
    var op = options.op || 'put';

    var id = req.query.id, type = req.query.type;
    if (!id || !type) return callback({ status: 400, message: "id and type are required"});
    if (id == req.account.id) return callback({ status: 400, message: "cannot connect to itself"});

    // Override primary key properties, the rest of the properties will be added as is
    req.query.id = req.account.id;
    req.query.type = type + ":" + id;
    req.query.mtime = now;
    db[op]("bk_connection", req.query, options, function(err) {
        if (err) return callback(err);

        // Reverse reference to the same connection
        req.query.id = id;
        req.query.type = type + ":"+ req.account.id;
        db[op]("bk_reference", req.query, options, function(err) {
            // Remove on error
            if (err) return db.del("bk_connection", { id: req.account.id, type: type + ":" + id }, function() { callback(err); });

            // Notify about connection change
            self.publish(id, { path: req.path, mtime: now, alias: req.account.alias, type: type }, options);

            // Update operation does not change the state of connections between the accounts
            if (op == 'update') return callback(null, {});

            // Keep track of all connections counters
            self.incrAutoCounter(req.account.id, type + '0', 1, options, function(err) {
                self.incrAutoCounter(id, type + '1', 1, options, function(err) {

                    // We need to know if the other side is connected too, this will save one extra API call later
                    if (!req.query._connected) return callback(null, {});

                    // req.query already setup as a reference for us and as a connection for the other account
                    db.get("bk_connection", req.query, { select: ['id'] }, function(err, row) {
                        callback(null, { connected: row ? 1 : 0 });
                    });
                });
            });
        });
    });
}

// Delete a connection, this function is called by the `/connection/del` API call
api.delConnection = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();

    function del(type, id, cb) {
        async.series([
           function(next) {
               db.del("bk_connection", { id: req.account.id, type: type + ":" + id }, options, next);
           },
           function(next) {
               self.incrAutoCounter(req.account.id, type + '0', -1, options, function() { next(); });
           },
           function(next) {
               db.del("bk_reference", { id: id, type: type + ":" + req.account.id }, options, next);
           },
           function(next) {
               self.incrAutoCounter(id, type + '1', -1, options, function() { next() });
           },
           function(next) {
               // Notify about connection change
               self.publish(id, { path: req.path, mtime: now, alias: req.account.alias, type: type }, options);
               next();
           }],
           function(err) {
               cb(err, []);
        });
    }

    // Single deletion
    if (req.query.id && req.query.type) return del(req.query.type, req.query.id, callback);

    // Delete by query
    db.select("bk_connection", { id: req.account.id, type: req.query.type ? (req.query.type + ":" + (req.query.id || "")) : "" }, options, function(err, rows) {
        if (err) return callback(err, []);

        async.forEachSeries(rows, function(row, next) {
            var t = row.type.split(":");
            if (req.query.id && t[1] != req.query.id) return next();
            if (req.query.type && t[0] != req.query.type) return next();
            del(t[0], t[1], next);
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

    // Perform location search based on hash key that covers the whole region for our configured max distance
    if (!req.query.latitude || !req.query.longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Limit the distance within our configured range
    req.query.distance = core.toNumber(req.query.distance, 0, core.minDistance, core.minDistance, core.maxDistance);

    // Continue pagination using the search token
    var token = core.toJson(req.query._token);
    if (token && token.geohash) {
        if (token.latitude != req.query.latitude ||
            token.longitude != req.query.longitude ||
            token.distance != req.query.distance) return callback({ status: 400, message: "invalid token, latitude, longitude and distance must be the same" });
        options = token;
    }
    // Rounded distance, not precise to keep from pin-pointing locations
    if (typeof options.round == "undefined") options.round = core.minDistance;

    db.getLocations(table, req.query, options, function(err, rows, info) {
        var next_token = info.more ? core.toBase64(info) : null;
        // Ignore current account, db still retrieves it but in the API we skip it
        rows = rows.filter(function(row) { return row.id != req.account.id });
        // Return accounts with locations
        if (core.toNumber(options.details) && rows.length) {
            var list = {}, ids = [];
            rows = rows.map(function(row) {
                // Skip duplicates
                if (list[row.id]) return row;
                ids.push({ id: row.id });
                list[row.id] = row;
                return row;
            });
            db.list("bk_account", ids, { select: req.query._select, check_public: req.account.id }, function(err, rows) {
                if (err) return self.sendReply(res, err);
                // Merge locations and accounts
                rows.forEach(function(row) {
                    var item = list[row.id];
                    for (var p in item) row[p] = item[p];
                });
                callback(null, { count: rows.length, data: rows, next_token: next_token });
            });
        } else {
            callback(null, { count: rows.length, data: rows, next_token: next_token });
        }
    });
}

// Save locstion coordinates for current account, this function is called by the `/location/put` API call
api.putLocation = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();

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
            if (distance == null || distance < core.minDistance || old.geohash == geo.geohash) return callback({ status: 305, message: "ignored, min distance: " + core.minDistance});
        }

        req.query.id = req.account.id;
        req.query.geohash = geo.geohash;
        var cols = db.getColumns("bk_location", options);
        // Update all account columns in the location, they are very tightly connected and custom filters can
        // be used for filtering locations based on other account properties like gender.
        for (var p in cols) if (old[p] && !req.query[p]) req.query[p] = old[p];

        var obj = { id: req.account.id, geohash: geo.geohash, latitude: latitude, longitude: longitude, ltime: now, location: req.query.location };
        db.update("bk_account", obj, function(err) {
            if (err) return callback(err);

            db.put("bk_location", req.query, function(err) {
                if (err) return callback(err);

                // Return new location record with the old coordinates
                req.query.old = old;
                if (!old.geohash) return callback(null, req.query);

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
    var db = core.context.db;

    req.query.id = req.account.id;
    if (!options.ops.mtime) options.ops.mtime = "gt";

    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
api.getSentMessage = function(req, options, callback)
{
    var db = core.context.db;

    req.query.id = req.account.id;
    if (!options.ops.mtime) options.ops.mtime = "gt";

    options.check_public = null;
    db.select("bk_sent", req.query, options, callback);
}

// Return new/unread messages, used in /message/get/unread API call
api.getMessage = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    req.query.id = req.account.id;
    if (!options.ops.mtime) options.ops.mtime = "gt";
    options.noprocessrows = 1;

    function del(rows, next) {
        async.forEachLimit(rows, options.concurrency || 1, function(row, next2) {
            db.del("bk_message", row, options, function() { next2() });
        }, next);
    }

    db.select("bk_message", req.query, options, function(err, rows, info) {
        if (err) return self.sendReply(res, err);

        options.ops = null;
        // Move to archive
        if (core.toBool(req.query._archive)) {
            async.forEachSeries(rows, function(row, next) {
                db.put("bk_archive", row, options, next);
            }, function(err) {
                if (err) return callback(err, []);

                // Delete from the new after we archived it
                del(rows, function() {
                    db.processRows(null, "bk_message", rows, options);
                    callback(err, rows, info);
                });
            });
        } else

        // Delete after read, if we crash now new messages will never be delivered
        if (core.toBool(req.query._delete)) {
            del(rows, function() {
                db.processRows(null, "bk_message", rows, options);
                callback(err, rows, info);
            });
        } else {
            db.processRows(null, "bk_message", rows, options);
            callback(err, rows, info);
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

    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    req.query.sender = req.account.id;
    req.query.mtime = now + ":" + req.query.sender;
    self.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime }, function(err, icon) {
        if (err) return callback(err);

        req.query.icon = icon ? 1 : 0;
        db.add("bk_message", req.query, options, function(err, rows, info) {
            if (err) return callback(err);

            var sent = core.cloneObj(req.query);
            sent.id = req.account.id;
            sent.recipient = req.query.id;
            sent.mtime = now + ':' + sent.recipient;
            db.add("bk_sent", sent, options, function(err, rows, info) {
                if (err) return db.del("bk_message", req.query, function() { callback(err); });

                if (req.query.id != req.account.id) {
                    self.publish(req.query.id, { path: req.path, mtime: now, alias: req.account.alias, msg: (req.query.msg || "").substr(0, 128) }, options);
                }

                callback(null, { id: req.query.id, mtime: now, sender: req.account.id, icon: req.query.icon }, info);
            });
        });
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
    options.table = "bk_archive";
    options.sender = "sender";
    this.delMessage(req, options, callback);
}

// Delete the messages i sent, used in /message/del/sent` API call
api.delSentMessage = function(req, options, callback)
{
    options.table = "bk_sent";
    options.sender = "recipient";
    this.delMessage(req, options, callback);
}

// Return an account, used in /account/get API call
api.getAccount  = function(req, options, callback)
{
    var db = core.context.db;
    if (!req.query.id) {
        db.get("bk_account", { id: req.account.id }, options, function(err, row, info) {
            if (err) return callback(err);
            if (!row) return callback({ status: 404, message: "not found" });

            // Setup session cookies for automatic authentication without signing
            if (req.query._session) {
                switch (req.query._session) {
                case "1":
                    var sig = core.signRequest(req.account.login, req.account.secret, "", req.headers.host, "", { sigversion: 2, expires: self.sessionAge });
                    req.session["bk-signature"] = sig["bk-signature"];
                    break;

                case "0":
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

// Query accounts, used in /accout/select API call, simple wrapper around db.select but can be replaced in the apps while using the same API endpoint
api.selectAccount = function(req, options, callback)
{
    var db = core.context.db;
    db.select("bk_account", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);
        var next_token = info && info.next_token ? core.toBase64(info.next_token) : "";
        callback(err, { count: rows.length, data: rows, next_token: next_token });
    });
}

// Register new account, used in /account/add API call
api.addAccount = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    // Verify required fields
    if (!req.query.secret) return callback({ status: 400, message: "secret is required"});
    if (!req.query.name) return callback({ status: 400, message: "name is required"});
    if (!req.query.login) return callback({ status: 400, message: "login is required"});
    if (!req.query.alias) req.query.alias = req.query.name;
    req.query.id = core.uuid();
    req.query.mtime = req.query.ctime = Date.now();
    // Only admin can add accounts with the type
    if (req.query.type && (!req.account || req.account.type != "admin")) req.query.type = null;
    db.add("bk_auth", req.query, function(err) {
        if (err) return callback(err);
        // Skip location related properties
        self.clearQuery(req, options, "bk_account", "noadd");
        db.add("bk_account", req.query, function(err) {
            if (err) return db.del("bk_auth", auth, function() { callback(err); });

            db.processRows(null, "bk_account", req.query, options);
            // Link account record for other middleware
            req.account = req.query;
            // Some dbs require the record to exist, just make one with default values
            db.put("bk_counter", { id: req.query.id, ping: 0 }, function() {
                callback(err, req.query);
            });
        });
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

// Update existing account, used in /account/update API call
api.updateAccount = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    req.query.mtime = Date.now();
    req.query.id = req.account.id;
    // Skip location related properties
    self.clearQuery(req, options, "bk_account", "noadd");
    db.update("bk_account", req.query, function(err, rows, info) {
        if (err || !req.query.alias) return callback(err, rows, info);
        db.update("bk_auth", { login: req.account.login, alias: req.query.alias }, callback);
    });
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain keep: {} object with table names to be kept without the bk_ prefix, for example
// delete an account but keep all messages and location: keep: { message: 1, location: 1 }
api.deleteAccount = function(obj, options, callback)
{
    var self = this;

    if (!obj || !obj.id || !obj.login) return callback({ status: 400, message: "id, login must be specified" });

    var db = core.context.db;
    if (!options.keep) options.keep = {};
    options.count = 1000000;

    db.get("bk_account", { id: obj.id }, options, function(err, account) {
        if (err) return callback(err);
        if (!account) return callback({ status: 404, message: "No account found" });
        // Merge the records to be returned to the client
        for (var p in account) if(!obj[p]) obj[p] = account[p];

        async.series([
           function(next) {
               if (options.keep.auth) return next();
               options.cached = true
               db.del("bk_auth", { login: obj.login }, options, function(err) {
                   options.cached = false;
                   next(err);
               });
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
                       var type = row.type.split(":");
                       db.del("bk_reference", { id: type[1], type: type[0] + ":" + obj.id }, options, function(err) {
                           db.del("bk_connection", row, options, next2);
                       });
                   }, next);
               });
           },
           function(next) {
               if (options.keep.message) return next();
               db.delAll("bk_message", { id: obj.id }, options, next);
           },
           function(next) {
               if (options.keep.archive) return next();
                   db.delAll("bk_archive", { id: obj.id }, options, next);
           },
           function(next) {
               if (options.keep.sent) return next();
               db.delAll("bk_sent", { id: obj.id }, options, next);
           },
           function(next) {
               if (options.keep.status) return next();
               db.del("bk_status", { id: obj.id }, options, next);
           },
           function(next) {
               if (options.keep.icon) return next();
               db.delAll("bk_icon", { id: obj.id }, options, function(err, rows) {
                   if (!options.keep.images) return next();
                   // Delete all image files
                   async.forEachSeries(rows, function(row, next2) {
                       self.formatIcon(row);
                       self.delIcon(obj.id, row, next2);
                   }, next);
               });
           },
           function(next) {
               if (options.keep.location || !account.geohash) return next();
               db.del("bk_location", { geohash: account.geohash, id: obj.id }, options, next);
           }],
           function(err) {
               callback(err, obj);
        });
    });
}

// Setup statistics collections
api.initStatistics = function()
{
    var self = this;
    this.metrics = new metrics();
    this.collectStatistics();
    setInterval(function() { self.collectStatistics(); }, 30000);

    // Setup toobusy timer to detect when our requests waiting in the queue for too long
    if (this.busyLatency) toobusy.maxLag(this.busyLatency); else toobusy.shutdown();
}

// Returns an object with collected db and api statstics and metrics
api.getStatistics = function()
{
    var info = {  };
    var pool = core.context.db.getPool();
    pool.metrics.stats = pool.stats();
    return { host: core.hostname, ip: core.ipaddrs, instance: core.instanceId, cpus: core.maxCPUs, ctime: core.ctime, latency: toobusy.lag(), pool: pool.metrics, api: this.metrics };
}

// Metrics about the process
api.collectStatistics = function()
{
    var cpus = os.cpus();
    var util = cpus.reduce(function(n, cpu) { return n + (cpu.times.user / (cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq)); }, 0);
    var avg = os.loadavg();
    var mem = process.memoryUsage();
    this.metrics.Histogram('rss').update(mem.rss);
    this.metrics.Histogram('heap').update(mem.heapUsed);
    this.metrics.Histogram('loadavg').update(avg[2]);
    this.metrics.Histogram('freemem').update(os.freemem());
    this.metrics.Histogram('totalmem').update(os.totalmem());
    this.metrics.Histogram("util").update(util * 100 / cpus.length);

    if (cluster.isWorker) {
        ipc.command({ op: "metrics", name: process.pid, value: this.getStatistics() });
    }
}
