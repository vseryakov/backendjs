//
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
    allow: /(^\/$|[a-zA-Z0-9\.-]+\.(gif|png|jpg|js|ico|css|html)$|(^\/public\/)|(^\/images\/)|(^\/image\/[a-z]+\/|^\/account\/add))/,

    // Refuse access to these urls
    deny: null,
    
    // Where images are kept
    imagesUrl: '',
    imagesS3: '',
    
    tables: { 
        // Authentication by email and secret
        auth: { email: { primary: 1 },
                id: { unique: 1 },
                secret: {},
                api_deny: {},
                api_allow: {},
                expires: { type: "int" },
                mtime: { type: "int" } },
                 
        // Basic account information
        account: { id: { primary: 1, pub: 1 },
                   email: { unique: 1 },
                   name: {},
                   alias: { pub: 1, index: 1 },
                   status: { pub: 1 },
                   phone: {},
                   website: {},
                   birthday: { semipub: 1 },
                   gender: { pub: 1 },
                   icons: { semipub: 1 },
                   address: {},
                   city: {},
                   state: {},
                   zipcode: {},
                   country: {},
                   latitude: { type: "real" },
                   longitude: { type: " real" },
                   location: {},
                   ltime: { type: "int" },
                   ctime: { type: "int" },
                   mtime: { type: "int" } },
                   
       // Locations for all accounts to support distance searches
       location: { geohash: { primary: 1 },                // geohash, the first part, biggest radius expected
                   georange: { primary: 1 },               // georange:id, the second part, the rest of the geohash
                   latitude: { type: "real" },
                   longitude: { type: "real" },
                   mtime: { type: "int" }},

       // All connections between accounts: like,dislike,friend...
       connection: { id: { primary: 1 },                    // account_id
                     type: { primary: 1 },                  // type:connection_id
                     state: {},
                     mtime: { type: "int" }},
                   
       // References from other accounts, likes,dislikes...
       reference: { id: { primary: 1 },                    // connection_id
                    type: { primary: 1 },                  // type:account_id
                    state: {},
                    mtime: { type: "int" }},
                     
       // Messages between accounts
       message : { id: { primary: 1 },                    // Account sent to 
                   mtime: { type: "int", primary: 1 },    // mtime:sender, the current timestamp in seconds and the sender
                   text: {},                              // Text of the message 
                   icon: {}},                             // Icon base64 or url
       
       // All accumulated counters for accounts
       counter: { id: { primary: 1 },                                         // account_id
                  like: { type: "counter", value: 0, pub: 1, incr: 1 },       // who i liked
                  r_like: { type: "counter", value: 0, pub: 1 },              // reversed like, who liked me
                  dislike: { type: "counter", value: 0, pub: 1, incr: 1 },
                  r_dislike: { type: "counter", value: 0, pub: 1 },
                  follow: { type: "counter", value: 0, pub: 1, incr: 1 },
                  r_follow: { type: "counter", value: 0, pub: 1 },
                  msg_count: { type: "counter", value: 0 },
                  msg_read: { type: "counter", value: 0 },
                  mtime: { type: "int" }},
                                  
       // Keep historic data about an account activity
       history: { id: { primary: 1 },
                  mtime: { type: "int", primary: 1 },
                  type: {} }
    },
    
    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    
    // Minimal distance in km between updates of account location, this is to avoid 
    // too many location updates with very high resolution is not required
    minDistance: 5,
    // Max distance in km for location searches
    maxDistance: 50, 
   
    // Config parameters
    args: [{ name: "images-url", descr: "URL where images are stored, for cases of central image server(s)" },
           { name: "images-s3", descr: "S3 bucket name where to image store instead of data/images directory on the filesystem" },
           { name: "access-log", descr: "File for access logging" },
           { name: "min-distance", type: "int", descr: "Min distance for location updates, if smaller updates will be ignored"  },
           { name: "max-distance", type: "int", max: 40000, min: 1, descr: "Max distance for locations searches"  },
           { name: "allow", type: "regexp", descr: "Regexp for URLs that dont need credentials" },
           { name: "deny", type: "regexp", descr: "Regexp for URLs that will be denied access"  },
           { name: "upload-limit", type: "number", min: 1024*1024, max: 1024*1024*10, descr: "Max size for uploads, bytes"  }],
}

