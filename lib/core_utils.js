//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var net = require('net');
var util = require('util');
var fs = require('fs');
var repl = require('repl');
var path = require('path');
var crypto = require('crypto');
var domain = require('domain');
var url = require('url');
var http = require('http');
var https = require('https');
var child = require('child_process');
var os = require('os');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var logger = require(__dirname + '/logger');

// Return unique process name based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
// making it usable for repeating environments or storage solutions.
core.processName = function()
{
    return (this.role || this.name) + this.workerId;
}

// Print help about command line arguments and exit
core.showHelp = function(options)
{
    var self = this;
    if (!options) options = {};
    var args = [ [ '', core.args ] ];
    Object.keys(this.modules).forEach(function(n) {
        if (self.modules[n].args) args.push([n, self.modules[n].args]);
    });
    var data = "";
    args.forEach(function(x) {
        x[1].forEach(function(y) {
            if (!y.name || !y.descr) return;
            var dflt = y._name ? lib.objGet(x[0] ? self.modules[x[0]] : self, y._name) : "";
            var line = (x[0] ? x[0] + '-' : '') + (y.match ? 'NAME-' : '') + y.name + (options.markdown ? "`" : "") + " - " + y.descr + (dflt ? ". Default: " + JSON.stringify(dflt) : "");
            if (y.dns) line += ". DNS TXT configurable.";
            if (y.match) line += ". Where NAME is the actual " + y.match + " name.";
            if (y.count) line += ". " + y.count + " variants: " + y.name + "-1 .. " + y.name + "-" + y.count + ".";
            if (options && options.markdown) {
                data += "- `" +  line + "\n";
            } else {
                console.log(" -" + line);
            }
        });
    });
    if (options.markdown) return data;
    process.exit(0);
}

// Send email
core.sendmail = function(options, callback)
{
    var self = this;
    try {
        var emailjs = require('emailjs');
        if (!options.from) options.from = "admin";
        if (options.from.indexOf("@") == -1) options.from += "@" + self.domain;
        if (!options.text) options.text = "";
        if (!options.subject) options.subject = "";
        if (options.to) options.to += ",";
        var server = emailjs.server.connect(this.smtp);
        server.send(options, function(err, message) {
            if (err) logger.error('sendmail:', err, options.from, options.to);
            if (typeof callback == "function") callback(err);
        });
    } catch(e) {
        logger.error('sendmail:', e, options.from, options.to);
        if (typeof callback == "function") callback(e);
    }
}

// Kill all backend processes that match name and not the current process
core.killBackend = function(name, signal, callback)
{
    var self = this;
    if (typeof signal == "function") callback = signal, signal = '';
    if (!signal) signal = 'SIGTERM';

    lib.execProcess("/bin/ps agx", function(stderr, stdout) {
        stdout.split("\n").
               filter(function(x) { return x.match(core.name + ":") && (!name || x.match(name)); }).
               map(function(x) { return lib.toNumber(x) }).
               filter(function(x) { return x != process.pid }).
               forEach(function(x) { try { process.kill(x, signal); } catch(e) { logger.error('killBackend:', name, x, e); } });
        if (typeof callback == "function") callback();
    });
}

// Shutdown the machine now
core.shutdown = function()
{
    var self = this;
    child.exec("/sbin/halt", function(err, stdout, stderr) {
        logger.log('shutdown:', stdout || "", stderr || "", err || "");
    });
}

// Set or reset a timer
core.setTimeout = function(name, callback, timeout)
{
    if (this.timers[name]) clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(callback, timeout);
}

// Create a Web server with options and request handler, returns a server object.
//
// Options can have the following properties:
// - port - port number is required
// - bind - address to bind
// - restart - name of the processes to restart on address in use error, usually "web"
// - ssl - an object with SSL options for TLS createServer call
// - timeout - number of milliseconds for the request timeout
// - name - server name to be assigned
core.createServer = function(options, callback)
{
    var self = this;
    if (!options || !options.port) {
        logger.error('createServer:', 'invalid options', options);
        return null;
    }
    var server = options.ssl ? https.createServer(options.ssl, callback) : http.createServer(callback);
    if (options.timeout) server.timeout = options.timeout;
    server.on('error', function(err) {
        logger.error(this.role + ':', 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restart) {
            self.killBackend(options.restart, "SIGKILL", function() { process.exit(0) });
        }
    });
    server.serverPort = options.port;
    if (options.name) server.serverName = options.name;
    try { server.listen(options.port, options.bind, this.backlog); } catch(e) { logger.error('server: listen:', options, e); server = null; }
    logger.log("createServer:", options);
    return server;
}

