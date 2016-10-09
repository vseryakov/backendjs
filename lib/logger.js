//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var os = require("os");
var bksyslog = require("bkjs-syslog");

// Simple logger utility for debugging
var logger = {
    level: 1,
    file: null,
    stream: process.stdout,
    writable: true,
    filters: null,

    levels: { test: 5, dev: 4, debug: 3, info: 2, notice: 1, log: 1, warn: 0, error: -1, none: -1 },

    // syslog facilities
    LOG_KERN: (0<<3),
    LOG_USER: (1<<3),
    LOG_MAIL: (2<<3),
    LOG_DAEMON: (3<<3),
    LOG_AUTH: (4<<3),
    LOG_SYSLOG: (5<<3),
    LOG_LPR: (6<<3),
    LOG_NEWS: (7<<3),
    LOG_UUCP: (8<<3),
    LOG_CRON:  (9<<3),
    LOG_AUTHPRIV: (10<<3),
    LOG_FTP: (11<<3),
    LOG_LOCAL0: (16<<3),
    LOG_LOCAL1: (17<<3),
    LOG_LOCAL2: (18<<3),
    LOG_LOCAL3: (19<<3),
    LOG_LOCAL4: (20<<3),
    LOG_LOCAL5: (21<<3),
    LOG_LOCAL6: (22<<3),
    LOG_LOCAL7: (23<<3),

    // syslog options for openlog
    LOG_PID: 0x01,
    LOG_CONS: 0x02,
    LOG_ODELAY: 0x04,
    LOG_NDELAY: 0x08,
    LOG_NOWAIT: 0x10,
    LOG_PERROR: 0x20,
    LOG_RFC3339: 0x10000,

    // syslog priorities
    LOG_EMERG: 0,
    LOG_ALERT: 1,
    LOG_CRIT: 2,
    LOG_ERROR: 3,
    LOG_WARNING: 4,
    LOG_NOTICE: 5,
    LOG_INFO: 6,
    LOG_DEBUG: 7,

    syslogMap: {},
    syslogLevels: {},
    syslogFacilities: {},

    // Registered custom levels
    modules: {}
}

module.exports = logger;

// Default options, can be set directly only so thi smodule does not have any dependencies
logger.options = logger.LOG_PID | logger.LOG_CONS | (os.type() == "Linux" ? logger.LOG_RFC3339 : 0);
logger.facility = logger.LOG_LOCAL0;

// Logger labels
for (var p in logger.levels) logger[p.toUpperCase()] = logger.levels[p];

// Register a custom level handler, must be invoked via `logger.logger` only, if no handler registered for given level
// the whole message will be logger as an error. The custom hadnler is called in the context of the module which means
// the options are available inside the handler.
//
// The following properties are supported automatically:
// - format - if 1 then all arguments will be formatted into one line as for the regular levels and passed
//    the handler as one argument, this is to support different transport and preserve the same standard logging format
//
logger.registerLevel = function(level, callback, options)
{
    if (typeof callback != "function") return;
    this.modules[level] = { name: level, callback: callback, options: options || {} };
}

logger.pad = function(n)
{
    if (n >= 0 && n < 10) return "0" + n
    return n
}

logger.prefix = function(level)
{
    var d = new Date()
    return d.getFullYear() + "-" +
           this.pad(d.getMonth()+1) + "-" +
           this.pad(d.getDate()) + " " +
           this.pad(d.getHours()) + ":" +
           this.pad(d.getMinutes()) + ":" +
           this.pad(d.getSeconds()) + "." +
           this.pad(d.getMilliseconds()) +
           " [" + process.pid + "] " +
           level + ": "
}

// Set or close syslog mode
logger.setSyslog = function (on)
{
    if (on) {
        bksyslog.open("backend", this.options, this.facility);
        this.print = this.printSyslog;
        // Initialize map for facilities
        this.syslogLevels = { test: this.LOG_DEBUG, dev: this.LOG_DEBUG, debug: this.LOG_DEBUG, warn: this.LOG_WARNING,
                              notice: this.LOG_NOTICE, info: this.LOG_INFO, error: this.LOG_ERROR,
                              emerg: this.LOG_EMERG, alert: this.LOG_ALERT, crit: this.LOG_CRIT };
        this.syslogFacilities = { kern: this.LOG_KERN, user: this.LOG_USER, mail: this.LOG_MAIL,
                                  daemon: this.LOG_DAEMON, auth: this.LOG_AUTH, syslog: this.LOG_SYSLOG,
                                  lpr: this.LOG_LPR, news: this.LOG_NEWS, uucp: this.LOG_UUCP,
                                  cron: this.LOG_CRON, authpriv: this.LOG_AUTHPRIV,
                                  ftp: this.LOG_FTP, local0: this.LOG_LOCAL0, local1: this.LOG_LOCAL1,
                                  local2: this.LOG_LOCAL2, local3: this.LOG_LOCAL3, local4: this.LOG_LOCAL4,
                                  local5: this.LOG_LOCAL5, local6: this.LOG_LOCAL6, local7: this.LOG_LOCAL7 };
        this.syslogMap = {}
        Object.keys(this.syslogLevels).forEach(function(l) {
           Object.keys(logger.syslogFacilities).forEach(function(f) {
               logger.syslogMap[l + ':' + f] = logger.syslogLevels[l] | logger.syslogFacilities[f];
           });
        });
    } else {
        bksyslog.close();
        this.print = this.printStream;
    }
    this.syslog = on;
}