module.exports = api;

// Initialize API layer with the active HTTP server
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

    self.app = express();
    // Wrap all calls in domain to catch exceptions
    self.app.use(function(req, res, next) {
        var d = domain.create();
        d.add(req);
        d.add(res);
        d.on('error', function(err) { req.next(err); });
        d.run(next);
    });
    self.app.use(express.bodyParser({ uploadDir: core.path.tmp, keepExtensions: true, limit: self.uploadLimit }));
    self.app.use(express.methodOverride());
    self.app.use(express.cookieParser());
    self.app.use(function(req, res, next) {
        res.header('Server', core.name + '/' + core.version);
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'v-signature');
        next();
    });
    self.app.use(this.accessLogger());
    self.app.use(function(req, res, next) { return self.checkRequest(req, res, next); });
    self.app.use(express.static(path.resolve(core.path.web)));
    self.app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
    self.app.listen(core.port, core.bind, function(err) {
        if (err) logger.error('startExpress:', core.port, err);
    });

    // Return images by prefix, id and possibly type, serves from local images folder, 
    // this is generic access without authentication, depends on self.allow regexp
    self.app.all(/^\/image\/([a-z]+)\/([a-z0-9-]+)\/?([0-9])?/, function(req, res) {
        self.getIcon(req, res, req.params[1], { prefix: req.params[0], type: req.params[2] });
    });

    // Direct access to the images by exact file name
    self.app.all(/^\/images\/(.+)/, function(req, res) {
        self.sendFile(req, res, path.join(core.path.images, req.params[0].replace(/\.\./g, "")));
    });
    
    // Managing accounts, basic functionality
    self.initAccountAPI();
    self.initConnectionAPI();
    self.initLocationAPI();
    self.initHistoryAPI();
    self.initCounterAPI();
    self.initIconAPI();
    self.initMessageAPI();

    // Provisioning access to the database
    self.initBackendAPI();

    // Post init or other application routes
    self.onInit.call(this);
    
    // Create tables in all db pools
    db.initTables(self.tables, callback);
    
    // Assign row handler for the account table
    db.getPool('account').processRow = self.processAccountRow;
}

//Cutomization hooks/callbacks, always run within api context
api.onInit = function() {}
       
// Perform authorization of the incoming request for access and permissions
api.checkRequest = function(req, res, next) 
{
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
}

// Perform URL based access checks
// Check access permissions, calls the callback with the following argument:
// - nothing if checkSignature needs to be called
// - an object with status: 200 to skip authorization and proceed with the next module
// - an object with status other than 200 to return the status and stop request processing
api.checkAccess = function(req, callback) 
{
    if (this.deny && req.path.match(this.deny)) return callback({ status: 401, message: "Access denied" });
    if (this.allow && req.path.match(this.allow)) return callback({ status: 200, message: "" });
    callback();
}

// Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
api.checkSignature = function(req, callback) 
{
    // Make sure we will not crash on wrong object
    if (!req || !req.headers) req = { headers: {} };
    if (!callback) callback = function(x) { return x; }

    // Extract all signatuee components from the request
    var sig = core.parseSignature(req);
    
    // Show request in the log on demand for diagnostics
    if (logger.level >= 1 || req.query._debug) {
        logger.log('checkSignature:', sig, 'hdrs:', req.headers);
    }

    // Sanity checks, required headers must be present and not empty
    if (!sig.method || !sig.host || !sig.expires || !sig.id || !sig.signature) {
        return callback({ status: 401, message: "Invalid request: " + (!sig.method ? "no method" :
                                                                       !sig.host ? "no host" :
                                                                       !sig.id ? "no email" :
                                                                       !sig.expires ? "no expiration" :
                                                                       !sig.signature ? "no signature" : "") });
    }

    // Make sure it is not expired, it may be milliseconds or ISO date
    if (sig.expires <= Date.now()) {
        return callback({ status: 400, message: "Expired request" });
    }

    // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
    core.context.db.getCached("auth", { email: sig.id }, function(err, account) {
        if (err) return callback({ status: 500, message: String(err) });
        if (!account) return callback({ status: 404, message: "No account" });

        // Account expiration time
        if (account.expires && account.expires < Date.now()) {
            return callback({ status: 404, message: "Expired account" });
        }

        // Verify ACL regex if specified, test the whole query string as it appear in GET query line
        if (account.api_deny && sig.url.match(account.api_deny)) {
            return callback({ status: 401, message: "Access denied" });
        }
        if (account.api_allow && !sig.url.match(account.api_allow)) {
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
        return callback({ status: 200, message: "Ok" });
    });
}

// Account management
api.initAccountAPI = function()
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
    
    this.app.all(/^\/account\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
        
        switch (req.params[0]) {
        case "get":
        	if (!req.query.id) {
        		db.get("account", { id: req.account.id }, function(err, rows) {
        			if (err) return self.sendReply(res, err);
        			if (!rows.length) return self.sendReply(res, 404);
        			res.json(rows[0]);
        		});
        	} else {
        		db.list("account", req.query, { select: req.query._select, public_columns: 1 }, function(err, rows) {
        			if (err) return self.sendReply(res, err);
        			res.json(rows);
        		});
        	}
            break;
            
        case "search":
        	var options = { select: req.query._select, start: req.query._start, count: req.query._count, sort: req.query._sort, desc: req.query._desc, public_columns: 1 };
            db.search("account", req.query, options, function(err, rows) {
                if (err) return self.sendReply(res, err);
                res.json(rows);
            });
            break;
            
        case "add":
            // Verify required fields
            if (!req.query.secret) return self.sendReply(res, 400, "secret is required");
            if (!req.query.name) return self.sendReply(res, 400, "name is required");
            if (!req.query.email) return self.sendReply(res, 400, "email is required");
            req.query.id = backend.uuid().replace(/-/g, '');
            req.query.mtime = req.query.ctime = now;
            // Add new auth record with only columns we support, noSQL db can add any columns on
            // the fly and we want to keep auth table very small
            db.add("auth", req.query, { check_columns: 1 }, function(err) {
                if (err) return self.sendReply(res, err);
                ["secret","icons","ctime","ltime","latitude","longitude","location"].forEach(function(x) { delete req.query[x] });
                db.add("account", req.query, function(err) {
                    if (err) {
                        db.del("auth", req.query);
                        return self.sendReply(res, err);
                    }
                    // Even if it fails here it will be created on first usage
                    db.add("counter", { id: req.query.id, mtime: now });
                    res.json(self.processAccountRow(req.query));
                });
            });
            break;

        case "update":
            req.query.mtime = now;
            req.query.id = req.account.id;
            req.query.email = req.account.email;
            // Make sure we dont add extra properties in case of noSQL database or update columns we do not support here
            ["secret","icons","ctime","ltime","latitude","longitude","location"].forEach(function(x) { delete req.query[x] });
            db.update("account", req.query, { check_columns: 1 }, function(err) {
                if (err) return self.sendReply(res, err);
                res.json(self.processAccountRow(req.query));
            });
            break;

        case "del":
            db.del("auth", { email: req.account.email }, { cached: 1 }, function(err) {
                self.sendReply(res, err);
                if (err) return;
                db.del("account", { id: req.account.id });
            });
            break;
            
        case "secret":
            if (!req.query.secret) return self.sendReply(res, 400, "secret is required");
            db.put("auth", { email: req.account.email, secret: req.query.secret }, { cached: 1 }, function(err) {
                self.sendReply(res, err);
                if (err) return;
                // Keep history of all changes
                if (req.query._history) {
                    db.add("history", { id: req.account.id, type: req.params[0], mtime: now, secret: core.sign(req.account.id, req.query.secret) });
                }
            });
            break;
        }
    });
}