// Create REPL interface with all modules available
core.createRepl = function(options)
{
    var self = this;
    var r = repl.start(options || {});
    r.context.core = this;
    r.context.fs = fs;
    r.context.os = os;
    r.context.util = util;
    r.context.url = url;
    r.context.path = path;
    r.context.child = child;
    r.rli.historyIndex = 0;
    r.rli.history = [];
    // Expose all modules as top level objects
    for (var p in this.modules) r.context[p] = this.modules[p];

    // Support history
    var file = options && options.file;
    if (file) {
        r.rli.history = lib.readFileSync(file, { list: '\n' }).reverse();
        r.rli.addListener('line', function(code) {
            if (code) {
                fs.appendFile(file, code + '\n', function() {});
            } else {
                r.rli.historyIndex++;
                r.rli.history.pop();
            }
      });
    }
    return r;
}

// Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
core.startRepl = function(port, bind, options)
{
    var self = this;
    if (!bind) bind = '127.0.0.1';
    try {
        this.repl.server = net.createServer(function(socket) {
            var repl = self.createRepl(lib.cloneObj(options, "prompt", '> ', "input", socket, "output", socket, "terminal", true, "useGlobal", false));
            repl.on('exit', function() {
                socket.end();
            });
        }).on('error', function(err) {
            logger.error('startRepl:', core.role, port, bind, err);
        }).listen(port, bind);
        logger.info('startRepl:', core.role, 'port:', port, 'bind:', bind);
    } catch(e) {
        logger.error('startRepl:', port, bind, e);
    }
}

// Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
// Options properties:
// - match - a regexp that specifies only files to be watched
// - ignore - a regexp of files to be ignored
// - seconds - number of seconds a file to be older to be deleted
// - nodirs - if 1 skip deleting directories
core.watchTmp = function(dir, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    if (!options.seconds) options.seconds = 86400;

    var now = Date.now();
    fs.readdir(dir, function(err, files) {
        if (err) return callback ? callback(err) : null;

        lib.forEachSeries(files, function(file, next) {
            if (file == "." || file == "..") return next();
            if (options.match && !file.match(options.match)) return next();
            if (options.ignore && file.match(options.ignore)) return next();

            file = path.join(dir, file);
            fs.stat(file, function(err, st) {
                if (err) return next();
                if (options.nodirs && st.isDirectory()) return next();
                if (now - st.mtime < options.seconds*1000) return next();
                logger.info('watchTmp: delete', dir, file, (now - st.mtime)/1000, 'sec old');
                if (st.isDirectory()) {
                    lib.unlinkPath(file, function(err) {
                        if (err) logger.error('watchTmp:', file, err);
                        next();
                    });
                } else {
                    fs.unlink(file, function(err) {
                        if (err) logger.error('watchTmp:', file, err);
                        next();
                    });
                }
            });
        }, callback);
    });
}

// Watch files in a dir for changes and call the callback
core.watchFiles = function(dir, pattern, fileCallback, endCallback)
{
    logger.debug('watchFiles:', dir, pattern);

    function watcher(event, file) {
        // Check stat if no file name, Mac OS X does not provide it
        fs.stat(file.name, function(err, stat) {
            if (err) return;
            if (stat.size == file.stat.size && stat.mtime == file.stat.mtime) return;
            logger.log('watchFiles:', event, file.name, file.ino, stat.size);
            if (event == "rename") {
                file.watcher.close();
                file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
            }
            file.stat = stat;
            fileCallback(file);
        });
    }

    fs.readdir(dir, function(err, list) {
        if (err) return typeof endCallback == "function" && endCallback(err);

        list = list.filter(function(file) {
            return !core.noWatch.test(file) && file.match(pattern);
        }).map(function(file) {
            file = path.join(dir, file);
            return ({ name: file, stat: lib.statSync(file) });
        });
        list.forEach(function(file) {
            logger.debug('watchFiles:', file.name, file.stat.ino, file.stat.size);
            file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
        });
        if (typeof endCallback == "function") endCallback(err, list);
    });
}

