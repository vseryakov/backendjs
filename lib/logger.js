/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module logger
 */

const util = require('util');
const fs = require('fs');
const os = require("os");
const syslog = require(__dirname + "/logger/syslog");

// Simple logger utility for debugging
const logger = {
    name: "logger",
    level: process.env.BKJS_LOG_LEVEL || 1,
    levels: { test: 5, dev: 4, debug: 3, info: 2, notice: 1, log: 1, warn: 0, error: -1, none: -2 },
    file: null,
    stream: process.stdout,
    writable: true,
    filters: {},
    oneline: true,
    separator: " ",
    inspectArgs: {
        showHidden: true,
        depth: 15,
        breakLength: Infinity,
        maxStringLength: 1024,
    },
    date: env(process.env.BKJS_LOG_DATE) || "datetime",
    pid: env(process.env.BKJS_LOG_PID) || process.pid,
    tag: env(process.env.BKJS_LOG_TAG) || "",

    // Registered custom levels
    modules: {},
    _syslog: {},
}

/**
 * Logging utility
 */
module.exports = logger;

function pad(n) { return n > 9 ? n : '0' + n }

function env(v) { return typeof v == "string" && v.startsWith("$BKJS_") ? process.env[v.substr(1)] : v }

// Logger labels
for (const p in logger.levels) logger[p.toUpperCase()] = logger.levels[p];

/**
 * Register a custom level handler, must be invoked via `logger.logger` only, if no handler registered for given level
 * the whole message will be logger as an error. The custom hadnler is called in the context of the module which means
 * the options are available inside the handler.
 * @param {string} level - custom log level
 * @param {function} callback - call it for this level
 * @param {Object} [options]
 * @param {boolean} [options.format] - if true then all arguments will be formatted into one line as for the regular levels and passed
 *    the handler as one argument, this is to support different transport and preserve the same standard logging format
 * @memberof module:logger
 * @method registerLevel
 */
logger.registerLevel = function(level, callback, options)
{
    if (typeof callback != "function") return;
    this.modules[level] = { name: level, callback, options };
}

/**
 * Build message prefix, depends on the options: date(1), pid(process.pid), tag(""),
 * can be set via setOptions, by default
 * - date is $BKJS_LOG_DATE or datetime or iso or utc or none
 * - pid is $BKJS_LOG_PID or current process pid
 * - tag is $BKJS_LOG_TAG
 * @param {string} level
 * @memberof module:logger
 * @method prefix
 */