// Connections management
api.initIconAPI = function() 
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
        
    this.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
            
        switch (req.params[0]) {
        case "get":
            self.getIcon(req, res, req.account.id, { prefix: 'account', type: req.query.type });
            break;
            
        case "del":
        case "put":
            // Add icon to the account, support any number of additonal icons using req.query.type, any letter or digit
            // The type can be the whole url of the icon, we need to parse it and extract only type
            var type = self.getIconType(req.account.id, req.body.type || req.query.type);
            self[req.params[0] + 'Icon'](req, req.account.id, { prefix: 'account', type: type }, function(err) {
                if (err) return self.sendReply(res, err);
                
                // Get current account icons
                db.get("account", { id: req.account.id }, { select: 'id,icons' }, function(err, rows) {
                    if (err) return self.sendReply(res, err);
                    
                    // Add/remove given type from the list of icons
                    rows[0].icons = core.strSplitUnique((rows[0].icons || '') + "," + type);
                    if (req.params[0] == 'del') rows[0].icons = rows[0].icons.filter(function(x) { return x != type } );
                        
                    var obj = { id: req.account.id, email: req.account.email, mtime: now, icons: rows[0].icons };
                    db.update("account", obj, function(err) {
                        if (err) return self.sendReply(res, err);
                        res.json(self.processAccountRow(rows[0]));
                    });
                });
            });
            break;
        }
    });
}
    
// Messaging management
api.initMessageAPI = function() 
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
        
    this.app.all(/^\/message\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
            
        switch (req.params[0]) {
        case "image":
            self.getIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime });
            break;
            
        case "get":
            if (!req.query.mtime) req.query.mtime = 0;
            var options = { ops: { type: "GT" }, select: req.query._select, total: req.query._total, start: core.toJson(req.query._start) };
            db.select("message", { id: req.account.id, mtime: req.query.mtime }, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                if (info.next_token) res.header("Next-Token", core.toBase64(info.next_token));
                res.json(rows);
            });
            break;
            
        case "add":
            if (!req.query.sender) return self.sendReply(res, 400, "sender is required");
            if (!req.query.text && !req.query.icon) return self.sendReply(res, 400, "text or icon is required");
            req.query.mtime = req.query.sender + ":" + now;
            self.putIcon(req, req.account.id, { prefix: 'message', type: req.query.mtime }, function(err, icon) {
                if (err) return self.sendReply(res, err);
                // Icon supplied, we have full path to it, save the url in the message
                if (icon) req.query.icon = self.imagesUrl + '/message/image/' + req.account.id + '/' + req.query.mtime;
                db.add("message", req.query, {}, function(err, rows) {
                    if (err) return self.sendReply(res, err);
                    db.incr("counter", { id: req.account.id, msg_count: 1 }, { cached: 1, mtime: 1 });
                    res.json(rows);
                });
            });
            break;
        }
    });
}

// Connections management
api.initHistoryAPI = function()
{
    var self = this;
    var now = core.now();
    var db = core.context.db;

    this.app.all(/^\/history\/([a-z]+)$/, function(req, res) {
        logger.debug('history:', req.params[0], req.account, req.query);

        switch (req.params[0]) {
        case "add":
            self.sendReply(res);
            req.query.id = req.account.id;
            req.query.mtime = now;
            db.add("history", req.query);
            break;
                
        case "get":
            db.select("history", { id: req.account.id, type: req.query.type }, function(err, rows) {
                res.json(rows);
            });
            break;
        }
    });
}

// Counters management
api.initCounterAPI = function()
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
        
    this.app.all(/^\/counter\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
        
        switch (req.params[0]) {
        case "add":
        case "put":
        case "incr":
            self.sendReply(res);
            req.query.mtime = now;
            req.query.id = req.account.id;
            db[req.params[0]]("counter", req.query, { cached: 1 });
            break;
            
        case "get":
            db.getCached("counter", { id: req.query.id, public_columns: 1 }, function(err, rows) {
                res.json(rows[0]);
            });
            break;
            
        default:
            self.sendReply(res, 400, "Invalid operation");
        }
    });
}