// Watch log files for errors and report via email or POST url, see config parameters starting with `logwatcher-` about how this works
core.watchLogs = function(options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var db = self.modules.db;

    // Check interval
    this.logwatcherMtime = Date.now();

    // From address, use current hostname
    if (!this.logwatcherFrom) this.logwatcherFrom = "logwatcher@" + this.domain;

    var match = {};
    for (var p in self.logwatcherMatch) {
        try {
            match[p] = new RegExp(this.logwatcherMatch[p].map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('watchLogs:', e, this.logwatcherMatch[p]);
        }
    }
    var ignore = {}
    for (var p in this.logwatcherIgnore) {
        try {
            ignore[p] = new RegExp(this.logwatcherIgnore[p].map(function(x) { return "(" + x + ")"}).join("|"));
        } catch(e) {
            logger.error('watchLogs:', e, this.logwatcherIgnore[p]);
        }
    }

    // Run over all regexps in the object, return channel name if any matched
    function matchObj(obj, line) {
        for (var p in obj) if (obj[p].test(line)) return p;
        return "";
    }

    logger.debug('watchLogs:', this.logwatcherEmail, this.logwatcherUrl, this.logwatcherFiles);

    // Load all previous positions for every log file, we start parsing file from the previous last stop
    db.select("bk_property", { name: 'logwatcher:' }, { ops: { name: 'begins_with' }, pool: db.local }, function(err, rows) {
        var lastpos = {};
        for (var i = 0; i < rows.length; i++) {
            lastpos[rows[i].name] = rows[i].value;
        }
        var errors = {}, echan = "", eline = 0;

        // For every log file
        lib.forEachSeries(self.logwatcherFile, function(log, next) {
            var file = log.file;
            if (!file && self[log.name]) file = self[log.name];
            if (!file) return next();

            fs.stat(file, function(err, st) {
               if (err) return next();
               // Last saved position, start from the end if the log file is too big or got rotated
               var pos = lib.toNumber(lastpos['logwatcher:' + file] || 0);
               if (st.size - pos > self.logwatcherMax || pos > st.size) pos = st.size - self.logwatcherMax;

               fs.open(file, "r", function(err, fd) {
                   if (err) return next();
                   var buf = new Buffer(self.logwatcherMax);
                   fs.read(fd, buf, 0, buf.length, Math.max(0, pos), function(err, nread, buffer) {
                       fs.close(fd, function() {});
                       if (err || !nread) return next();

                       var lines = buffer.slice(0, nread).toString().split("\n");
                       for (var i = 0; i < lines.length; i++) {
                           // Skip local or global ignore list first
                           if ((log.ignore && log.ignore.test(lines[i])) || matchObj(ignore, lines[i])) continue;
                           // Match both global or local filters
                           var chan = log.match && log.match.test(lines[i]) ? (log.type || "all") : "";
                           if (!chan) chan = matchObj(match, lines[i]);
                           if (chan) {
                               // Attach to the previous channel, for cases when more error into like backtraces are matched with
                               // a separate pattern. If no channel previously matched use any as the channel itself.
                               chan = chan == "any" && i - eline <= self.logwatcherAnyRange ? (echan || "any") : chan;
                               if (!errors[chan]) errors[chan] = "";
                               errors[chan] += lines[i] + "\n";
                               // Add all subsequent lines starting with a space or tab, those are continuations of the error or stack traces
                               while (i < lines.length -1 && (lines[i + 1][0] == ' ' || lines[i + 1][0] == '\t')) {
                                   errors[chan] += lines[++i] + "\n";
                               }
                               echan = chan;
                               eline = i;
                           }
                       }
                       // Save current size to start next time from
                       db.put("bk_property", { name: 'logwatcher:' + file, value: st.size }, { pool: db.local }, function(err) {
                           if (err) logger.error('watchLogs:', file, err);
                           next();
                       });
                   });
               });
            });
        }, function(err) {
            lib.forEach(Object.keys(errors), function(type, next) {
                if (!errors[type].length) return next();
                logger.log('logwatcher:', type, 'found matches, sending to', self.logwatcherEmail[type], self.logwatcherUrl[type], self.logwatcherTable[type]);

                if (self.logwatcherTable[type]) {
                    db.add(self.logwatcherTable[type], {
                               mtime: Date.now(),
                               type: type,
                               ipaddr: self.ipaddr,
                               host: os.hostname(),
                               instance_id: self.instance.id,
                               instance_tag: self.instance.tag,
                               run_mode: self.runMode,
                               data: errors[type] }, function() { next() });
                    return;
                }
                if (self.logwatcherUrl[type]) {
                    self.sendRequest({ url: self.logwatcherUrl[type],
                                         queue: true,
                                         headers: {
                                             "content-type": "text/plain",
                                             "bk-type": type,
                                             "bk-ipaddr": self.ipaddr,
                                             "bk-host": os.hostname(),
                                             "bk-instance-id": self.instance.id,
                                             "bk-instance-tag": self.instance.tag,
                                             "bk-run-mode": self.runMode,
                                         },
                                         method: "POST",
                                         retryCount: 3,
                                         retryOnError: 1,
                                         retryTimeout: 1000,
                                         postdata: errors[type] }, function() { next() });
                    return;
                }
                if (self.logwatcherEmail[type]) {
                    var subject = "logwatcher: " + type + ": " + os.hostname() + "/" + self.ipaddr + "/" + self.instance.id + "/" + self.instance.tag + "/" + self.runMode;
                    if (self.logwatcherSes) {
                        core.modules.aws.sesSendEmail(self.logwatcherEmail[type], subject, errors[type], { from: self.logwatcherFrom }, function() { next() });
                    } else {
                        self.sendmail({ from: self.logwatcherFrom, to: self.logwatcherEmail[type], subject: subject, text: errors[type] }, function() { next() });
                    }
                    return;
                }
                next();
            }, function(err) {
                if (typeof callback == "function") callback(err, errors);
            });
        });
    });
}

// Return cookies that match given domain
core.cookieGet = function(domain, callback)
{
    var db = this.modules.db;
    var cookies = [];
    db.scan("bk_property", {}, { pool: db.local }, function(row, next) {
        if (!row.name.match(/^bk:cookie:/)) return next();
        var cookie = lib.jsonParse(row.value, { datatype: "obj" })
        if (cookie.expires <= Date.now()) return next();
        if (cookie.domain == domain) {
            cookies.push(cookie);
        } else
        if (cookie.domain.charAt(0) == "." && (cookie.domain.substr(1) == domain || domain.match(cookie.domain.replace(/\./g,'\\.') + '$'))) {
            cookies.push(cookie);
        }
        next();
    }, function(err) {
        logger.debug('cookieGet:', domain, cookies);
        if (callback) callback(err, cookies);
    });
}

// Save new cookies arrived in the request,
// merge with existing cookies from the jar which is a list of cookies before the request
core.cookieSave = function(cookiejar, setcookies, hostname, callback)
{
    var db = this.modules.db;
    var cookies = !setcookies ? [] : Array.isArray(setcookies) ? setcookies : String(setcookies).split(/[:](?=\s*[a-zA-Z0-9_\-]+\s*[=])/g);
    logger.debug('cookieSave:', cookiejar, 'SET:', cookies);
    cookies.forEach(function(cookie) {
        var parts = cookie.split(";");
        var pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
        if (!pair) return;
        var obj = { name: pair[1], value: pair[2], path: "", domain: "", secure: false, expires: Infinity };
        for (var i = 1; i < parts.length; i++) {
            pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
            if (!pair) continue;
            var key = pair[1].trim().toLowerCase();
            var value = pair[2];
            switch(key) {
            case "expires":
                obj.expires = value ? Number(lib.toDate(value)) : Infinity;
                break;

            case "path":
                obj.path = value ? value.trim() : "";
                break;

            case "domain":
                obj.domain = value ? value.trim() : "";
                break;

            case "secure":
                obj.secure = true;
                break;
            }
        }
        if (!obj.domain) obj.domain = hostname || "";
        var found = false;
        cookiejar.forEach(function(x, j) {
            if (x.path == obj.path && x.domain == obj.domain && x.name == obj.name) {
                if (obj.expires <= Date.now()) {
                    cookiejar[j] = null;
                } else {
                    cookiejar[j] = obj;
                }
                found = true;
            }
        });
        if (!found) cookiejar.push(obj);
    });
    lib.forEachSeries(cookiejar, function(rec, next) {
        if (!rec) return next();
        if (!rec.id) rec.id = lib.hash(rec.name + ':' + rec.domain + ':' + rec.path);
        db.put("bk_property", { name: "bk:cookie:" + rec.id, value: rec }, { pool: db.local }, function() { next() });
    }, callback);
}

