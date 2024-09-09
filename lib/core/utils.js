//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const net = require('net');
const util = require('util');
const fs = require('fs');
const repl = require('repl');
const path = require('path');
const url = require('url');
const http = require('http');
const https = require('https');
const child = require('child_process');
const os = require('os');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

// Expose mime via core, compatibility with mime module
core.mime = require("mime-types");

// Switch to new home directory, exit if we cannot, this is important for relative paths to work if used,
// no need to do this in worker because we already switched to home directory in the master and all child processes
// inherit current directory
// Important note: If run with combined server or as a daemon then this MUST be an absolute path, otherwise calling
// it in the spawned web master will fail due to the fact that we already set the home and relative path will not work after that.
core.setHome = function(home)
{
    if ((home || this.home) && core.isMaster) {
        if (home) this.home = path.resolve(home);
        // On create set permissions
        if (lib.makePathSync(this.home)) lib.chownSync(this.uid, this.gid, this.home);
        try {
            process.chdir(this.home);
        } catch (e) {
            logger.error('setHome: cannot set home directory', this.home, e);
            process.exit(1);
        }
        logger.dev('setHome:', this.role, this.home);
    }
    this.home = process.cwd();
}

// Return true if the given service is not disabled
core.isOk = function(name)
{
    return !this.none.includes(name);
}

// Install internal inspector for the logger, an alternative to the `util.inspect`
core.setLogInspect = function(set)
{
    if (lib.toBool(set)) {
        if (!logger._oldInspect) {
            logger._oldInspect = logger.inspect;
            logger._oldInspectArgs = logger.inspectArgs;
        }
        logger.inspect = this.inspect;
        logger.inspectArgs = this.logInspect;
    } else {
        if (logger._oldInspect) logger.inspect = logger._oldInspect;
        if (logger._oldInspectArgs) logger.inspectArgs = logger._oldInspectArgs;
    }
}

core.inspect = function(obj, options)
{
    return lib.objDescr(obj, options || core.logInspect);
}

// Parse the config file, configFile can point to a file or can be skipped and the default file will be loaded
core.loadConfig = function(file, callback)
{
    logger.debug('loadConfig:', this.role, file);

    fs.readFile(file || "", (err, data) => {
        if (!err) core.parseConfig(data.toString(), 0, file);
        lib.tryCall(callback, err);
    });
}

// Return unique process name based on the cluster status, worker or master and the role. This is can be reused by other workers within the role thus
// making it usable for repeating environments or storage solutions.
core.processName = function()
{
    return (this.role || this.name) + this.workerId;
}

// Print help about command line arguments and exit
core.showHelp = function(options)
{
    if (!options) options = {};
    var args = [ [ '', core.args ] ];
    Object.keys(this.modules).forEach((n) => {
        if (core.modules[n].args) args.push([n, core.modules[n].args]);
    });
    var data = "";
    args.forEach((x) => {
        x[1].forEach((y) => {
            if (!y.name || !y.descr) return;
            var dflt = y._name ? lib.objGet(x[0] ? core.modules[x[0]] : core, y._name) : "";
            var line = (x[0] ? x[0] + '-' : '') + (y.match ? 'NAME-' : '') + y.name + (options.markdown ? "`" : "") + " - " + y.descr + (dflt ? ". Default: " + JSON.stringify(dflt) : "");
            if (y.match) line += ". Where NAME is the actual " + y.match + " name.";
            if (y.count) line += ". " + y.count + " variants: " + y.name + "-1 .. " + y.name + "-" + y.count + ".";
            if (options && options.markdown) {
                data += "- `" + line + "\n";
            } else {
                console.log(" -" + line);
            }
        });
    });
    if (options.markdown) return data;
    process.exit(0);
}