logger.prefix = function(level)
{
    var date = "";
    switch (this.date) {
    case "datetime":
        var d = new Date();
        date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds())} `;
        break;

    case "iso":
        date = new Date().toISOString() + " ";
        break;

    case "utc":
        date = new Date().toUTCString() + " ";
        break;
    }
    var pid = "";
    switch (this.pid) {
    case 0:
    case "0":
    case "":
        if (this.tag) pid = " ";
        break;
    default:
        pid = `[${this.pid}]: `;
    }
    return `${date}${this.tag}${pid}${level}: `;
}

/**
 * Enable or close syslog mode
 * @param {int|string} facility - syslog facility as a number or remote syslog server:
 * @example
 * unix://
 * udp://host?tag=app
 * tcp://host:514?facility=LOG_LOCAL0
 *
 * @memberof module:logger
 * @method setSyslog
 */
logger.setSyslog = function(facility)
{
    if (facility == 1 || facility === true || (typeof facility == "string" && facility.includes(":"))) {
        var opts = Object.assign({ tag: this.tag }, this._syslog);

        if (typeof facility == "string" && facility != 1) {
            var h = URL.parse(facility);
            if (h) {
                if (h.protocol == "udp:") opts.udp = 1;
                if (h.protocol == "unix:") opts.udp = 1, opts.path = "/dev/log";
                if (h.pathname) opts.path = h.pathname;
                if (h.hostname) opts.host = h.hostname;
                if (h.port) opts.port = h.port;
                for (const [key, val] of h.searchParams) opts[key] = val;
            }
        } else {
            // Use defaults per platform
            if (os.platform() == "linux") {
                opts.udp = 1;
                opts.path = "/dev/log";
            }
        }
        if (!opts.port && !opts.path) opts.port = 514;
        if (this.syslog) {
            if (this.syslog.udp == opts.udp && this.syslog.path == opts.path &&
                this.syslog.host == opts.host && this.syslog.port == opts.port) return;
            this.syslog.close();
        }
        this.syslog = new syslog.Syslog(opts);
        this.print = this.printSyslog;
        this.syslog.open();
    } else {
        this.print = this.printStream;
        if (this.syslog) this.syslog.close();
        delete this.syslog;
    }
}

/**
 * Special options for logger to override defaults, syslog options must start with `syslog-`
 * For tag, date, pid values may refer to other env variables if start with $, like BKJS_LOG_TAG='$BKJS_TAG'
 * @param {Object} options
 * @param {string} [options.filter] - debug filters
 * @param {string} [options.level] - set current level
 * @param {string} [options.tag] - syslog tag
 * @param {int} [options.pid] - process id
 * @param {date} [options.date] - date format: `datetime, iso, utc`
 * @param {string} [options.syslog-hostname] - syslog hostname to use
 * @param {string} [options.syslog-facility] - syslog hostname to use
 * @param {boolean} [options.syslog-bsd] - syslog version
 * @param {boolean} [options.syslog-rfc5424] - syslog version
 * @param {boolean} [options.syslog-rfc3164] - syslog version
 *
 * @memberof module:logger
 * @method setOptions
 */
logger.setOptions = function(options)
{
    for (const p in options) {
        var v = options[p];
        switch (p) {
        case "filter":
            this.setDebugFilter(v);
            break;

        case "level":
            this.setLevel(v);
            break;

        case "tag":
            this[p] = this._syslog[p] = env(v);
            break;

        case "pid":
        case "date":
            this[p] = env(v);
            break;

        default:
            if (p.startsWith("syslog-")) {
                this._syslog[p.substr(7)] = env(v);
            }
        }
    }
    if (this.syslog) {
        this.syslog.setOptions(this._syslog);
    }
}

/**
 * Redirect logging into a file
 * @param {string} file
 * @memberof module:logger
 * @method setFile
 */
logger.setFile = function(file)
{
    if (this.stream && this.stream != process.stdout) {
        this.stream.destroySoon();
    }
    this.file = file;
    if (this.file) {
        this.stream = fs.createWriteStream(this.file, { flags: 'a' });
        this.stream.on('error', (err) => {
            process.stderr.write(String(err));
            logger.stream = process.stderr;
        });
    } else {
        this.stream = process.stdout;
    }
    this.setSyslog(0);
}

/**
 * Set the output level, it can be a number or one of the supported level names
 * @param {stream} level
 * @memberof module:logger
 * @method setLevel
 */
logger.setLevel = function(level)
{
    this.level = typeof this.levels[level] != "undefined" ? this.levels[level] : isNaN(parseInt(level)) ? 0 : parseInt(level);
}

/**
 * Enable debugging level for this label, if used with the same debugging level it will be printed regardless of the global level,
 * a label is first argument to the `logger.debug` methods, it is used as is, usually the fist argument is
 * the current function name with comma, like `logger.debug("select:", name, args)`
 * @param {string} label - label(s) to debug, can be a comma separated list
 * @param {function] handler - can be a function to be used instead of regular logging, this is for rerouting some output to a custom console or for
 * dumping the actual Javascript data without preformatting, most useful to use `console.log`
 * @memberof module:logger
 * @method setDebugFilter
 */
logger.setDebugFilter = function(label, handler)
{
    String(label).split(",").forEach((x) => {
        x = x.trim();
        if (!x) return;
        if (x == "null") {
            logger.filters = {};
        } else
        if (x[0] == "!" || x[0] == "-") {
            delete logger.filters[x.substr(1)];
        } else {
            if (x[0] == '+') x = x.substr(1);
            logger.filters[x] = handler || 1;
        }
    });
}

logger.checkDebugFilter = function(args)
{
    const filter = this.filters[args[0]] || this.filters[args[1]];
    if (typeof filter != "function") return filter;
    filter.apply(this, args);
}

logger.printSyslog = function(level, msg)
{
    this.syslog.log(0, level + ": " + msg);
}

logger.printStream = function(level, msg)
{
    this.stream.write(this.prefix(level) + msg + "\n");
}

logger.print = logger.printStream.bind(logger);

logger.printError = function()
{
    process.stderr.write(this.prefix("ERROR") + this.format(arguments) + "\n");
}

/**
 * Log with NOTICE level
 * @param {...any} args
 * @memberof module:logger
 * @method log
 */
logger.log = function()
{
    if (this.level < this.NOTICE) return;
    this.print('NOTICE', this.format(arguments));
}
logger.notice = logger.log;

/**
 * Log with INFO level
 * @param {...any} args
 * @memberof module:logger
 * @method info
 */

logger.info = function()
{
    if (this.level < this.INFO && !this.checkDebugFilter(arguments)) return;
    this.print('INFO', this.format(arguments));
}

/**
 * Log with WARN level
 * @param {...any} args
 * @memberof module:logger
 * @method warn
 */

logger.warn = function()
{
    if (this.level < this.WARN) return;
    this.print('WARN', this.format(arguments));
}

/**
 * Log with DEBUG level, enabled debug filter will be logged if matched
 * @param {...any} args
 * @memberof module:logger
 * @method debug
 */

logger.debug = function()
{
    if (this.level < this.DEBUG && !this.checkDebugFilter(arguments)) return;
    this.print('DEBUG', this.format(arguments));
}

/**
 * Log with DEV level
 * @param {...any} args
 * @memberof module:logger
 * @method dev
 */

logger.dev = function()
{
    if (this.level < this.DEV && !this.checkDebugFilter(arguments)) return;
    this.print('DEV', this.format(arguments));
}

/**
 * Log with ERROR level
 * @param {...any} args
 * @memberof module:logger
 * @method error
 */

logger.error = function()
{
    this.print('ERROR', this.format(arguments));
}

/**
 * Log with NONE level, no-op
 * @param {...any} args
 * @memberof module:logger
 * @method none
 */

logger.none = function()
{
}

logger.dump = function()
{
    this.stream.write(util.formatWithOptions.apply(this, [this.inspectArgs, ...arguments]).replace(/[ \r\n\t]+/g, " ") + "\n");
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

/**
 * Print stack backtrace as error
 * @memberof module:logger
 * @method trace
 */
logger.trace = function()
{
    var err = new Error('');
    err.name = 'Trace';
    Error.captureStackTrace(err, logger.trace);
    this.error(util.format.apply(this, arguments), err.stack);
}

/**
 * A generic logger method, safe, first arg is supposed to be a logging level, if not valid the error level is used
 * @param {string} level - logging level, can be one of the default levels or custom one registered with {registerLevel}
 * @param {...any} args - arguments to log
 * @memberof module:logger
 * @method logger
 */
logger.logger = function(level, ...args)
{
    if (typeof level == "string") level = level.trim().toLowerCase();
    var mod = this.modules[level];
    if (mod) {
        mod.callback.apply(mod, mod.options?.format ? this.format(args) : args);
    } else
    if (this[level]) {
        this[level].apply(this, args);
    } else {
        this.error.apply(this, [level, ...args]);
    }
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
