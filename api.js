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
var connect = require('connect');
var cookieParser = require('cookie-parser');
var session = require('cookie-session');
var serveStatic = require('serve-static');
var formidable = require('formidable');
var mime = require('mime');
var consolidate = require('consolidate');
var domain = require('domain');
var metrics = require(__dirname + '/metrics');
var core = require(__dirname + '/core');
var printf = require('printf');
var logger = require(__dirname + '/logger');
var backend = require(__dirname + '/build/backend');

// HTTP API to the server from the clients, this module implements the basic HTTP(S) API functionality with some common features. The API module
// incorporates the Express server which is exposed as api.app object, the master server spawns Web workers which perform actual operations and monitors
// the worker processes if they die and restart them automatically. How many processes to spawn can be configured via `-server-max-workers` config parameter.
var api = {

    // No authentication for these urls
    allow: ["^/$",
            ".+\\.(ico|gif|png|jpg|js|css|ttf|eof|woff|svg|html)$",
            "^/public",
            "^/account/add$" ],

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
                   url_deny: {},                        // Deny access to matched url
                   url_allow: {},                       // Only grant access if matched this regexp
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
                      latitude: { type: "real" },
                      longitude: { type: "real" },
                      geohash: {},
                      location: {},
                      ltime: { type: "bigint" },
                      ctime: { type: "bigint" },
                      mtime: { type: "bigint", now: 1 } },

       // Keep track of icons uploaded
       bk_icon: { id: { primary: 1, pub: 1 },                 // Account id
                  type: { primary: 1, pub: 1 },               // prefix:type
                  allow: {},                                  // Who can see it: all, auth, id:id...
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

       // Connections by time to query for recent updates since some time...
       bk_recent: { id: { primary: 1 },               // my account id
                    mtime: { primary: 1 },            // mtime:connection_id
                    type: {} },

       // References from other accounts, likes,dislikes...
       bk_reference: { id: { primary: 1 },                    // connection_id
                       type: { primary: 1 },                  // type:account_id
                       state: {},
                       mtime: { type: "bigint", now: 1 }},

       // Messages between accounts
       bk_message: { id: { primary: 1 },                    // my account_id
                     mtime: { primary: 1 },                 // mtime:sender, the current timestamp in milliseconds and the sender
                     status: {},                            // Status flags: R - read
                     msg: { type: "text" },                 // Text of the message
                     icon: {}},                             // Icon base64 or url

       // All accumulated counters for accounts
       bk_counter: { id: { primary: 1, pub: 1 },                               // account id
                     mtime: { type: "bigint", now: 1 },
                     ping: { type: "counter", value: 0, pub: 1 },              // public column to ping the buddy
                     like0: { type: "counter", value: 0, incr: 1 },            // who i liked
                     like1: { type: "counter", value: 0 },                     // reversed, who liked me
                     dislike0: { type: "counter", value: 0, incr: 1 },
                     dislike1: { type: "counter", value: 0 },
                     follow0: { type: "counter", value: 0, incr: 1 },
                     follow1: { type: "counter", value: 0, },
                     invite0: { type: "counter", value: 0, incr: 1 },
                     invite1: { type: "counter", value: 0, },
                     view0: { type: "counter", value: 0, incr: 1 },
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

    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    subscribeTimeout: 600000,
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
           { name: "disable", type: "list", descr: "Disable default API by endpoint name: account, message, icon....." },
           { name: "disable-session", type: "list", descr: "Disable access to API endpoints for Web sessions, must be signed properly" },
           { name: "allow", array: 1, descr: "Regexp for URLs that dont need credentials, replace the whole access list" },
           { name: "allow-path", array: 1, key: "allow", descr: "Add to the list of allowed URL paths without authentication" },
           { name: "disallow-path", type: "callback", value: function(v) {var i=this.allow.indexOf(v);if(i>-1) this.allow.splice(i,1)}, descr: "Remove from the list of allowed URL paths that dont need authentication, most common case is to to remove ^/account/add$ to disable open registration" },
           { name: "allow-ssl", array: 1, descr: "Add to the list of allowed URL paths using HTRPs only, plain HTTP requetss to these urls will be refused" },
           { name: "mime-body", array: 1, descr: "Collect full request body in the req.body property for the given MIME type in addition to json and form posts, this is for custom body processing" },
           { name: "deny", type: "regexp", descr: "Regexp for URLs that will be denied access, replaces the whole access list"  },
           { name: "deny-path", array: 1, key: "deny", descr: "Add to the list of URL paths to be denied without authentication" },
           { name: "subscribe-timeout", type: "number", min: 60000, max: 3600000, descr: "Timeout for Long POLL subscribe listener, how long to wait for events, milliseconds"  },
           { name: "subscribe-interval", type: "number", min: 500, max: 3600000, descr: "Interval between delivering events to subscribed clients, milliseconds"  },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10, descr: "Max size for uploads, bytes"  }],
}