// Connections management
api.initConnectionAPI = function() 
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
    
    this.app.all(/^\/(connection|reference)\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
        
        switch (req.params[1]) {
        case "add":
        case "put":
        case "update":
        	var op = db[req.params[1]];
            var id = req.query.id, type = req.query.type;
            if (!id || !type) return self.sendReply(res, 400, "id and type are required");
            if (id == req.account.id) return self.sendReply(res, 400, "cannot connect to itself");
            // Override primary key properties, the rest of the properties will be added as is
            req.query.id = req.account.id;
            req.query.type = type + ":" + id;
            req.query.mtime = now;
            op("connection", req.query, function(err) {
                if (err) return self.sendReply(res, err);
                // Reverse reference to the same connection
                req.query.id = id;
                req.query.type = type + ":"+ req.account.id;
                op("reference", req.query, function(err) {
                    if (err) db.del("connection", { id: req.account.id, type: type + ":" + id });
                    self.sendReply(res, err);
                });
            });
            
            // Update history on connections update
            if (req.query._history) {
                db.add("history", { id: req.account.id, type: req.path, mtime: now, cid: id, ctype: type });
            }

            // Update accumulated counter if we support this column and do it automatically
            if (req.params[0] != 'add') break;
            var col = db.getColumn("counter", req.query.type);
            if (col && col.incr) {
                db.incr("counter", core.newObj('id', req.account.id, 'mtime', now, type, 1, 'r_' + type, 1), { cached: 1 });
                db.incr("counter", core.newObj('id', req.query.id, 'mtime', now, type, 1, 'r_' + type, 1), { cached: 1 });
            }
            break;

        case "del":
            var id = req.query.id, type = req.query.type;
            if (!id || !type) return self.sendReply(res, 400, "id and type are required");
            db.del("connection", { id: req.account.id, type: type + ":" + id }, function(err) {
                if (err) return self.sendReply(res, err);
                db.del("reference", { id: id, type: type + ":" + req.account.id }, function(err) {
                    self.sendReply(res, err);
                });
            });
            
            // Update history on connections update
            if (req.query._history) {
                db.add("history", { id: req.account.id, type: req.path, mtime: now, cid: id, ctype: type });
            }
            
            // Update accumulated counter if we support this column and do it automatically
            var col = db.getColumn("counter", req.query.type);
            if (col && col.incr) {
                db.incr("counter", core.newObj('id', req.account.id, 'mtime', now, type, -1, 'r_' + type, -1), { cached: 1 });
                db.incr("counter", core.newObj('id', req.query.id, 'mtime', now, type, -1, 'r_' + type, -1), { cached: 1 });
            }
            break;

        case "get":
            // Only one connection record to be returned if id and type specified
            if (req.query.id && req.query.type) req.query.type += ":" + req.query.id;
            var options = { ops: { type: "begins_with" }, select: req.query._select, total: req.query._total, start: core.toJson(req.query._start) };
            db.select(req.params[0], { id: req.account.id, type: req.query.type }, options, function(err, rows, info) {
                if (err) return self.sendReply(res, err);
                if (info.next_token) res.header("Next-Token", core.toBase64(info.next_token));
                // Collect account ids
                rows = rows.map(function(row) { return row.type.split(":")[1]; });
                if (!req.query._details) return res.json(rows);
                
                // Get all account records for the id list
                db.list("account", rows, { select: req.query._select, public_columns: 1 }, function(err, rows) {
                    if (err) return self.sendReply(res, err);
                    res.json(rows);
                });
            });
            break;
        }
    });
    
}

