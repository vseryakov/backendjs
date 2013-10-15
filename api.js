//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var pool = require('generic-pool');
var crypto = require('crypto');
var async = require('async');
var express = require('express');
var domain = require('domain');
var core = require(__dirname + '/core');
var printf = require('printf');
var logger = require(__dirname + '/logger');

// HTTP API to the server from the clients
var api = {

    // No authentication for these urls
    allow: /(^\/$|[a-zA-Z0-9\.-]+\.(gif|png|jpg|js|ico|css|html|txt|csv|json|plist)$|(^\/image\/[a-z]+\/|^\/account\/add))/,

    // Refuse access to these urls
    deny: null,
    
    // Account management
    accountPrefix: '',
    accountImages: '',
    accountColumns: [ { name: "account_id", primary: 1 },
                      { name: "facebook_id", type: "int" },
                      { name: "linkedin_id", type: "int" },
                      { name: "tweeter_id", },
                      { name: "google_id", },
                      { name: "secret" },
                      { name: "name" },
                      { name: "email" },
                      { name: "birthday" },
                      { name: "distance", type: "int" },
                      { name: "gender" },
                      { name: "address" },
                      { name: "city" },
                      { name: "state" },
                      { name: "zipcode" },
                      { name: "country" },
                      { name: "location" },
                      { name: "acl_allow" },
                      { name: "acl_deny" },
                      { name: "ltime", type: "int" },
                      { name: "atime", type: "int" },
                      { name: "ctime", type: "int" },
                      { name: "mtime", type: "int" } ],
    
    // Upload limit, bytes
    uploadLimit: 10*1024*1024,
    
    // Cache statistics
    stats: { gets: 0, hits: 0, misses: 0, puts: 0, dels: 0 },
    
    // Config parameters
    args: ["account-pool", 
           "account-prefix", 
           "account-images",
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

        // Check authenication, if we get here it means access has been verified
        self.app.all("/auth", function(req, res) {
            res.json({ status: 200 });
        });

        // Return current statistics
        self.app.all("/status", function(req, res) {
            res.json(self.stats);
        });

        // Return images by prefix, id and possibly type, serves from local images folder, 
        // this is generic access without authentication, depends on self.allow regexp
        self.app.all(/^\/image\/([a-z]+)\/([a-z])?\/?([a-z0-9-]+)/, function(req, res) {
            self.sendFile(req, res, core.iconPath(req.params[2], req.params[0], req.params[1]));
        });

        // Managing accounts
        this.app.all(/^\/account\/(add|get|put|del|puticon)$/, function(req, res) {
            switch (req.params[0]) {
            case "get":
                // Delete all special properties and the secret
                for (var p in req.account) {
                    if (p[0] == '_' || p == 'secret') delete req.account[p];
                }
                // List all possible icons, this server may not have access to the files so it is up to the client to verify which icons exist
                req.account.icon = self.accountImages + '/image/account/' + req.account.id;
                req.account.icons = ['a','b','c','d','e','f'].map(function(x) { return self.accountImages + '/image/account/' + x + '/' + req.account.id });
                res.json(req.account);
                break;

            case "add":
                // Verify required fields
                if (!req.query.account_id) return self.sendReply(res, 400, "Id is required");
                if (!req.query.secret) return self.sendReply(res, 400, "Secret is required");
                if (!req.query.name) return self.sendReply(res, 400, "Name is required");
                if (!req.query.email) return self.sendReply(res, 400, "Email is required");
                self.manageAccount("account." + req.params[0], req, req.query, {}, function(err) {
                    self.sendReply(res, err);
                });
                break;

            case "put":
                self.manageAccount("account.put", req, req.query, {}, function(err) {
                    self.sendReply(res, err);
                });
                break;

            case "del":
                self.manageAccount("account.del", req, req.query, {}, function(err) {
                   self.sendReply(res, err);
                });
                break;
                
            case 'puticon':
                // Add icon to the account, support up to 6 icons with types: a,b,c,d,e,f, primary icon type is ''
                self.putIcon(req, { id: req.account.id, prefix: 'account' , type: req.body.type || req.query.type || '' }, function(err) {
                    self.sendReply(res, err);
                });
                break;
            }
        });
        
        // Provisioning access to the database
        if (self.backend) self.initBackend();

        // Post init or other application routes
        self.onInit.call(this);

        // Start the account driver
        self.manageAccount("init", {}, {}, callback);
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
                   (req.account ? req.account.account_id : "-") + "\n";
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

    // Perform authorization of the incoming request for access and permissions
    checkRequest: function(req, res, next) {
        var self = this;
        self.manageAccess(req, function(rc1) {
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

    // Verify request signature from the request object, uses properties: .host, .method, .url or .originalUrl, .headers
    checkSignature: function(req, callback) {
        // Make sure we will not crash on wrong object
        if (!req || !req.headers) req = { headers: {} };
        if (!callback) callback = function(x) { return x; }

        // Extract all signatuee components from the request
        var sig = core.parseSignature(req);

        // Show request in the log on demand for diagnostics
        if (logger.level > 1 || req.query._debug) {
            logger.log('checkRequest:', sig, 'hdrs:', req.headers);
        }

        // Sanity checks, required headers must be present and not empty
        if (!sig.method || !sig.host || !sig.expires || !sig.accesskey || !sig.signature) {
            return callback({ status: 401, message: "Invalid request: " + (!sig.method ? "no method" :
                                                                           !sig.host ? "no host" :
                                                                           !sig.accesskey ? "no access email" :
                                                                           !sig.expires ? "no expires" :
                                                                           !sig.signature ? "no signature" : "") });
        }

        // Make sure it is not expired, it may be milliseconds or ISO date
        if (sig.expires <= Date.now()) {
            return callback({ status: 400, message: "Expired request" });
        }

        // Verify if the access key is valid, they all are cached so a bad cache may result in rejects
        this.manageAccount("account.get", req, { account_id: sig.accesskey }, function(err, account) {
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
            // Support API version in the request, use current if not specified
            req.version = (req.headers.version || req.query._version || core.version).substr(0, 10);
            // Save components of signature verification, it will be used later for profile password check as well
            req.signature = sig;
            // Save current account in the request
            req.account = account;
            // All conditions must be checked for account id
            req.query.account_id = account.account_id;
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

    // Perform URL based access checks
    // Check access permissions, calls the callback with the following argument:
    // - nothing if checkSignature needs to be called
    // - an object with status: 200 to skip authorization and proceed with the next module
    // - an object with status other than 200 to return the status and stop request processing
    manageAccess: function(req, callback) {
        if (this.deny && req.path.match(this.deny)) return callback({ status: 401, message: "Access denied" });
        if (this.allow && req.path.match(this.allow)) return callback({ status: 200, message: "" });
        callback();
    },

    // Account driver that actually retrieve and return account records and perform caching if necesary
    manageAccount: function(cmd, req, obj, options, callback) { 
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (typeof callback != "function") callback = function() {};
            
        switch (cmd) {
        case "init":
            var tables = [ "CREATE TABLE IF NOT EXISTS " + self.accountPrefix + "account(" + 
                           self.accountColumns.map(function(x) { 
                               return x.name + " " + 
                                      (x.type || "TEXT") + " " + 
                                      (x.value ? "DEFAULT " + x.value : "") + " " + 
                                      (x.primary ? "PRIMARY KEY" : "") }).join(",") + 
                           ")" ];
            async.forEachSeries(tables, function(t, next) { 
                core.dbQuery(t, { pool: self.accountPool }, next); 
            }, function() {
                // Cache all columns for operations to work correctly
                core.dbCacheColumns({ pool: self.accountPool }, callback);
            });
            break;
            
        case "account.get":
            self.gets++;
            core.ipcGetCache("account:" + obj.account_id, function(rc) {
                // Cached value retrieved
                if (rc) {
                    self.stats.hits++;
                    return callback(null, JSON.parse(rc));
                }
                self.stats.misses++;
                // Retrieve account from the database
                core.dbSelect(self.accountPrefix + "account", obj, { pool: self.accountPool }, function(err, rows) {
                    // Store in cache if no error
                    if (rows.length && !err) {
                        self.stats.puts++;
                        core.ipcPutCache("account:" + obj.account_id, JSON.stringify(rows[0]));
                    }
                    callback(err, rows.length ? rows[0] : null);
                });
            });
            break;
                
        case "account.add":
            obj.mtime = obj.ctime = core.now();
            core.dbInsert(self.accountPrefix + "account", obj, { pool: self.accountPool }, function(err, rows) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;

        case "account.put":
            obj.mtime = core.now();
            core.dbUpdate(self.accountPrefix + "account", obj, { pool: self.accountPool }, function(err) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;
            
        case "account.del":
            core.dbDelete(self.accountPrefix + "account", obj, { pool: self.accountPool }, function(err) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;
            
        default:
            // Third argument signifies unsupported command
            callback(null, null, null);
        }
    },

    // Prepare an account record to be put into the database, remove not supported fields
    prepareAccount: function(obj, options) {
        for (var p in obj) {
            if (p[0] == '_' || typeof obj[p] == "undefined") delete obj[p];
            if (!this.accountColumns.some(function(x) { return x.name == p })) delete obj[p];
            if (obj[p] === null && options && options.nonull) delete obj[p];
        }
        obj.mtime = core.now();
        return obj;
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

    // DynamoDB account driver
    manageAccountDynamoDB: function(cmd, req, obj, options, callback) {
        var self = this;
        if (typeof options == "function") callback = options, options = {};
        if (typeof callback != "function") callback = function() {};

        switch (cmd) {
        case "init":
            aws.ddbListTables(function(err, rc) {
                if (err || !rc) return callback(err);
                var tables = [ { name: self.accountPrefix + "account", args: [{ account_id: 'S' }, { account_id: 'HASH' }, {}] } ];
                async.forEachSeries(tables, function(table, next) {
                    if (rc.TableNames.indexOf(table.name) > -1) return next();
                    aws.ddbCreateTable(table.name, table.args[0], table.args[1], table.args[2], next);
                }, function() {
                   callback();
                });
            });
            break;

        case "account.get":
            self.gets++;
            core.ipcGetCache("account:" + obj.account_id, function(rc) {
                // Cached value retrieved
                if (rc) {
                    self.stats.hits++;
                    return callback(null, JSON.parse(rc));
                }
                self.stats.misses++;
                aws.ddbGetItem(self.accountPrefix + "account", { account_id: obj.account_id }, { ConsistentRead: true }, function(err, item) {
                    // Store in cache if no error
                    if (!err && item && item.Item) {
                        self.stats.puts++;
                        core.ipcPutCache("account:" + obj.account_id, JSON.stringify(item.Item));
                    }
                    callback(err, item ? item.Item : null);
                });
            });
            break;

        case "account.add":
            self.prepareAccount(obj, { nonull: 1 });
            obj.ctime = core.now();
            aws.ddbPutItem("account", obj, { expected: { account_id: null } }, function(err, rc) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;

        case "account.put":
            self.prepareAccount(obj, { nonull: 1 });
            aws.ddbUpdateItem(self.accountPrefix + "account", { account_id: obj.account_id }, obj, { expected: { account_id: obj.account_id } }, function(err, rc) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;

        case "account.del":
            aws.ddbDeleteItem(self.accountPrefix + "account", { account_id: obj.account_id }, {}, function(err, rc) {
                self.stats.dels++;
                core.ipcDelCache("account:" + obj.account_id);
                callback(err);
            });
            break;
            
        default:
            // Third argument signifies unsupported command
            callback(null, null, null);
        }
    },
}

module.exports = api;
core.addContext('api', api);