module.exports = api;

// Initialize API layer, this mut be called before the api module can be used but it is called by the server module automatically so api.init is
// rearely need to used directly, only for new server implementation or if using in the shell for testing.
// During the init sequence, this function calls api.initMiddleware and api.initApplication methods which by default are empty but can be redefined in the user aplications.
api.init = function(callback)
{
    var self = this;
    var db = core.context.db;

    // Access log via file or syslog
    if (logger.syslog) {
        self.accesslog = new stream.Stream();
        self.accesslog.writable = true;
        self.accesslog.write = function(data) { logger.printSyslog('info:local5', data); return true; }
    } else
    if (self.accessLog) {
        self.accesslog = fs.createWriteStream(path.join(core.path.log, self.accessLog), { flags: 'a' });
        self.accesslog.on('error', function(err) { logger.error('accesslog:', err); })
    } else {
        self.accesslog = logger;
    }

    // Performance statistics
    self.metrics = new metrics();
    self.collectStatistics();
    setInterval(function() { self.collectStatistics() }, 300000);

    // Setup toobusy timer to detect when our requests waiting in the queue for too long
    if (self.busyLatency) toobusy.maxLag(self.busyLatency); else toobusy.shutdown();

    self.app = express();

    // Wrap all calls in domain to catch exceptions
    self.app.use(function(req, res, next) {
        var d = domain.create();
        d.add(req);
        d.add(res);
        d.on('error', function(err) { req.next(err); });
        d.run(next);
    });

    // Metrics starts early
    self.app.use(function(req, res, next) { return self.collectMetrics(req, res, next); });

    // Allow cross site requests
    self.app.use(function(req, res, next) {
        if (self.busyLatency && toobusy()) return res.send(503, "Server is unavailable");
        res.header('Server', core.name + '/' + core.version);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'b-signature,b-next-token');
        next();
    });

    // Request parsers
    self.app.use(cookieParser());
    self.app.use(function(req, res, next) { return self.checkQuery(req, res, next); });
    self.app.use(function(req, res, next) { return self.checkBody(req, res, next); });

    // Keep session in the cookies
    self.app.use(session({ key: 'bk_sid', secret: self.sessionSecret || core.name, cookie: { path: '/', httpOnly: false, maxAge: self.sessionAge || null } }));

    // Check the signature and make sure the logger is defined to log all requests
    self.app.use(this.accessLogger());
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
    // Default error handler to show erros in the log
    self.app.use(function(err, req, res, next) {
        console.error(err.stack);
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
        self.registerAuthCheck('', new RegExp(x), function(req, callback) {
            if (req.session && req.session['bk-signature']) return callback({ status: 401, message: "Not authorized" });
            callback();
        });
    });

    // Custom application logic
    self.initApplication.call(self, function(err) {
        // Setup all tables
        self.initTables(function(err) {

            var server = self.app.listen(core.port, core.bind, function(err) {
                if (err) return logger.error('api: init:', core.port, core.bind, err);
                this.timeout = core.timeout;

                // Start the SSL server as well
                if (core.ssl.key || core.ssl.pfx) {
                    server = https.createServer(core.ssl, self.app).listen(core.ssl.port, core.ssl.bind, function(err) {
                        if (err) logger.error('api: ssl failed:', err, core.ssl); else logger.log('api: ssl started', 'port:', core.ssl.port, 'bind:', core.ssl.bind, 'timeout:', core.timeout);
                        this.timeout = core.timeout;
                        if (callback) callback(err);
                    });
                } else
                if (callback) callback(err);
            });
        });
    });
}

// This handler is called after the Express server has been setup and all default API endpoints initialized but the server
// is not ready for incoming requests yet. This handler can setup additional API endpoints, add/modify table descriptions.
api.initApplication = function(callback) { callback() };

// This handler is called during the Express server initialization just after the security middleware.
// this.app refers to the Express instance.
api.initMiddleware = function() {};

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

    var type = connect.utils.mime(req);
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
        } catch (err){
            err.body = buf;
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
    if ('multipart/form-data' != connect.utils.mime(req)) return next();
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
    if (hook) return hook.callbacks.call(this, req, callback)
    callback();
}