// Geo locations management
api.initLocationAPI = function() 
{
    var self = this;
    var now = core.now();
    var db = core.context.db;
    
    this.app.all(/^\/location\/([a-z]+)$/, function(req, res) {
        logger.debug(req.path, req.account.id, req.query);
        
        switch (req.params[0]) {
        case "put":
            var latitude = req.query.latitude, longitude = req.query.longitude;
            if (!latitude || !longitude) return self.sendReply(res, 400, "latitude/longitude are required");
            // Get current location
            db.get("account", { id: req.account.id }, { select: 'latitude,longitude' }, function(err, rows) {
                if (err) return self.sendReply(res, err);
                req.account.latitude = rows[0].latitude;
                req.account.longitude = rows[0].longitude;
                // Skip if within minimal distance
                var distance = backend.geoDistance(req.account.latitude, req.account.longitude, latitude, longitude);
                if (distance < self.minDistance) return self.sendReply(res, 305, "ignored, min distance: " + self.minDistance);
                
                var obj = { id: req.account.id, email: req.account.email, mtime: now, ltime: now, latitude: latitude, longitude: longitude, location: req.query.location };
                db.update("account", obj, function(err) {
                    if (err) return self.sendReply(res, err);
                    res.json(self.processAccount(obj));
                    
                    // Delete current location
                    var geo = core.geoHash(req.account.latitude, req.account.longitude, { distance: req.account.distance, max_distance: self.maxDistance });
                    geo.georange += ":" + req.account.id;
                    db.del("location", geo);
                    
                    // Insert new location
                    geo = core.geoHash(latitude, longitude, { distance: req.account.distance, max_distance: self.maxDistance });
                    geo.mtime = now;
                    geo.georange += ":" + req.account.id;
                    db.put("location", geo);
                });
                    
                // Keep history of all changes
                if (req.query._history) {
                    db.add("history", { id: req.account.id, type: req.path, mtime: now, lat: latitude, lon: longitude });
                }
            });
            break;
            
        case "get":
            var options = { select: req.query._select, count: req.query._count || 25 };
            // Perform location search based on hash key that covers the whole region for our configured max distance
            if (!req.query.latitude || !req.query.longitude) return self.sendReply(res, 400, "latitude/longitude are required");
            // Limit the distance within our configured range
            req.query.distance = core.toNumber(req.query.distance, 0, self.minDistance, self.minDistance, self.maxDistance);
            // Continue pagination using the search token
            var token = core.toJson(req.query._token);   
            if (token && token.geohash && token.georange) {
            	if (token.latitude != req.query.latitude ||	token.longitude != req.query.longitude) return self.sendRepy(res, 400, "invalid token");
            	options = token;
            }
            db.getLocations("location", options, function(err, rows, info) {
                // Return accounts with locations
                if (req.query._details) {
                    var list = {}, ids = [];
                    rows = rows.map(function(row) { 
                        ids.push({ id: row.id });
                        list[row.id] = row;
                        return row;
                    });
                	db.list("account", ids, { select: req.query._select, public_columns: 1 }, function(err, rows) {
                        if (err) return self.sendReply(res, err);
                        // Merge locations and accounts
                        rows.forEach(function(row) {
                            var item = list[row.id];
                            for (var p in item) row[p] = item[p];
                        });
                        res.json({ token: core.toBase64(info), rows: rows });
                    });
                } else {
                    res.json({ token: core.toBase64(info), rows: rows });
                }            
            });
            break;
        }
    });
}

// Prepare an account record for response, set required fields, icons
api.processAccountRow = function(row, options, cols)
{
    if (row.birthday) {
    	row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
    	delete row.birthday;
    }
    // List all available icons, on icon put, we save icon type in the icons property
    core.strSplitUnique(row.icons).forEach(function(x) {
        row['icon' + x] = self.imagesUrl + '/image/account/' + row.id + '/' + x;
    });
    delete row.icons;
    return row;
}

