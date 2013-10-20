//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var crypto = require('crypto');
var async = require('async');
var express = require('express');
var domain = require('domain');
var core = require(__dirname + '/core');
var printf = require('printf');
var logger = require(__dirname + '/logger');
var backend = require(__dirname + '/backend');

// HTTP API to the server from the clients
var api = {

    // No authentication for these urls
    allow: /(^\/$|[a-zA-Z0-9\.-]+\.(gif|png|jpg|js|ico|css|html|txt|csv|json|plist)$|(^\/image\/[a-z]+\/|^\/account\/add))/,

    // Refuse access to these urls
    deny: null,
    
    // Account management
    imagesUrl: '',
    tables: { 
        // Basic account information and settings
        account: [ { name: "id", primary: 1 },
                   { name: "email", unique: 1 },
                   { name: "name" },
                   { name: "phone" },
                   { name: "website" },
                   { name: "birthday" },
                   { name: "gender" },
                   { name: "address" },
                   { name: "city" },
                   { name: "state" },
                   { name: "zipcode" },
                   { name: "country" },
                   { name: "distance", type: "int" },
                   { name: "facebook_id", type: "int" },
                   { name: "linkedin_id", type: "int" },
                   { name: "tweeter_id", },
                   { name: "google_id", },
                   { name: "ctime", type: "int" },
                   { name: "mtime", type: "int" } ],
                   
       // Authentication by email and secret
       auth: [ { name: 'email', primary: 1 },
               { name: 'id', unique: 1 },
               { name: 'secret' },
               { name: 'acl_deny' },
               { name: 'acl_allow' },
               { name: "expires", type: "int" } ],
                
       // All location changes           
       location: [ { name: "id", primary: 1 },
                   { name: "geohash", primary: 1 },
                   { name: "latitude", type: "real" },
                   { name: "longitude", type: " real" },
                   { name: "location" },
                   { name: "mtime", type: "int", index: 1 }],
                   
       // Keep historic data about an account, data can be JSON depending on the type
       history: [{ name: "id", primary: 1 },
                 { name: "mtime", type: "int", primary: 1 },
                 { name: "type" },
                 { name: "data" } ]
    },
    
    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    
    // Config parameters
    args: ["account-pool", 
           "images-url",
           "db-pool",
           "access-log",
           { name: "backend", type: "bool" },
           { name: "allow", type: "regexp" },
           { name: "deny", type: "regexp" },
           { name: "accesslog", type: "path" },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10 }],

    // Cutomization hooks/callbacks, always run within api context
    onInit: function() {},
           
    // Initialize API layer with the active HTTP server
    init: function(callback) {
        var self = this;

        // Access log via file or syslog
        if (logger.syslog) {
            this.accesslog = new stream.Stream();
            this.accesslog.writable = true;
            this.accesslog.write = function(data) { logger.printSyslog('info:local5', data); return true; }
        } else
        if (this.accessLog) {
            this.accesslog = fs.createWriteStream(path.join(core.path.log, this.accessLog), { flags: 'a' });
            this.accesslog.on('error', function(err) { logger.error('accesslog:', err); })
        } else {
            this.accesslog = logger;
        }

        this.app = express();
        // Wrap all calls in domain to catch exceptions
        this.app.use(function(req, res, next) {
            var d = domain.create();
            d.add(req);
            d.add(res);
            d.on('error', function(err) { req.next(err); });
            d.run(next);
        });
        this.app.use(express.bodyParser({ uploadDir: core.path.tmp, keepExtensions: true, limit: self.uploadLimit }));
        this.app.use(express.methodOverride());
        this.app.use(express.cookieParser());
        this.app.use(function(req, res, next) {
            res.header('Server', core.name + '/' + core.version);
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'accesskey,version,signature,expires,checksum');
            next();
        });
        this.app.use(this.accessLogger());
        this.app.use(function(req, res, next) { return self.checkRequest(req, res, next); });
        this.app.use(express.static(path.resolve(core.path.web)));
        this.app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
        this.app.listen(core.port, core.bind, function(err) {
            if (err) logger.error('startExpress:', core.port, err);
        });

        // Return current statistics
        this.app.all("/status", function(req, res) {
            res.json(core.dbpool[self.accountPool].stats);
        });

        // Return images by prefix, id and possibly type, serves from local images folder, 
        // this is generic access without authentication, depends on self.allow regexp
        this.app.all(/^\/image\/([a-z]+)\/([a-z0-9-]+)\/?([a-z])?/, function(req, res) {
            self.sendFile(req, res, core.iconPath(req.params[1], req.params[0], req.params[2]));
        });

        // Managing accounts
        this.initAccount();
        
        // Provisioning access to the database
        if (this.backend) this.initBackend();

        // Post init or other application routes
        this.onInit.call(this);

        // Create account tables if dont exist
        core.dbInit({ pool: self.accountPool, tables: self.tables }, callback);
    },
        
    // Perform authorization of the incoming request for access and permissions
    checkRequest: function(req, res, next) {
        var self = this;
        self.checkAccess(req, function(rc1) {
            // Status is given, return an error or proceed to the next module
            if (rc1) return (rc1.status == 200 ? next() : res.json(rc1));

            // Verify account access for signature
            self.checkSignature(req, function(rc2) {
                res.header("cache-control", "no-cache");
                res.header("pragma", "no-cache");
                // The account is verified, proceed with the request
                if (rc2.status == 200) return next();
                // Something is wrong, return an error
                res.json(rc2.status, rc2);
            });
        });
    },

    // Perform URL based access checks
    // Check access permissions, calls the callback with the following argument:
    // - nothing if checkSignature needs to be called
    // - an object with status: 200 to skip authorization and proceed with the next module
    // - an object with status other than 200 to return the status and stop request processing
    checkAccess: function(req, callback) {
        if (this.deny && req.path.match(this.deny)) return callback({ status: 401, message: "Access denied" });
        if (this.allow && req.path.match(this.allow)) return callback({ status: 200, message: "" });
        callback();
    },

    // Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
    checkSignature: function(req, callback) {
        // Make sure we will not crash on wrong object
        if (!req || !req.headers) req = { headers: {} };
        if (!callback) callback = function(x) { return x; }

        // Extract all signatuee components from the request
        var sig = core.parseSignature(req);
        
        // Show request in the log on demand for diagnostics
        if (logger.level > 1 || req.query._debug) {
            logger.log('checkSignature:', sig, 'hdrs:', req.headers);
        }

        // Sanity checks, required headers must be present and not empty
        if (!sig.method || !sig.host || !sig.expires || !sig.id || !sig.signature) {
            return callback({ status: 401, message: "Invalid request: " + (!sig.method ? "no method" :
                                                                           !sig.host ? "no host" :
                                                                           !sig.id ? "no email" :
                                                                           !sig.expires ? "no expires" :
                                                                           !sig.signature ? "no signature" : "") });
        }

        // Make sure it is not expired, it may be milliseconds or ISO date
        if (sig.expires <= Date.now()) {
            return callback({ status: 400, message: "Expired request" });
        }

        // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
        core.dbGetCached("auth", { email: sig.id }, { pool: this.accountPool }, function(err, account) {
            if (err) return callback({ status: 500, message: String(err) });
            if (!account) return callback({ status: 404, message: "No account" });

            // Account expiration time
            if (account.expires && account.expires < Date.now()) {
                return callback({ status: 404, message: "Expired account" });
            }

            // Verify ACL regex if specified, test the whole query string as it appear in GET query line
            if (account.acl_deny && sig.url.match(account.acl_deny)) {
                return callback({ status: 401, message: "Access denied" });
            }
            if (account.acl_allow && !sig.url.match(account.acl_allow)) {
                return callback({ status: 401, message: "Not permitted" });
            }

            // Verify the signature with account secret
            if (!core.checkSignature(sig, account)) {
                return callback({ status: 401, message: "Bad signature, signed string is: " + sig.str + ", calculated signature is " + sig.hash });
            }

            // Deal with encrypted body, we have to decrypt it before checking checksum, use
            // out account secret to decrypt
            if (req.body && req.get("content-encoding") == "encrypted") {
                req.body = core.decrypt(account.secret, req.body);
            }

            // Check body checksum now
            if (sig.checksum) {
                var chk = core.hash(typeof req.body == "object" ? JSON.stringify(req.body) : String(req.body));
                if (sig.checksum != chk) {
                    return callback({ status: 401, message: "Bad checksum, calculated checksum is " + chk });
                }
            }
            // Save components of signature verification, it will be used later for profile password check as well
            req.signature = sig;
            // Save current account in the request
            req.account = account;
            // Primary keys must be in the query
            req.query.id = account.id;
            req.query.email = account.email;
            return callback({ status: 200, message: "Ok" });
        });
    },

    // Send formatted reply to API clients, if status is an instance of Error then error message with status 500 is sent back
    sendReply: function(res, status, msg) {
        if (status instanceof Error) msg = status, status = 500;
        if (!status) status = 200, msg = "";
        res.json(status, { status: status, message: String(msg || "").replace(/SQLITE_CONSTRAINT:/g, '') });
        return false;
    },

    // Send file back to the client, res is Express response object
    sendFile: function(req, res, file, redirect) {
        fs.exists(file, function(yes) {
            if (req.method == 'HEAD') return res.send(yes ? 200 : 404);
            if (yes) return res.sendfile(file);
            if (redirect) return res.redirect(redirect);
            res.send(404);
        });
    },

    // Store an icon for account, .type defines icon prefix
    putIcon: function(req, options, callback) {
        // Multipart upload can provide more than one icon, file name can be accompanied by file_type property
        // to define type for each icon
        if (req.files) {
            async.forEachSeries(Object.keys(req.files), function(f, next) {
                core.putIcon(req.files[f].path, options.id, { prefix: options.prefix, type: req.body[f + '_type'] }, next);
            }, function(err) {
                callback(err);
            });
        } else 
        // JSON object submitted with .icon property
        if (typeof req.body == "object") {
            req.body = new Buffer(req.body.icon, "base64");
            core.putIcon(req.body, options.id, options, callback);
        } else {
            return callback(new Error("no icon"));
        }
    },

    // Account management
    initAccount: function() {
        var self = this;
        
        // Accont database driver
        var pool = core.dbPool(self.accountPool);
        
        this.app.all(/^\/account\/([a-z]+)$/, function(req, res) {
            switch (req.params[0]) {
            case "get":
                core.dbGet("account", { id: req.account.id }, { pool: self.accountPool }, function(err, rows) {
                    if (err) self.sendReply(res, err);
                    if (!rows.length) return self.sendReply(res, 404);
                    // List all possible icons, this server may not have access to the files so it is up to the client to verify which icons exist
                    rows[0].icon = self.imagesUrl + '/image/account/' + req.account.id;
                    rows[0].icons = ['a','b','c','d','e','f'].map(function(x) { return self.imagesUrl + '/image/account/' + req.account.id + '/' + x });
                    res.json(rows[0]);
                });
                break;

            case "add":
                // Verify required fields
                if (!req.query.secret) return self.sendReply(res, 400, "Secret is required");
                if (!req.query.name) return self.sendReply(res, 400, "Name is required");
                if (!req.query.email) return self.sendReply(res, 400, "Email is required");
                req.query.id = backend.uuid().replace(/-/g, '');
                req.query.mtime = req.query.ctime = core.now();
                // Add new auth record with only columns we support, no-SQL dbs can add any columns on 
                // the fly and we want to keep auth table very small
                core.dbInsert("auth", req.query, { pool: self.accountPool, columns: core.dbConvertColumns(self.tables.auth) }, function(err) {
                    if (err) return self.sendReply(res, err);
                    core.dbInsert("account", req.query, { pool: self.accountPool }, function(err) {
                        if (err) core.dbDelete("auth", req.query, { pool: self.accountPool });
                        self.sendReply(res, err);
                    });
                });
                break;

            case "put":
                req.query.mtime = core.now();
                core.dbUpdate("account", req.query, { pool: self.accountPool }, function(err) {
                    self.sendReply(res, err);
                });
                break;

            case "putsecret":
                if (!req.query.secret) return self.sendReply(res, 400, "Secret is required");
                core.dbUpdate("auth", { email: req.account.email, secret: req.query.secret }, { pool: self.accountPool }, function(err) {
                    self.sendReply(res, err);
                    core.ipcDelCache("auth:" + req.account.email);
                });
                break;
                
            case "del":
                core.dbDelete("auth", req.account, { pool: self.accountPool }, function(err) {
                    self.sendReply(res, err);
                    core.ipcDelCache("auth:" + req.account.email);
                    if (!err) core.dbDelete("account", req.account, { pool: self.accountPool });
                });
                break;
                
            case "puthistory":
                self.sendReply(res);
                // History time is in milliseconds for high resolution
                req.query.mtime = core.mnow();
                core.dbInsert("history", req.query, { pool: self.accountPool });
                break;
                
            case "getlocation":
                // Select the last location record 
                core.dbSelect("location", { id: req.account.id }, { pool: self.accountPool, count: 1, sort: 'mtime', desc: 1 }, function(err, rows) {
                    res.json(rows);
                });
                break;
                
            case "putlocation":
                req.query.mtime = core.now();
                req.query.geohash = backend.geoHashEncode(req.query.latitude, req.query.longitude);
                // Make sure we dont add extra properties in case of noSQL database
                core.dbUpdate("location", req.query, { pool: self.accountPool, columns: core.dbConvertcolumns(self.tables.location) }, function(err) {
                    self.sendReply(res, err);
                });
                break;
                
            case "puticon":
                // Add icon to the account, support up to 6 icons with types: a,b,c,d,e,f, primary icon type is ''
                self.putIcon(req, { id: req.account.id, prefix: 'account' , type: req.body.type || req.query.type || '' }, function(err) {
                    self.sendReply(res, err);
                });
                break;
                
            default:
                self.sendReply(res, 400, "Invalid operation");
            }
        });
    },
    
    // API for internal provisioning, by default supports access to all tables
    initBackend: function() {
        var self = this;
        
        // Load columns into the cache
        this.app.all(/^\/cache-columns$/, function(req, res) {
            core.dbCacheColumns({ pool: self.dbPool });
            res.json([]);
        });

        // Return table columns
        this.app.all(/^\/([a-z_0-9]+)\/columns$/, function(req, res) {
            res.json(core.dbColumns(req.params[0], { pool: self.dbPool }));
        });

        // Return table keys
        this.app.all(/^\/([a-z_0-9]+)\/keys$/, function(req, res) {
            res.json(core.dbKeys(req.params[0], { pool: self.dbPool }));
        });

        // Query on a table
        this.app.all(/^\/([a-z_0-9]+)\/get$/, function(req, res) {
            var options = { pool: self.dbPool, 
                            total: req.query._total, 
                            count: req.query._count || 25, 
                            sort: req.query._sort, 
                            select: req.query._cols };
            // Convert values into actual arrays if separated by pipes
            for (var p in req.query) {
                if (p[0] != '_' && req.query[p].indexOf("|") > 0) req.query[p] = req.query[p].split("|");
            }
            core.dbSelect(req.params[0], req.query, options, function(err, rows) {
                if (err) return res.json([]);
                res.json(rows);
            });
        });
        
        // Basic operations on a table
        this.app.all(/^\/([a-z_0-9]+)\/(add|put|del)$/, function(req, res) {
            var dbcols = core.dbColumns(req.params[0], { pool: self.dbPool });
            if (!dbcols) return res.json([]);
            
            switch (req.params[1]) {
            case "add":
                core.dbInsert(req.params[0], req.query, { pool: self.dbPool }, function(err, rows) {
                    return self.sendReply(res, err);
                });
                break;
                
            case "rep":
                core.dbReplace(req.params[0], req.query, { pool: self.dbPool }, function(err, rows) {
                    self.sendReply(res, err);
                });
                break;
                
            case "put":
                core.dbUpdate(req.params[0], req.query, { pool: self.dbPool }, function(err, rows) {
                    self.sendReply(res, err);
                });
                break;
                
            case "del":
                core.dbDelete(req.params[0], req.query, { pool: self.dbPool }, function(err, rows) {
                    self.sendReply(res, err);
                });
                break;
            }
        });
        
    },
    
    // Custom access logger
    accessLogger: function() {
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
                   (req.account ? req.account.email : "-") + "\n";
        }

        return function logger(req, res, next) {
            req._startTime = new Date;
            res._end = res.end;
            res.end = function(chunk, encoding) {
                res._end(chunk, encoding);
                if (!self.accesslog || req._skipLogging) return;
                var line = format(req, res);
                if (!line) return;
                self.accesslog.write(line);
            }
            next();
        }
    },

}

module.exports = api;
core.addContext('api', api);