// Perform authorization checks after the account been checked for valid signature, this is called even if the signature verification failed
// - req is Express request object
// - status contains the signature verification status, an object wth status: and message: properties
// - callback is a function(req, status) to be called with the resulted status where status must be an object with status and message properties as well
api.checkAuthorization = function(req, status, callback)
{
    var hook = this.findHook('auth', req.method, req.path);
    if (hook) return hook.callbacks.call(this, req, status, callback);
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

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    core.context.db.getCached("bk_auth", { login: sig.login }, function(err, account) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account record found" });

        // Account expiration time
        if (account.expires && account.expires < Date.now()) {
            return callback({ status: 404, message: "This account has expired" });
        }

        // Verify ACL regex if specified, test the whole query string as it appears in the request query line
        if (account.url_deny && sig.url.match(account.url_deny)) {
            return callback({ status: 401, message: "Access denied" });
        }
        if (account.url_allow && !sig.url.match(account.url_allow)) {
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
        		db.get("bk_account", { id: req.account.id }, options, function(err, rows) {
        			if (err) return self.sendReply(res, err);
        			if (!rows.length) return self.sendReply(res, 404);

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
        			self.sendJSON(req, res, rows[0]);
        		});
        	} else {
        		db.list("bk_account", req.query.id, options, function(err, rows) {
        			if (err) return self.sendReply(res, err);
        			self.sendJSON(req, res, rows);
        		});
        	}
            break;

        case "add":
            // Verify required fields
            if (!req.query.secret) return self.sendReply(res, 400, "secret is required");
            if (!req.query.name) return self.sendReply(res, 400, "name is required");
            if (!req.query.login) return self.sendReply(res, 400, "login is required");
            if (!req.query.alias) req.query.alias = req.query.name;
            req.query.id = core.uuid();
            req.query.mtime = req.query.ctime = Date.now();
            // Add new auth record with only columns we support, NoSQL db can add any columns on the fly and we want to keep auth table very small
            var auth = { id: req.query.id, login: req.query.login, secret: req.query.secret };
            // Only admin can add accounts with the type
            if (req.account && req.account.type == "admin" && req.query.type) auth.type = req.query.type;
            db.add("bk_auth", auth, function(err) {
                if (err) return self.sendReply(res, db.convertError("bk_auth", err));

                ["secret","ctime","ltime","latitude","longitude","location"].forEach(function(x) { delete req.query[x] });
                db.add("bk_account", req.query, function(err) {
                    if (err) {
                        db.del("bk_auth", auth);
                        return self.sendReply(res, db.convertError("bk_account", err));
                    }
                    db.processRows(null, "bk_account", req.query, options);
                    // Link account record for other middleware
                    req.account = req.query;
                    // Some dbs require the record to exist, just make one with default values
                    db.put("bk_counter", { id: req.query.id, like0: 0 });
                    self.sendJSON(req, res, req.query);
                });
            });
            break;

        case "update":
            req.query.mtime = Date.now();
            req.query.id = req.account.id;
            // Make sure we dont add extra properties in case of noSQL database or update columns we do not support here
            ["secret","ctime","ltime","latitude","longitude","location"].forEach(function(x) { delete req.query[x] });
            db.update("bk_account", req.query, function(err) {
                if (err) return self.sendReply(res, err);
                self.sendJSON(req, res, {});
            });
            break;

        case "del":
            db.get("bk_account", { id: req.account.id }, options, function(err, rows) {
                if (err) return self.sendReply(res, err);
                if (!rows.length) return self.sendReply(res, 404);
                // Pass the whole account record downstream to the possible hooks and return it as well to our client
                for (var p in rows[0]) req.account[p] = rows[0][p];
                self.deleteAccount(req.account, function(err) {
                    if (err) return self.sendReply(res, err);
                    self.sendJSON(req, res, core.cloneObj(req.account, { secret: true }));
                });
            });
            break;

        case "subscribe":
            // Ignore not matching events, the whole string is checked
            if (req.query.match) req.query.match = new RegExp(req.query.match);

            // Returns opaque handle depending on the pub/sub system
            req.pubSock = core.ipcSubscribe(req.account.id, function(data) {
                if (typeof data != "string") data = JSON.stringify(data);
                if (req.query.match && !data.match(req.query.match)) return;
                logger.debug('subscribe:', req.account.id, this.socket, data, res.headersSent);
                if (res.headersSent) return (req.pubSock = core.ipcUnsubscribe(req.pubSock));
                if (req.pubTimeout) clearTimeout(req.pubTimeout);
                // Concatenate all messages received within the interval
                if (!req.pubData) req.pubData = ""; else req.pubData += ",";
                req.pubData += data;
                req.pubTimeout = setTimeout(function() {
                    if (!res.headersSent) res.type('application/json').send("[" + req.pubData + "]");
                    // Returns null and clears the reference
                    req.pubSock = core.ipcUnsubscribe(req.pubSock, req.account.id);
                }, self.subscribeInterval);
            });
            if (!req.pubSock) return self.sendReply(res, 500, "Service is not activated");

            // Listen for timeout and ignore it, this way the socket will be alive forever until we close it
            res.on("timeout", function() {
                logger.debug('subscribe:', 'timeout', req.account.id, req.pubSock);
                setTimeout(function() { req.socket.destroy(); }, self.subscribeTimeout);
            });
            req.on("close", function() {
                logger.debug('subscribe:', 'close', req.account.id, req.pubSock);
                req.pubSock = core.ipcUnsubscribe(req.pubSock, req.account.id);
            });
            logger.debug('subscribe:', 'start', req.account.id, req.pubSock);
            break;

        case "select":
            db.select("bk_account", req.query, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                var next_token = info.next_token ? core.toBase64(info.next_token) : "";
                self.sendJSON(req, res, { data: rows, next_token: next_token });
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
                rows.forEach(function(x) { self.formatIcon(req, req.query.id, x); });
                self.sendJSON(req, res, rows);
            });
            break;

        case "put/icon":
        case "del/icon":
            req.query.prefix = 'account';
            if (!req.query.type) req.query.type = '0';
            self.handleIcon(req, res, req.params[0].substr(0, 3), options);
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

    this.app.all(/^\/icon\/([a-z]+)\/([a-z0-9]+)\/?([a-z0-9])?$/, function(req, res) {

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
                rows.forEach(function(x) { self.formatIcon(req, req.query.id, x); });
                self.sendJSON(req, res, rows);
            });
            break;

        case "del":
        case "put":
            self.handleIcon(req, res, req.params[0], options);
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

    this.app.all(/^\/message\/([a-z]+)$/, function(req, res) {

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);
        var now = Date.now();

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            self.getIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            options.ops = { mtime: "gt" };
            db.select("bk_message", { id: req.account.id, mtime: req.query.mtime || "" }, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                var next_token = info.next_token ? core.toBase64(info.next_token) : "";
                rows.forEach(function(row) {
                    var mtime = row.mtime.split(":");
                    row.mtime = mtime[0];
                    row.sender = mtime[1];
                    if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime;
                });
                self.sendJSON(req, res, { data: rows, next_token: next_token });
            });
            break;

        case "add":
            if (!req.query.id) return self.sendReply(res, 400, "receiver id is required");
            if (!req.query.msg && !req.query.icon) return self.sendReply(res, 400, "msg or icon is required");
            req.query.sender = req.account.id;
            req.query.mtime = now + ":" + req.query.sender;
            self.putIcon(req, req.query.id, { prefix: 'message', type: req.query.mtime }, function(err, icon) {
                if (err) return self.sendReply(res, err);
                if (icon) req.query.icon = 1;
                db.add("bk_message", req.query, {}, function(err, rows) {
                    if (err) return self.sendReply(res, db.convertError("bk_message", err));
                    self.sendJSON(req, res, {});
                    core.ipcPublish(req.query.id, { path: req.path, mtime: now, sender: req.query.sender });
                    db.incr("bk_counter", { id: req.account.id, msg_count: 1 }, { cached: 1 });

                    // Update history log
                    if (req.query._history) {
                        db.add("bk_history", { id: req.account.id, type: req.path, mtime: now, data: req.query.id });
                    }
                });
            });
            break;

        case "read":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            req.query.mtime += ":" + req.query.sender;
            db.update("bk_message", { id: req.account.id, mtime: req.query.mtime, status: "R" }, function(err, rows) {
                if (!err) db.incr("bk_counter", { id: req.account.id, msg_read: 1 }, { cached: 1 });
                self.sendReply(res, err);
            });
            break;

        case "del":
            if (!req.query.sender || !req.query.mtime) return self.sendReply(res, 400, "sender and mtime are required");
            req.query.mtime = now + ":" + req.query.sender;
            req.query.id = req.account.id;
            db.del("bk_message", req.query, {}, function(err, rows) {
                if (err) return self.sendReply(res, err);
                db.incr("bk_counter", { id: req.account.id, msg_count: -1 }, { cached: 1 });
                self.sendJSON(req, res, {});
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
            // Remove non public columns when updating other account
            if (req.query.id && req.query.id != req.account.id) {
                var obj = { id: req.query.id };
                db.getPublicColumns("bk_counter").forEach(function(x) { if (req.query[p]) obj[p] = req.query[p]; });
            } else {
                var obj = req.query;
                obj.id = req.account.id;
            }
            db[req.params[0]]("bk_counter", obj, { cached: 1 }, function(err, rows) {
                if (err) return self.sendReply(res, db.convertError("bk_counter", err));

                // Update history log
                if (req.query._history) {
                    db.add("bk_history", { id: req.account.id, type: req.path, data: core.cloneObj(obj, { mtime: 1 }) });
                }

                self.sendJSON(req, res, rows);
                core.ipcPublish(req.query.id, { path: req.path, mtime: now, data: core.cloneObj(obj, { id: 1, mtime: 1 })});
            });
            break;

        case "get":
            var id = req.query.id || req.account.id;
            db.getCached("bk_counter", { id: id }, options, function(err, row) {
                res.json(row);
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
            var id = req.query.id, type = req.query.type;
            if (!id || !type) return self.sendReply(res, 400, "id and type are required");
            if (id == req.account.id) return self.sendReply(res, 400, "cannot connect to itself");
            // Override primary key properties, the rest of the properties will be added as is
            req.query.id = req.account.id;
            req.query.type = type + ":" + id;
            req.query.mtime = now;
            db[req.params[1]]("bk_connection", req.query, function(err) {
                if (err) return self.sendReply(res, db.convertError("bk_connection", err));

                // Maintain recent mtime for connections so we can query who's new connected
                db.add("bk_recent", { id: req.account.id, mtime: now + ":" + id, type: type });

                // Reverse reference to the same connection
                req.query.id = id;
                req.query.type = type + ":"+ req.account.id;
                db[req.params[1]]("bk_reference", req.query, function(err) {
                    if (err) {
                        db.del("bk_connection", { id: req.account.id, type: type + ":" + id });
                        return self.sendReply(res, err);
                    }
                    // We need to know if the other side is connected too, this will save one extra API call
                    if (req.query._connected) {
                        db.get("bk_connection", req.query, function(err, rows) {
                            self.sendJSON(req, res, { connected: rows.length });
                        });
                    } else {
                        self.sendJSON(req, res, {});
                    }
                    core.ipcPublish(id, { path: req.path, mtime: now, type: type, id: req.account.id });

                    // Update history log
                    if (req.query._history) {
                        db.add("bk_history", { id: req.account.id, type: req.path, data: type + ":" + id });
                    }

                    // Update accumulated counter if we support this column and do it automatically
                    if (req.params[1] == 'update') return;

                    var col = db.getColumn("bk_counter", type + '0');
                    if (col && col.incr) {
                        db.incr("bk_counter", core.newObj('id', req.account.id, type + '0', 1), { cached: 1 });
                        db.incr("bk_counter", core.newObj('id', id, type + '1', 1), { cached: 1 });
                    }
                });
            });
            break;

        case "del":
            var id = req.query.id, type = req.query.type;
            if (!id || !type) return self.sendReply(res, 400, "id and type are required");
            db.del("bk_connection", { id: req.account.id, type: type + ":" + id }, function(err) {
                if (err) return self.sendReply(res, err);
                db.del("bk_reference", { id: id, type: type + ":" + req.account.id }, function(err) {
                    if (err) self.sendReply(res, err);
                    self.sendJSON(req, res, {});
                    core.ipcPublish(id, { path: req.path, mtime: now, type: type, id: req.account.id });

                    // Update history log
                    if (req.query._history) {
                        db.add("bk_history", { id: req.account.id, type: req.path, data: type + ":" + id });
                    }

                    // Update accumulated counter if we support this column and do it automatically
                    var col = db.getColumn("bk_counter", req.query.type + "0");
                    if (col && col.incr) {
                        db.incr("bk_counter", core.newObj('id', req.account.id, type + '0', -1), { cached: 1 });
                        db.incr("bk_counter", core.newObj('id', id, type + '1', -1), { cached: 1 });
                    }
                });
            });
            break;

        case "recent":
            options.ops = { type: "gt" };
            db.select("bk_recent", { id: req.account.id, mtime: req.query.mtime || "0" }, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                var next_token = info.next_token ? core.toBase64(info.next_token) : "";
                // Split mtime and reference id
                rows.forEach(function(row) {
                    var d = row.mtime.split(":");
                    row.mtime = d[0];
                    row.id = d[1];
                });
                if (!req.query._details) return self.sendJSON(req, res, { data: rows, next_token: next_token });

                // Get all account records for the id list
                db.list("bk_account", rows, { select: req.query._select, check_public: req.account.id }, function(err, rows) {
                    if (err) return self.sendReply(res, err);
                    self.sendJSON(req, res, { data: rows, next_token: next_token });
                });
            });
            break;

        case "get":
            if (!req.query.type) return self.sendReply(res, 400, "type is required");
            req.query.type += ":" + (req.query.id || "");
            options.ops = { type: "begins_with" };
            db.select("bk_" + req.params[0], { id: req.account.id, type: req.query.type }, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                var next_token = info.next_token ? core.toBase64(info.next_token) : "";
                // Split type and reference id
                rows.forEach(function(row) {
                    var d = row.type.split(":");
                    row.type = d[0];
                    row.id = d[1];
                });
                if (!req.query._details) return self.sendJSON(req, res, { data: rows, next_token: next_token });

                // Get all account records for the id list
                db.list("bk_account", rows, { select: req.query._select, check_public: req.account.id }, function(err, rows) {
                    if (err) return self.sendReply(res, err);
                    self.sendJSON(req, res, { data: rows, next_token: next_token });
                });
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
            var now = Date.now();
            var latitude = req.query.latitude, longitude = req.query.longitude;
            if (!latitude || !longitude) return self.sendReply(res, 400, "latitude/longitude are required");
            // Get current location
            db.get("bk_account", { id: req.account.id }, { select: 'latitude,longitude' }, function(err, rows) {
                if (err || !rows.length) return self.sendReply(res, err);
                req.account.latitude = rows[0].latitude;
                req.account.longitude = rows[0].longitude;
                // Skip if within minimal distance
                var distance = backend.geoDistance(req.account.latitude, req.account.longitude, latitude, longitude);
                if (distance < core.minDistance) return self.sendReply(res, 305, "ignored, min distance: " + core.minDistance);

                var geo = core.geoHash(latitude, longitude, { distance: req.account.distance });
                var obj = { id: req.account.id, ltime: now, latitude: latitude, longitude: longitude, geohash: geo.geohash, location: req.query.location };
                db.update("bk_account", obj, function(err) {
                    if (err) return self.sendReply(res, err);
                    self.sendJSON(req, res, obj);

                    // Delete current location
                    var oldgeo = core.geoHash(req.account.latitude, req.account.longitude, { distance: req.account.distance });
                    oldgeo.id = req.account.id;
                    db.del("bk_location", oldgeo);

                    // Insert new location
                    geo.id = req.account.id;
                    geo.mtime = now;
                    db.put("bk_location", geo);

                    // Update history log
                    if (req.query._history) {
                        db.add("bk_history", { id: req.account.id, type: req.path, data: geo.hash + ":" + latitude + ":" + longitude });
                    }
                });
            });
            break;

        case "get":
            // Perform location search based on hash key that covers the whole region for our configured max distance
            if (!req.query.latitude || !req.query.longitude) return self.sendReply(res, 400, "latitude/longitude are required");
            // Limit the distance within our configured range
            options.distance = core.toNumber(req.query.distance, 0, core.minDistance, core.minDistance, core.maxDistance);
            options.latitude = req.query.latitude;
            options.longitude = req.query.longitude;
            // Continue pagination using the search token
            var token = core.toJson(req.query._token);
            if (token && token.geohash) {
            	if (token.latitude != req.query.latitude ||	token.longitude != req.query.longitude) return self.sendRepy(res, 400, "invalid token");
            	options = token;
            }
            db.getLocations("bk_location", options, function(err, rows, info) {
                // Return accounts with locations
                if (req.query._details && rows.length) {
                    var list = {}, ids = [];
                    rows = rows.map(function(row) {
                        ids.push({ id: row.id });
                        list[row.id] = row;
                        return row;
                    });
                    var next_token = core.toBase64(info);
                	db.list("bk_account", ids, { select: req.query._select, check_public: req.account.id }, function(err, rows) {
                        if (err) return self.sendReply(res, err);
                        // Merge locations and accounts
                        rows.forEach(function(row) {
                            var item = list[row.id];
                            for (var p in item) row[p] = item[p];
                        });
                        self.sendJSON(req, res, { data: rows, next_token: next_token });
                    });
                } else {
                    self.sendJSON(req, res, { data: rows, next_token: next_token });
                }
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// API for internal provisioning, by default supports access to all tables
api.initDataAPI = function()
{
    var self = this;
    var db = core.context.db;

    // Return current statistics
    this.app.all("/data/stats", function(req, res) {
        res.json({ toobusy: toobusy.lag(), pool: db.getPool().metrics, api: self.metrics });
    });

    // Load columns into the cache
    this.app.all("/data/columns", function(req, res) {
        db.cacheColumns({}, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table columns
    this.app.all(/^\/data\/columns\/([a-z_0-9]+)$/, function(req, res) {
        res.json(db.getColumns(req.params[0]));
    });

    // Return table keys
    this.app.all(/^\/data\/keys\/([a-z_0-9]+)$/, function(req, res) {
        res.json(db.getKeys(req.params[0]));
    });

    // Basic operations on a table
    this.app.all(/^\/data\/(select|search|list|get|add|put|update|del|incr|replace)\/([a-z_0-9]+)$/, function(req, res, info) {
        // Table must exist
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return self.sendReply(res, "Unknown table");

        if (req.method == "POST") req.query = req.body;
        var options = self.getOptions(req);

        db[req.params[0]](req.params[1], req.query, options, function(err, rows) {
            if (err) return self.sendReply(res, err);
            switch (req.params[0]) {
            case "select":
            case "search":
                self.sendJSON(req, res, { data: rows, next_token: info.next_token });
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

// Convert query options into database options
api.getOptions = function(req)
{
    var options = { check_public: req.account ? req.account.id : null };
    if (req.query._select) options.select = req.query._select;
    if (req.query._count) options.count = core.toNumber(req.query._count, 0, 50);
    if (req.query._consistent) options.consistent = core.toBool(req.query._consistent);
    if (req.query._start) options.start = core.toJson(req.query._start);
    if (req.query._sort) options.sort = req.query._sort;
    if (req.query._page) options.page = core.toNumber(req.query._page, 0, 0, 0, 9999);
    if (req.query._desc) options.sort = core.toBool(req.query._desc);
    if (req.query._keys) options.keys = core.strSplit(req.query._keys);
    if (req.query._width) options.width = core.toNumber(req.query._width);
    if (req.query._height) options.height = core.toNumber(req.query._height);
    if (req.query._ext) options.ext = req.query._ext;
    if (req.query._ops) {
        if (!options.ops) options.ops = {};
        var ops = core.strSplit(req.query._ops);
        for (var i = 0; i < ops.length -1; i+= 2) options.ops[ops[i]] = ops[i+1];
    }
    if (req.query._total) options.total = core.toBool(req.query._total);
    return options;
}

// Add columns to account tables, makes sense in case of SQL database for extending supported properties and/or adding indexes
// Used during initialization of the external modules which may add custom columns to the existing tables.
api.describeTables = function(tables)
{
    var self = this;
    for (var p in tables) {
        if (!self.tables[p]) self.tables[p] = {};
        for (var c in tables[p]) {
            if (!self.tables[p][c]) self.tables[p][c] = {};
            // Override columns
            for (var k in tables[p][c]) {
                self.tables[p][c][k] = tables[p][c][k];
            }
        }
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
// - path is a string or regexp of the request URL similr to registering Express routes
// - callback is a function with the following parameters: function(req, cb) {}, to indicate an error condition pass an object
//   with the callback with status: and message: properties, status != 200 means error
//
// Example:
//
//          api.registerAccessCheck('', 'account', function(req, cb) { cb({status:500,message:"access disabled"}) }))
//
//          api.registerAccessCheck('POST', 'account/add', function(req, cb) {
//             if (!req.query.invitecode) return cb({ status: 400, message: "invitation code is required" });
//             cb();
//          });
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
    if (hook) return hook.callbacks.call(this, req, res, rows);
    res.json(rows);
}

// Send formatted JSON reply to API client, if status is an instance of Error then error message with status 500 is sent back
api.sendReply = function(res, status, msg)
{
    if (status instanceof Error) msg = status.message, status = 500;
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

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
api.handleIcon = function(req, res, op, options)
{
    var self = this;
    var db = core.context.db;

    if (!req.query.type) req.query.type = "";

    var obj = { id: req.account.id, type: req.query.prefix + ":" + req.query.type, allow: req.query.allow };
    db[op]("bk_icon", obj, function(err, rows) {
        if (err) return self.sendReply(res, err);

        options.force = true;
        options.prefix = req.query.prefix;
        options.type = req.query.type;
        self[op + 'Icon'](req, req.account.id, options, function(err, icon) {
            if ((err || !icon) && op == "put") db.del('bk_icon', obj);
            self.sendReply(res, err);
        });
    });
}

// Return formatted icon URL for the given account
api.formatIcon = function(req, id, row)
{
    var type = row.type.split(":");
    row.prefix = type[0];
    row.type = type[1];

    // Provide public url if allowed
    if (row.allow && row.allow == "all" && this.allow && ("/image/" + row.prefix + "/").match(this.allow)) {
        row.url = '/image/' + row.prefix + '/' + req.query.id + '/' + row.type;
    } else {
        if (row.prefix == "account") {
            row.url = '/account/get/icon?type=' + row.type;
        } else {
            row.url = '/icon/get/' + row.prefix + "/" + row.type + "?";
        }
        if (id != req.account.id) row.url += "&id=" + id;
    }
}

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.context.db;

    db.get("bk_icon", { id: id, type: options.prefix + ":" + options.type }, options, function(err, rows) {
        if (err) return self.sendReply(res, err);
        if (!rows.length) return self.sendReply(res, 404, "Not found");
        if (!self.checkIcon(req, id, rows[0])) return self.sendReply(res, 401, "Not allowed");

        var icon = core.iconPath(id, options);
        if (self.imagesS3) {
            var aws = core.context.aws;
            aws.queryS3(self.imagesS3, icon, options, function(err, params) {
                if (err) return self.sendReply(res, err);

                res.type("image/" + (options.ext || "jpeg"));
                res.send(200, params.data);
            });
        } else {
            self.sendFile(req, res, icon);
        }
    });
}

// Verify icon permissions for given account id, returns true if allowed
api.checkIcon = function(req, id, row)
{
    var allow = row.allow || "";
    if (allow == "all") return true;
    if (allow == "auth" && req.account) return true;
    if (allow.split(",").filter(function(x) { return x == id }).length) return true;
    return id == req.account.id;
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback)
{
    var self = this;
    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property
    // to define type for each icon
    if (req.files && Object.keys(req.files).length) {
        async.forEachSeries(Object.keys(req.files), function(f, next) {
            var opts = core.extendObj(options, 'type', req.body[f + '_type']);
            self.storeIcon(req.files[f].path, id, opts, next);
        }, function(err) {
            callback(err);
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
api.delIcon = function(req, id, options, callback)
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

// Delete account specified in the obj, this must be merged object from bk_auth and bk_account tables.
// Return err if something wrong occured in the callback.
api.deleteAccount = function(obj, callback)
{
    if (!obj || !obj.id || !obj.login) return callback ? callback(new Error("id, login must be specified")) : null;
    var db = core.context.db;

    db.del("bk_auth", { login: obj.login }, { cached: true }, function(err) {
        if (err) return callback ? callback(err) : null;
        db.del("bk_account", { id: obj.id }, callback);
    });
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

// Metrics collection middleware
api.collectMetrics = function(req, res, next)
{
    var self = this;
    this.metrics.Meter('rate').mark();
    req.stopwatch = this.metrics.Timer('response').start();
    this.metrics.Histogram('queue').update(this.metrics.Counter('count').inc());
    req.on('end', function() {
        req.stopwatch.end();
        self.metrics.Counter('count').dec();
    });
    next();
}

// Custom access logger middleware
api.accessLogger = function()
{
    var self = this;

    var format = function(req, res) {
        var now = new Date();
        return (req.ip || (req.socket.socket ? req.socket.socket.remoteAddress : "-")) + " - " +
               (logger.syslog ? "-" : '[' +  now.toUTCString() + ']') + " " +
               req.method + " " +
               (req.originalUrl || req.url) + " " +
               "HTTP/" + req.httpVersionMajor + '.' + req.httpVersionMinor + " " +
               res.statusCode + " " +
               ((res._headers || {})["content-length"] || '-') + " - " +
               (now - req._startTime) + " ms - " +
               (req.headers['user-agent'] || "-") + " " +
               (req.headers['version'] || "-") + " " +
               (req.account ? req.account.login : "-") + "\n";
    }

    return function logger(req, res, next) {
        req._startTime = new Date;
        res._end = res.end;
        res.end = function(chunk, encoding) {
            res._end(chunk, encoding);
            if (!self.accesslog || req._skipAccessLog) return;
            var line = format(req, res);
            if (!line) return;
            self.accesslog.write(line);
        }
        next();
    }
}
