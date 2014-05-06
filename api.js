//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var stream = require('stream');
var util = require('util');
var fs = require('fs');
var os = require('os');
var http = require('http');
var https = require('https');
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
var mime = require('mime');
var consolidate = require('consolidate');
var domain = require('domain');
var metrics = require(__dirname + '/metrics');
var core = require(__dirname + '/core');
var ipc = require(__dirname + '/ipc');
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
    alowSsl: null,

    // Refuse access to these urls
    deny: null,

    // Where images/file are kept
    imagesUrl: '',
    imagesS3: '',
    fileS3: '',

    tables: {
        // Authentication by login, only keeps id and secret to check the siganture
        bk_auth: { login: { primary: 1 },               // Account login
                   id: {},                              // Auto generated UUID
                   secret: {},                          // Account password
                   type: {},                            // Account type: admin, ....
                   acl_deny: {},                        // Deny access to matched url
                   acl_allow: {},                       // Only grant access if matched this regexp
                   expires: { type: "bigint" },         // Deny access to the account if this value is before current date, milliseconds
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
                      latitude: { type: "real", noadd: 1 },
                      longitude: { type: "real", noadd: 1 },
                      geohash: { noadd: 1 },
                      location: { noadd: 1 },
                      ltime: { type: "bigint", noadd: 1 },
                      ctime: { type: "bigint" },
                      mtime: { type: "bigint", now: 1 } },

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
       bk_location: { geohash: { primary: 1, semipub: 1 },        // geohash, minDistance defines the size
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

       // Messages between accounts
       bk_message: { id: { primary: 1, index: 1, index1: 1 },  // my account_id
                     mtime: { primary: 1 },                    // mtime:sender, the current timestamp in milliseconds and the sender
                     status: { index: 1 },                     // status: R:mtime:sender or N:mtime:sender, where R - read, N - new
                     sender: { index1: 1 },                    // sender:mtime, reverse index by sender
                     msg: { type: "text" },                    // Text of the message
                     icon: {}},                                // Icon base64 or url

       // All accumulated counters for accounts
       bk_counter: { id: { primary: 1, pub: 1 },                               // account id
                     ping: { type: "counter", value: 0, pub: 1 },              // public column to ping the buddy
                     like0: { type: "counter", value: 0, autoincr: 1 },        // who i liked
                     like1: { type: "counter", value: 0 },                     // reversed, who liked me
                     dislike0: { type: "counter", value: 0, autoincr: 1 },
                     dislike1: { type: "counter", value: 0 },
                     follow0: { type: "counter", value: 0, autoincr: 1 },
                     follow1: { type: "counter", value: 0, },
                     invite0: { type: "counter", value: 0, autoincr: 1 },
                     invite1: { type: "counter", value: 0, },
                     view0: { type: "counter", value: 0, autoincr: 1 },
                     view1: { type: "counter", value: 0, },
                     msg_count: { type: "counter", value: 0 },                  // total msgs received
                     msg_read: { type: "counter", value: 0 }},                  // total msgs read

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

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 900000,
    subscribeInterval: 5000,

    // Collect body MIME types as binary blobs
    mimeBody: [],

    // Sessions
    sessionAge: 86400 * 14 * 1000,

    // Default busy latency 1 sec
    busyLatency: 1000,

    // Default endpoints
    endpoints: { "account": 'initAccountAPI',
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
           { name: "caching", array: 1, type: "list", descr: "List of tables that can be cached: bk_auth, bk_counter. This list defines which DB calls will cache data with whatever cache configured" },
           { name: "disable", type: "list", descr: "Disable default API by endpoint name: account, message, icon....." },
           { name: "disable-session", type: "list", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow-admin", array: 1, descr: "URLs which can be accessed by admin accounts only, can be partial urls or Regexp, thisis a convenient options which registers AuthCheck callback for the given endpoints" },
           { name: "allow", array: 1, descr: "Regexp for URLs that dont need credentials, replace the whole access list" },
           { name: "allow-path", array: 1, key: "allow", descr: "Add to the list of allowed URL paths without authentication" },
           { name: "disallow-path", type: "callback", value: function(v) {this.allow.splice(this.allow.indexOf(v),1)}, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove ^/account/add$ to disable open registration" },
           { name: "allow-ssl", array: 1, descr: "Add to the list of allowed URL paths using HTRPs only, plain HTTP requetss to these urls will be refused" },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "deny", type: "regexp", descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", array: 1, key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 500, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
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
    self.metrics = new metrics();
    self.collectStatistics();
    setInterval(function() { self.collectStatistics() }, 300000);

    // Setup toobusy timer to detect when our requests waiting in the queue for too long
    if (self.busyLatency) toobusy.maxLag(self.busyLatency); else toobusy.shutdown();

    self.app = express();

    // Wrap all calls in domain to catch exceptions
    self.app.use(function(req, res, next) {
        if (self.busyLatency && toobusy()) return self.sendReply(res, 503, "Server is unavailable");

        var d = domain.create();
        d.on('error', function(err) {
            logger.error('api:', req.path, err.stack);
            self.sendReply(res, err);
            self.shutdown(function() { process.exit(0); });
        });
        d.add(req);
        d.add(res);
        d.run(next);
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
        req.stopwatch = self.metrics.Timer('response').start();
        self.metrics.Histogram('queue').update(self.metrics.Counter('count').inc());
        var end = res.end;
        res.end = function(chunk, encoding) {
            res.end = end;
            res.end(chunk, encoding);
            req.stopwatch.end();
            self.metrics.Counter('count').dec();
        }
        next();
    });

    // Access log via file or syslog
    if (logger.syslog) {
        self.accesslog = new stream.Stream();
        self.accesslog.writable = true;
        self.accesslog.write = function(data) { logger.printSyslog('info:local5', data); return true; }
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
                       (req.originalUrl || req.url) + " " +
                       "HTTP/" + req.httpVersionMajor + '.' + req.httpVersionMinor + " " +
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
    self.app.set('views', fs.existsSync(core.path.web + "/views") ? core.path.web + "/view" : __dirname + '/views');

    // Serve from default web location in the package or from application specific location
    self.app.use(serveStatic(core.path.web));
    self.app.use(serveStatic(__dirname + "/web"));

    self.app.use(self.app.router);

    // Default error handler to show errors in the log
    self.app.use(function(err, req, res, next) {
        logger.error(req.path, err.stack);
        self.sendReply(res, err);
    });

    // Return images by prefix, id and possibly type
    self.app.all(/^\/image\/([a-z]+)\/([a-z0-9-]+)\/?([0-9])?$/, function(req, res) {
        self.getIcon(req, res, req.params[1], { prefix: req.params[0], type: req.params[2] });
    });

    // Convert allow/deny lists into single regexp
    if (this.allow) this.allow = new RegExp(this.allow.map(function(x) { return "(" + x + ")"}).join("|"));
    if (this.allowSsl) this.allowSsl = new RegExp(this.allowSsl.map(function(x) { return "(" + x + ")"}).join("|"));
    if (this.deny) this.deny = new RegExp(this.deny.map(function(x) { return "(" + x + ")"}).join("|"));

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
        self.allowAdmin = new RegExp(self.allowAdmin.map(function(x) { return "(" + x + ")"}).join("|"));
        self.registerAuthCheck('', self.allowAdmin, function(req, status, cb) {
            if (req.account.type != "admin") return cb({ status: 401, message: "access denied, admins only" });
            cb();
        });
    }

    // Custom application logic
    self.initApplication.call(self, function(err) {
        // Setup all tables
        self.initTables(function(err) {

            self.server = self.app.listen(core.port, core.bind, core.backlog, function(err) {
                if (err) return logger.error('api: init:', core.port, core.bind, err);
                this.timeout = core.timeout;

                // Start the SSL server as well
                if (core.ssl.key || core.ssl.pfx) {
                    self.sslserver = https.createServer(core.ssl, self.app).listen(core.ssl.port, core.ssl.bind, core.backlog, function(err) {
                        if (err) logger.error('api: ssl failed:', err, core.ssl); else logger.log('api: ssl started', 'port:', core.ssl.port, 'bind:', core.ssl.bind, 'timeout:', core.timeout);
                        this.timeout = core.timeout;
                        if (callback) callback(err);
                    });
                } else
                if (callback) callback.call(self, err);
            });
        });
    });
}

// Gracefully close all connections, call the callback after that
api.shutdown = function(callback)
{
    logger.log('api.shutdown: started');

    var count = 0;
    if (this.server) {
        count++;
        this.server.close();
        this.server.on('close', function() {
            logger.log('api.shutdown: closed');
            if (--count == 0 && callback) callback();
        });
    }
    if (this.sslserver) {
        count++;
        this.sslserver.close();
        this.sslserver.on("close", function() {
            logger.log('api.shutdown: SSL closed');
            if (--count == 0 && callback) callback();
        });
    }
    // No servers running, call immediately
    if (!count && callback) callback();
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
    if (this.deny && req.path.match(this.deny)) return callback({ status: 401, message: "Access denied" });
    if (this.allow && req.path.match(this.allow)) return callback({ status: 200, message: "" });
    // Call custom access handler for the endpoint
    var hook = this.findHook('access', req.method, req.path);
    if (hook) {
        logger.debug('checkAccess:', req.method, req.path, hook);
        return hook.callbacks.call(this, req, callback)
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
    if (!sig.method || !sig.host || !sig.expires || !sig.login || !sig.signature) {
        return callback({ status: 401, message: "Invalid request: " + (!sig.method ? "no method provided" :
                                                                       !sig.host ? "no host provided" :
                                                                       !sig.login ? "no login provided" :
                                                                       !sig.expires ? "no expiration provided" :
                                                                       !sig.signature ? "no signature provided" : "") });
    }

    // Make sure it is not expired, it may be milliseconds or ISO date
    if (sig.expires <= Date.now()) {
        return callback({ status: 400, message: "Expired request" });
    }

    var options = {};
    if (this.caching.indexOf("bk_auth") > -1) options.cached = 1;

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    core.context.db.get("bk_auth", { login: sig.login }, options, function(err, account) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account record found" });

        // Account expiration time
        if (account.expires && account.expires < Date.now()) {
            return callback({ status: 404, message: "This account has expired" });
        }

        // Verify ACL regex if specified, test the whole query string as it appears in the request query line
        if (account.acl_deny && sig.url.match(account.acl_deny)) {
            return callback({ status: 401, message: "Access denied" });
        }
        if (account.acl_allow && !sig.url.match(account.acl_allow)) {
            return callback({ status: 401, message: "Not permitted" });
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
        	if (!req.query.id) {
        	    if (self.caching.indexOf("bk_account")) options.cached = 1, options.select = null;
        		db.get("bk_account", { id: req.account.id }, options, function(err, row) {
        			if (err) return self.sendReply(res, err);
        			if (!row) return self.sendReply(res, 404);

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
        			self.sendJSON(req, res, row);
        		});
        	} else {
        		db.list("bk_account", req.query.id, options, function(err, rows) {
        			if (err) return self.sendReply(res, err);
        			self.sendJSON(req, res, rows);
        		});
        	}
            break;

        case "add":
            self.addAccount(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "update":
            self.updateAccount(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "del":
            self.deleteAccount(req.account, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "subscribe":
            self.subscribe(req);
            break;

        case "select":
            db.select("bk_account", req.query, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                var next_token = info.next_token ? core.toBase64(info.next_token) : "";
                self.sendJSON(req, res, { count: rows.length, data: rows, next_token: next_token });
            });
            break;

        case "put/secret":
            if (!req.query.secret) return self.sendReply(res, 400, "secret is required");
            req.account.secret = req.query.secret;
            db.update("bk_auth", req.account, { cached: 1 }, function(err) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, {});
            });
            break;

        case "select/location":
            options.table = "bk_account";
            self.getLocations(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "get/icon":
            if (!req.query.id) req.query.id = req.account.id;
            if (!req.query.type) req.query.type = '0';
            self.getIcon(req, res, req.query.id, { prefix: 'account', type: req.query.type });
            break;

        case "select/icon":
            if (!req.query.id) req.query.id = req.account.id;
            options.ops = { type: "begins_with" };
            db.select("bk_icon", { id: req.query.id, type: "account:" }, options, function(err, rows) {
                if (err) return self.sendReply(res, err);
                // Filter out not allowed icons
                rows = rows.filter(function(x) { return self.checkIcon(req, req.query.id, x); });
                rows.forEach(function(x) { self.formatIcon(x, req.account); });
                self.sendJSON(req, res, rows);
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
            options.ops = { type: "begins_with" };
            db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + req.query.type }, options, function(err, rows) {
                if (err) return self.sendReply(res, err);
                // Filter out not allowed icons
                rows = rows.filter(function(x) { return self.checkIcon(req, req.query.id, x); });
                rows.forEach(function(x) { self.formatIcon(x, req.account); });
                self.sendJSON(req, res, rows);
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

    function processRows(rows) {
        rows.forEach(function(row) {
            if (row.mtime) {
                var mtime = row.mtime.split(":");
                row.mtime = core.toNumber(mtime[0]);
                row.sender = mtime[1];
            }
            if (row.status) row.status = row.status[0];
            if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime;
        });
        return rows;
    }

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
            if (!req.query.id) req.query.id = req.account.id;
            // Must be a string for DynamoDB at least
            if (req.query.mtime) {
                options.ops.mtime = "gt";
                req.query.mtime = String(req.query.mtime);
            }
            // All msgs i sent to this id
            if (req.query.id != req.account.id) {
                options.ops.sender = "begins_with";
                delete options.check_public;
                req.query.sender = req.account.id + ":";
            } else
            // Using sender index, all msgs from the sender
            if (req.query.sender) {
                options.sort = "sender";
                options.ops.sender = "begins_with";
                options.select = Object.keys(db.getColumns("bk_message", options));
                req.query.id = req.account.id;
                req.query.sender += ":";
            }
            db.select("bk_message", req.query, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, { count: rows.length, data: processRows(rows), next_token: info.next_token ? core.toBase64(info.next_token) : "" });
            });
            break;

        case "get/unread":
            req.query.id = req.account.id;
            req.query.status = "N:";
            options.sort = "status";
            options.ops.status = "begins_with";
            db.select("bk_message", req.query, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                // Mark all existing as read
                if (core.toBool(req.query._read)) {
                    var nread = 0;
                    async.forEachSeries(rows, function(row, next) {
                        db.update("bk_message", { id: req.account.id, mtime: row.mtime, status: 'R:' + row.mtime }, function(err) {
                            if (!err) nread++;
                            next();
                        });
                    }, function(err) {
                        if (nread) db.incr("bk_counter", { id: req.account.id, msg_read: nread }, { cached: 1 });
                        self.sendJSON(req, res, { count: rows.length, data: processRows(rows), next_token: info.next_token ? core.toBase64(info.next_token) : "" });
                    });
                } else {
                    self.sendJSON(req, res, { count: rows.length, data: processRows(rows), next_token: info.next_token ? core.toBase64(info.next_token) : "" });
                }
            });
            break;

        case "read":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            req.query.mtime += ":" + req.query.sender;
            db.update("bk_message", { id: req.account.id, mtime: req.query.mtime, status: "R:" + req.query.mtime }, function(err, rows) {
                if (!err) db.incr("bk_counter", { id: req.account.id, msg_read: 1 }, { cached: 1 });
                self.sendReply(res, err);
            });
            break;

        case "add":
            self.addMessage(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "del":
            self.delMessages(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
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
            self.incrCounters(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "get":
            var id = req.query.id || req.account.id;
            if (self.caching.indexOf("bk_counter")) options.cached = 1, options.select = null;
            db.get("bk_counter", { id: id }, options, function(err, row) {
                self.sendJSON(req, res, row);
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
            self.putConnections(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "del":
            self.delConnections(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "get":
            options.op = req.params[0];
            self.getConnections(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
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
            self.putLocations(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
            });
            break;

        case "get":
            self.getLocations(req, options, function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, data);
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
    this.app.all("/system/stats", function(req, res) {
        res.json(self.getStatistics());
    });

    this.app.all(/^\/system\/msg\/(.+)$/, function(req, res) {
        switch (req.params[0]) {
        case 'init':
            ipc.configure('msg');
            break;
        }
    });

    this.app.all(/^\/system\/cache\/(.+)$/, function(req, res) {
        switch (req.params[0]) {
        case 'init':
            ipc.configure('cache');
            break;
        case 'stats':
            ipc.statsCache(function(data) { res.send(data) });
            break;
        case "keys":
            ipc.keysCache(function(data) { res.send(data) });
            break;
        case "get":
            ipc.getCache(req.query.name, function(data) { res.send(data) });
            break;
        case "clear":
            ipc.clearCache();
            res.json();
            break;
        case "del":
            ipc.delCache(req.query.name);
            res.json();
            break;
        case "incr":
            ipc.incrCache(req.query.name, core.toNumber(req.query.value));
            res.json();
            break;
        case "put":
            ipc.putCache(req.params[0].split("/").pop(), req.query);
            res.json();
            break;
        default:
            self.sendReply(res, 404, "Invalid command");
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
    this.app.all(/^\/data\/(select|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res, info) {
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

        db[req.params[0]](req.params[1], req.query, options, function(err, rows) {
            if (err) return self.sendReply(res, err);
            switch (req.params[0]) {
            case "select":
            case "search":
                self.sendJSON(req, res, { count: rows.length, data: rows, next_token: info.next_token });
                break;
            default:
                self.sendJSON(req, res, rows);
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
    if (req.query._keys) {
        options.keys = core.strSplit(req.query._keys);
        if (!options.keys.length) delete options.keys;
    }
    if (req.query._width) options.width = core.toNumber(req.query._width);
    if (req.query._height) options.height = core.toNumber(req.query._height);
    if (req.query._ext) options.ext = req.query._ext;
    if (req.query._quality) options.quality = req.query._quality;
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
api.clearQuery = function(req, options, table, name)
{
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

api.addHook = function(type, method, path, callback)
{
    this.hooks[type].push(new express.Route(method, path, callback));
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

// Send result back with possibly executing post-process callback, this is used by all API handlers to allow custom post processing in teh apps
api.sendJSON = function(req, res, rows)
{
    var hook = this.findHook('post', req.method, req.path);
    if (!hook) return res.json(rows);
    try {
        hook.callbacks.call(this, req, res, rows);
    } catch(e) {
        logger.error('sendJSON:', req.path, err.stack);
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
        logger.error('sendStatus:', e);
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
    ipc.subscribe(req.msgKey, this.sendMessage, req);

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

// Process a message received from subscription server or other even notifier, it is used by `api.subscribe` method for delivery events to the clients
api.sendMessage = function(req, key, data)
{
    logger.debug('subscribe:', key, req.socket, data, res.headersSent);
    // If for any reasons the response has been sent we just bail out
    if (req.res.headersSent) return ipc.unsubscribe(key);
    if (typeof data != "string") data = JSON.stringify(data);
    // Filter by matching the whole message text
    if (req.msgMatch && !data.match(req.mgMatch)) return;
    if (!req.msgData) req.msgData = [];
    req.msgData.push(data);
    if (req.msgTimeout) clearTimeout(req.msgTimeout);
    req.msgTimeout = setTimeout(function() {
        if (!req.res.headersSent) req.res.type('application/json').send("[" + req.msgData.join(",") + "]");
        ipc.unsubscribe(key);
    }, req.msgInterval || 5000);
}

// Increase a counter, used in /counter/incr API call, options.op can be set to 'put'
api.incrCounters = function(req, options, callback)
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
    db[op]("bk_counter", obj, { cached: 1 }, function(err, rows) {
        if (err) return callback(db.convertError("bk_counter", "incr", err));

        // Notify only the other account
        if (obj.id != req.account.id) {
            ipc.publish(obj.id, { path: req.path, mtime: now, type: Object.keys(obj).join(",") });
        }

        callback(null, rows);

        // Update history log
        if (options.history) {
            db.add("bk_history", { id: obj.id, type: req.path, data: core.cloneObj(obj, { mtime: 1 }) });
        }
    });
}

// Return all connections for the current account, this function is called by the `/connection/get` API call.
api.getConnections = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    if (req.query.type) req.query.type += ":" + (req.query.id || "");
    req.query.id = req.account.id;
    options.ops.type = "begins_with";
    db.select("bk_" + (options.op || "connection"), req.query, options, function(err, rows, info) {
        if (err) return self.sendReply(res, err);
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
            if (err) return self.sendReply(res, err);
            callback(null, { count: rows.length, data: rows, next_token: next_token });
        });
    });
}

// Create a connection between 2 accounts, this function is called by the `/connection/add` API call.
api.putConnections = function(req, options, callback)
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
    db[op]("bk_connection", req.query, function(err) {
        if (err) return callback(db.convertError("bk_connection", op, err));

        // Reverse reference to the same connection
        req.query.id = id;
        req.query.type = type + ":"+ req.account.id;
        db[op]("bk_reference", req.query, function(err) {
            if (err) {
                db.del("bk_connection", { id: req.account.id, op: op, type: type + ":" + id });
                return callback(err);
            }
            ipc.publish(id, { path: req.path, mtime: now, type: type });

            // We need to know if the other side is connected too, this will save one extra API call later
            if (req.query._connected) {
                db.get("bk_connection", req.query, { select: ['id'] }, function(err, row) {
                    callback(null, { connected: row ? 1 : 0 });
                });
            } else {
                callback(null, {});
            }

            async.series([
               function(next) {
                   // Update history log
                   if (!options.history) return next();
                   db.add("bk_history", { id: req.account.id, type: req.path, data: type + ":" + id }, next);
               },
               function(next) {
                   // Update accumulated counter if we support this column and do it automatically
                   next(op == 'update' ? new Error("stop") : null);
               },
               function(next) {
                   var col = db.getColumn("bk_counter", type + '0');
                   if (!col || !col.autoincr) return next();
                   db.incr("bk_counter", core.newObj('id', req.account.id, type + '0', 1), { cached: 1 }, function() {
                       db.incr("bk_counter", core.newObj('id', id, type + '1', 1), { cached: 1 }, next);
                   });
               }]);
        });
    });
}

// Delete a connection, this function is called by the `/connection/del` API call
api.delConnections = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();
    var id = req.query.id;
    var type = req.query.type;

    if (id && type) {
        db.del("bk_connection", { id: req.account.id, type: type + ":" + id }, options, function(err) {
            if (err) return callback(err);
            db.del("bk_reference", { id: id, type: type + ":" + req.account.id }, options, function(err) {
                if (err) return callback(err);

                ipc.publish(id, { path: req.path, mtime: now, type: type });

                callback(null, {});

                async.series([
                   function(next) {
                       // Update history log
                       if (!options.history) return next();
                       db.add("bk_history", { id: req.account.id, type: req.path, data: type + ":" + id }, next);
                   },
                   function(next) {
                       // Update accumulated counter if we support this column and do it automatically
                       var col = db.getColumn("bk_counter", req.query.type + "0");
                       if (!col || !col.autoincr) return next();
                       db.incr("bk_counter", core.newObj('id', req.account.id, type + '0', -1), { cached: 1 }, function() {
                           db.incr("bk_counter", core.newObj('id', id, type + '1', -1), { cached: 1 }, next);
                       });
                   }]);
            });
        });
    } else {
        var counters = {};
        db.select("bk_connection", { id: req.account.id }, options, function(err, rows) {
            if (err) return next(err)
            async.forEachSeries(rows, function(row, next2) {
                var t = row.type.split(":");
                if (id && t[1] != id) return next2();
                if (type && t[0] != type) return next2();
                // Keep track of all counters
                var name0 = t[0] + '0', name1 = t[0] + '1';
                var col = db.getColumn("bk_counter", name0);
                if (col && col.autoincr) {
                    if (!counters[req.account.id]) counters[req.account.id] = { id: req.account.id };
                    if (!counters[req.account.id][name0]) counters[req.account.id][name0] = 0;
                    counters[req.account.id][name0]--;
                    if (!counters[t[1]]) counters[t[1]] = { id: t[1] };
                    if (!counters[t[1]][name1]) counters[t[1]][name1] = 0;
                    counters[t[1]][name1]--;
                }
                db.del("bk_reference", { id: t[1], type: t[0] + ":" + req.account.id }, options, function(err) {
                    db.del("bk_connection", row, options, next2);
                });
            }, function(err) {
                if (err) return callback(err);

                // Update all counters for each id
                async.forEachSeries(Object.keys(counters), function(id, next) {
                    db.incr("bk_counter", counters[id], { cached: 1 }, next);
                }, function(err) {
                    // Update history log
                    if (!options.history) return callback(err, {});
                    db.add("bk_history", { id: req.account.id, type: req.path, data: type + ":" + id }, callback);
                });
            });
        });
    }
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
//                  self.sendJSON(req, res, data);
//              });
//          });
//
api.getLocations = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var table = options.table || "bk_location";

    // Perform location search based on hash key that covers the whole region for our configured max distance
    if (!req.query.latitude || !req.query.longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Pass all query parameters for custom filters if any, do not override existing options
    for (var p in req.query) {
        if (p[0] != "_" && !options[p]) options[p] = req.query[p];
    }
    // Limit the distance within our configured range
    options.distance = core.toNumber(req.query.distance, 0, core.minDistance, core.minDistance, core.maxDistance);

    // Continue pagination using the search token
    var token = core.toJson(req.query._token);
    if (token && token.geohash) {
        if (token.latitude != options.latitude ||
            token.longitude != options.longitude ||
            token.distance != options.distance) return callback({ status: 400, message: "invalid token, latitude, longitude and distance must be the same" });
        options = token;
    }
    // Rounded distance, not precise to keep from pin-pointing locations
    if (!options.round) options.round = core.minDistance;

    db.getLocations(table, options, function(err, rows, info) {
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
api.putLocations = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();

    var latitude = req.query.latitude, longitude = req.query.longitude;
    if (!latitude || !longitude) return callback({ status: 400, message: "latitude/longitude are required" });

    // Get current location
    db.get("bk_account", { id: req.account.id }, function(err, old) {
        if (err || !old) return callback(err);

        // Build new location record
        var geo = core.geoHash(latitude, longitude);

        // Skip if within minimal distance
        var distance = backend.geoDistance(old.latitude, old.longitude, latitude, longitude);
        if (distance < core.minDistance || old.geohash == geo.geohash) return callback({ status: 305, message: "ignored, min distance: " + core.minDistance});

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
                callback(null, req.query);

                async.series([
                   function(next) {
                       // Delete the old location, no need to wait even if fails we still have a new one recorded
                       db.del("bk_location", old, next);
                   },
                   function(next) {
                       // Update history log
                       if (!options.history) return next();
                       db.add("bk_history", { id: req.account.id, type: req.path, data: geo.hash + ":" + latitude + ":" + longitude }, next);
                   }]);
            });
        });
    });
}

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
api.handleIcon = function(req, res, options)
{
    var self = this;
    var db = core.context.db;
    var op = options.op || "put";
    if (!req.query.type) req.query.type = "";

    req.query.id = req.account.id;
    req.query.type = req.query.prefix + ":" + req.query.type;
    if (req.query.latitude && req.query.longitude) req.query.geohash = core.geoHash(req.query.latitude, req.query.longitude);

    db[op]("bk_icon", req.query, function(err, rows) {
        if (err) return self.sendReply(res, err);

        options.force = true;
        options.prefix = req.query.prefix;
        options.type = req.query.type;
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

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.context.db;

    if (self.caching.indexOf("bk_icon")) options.cached = 1;
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

// Place the icon data to the destination
api.storeIcon = function(icon, id, options, callback)
{
    if (this.imagesS3) {
        this.putIconS3(icon, id, options, callback);
    } else {
        core.putIcon(icon, id, options, callback);
    }
}

// Delete an icon for account, .type defines icon prefix
api.delIcon = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = core.iconPath(id, options);
    if (this.imagesS3) {
        var aws = core.context.aws;
        aws.queryS3(this.imagesS3, icon, { method: "DELETE" }, function(err) {
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

// Same as putIcon but store the icon in the S3 bucket, icon can be a file or a buffer with image data
api.putIconS3 = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var aws = core.context.aws;
    var icon = core.iconPath(id, options);
    core.scaleIcon(file, options, function(err, data) {
        if (err) return callback ? callback(err) : null;
        var headers = { 'content-type': 'image/' + (options.ext || "jpeg") };
        aws.queryS3(self.imagesS3, icon, { method: "PUT", postdata: data, headers: headers }, function(err) {
            if (callback) callback(err, icon);
        });
    });
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

    if (this.fileS3) {
        var headers = { 'content-type': mime.lookup(outfile) };
        var ops = { method: "PUT", headers: headers }
        opts[Buffer.isBuffer(tmfile) ? 'postdata' : 'postfile'] = tmpfile;
        aws.queryS3(this.filesS3, outfile, opts, function(err) {
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

// Delete file by name
api.deleteFile = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.fileS3) {
        aws.queryS3(this.filesS3, file, { method: "DELETE" }, function(err) {
            if (callback) callback(err, outfile);
        });
    } else {
        fs.unlink(path.join(core.path.files, file), function(err) {
            if (err) logger.error('deleteFile:', file, err);
            if (callback) callback(err, outfile);
        })
    }
}

// Add new message, used in /message/add API call
api.addMessage = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;
    var now = Date.now();

    if (!req.query.id) return callback({ status: 400, message: "receiver id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });
    req.query.mtime = now + ":" + req.account.id;
    req.query.sender = req.account.id + ":" + now;
    req.query.status = 'N:' + req.query.mtime;
    self.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime }, function(err, icon) {
        if (err) return callback(err);
        req.query.icon = icon ? 1 : "0";
        db.add("bk_message", req.query, {}, function(err, rows) {
            if (err) return callback(db.convertError("bk_message", "add", err));

            if (req.query.id != req.account.id) {
                ipc.publish(req.query.id, { path: req.path, mtime: now, type: req.query.icon });
            }

            callback(null, { id: req.query.id, mtime: now, sender: req.account.id, icon: req.query.icon });

            async.series([
               function(next) {
                   db.incr("bk_counter", { id: req.query.id, msg_count: 1 }, { cached: 1 }, next);
               },
               function(next) {
                   // Update history log
                   if (!options.history) return next();
                   db.add("bk_history", { id: req.account.id, type: req.path, mtime: now, data: req.query.id }, next);
               }]);
        });
    });
}

// Delete a message or all messages for the given account from the given sender, used in /messge/del` API call
api.delMessages = function(req, options, callback)
{
    var self = this;
    var db = core.context.db;

    if (!req.query.sender) return callback({ status: 400, message: "sender is required" });

    if (req.query.mtime) {
        req.query.mtime += ":" + req.query.sender;
        db.del("bk_message", { id: req.account.id, mtime: req.query.mtime }, function(err, rows) {
            if (err) return callback(err);
            db.incr("bk_counter", { id: req.account.id, msg_count: -1 }, { cached: 1 }, callback);
        });
    } else {
        options.sort = "sender";
        options.ops = { sender: "begins_with" };
        db.select("bk_message", { id: req.account.id, sender: req.query.sender + ":" }, options, function(err, rows) {
            if (err) return callback(err);
            async.forEachSeries(rows, function(row, next) {
                var sender = row.sender.split(":");
                row.mtime = sender[1] + ":" + sender[0];
                db.del("bk_message", row, options, next);
            }, function(err) {
                if (err || !rows.count) return callback(err, {});
                db.incr("bk_counter", { id: req.account.id, msg_count: -rows.count }, { cached: 1 }, callback);
            });
        });
    }
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
    // Add new auth record with only columns we support, NoSQL db can add any columns on the fly and we want to keep auth table very small
    var auth = { id: req.query.id, login: req.query.login, secret: req.query.secret };
    // Only admin can add accounts with the type
    if (req.account && req.account.type == "admin" && req.query.type) auth.type = req.query.type;
    db.add("bk_auth", auth, function(err) {
        if (err) return callback(db.convertError("bk_auth", "add", err));
        // Skip location related properties
        self.clearQuery(req, options, "bk_account", "noadd");
        db.add("bk_account", req.query, function(err) {
            if (err) {
                db.del("bk_auth", auth);
                return callback(db.convertError("bk_account", "add", err));
            }
            db.processRows(null, "bk_account", req.query, options);
            // Link account record for other middleware
            req.account = req.query;
            // Some dbs require the record to exist, just make one with default values
            db.put("bk_counter", { id: req.query.id, like0: 0 }, function(err) {
                callback(err, req.query);
            });
        });
    });
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
    db.update("bk_account", req.query, callback);
}

// Delete account specified by the obj. Used in `/account/del` API call.
// The options may contain keep: {} object with table names to be kept without the bk_ prefix, for example
// delete an account but keep all messages and location: keep: { message: 1, location: 1 }
api.deleteAccount = function(obj, options, callback)
{
    var self = this;

    if (!obj || !obj.id || !obj.login) return callback({ status: 400, message: "id, login must be specified" });

    var db = core.context.db;
    options = db.getOptions("bk_account", options);
    if (!options.keep) options.keep = {};

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
               db.delAll("bk_message", { id: obj.id }, options, function() { next() });
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

// Returns an object with collected db and api statstics and metrics
api.getStatistics = function()
{
    return { toobusy: toobusy.lag(), pool: core.context.db.getPool().metrics, api: this.metrics };
}

// Metrics about the process
api.collectStatistics = function()
{
    var avg = os.loadavg();
    var mem = process.memoryUsage();
    this.metrics.Histogram('rss').update(mem.rss);
    this.metrics.Histogram('heap').update(mem.heapUsed);
    this.metrics.Histogram('loadavg').update(avg[2]);
    this.metrics.Histogram('freemem').update(os.freemem());
}