// API for internal provisioning, by default supports access to all tables
api.initBackendAPI = function() 
{
    var self = this;
    
    // Return current statistics
    this.app.all("/backend/stats", function(req, res) {
        res.json(db.getPool().stats);
    });

    // Load columns into the cache
    this.app.all(/^\/backend\/columns$/, function(req, res) {
        db.cacheColumns({}, function() {
            res.json(db.getPool().dbcolumns);
        });
    });

    // Return table columns
    this.app.all(/^\/backend\/columns\/([a-z_0-9]+)$/, function(req, res) {
        res.json(db.getColumns(req.params[0]));
    });

    // Return table keys
    this.app.all(/^\/backend\/keys\/([a-z_0-9]+)$/, function(req, res) {
        res.json(db.getKeys(req.params[0]));
    });

    // Basic operations on a table
    this.app.all(/^\/backend\/(select|search|list|get|add|put|update|del|replace)\/([a-z_0-9]+)$/, function(req, res) {
        var dbcols = db.getColumns(req.params[1]);
        if (!dbcols) return res.json([]);
        var options = {};
        // Convert values into actual arrays if separated by pipes
        // Set options from special properties
        for (var p in req.query) {
            if (p[0] != '_' && req.query[p].indexOf("|") > 0) req.query[p] = req.query[p].split("|");
            if (p[0] == '_') options[p.substr(1)] = req.query[p];
        }
        options.pool = self.pool;
        db[req.params[0]](req.params[1], req.query, options, function(err, rows) {
            return self.sendReply(res, err);
        });
    });
    
}

// Add columns to account tables, makes sense in case of SQL database for extending supported properties and/or adding indexes
// Used during initialization of the external modules which may add custom columns to the existing tables. 
api.initTables = function(table, columns) 
{
    var self = this;
    if (!Array.isArray(columns)) return;
    if (!self.tables[table]) self.tables[table] = []; 
    columns.forEach(function(x) {
        if (typeof x == "object" && x.name && !self.tables[table].some(function(y) { return y.name == x.name })) {
            self.tables[table].push(x);
        } 
    });
}

// Send formatted reply to API clients, if status is an instance of Error then error message with status 500 is sent back
api.sendReply = function(res, status, msg) 
{
    if (status instanceof Error) msg = status, status = 500;
    if (!status) status = 200, msg = "";
    res.json(status, { status: status, message: String(msg || "").replace(/SQLITE_CONSTRAINT:/g, '') });
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

// Return type of the icon, this can be type itself or full icon url
api.getIconType = function(id, type) 
{
    var d = (type || "").match(/\/image\/account\/([a-z0-9-]+)\/?(([0-9])$|([0-9])\?)?/);
    return d && d[1] == id ? (d[3] || d[4]) : "0";
}

// Return icon to the client
api.getIcon = function(req, res, id, options) 
{
    var self = this;
    
    var icon = core.iconPath(id, options);
    if (this.imagesS3) {
        var aws = core.context.aws;
        aws.queryS3(this.imagesS3, icon, options, function(err, params) {
            if (err) return self.sendReply(res, err);
            res.type("image/" + (options.ext || "jpeg")); 
            res.send(200, params.data);
        });
    } else {
        this.sendFile(req, res, icon);
    }
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback) 
{
    var self = this;
    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property
    // to define type for each icon
    if (req.files) {
        async.forEachSeries(Object.keys(req.files), function(f, next) {
            var opts = core.extendObj(options, 'type', req.body[f + '_type']);
            self.storeIcon(req.files[f].path, id, opts, next);
        }, function(err) {
            callback(err);
        });
    } else 
    // JSON object submitted with .icon property
    if (typeof req.body == "object") {
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
api.storeIcon = function(icon, id, options, calback) 
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
    core.scaleIcon(file, "", options, function(err, data) {
        if (err) return callback ? callback(err) : null;
        var headers = { 'content-type': 'image/' + (options.ext || "jpeg") };
        aws.queryS3(self.imagesS3, icon, { method: "PUT", postdata: data, headers: headers }, function(err) {
            if (callback) callback(err, icon);
        });
    });
}

// Custom access logger
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
               (req.account ? req.account.email : "-") + "\n";
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