// Send email via `nodemailer` with SMTP transport, other supported transports:
// - fake: - same as json
// - json: - return message as JSON
// - file: - save to a file in the `tmp/`
// - sendgrid: - send via SendGrid
// - ses: - send via AWS SES service
//
core.sendmail = function(options, callback)
{
    if (!options.from) options.from = this.emailFrom || "admin";
    if (options.from.indexOf("@") == -1) options.from += "@" + this.domain;
    logger.debug("sendmail:", options);

    try {
        var h = url.parse(options.transport || this.emailTransport || "", true), transport;
        switch (h.protocol) {
        case "fake:":
        case "json:":
            transport = { jsonTransport: true };
            break;

        case "file:":
            transport = {
                send: function(mail, done) {
                    mail.normalize((err, data) => {
                        fs.writeFile(`${core.path.tmp}/email-${data.envelope.to}.json`, lib.stringify(data), done);
                    });
                }
            };
            break;

        case "ses:":
            if (!core.modules.aws.key || !core.modules.aws.secret) break;
            transport = {
                SES: {
                    region: core.modules.aws.region,
                    sendRawEmail: function(params) {
                        return {
                            promise: function() {
                                return new Promise((resolve, reject) => {
                                    var req = { "RawMessage.Data": Buffer.from(params.RawMessage.Data).toString("base64"), Source: params.Source };
                                    lib.strSplit(params.Destinations).forEach((x, i) => { params["Destinations.member." + (i + 1)] = x });
                                    core.modules.aws.querySES("SendRawEmail", req, null, (err, rc) => {
                                        if (err) return reject(err);
                                        resolve(rc);
                                    });
                                });
                            }
                        }
                    }
                },
                sendingRate: options.sendingRate,
            };
            break;

        case "sendgrid:":
            transport = new core.SendGridTransport({ apikey: h.query.key });
            break;
        }
        var mailer = require("nodemailer").createTransport(transport || core.smtp || { host: "localhost", port: 25 });
        mailer.sendMail(options, (err, rc) => {
            if (err) logger.error('sendmail:', err, options);
            lib.tryCall(callback, err, rc);
        });

    } catch (err) {
        logger.error('sendmail:', err, options);
        lib.tryCall(callback, err);
    }
}

// Kill all backend processes that match name and not the current process
core.killBackend = function(name, signal, callback)
{
    if (typeof signal == "function") callback = signal, signal = null;
    if (!signal) signal = 'SIGTERM';

    name = lib.strSplit(name).join("|");
    lib.findProcess({ filter: `${core.name}: ` + (name ? `(${name})`: "") }, (err, list) => {
        logger.debug("killBackend:", name, list);
        lib.forEach(list.map((x) => (x.pid)), (pid, next) => {
            try { process.kill(pid) } catch (e) { logger.debug("killBackend:", name, pid, e) }
            setTimeout(() => {
                try { process.kill(pid, "SIGKILL") } catch (e) { logger.debug("killBackend:", name, pid, e) }
                next();
            }, 1000);
        }, callback);
    });
}

