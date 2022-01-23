//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const fs = require('fs');
const os = require("os");
const bksyslog = require("bkjs-syslog");

// Simple logger utility for debugging
var logger = {
    name: "logger",
    level: process.env.BKJS_LOGLEVEL || 1,
    file: null,
    stream: process.stdout,
    writable: true,
    filters: null,
    oneline: true,
    separator: " ",
    inspectArgs: { depth: 10, breakLength: Infinity },

    levels: { test: 5, dev: 4, debug: 3, info: 2, notice: 1, log: 1, warn: 0, error: -1, none: -2 },

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
    LOG_CRON: (9<<3),
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
for (const p in logger.levels) logger[p.toUpperCase()] = logger.levels[p];

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
           this.pad(d.getDate()) + "T" +
           this.pad(d.getHours()) + ":" +
           this.pad(d.getMinutes()) + ":" +
           this.pad(d.getSeconds()) + "." +
           this.pad(d.getMilliseconds()) +
           " [" + process.pid + "]: " +
           level + ": "
}

// Set or close syslog mode
logger.setSyslog = function(facility)
{
    if (facility) {
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
        facility = this.syslogFacilities[facility] || this.facility;
        this.print = this.printSyslog;
        bksyslog.open("backend", this.options, facility);
    } else {
        bksyslog.close();
        this.print = this.printStream;
    }
    this.syslog = facility;
}

// Redirect logging into file
logger.setFile = function(file, options)
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
        if (process.getuid() == 0 && options && options.uid) {
            fs.chown(file, options.uid, options.gid || 0, function(err) { logger.error(file, err) });
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
        if (x == "null") {
            logger.filters = null;
        } else
        if (x[0] == "!" || x[0] == "-") {
            if (logger.filters) {
                delete logger.filters[x.substr(1)];
                if (!Object.keys(logger.filters).length) logger.filters = null;
            }
        } else {
            if (x[0] == '+') x = x.substr(1);
            if (!logger.filters) logger.filters = {};
            logger.filters[x] = 1;
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

logger.warn = function()
{
    if (this.level < this.WARN) return;
    this.print('WARN', this.format(arguments));
}

logger.debug = function()
{
    if (this.level < this.DEBUG && !(this.filters && (this.filters[arguments[0]] || this.filters[arguments[1]]))) return;
    this.print('DEBUG', this.format(arguments));
}

logger.dev = function()
{
    if (this.level < this.DEV && !(this.filters && (this.filters[arguments[0]] || this.filters[arguments[1]]))) return;
    this.print('DEV', this.format(arguments));
}

logger.error = function()
{
    this.print('ERROR', this.format(arguments));
}

logger.none = function()
{
}

// Prints the given error and the rest of the arguments, the logger level to be used is determined for the given error by code,
// uses `options` or `options.logger_error` as the level if a string,
// - if `options.logger_error` is an object, extract the level by `err.code` or use `*` as the default level for not matched codes,
// the default is to use the `error` level.
// - In case the level is notice or info the error will only show status/code/message properties in order not to print stack trace
// - Merge `options.logger_inspect` if present with the current inspect options to log the rest of arguments.
logger.errorWithOptions = function(err, options)
{
    if (err && options) {
        var log = typeof options == "string" ? options:
                  options.quiet ? "debug" :
                  typeof options.logger_error == "string" ? options.logger_error :
                  typeof options.logger_error == "object" ? options.logger_error[err.code] || options.logger_error["*"] :
                  err.status >= 200 && err.status < 300 ? "info" :
                  "error";
        var e = log == "notice" || log == "info" ? { status: err.status, code: err.code, message: err.message } : err;
        if (options.logger_inspect) this.setInspectOptions(options.logger_inspect);
        (this[log] || this.error).apply(this, Array.prototype.slice.apply(arguments).slice(2).map((x) => (x === err ? e : x)));
        delete this._inspectArgs;
    } else {
        this.print('ERROR', this.format(arguments));
    }
}

logger.dump = function()
{
    this.stream.write(util.format.apply(this, arguments).replace(/[ \r\n\t]+/g, " ") + "\n");
}

logger.inspect = function(obj, options)
{
    var str = util.inspect(obj, options || this.inspectArgs);
    return this.oneline ? str.replace(/\\n/g,' ').replace(/[ \\\r\n\t]+/g, " ") : str.replace(/\\n/g, "\n");
}

// Merge with existing inspect options temporarily, calling without options will reset to previous values
logger.setInspectOptions = function(options)
{
    if (options) {
        this._inspectArgs = {};
        for (const p in this.inspectArgs) this._inspectArgs[p] = this.inspectArgs[p];
        for (const p in options) this._inspectArgs[p] = options[p];
    } else {
        delete this._inspectArgs;
    }
}

logger.format = function(args, options)
{
    var str = "";
    for (const p in args) {
        if (typeof args[p] == "undefined") continue;
        str += this.inspect(args[p], options || this._inspectArgs) + this.separator;
    }
    return str;
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
logger.logger = function(level, ...args)
{
    if (typeof level == "string") level = level.trim().toLowerCase();
    var mod = this.modules[level];
    if (mod) {
        mod.callback.apply(mod, mod.options.format ? this.format(args) : args);
    } else {
        (this[level] || this.error).apply(this, args);
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