// Redirect logging into file
logger.setFile = function(file)
{
    if (this.stream && this.stream != process.stdout) {
        this.stream.destroySoon();
    }
    this.file = file;
    if (this.file) {
        this.stream = fs.createWriteStream(this.file, { flags: 'a' });
        this.stream.on('error', function(err) {
            process.stderr.write(String(err));
            logger.stream = process.stderr;
        });
        // Make sure the log file is owned by regular user to avoid crashes due to no permission of the log file
        if (process.getuid() == 0) {
            fs.chown(file, core.uid, core.gid, function(err) { logger.error(file, e) });
        }
    } else {
        this.stream = process.stdout;
    }
    this.setSyslog(0);
}

// Set the output level, it can be a number or one of the supported level names
logger.setLevel = function(level)
{
    this.level = typeof this.levels[level] != "undefined" ? this.levels[level] : isNaN(parseInt(level)) ? 0 : parseInt(level);
}

// Enable debugging level for this label, if used with the same debugging level it will be printed regardless of the global level,
// a label is first argument to the `logger.debug` methods, it is used as is, usually the fist argument is
// the current function name with comma, like `logger.debug("select:", name, args)`
logger.setDebugFilter = function(str)
{
    String(str).split(",").forEach(function(x) {
        x = x.trim();
        switch (x[0]) {
        case '-':
            if (x == "-") logger.filters = null;
            if (!logger.filters) break;
            delete logger.filters[x.substr(1)];
            if (!Object.keys(logger.filters).length) logger.filters = null;
            break;
        case '+':
            if (!logger.filters) logger.filters = {};
            logger.filters[x.substr(1)] = 1;
            break;
        }
    });
}

// syslog allows facility to be specified after log level like info:local0 for LOG_LOCAL0
logger.printSyslog = function(level, msg)
{
    var code = this.syslogMap[level];
    bksyslog.send(code || this.LOG_NOTICE, (code ? "" : level + ": ") + msg);
}

logger.printStream = function(level, msg)
{
    this.stream.write(this.prefix(level) + msg + "\n");
}

logger.printError = function()
{
    process.stderr.write(this.prefix("ERROR") + this.format(arguments) + "\n");
}

logger.log = function()
{
    if (this.level < this.NOTICE) return;
    this.print('NOTICE', this.format(arguments));
}
logger.notice = logger.log;

logger.info = function()
{
    if (this.level < this.INFO) return;
    this.print('INFO', this.format(arguments));
}

logger.dev = function()
{
    if (this.level < this.DEV) return;
    this.print('DEV', this.format(arguments));
}

logger.warn = function()
{
    if (this.level < this.WARN) return;
    this.print('WARN', this.format(arguments));
}

logger.debug = function()
{
    if (this.level < this.DEBUG && (!this.filters || !this.filters[arguments[0]])) return;
    this.print('DEBUG', this.format(arguments));
}

logger.error = function()
{
    this.print('ERROR', this.format(arguments));
}

logger.dump = function()
{
    this.stream.write(util.format.apply(this, arguments).replace(/[ \r\n\t]+/g, " ") + "\n");
}

logger.format = function(args)
{
    var str = "";
    for (var p in args) if (typeof args[p] != "undefined") str += util.inspect(args[p], { depth: 5 }) + " ";
    return str.replace(/\\n/g,' ').replace(/[ \\\r\n\t]+/g, " ");
}

// Print stack backtrace as error
logger.trace = function()
{
    var err = new Error('');
    err.name = 'Trace';
    Error.captureStackTrace(err, arguments.callee);
    this.error(util.format.apply(this, arguments), err.stack);
}

// A generic logger method, safe, first arg is supposed to be a logging level, if not valid the error level is used
logger.logger = function()
{
    var mod = this.modules[arguments[0]];
    if (mod) {
        var args = Array.prototype.slice.apply(arguments).slice(1)
        mod.callback.apply(mod, mod.options.format ? this.format(args) : args);
    } else {
        (this[arguments[0]] || this.error).apply(this, Array.prototype.slice.apply(arguments).slice(1));
    }
}

// Default write handler
logger.print = function()
{
    this.printStream.apply(this, arguments);
}

// Stream emulation
logger.write = function(str)
{
    if (str) this.log(str);
    return true;
}

logger.end = function(str)
{
    if (str) this.log(str);
}