// Shutdown the machine now
core.shutdown = function()
{
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
// - keepAliveTimeout - number of milliseconds to keep the HTTP connecton alive
// - requestTimeout - number of milliseconds to receive the entire request from the client
// - maxRequestsPerSocket - number of requests a socket can handle before closing keep alive connection
// - maxHeaderSize - maximum length of request headers in bytes
// - name - server name to be assigned
core.createServer = function(options, callback)
{
    if (!options || !options.port) {
        logger.error('createServer:', 'invalid options', options);
        return null;
    }
    var server;
    if (options.ssl) {
        var opts = lib.objClone(options.ssl);
        for (const p in options) if (p != "ssl") opts[p] = options[p];
        server = https.createServer(opts, callback);
    } else {
        server = http.createServer(options, callback);
    }
    if (options.timeout) {
        server.timeout = options.timeout;
    }
    server.serverPort = options.port;
    if (options.name) {
        server.serverName = options.name;
    }
    if (options.keepAliveTimeout) {
        server.keepAliveTimeout = options.keepAliveTimeout;
        server.headersTimeout = Math.round(options.keepAliveTimeout * 1.25);
    }
    server.requestTimeout = options.requestTimeout || 0;
    server.maxRequestsPerSocket = options.maxRequestsPerSocket || null;
    server.on('error', function(err) {
        logger.error(core.role + ':', 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code == 'EADDRINUSE' && options.restart) {
            core.killBackend(options.restart, "SIGKILL", function() { process.exit(0) });
        }
    });

    try { server.listen(options.port, options.bind, this.backlog); } catch (e) { logger.error('server: listen:', options, e); server = null; }
    logger.log("createServer:", options);
    if (server) {
        this.runMethods("bkCreateServer", { sync: 1, server: server, options: options });
    }
    return server;
}

// Create REPL interface with all modules available
core.createRepl = function(options)
{
    var r = repl.start(options || {});
    r.context.core = this;
    r.context.fs = fs;
    r.context.os = os;
    r.context.util = util;
    r.context.url = url;
    r.context.path = path;
    r.context.child = child;
    r.historyIndex = 0;
    r.history = [];
    // Expose all modules as top level objects
    for (const p in this.modules) r.context[p] = this.modules[p];

    // Support history
    var file = options && options.file;
    if (file) {
        r.history = lib.readFileSync(file, { list: '\n', offset: -options.size }).reverse();
        r.addListener('line', (code) => {
            if (code) {
                fs.appendFile(file, code + '\n', lib.noop);
            } else {
                r.historyIndex++;
                r.history.pop();
            }
        });
    }
    return r;
}

// Start command prompt on TCP socket, context can be an object with properties assigned with additional object to be accessible in the shell
core.startRepl = function(port, bind, options)
{
    if (!bind) bind = '127.0.0.1';
    try {
        this.repl.server = net.createServer((socket) => {
            var repl = core.createRepl(lib.objClone(options, "prompt", '> ', "input", socket, "output", socket, "terminal", true, "useGlobal", false));
            repl.on('exit', () => {
                socket.end();
            });
        }).on('error', (err) => {
            logger.error('startRepl:', core.role, port, bind, err);
        }).listen(port, bind);

        logger.info('startRepl:', core.role, 'port:', port, 'bind:', bind);
    } catch (e) {
        logger.error('startRepl:', port, bind, e);
    }
}

// Watch temp files and remove files that are older than given number of seconds since now, remove only files that match pattern if given
// Options properties:
// - path - root folder, relative or absolute
// - age - number of seconds a file to be older to be deleted, default 1 day
// - include - a regexp that specifies only files to be watched
// - exclude - a regexp of files to be ignored
// - nodirs - if 1 skip deleting directories
// - depth - how deep to go, default is 1
core.watchTmp = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var age = lib.toNumber(options.age, { dflt: 86400 }) * 1000;
    var exclude = options.exclude && lib.toRegexp(options.exclude);
    var include = options.include && lib.toRegexp(options.include);

    logger.debug("watchTmp:", options);
    var now = Date.now();
    lib.findFile(options.path, { details: 1, include, exclude, depth: options.depth || 1 }, (err, files) => {
        if (err) return callback ? callback(err) : null;

        lib.forEachSeries(files, (file, next) => {
            if (options.nodirs && file.isDirectory()) return next();
            if (now - file.mtime < age) return next();

            logger.info('watchTmp: delete', age, file.file, lib.toAge(file.mtime), "old");
            if (file.isDirectory()) {
                lib.unlinkPath(file.file, (err) => {
                    if (err && err.code != "ENOENT") logger.error('watchTmp:', file.file, err);
                    next();
                });
            } else {
                fs.unlink(file.file, (err) => {
                    if (err && err.code != "ENOENT") logger.error('watchTmp:', file.file, err);
                    next();
                });
            }
        }, callback);
    });
}

// Parse Set-Cookie header and return an object of cookies: { NAME: { value: VAL, secure: true, expires: N ... } }
core.parseCookies = function(header)
{
    var cookies = {};
    header = Array.isArray(header) ? header.filter((x) => (typeof x == "string")) :
             typeof header == "string" ? header.split(/[:](?=\s*[a-zA-Z0-9_-]+\s*[=])/g) : [];
    for (const p of header) {
        const parts = p.split(";");
        let pair = parts[0].match(/([^=]+)=((?:.|\n)*)/);
        if (!pair) continue;
        const name = pair[1], cookie = { value: pair[2] || "" };
        for (let i = 1; i < parts.length; i++) {
            pair = parts[i].match(/([^=]+)(?:=((?:.|\n)*))?/);
            if (!pair) continue;
            const key = pair[1].trim().toLowerCase();
            const value = pair[2] && pair[2].trim();
            switch (key) {
            case "expires":
                if (value) cookie.expires = lib.toMtime(value);
                break;

            case "path":
            case "domain":
                if (value) cookie[key] = value;
                break;

            case "samesite":
                if (value) cookie.sameSite = value;
                break;

            case "secure":
                cookie.secure = true;
                break;

            case "httponly":
                cookie.httpOnly = true;
                break;
            }
        }
        cookies[name] = cookie;
    }
    return cookies;
}

// Load configured locales
core.loadLocales = function(options, callback)
{
    lib.forEach(this.locales, function(x, next) {
        lib.forEach(core.path.locales, function(path, next2) {
            lib.loadLocale(path + "/" + x + '.json', function(err, d) {
                if (!d) return next();
                if (!core._localeFiles) core._localeFiles = {};
                if (core._localeFiles[x] && core._localeFiles[x].watcher) core._localeFiles[x].watcher.close();
                var file = { name: path + "/" + x + '.json' };
                file.watcher = fs.watch(file.name, function(event) { lib.loadLocale(file.name) });
                core._localeFiles[x] = file;
                next2(d);
            });
        }, next, true);
    }, callback, true);
}

