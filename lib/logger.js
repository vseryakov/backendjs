/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
 * @module logger
 */

const util = require('node:util');
const fs = require('node:fs');
const os = require("node:os");
const syslog = require(__dirname + "/logger/syslog");

const logger =

/**
 * Logging utility
 *
 * Default mode is to use util.inspect and output to stdout
 *
 * Syslog mode can log to local or remote syslog with customizable facility and level
 *
 * JSON mode will output an object with predefined properties first then the rest will be put inside the data array
 * ```js
 *{"level":"LOG","date":"2026-05-10T18:22:16.066Z","now":1778437336066,"role":"node","pid":71942, "data": ["shutdownServer:", "api", "node", "server", "closed"] }
 * ```
 *
 * @example
 * logger.setLevel("info")
 * logger.log("log")             // visible
 * logger.info("info")           // visible
 * logger.debug("debug")         // not visible
 * logger.error("error")         // visible
 *
 * logger.setLevel("debug")
 * logger.debug("debug")         // visible
 *
 * logger.setLevel("info")
 * logger.setDebugFilter("custom")
 * logger.debug("debug")         // still not visible
 * logger.debug("custom")        // visible
 */

module.exports = {

    name: "logger",

    /**
     * @var {int} - current logging level, can be set via $BKJS_LOG_LEVEL
     * @default 0(WARN)
     */
    level: 0,

    /** @var {object} - levels sorted by priorities: ERROR, WARN, LOG, INFO, DEBUG, DEV */
    levels: { DEV: 4, DEBUG: 3, INFO: 2, LOG: 1, WARN: 0, ERROR: -1, NONE: -2 },

    /**
     * @var {object} - debugging filters enabled, can be set via $BKJS_LOG_FILTER
     */
    filters: {},

    /**
     * @var {string} - concat argumenrs with this separator @default
     * @default space
     */
    separator: " ",

    /**
     * @var {boolean} - if true newlines will be replaced with spaces,
     * @default false
     */
    oneline: false,

    /**
     * @var {boolean} - if true the outout will be a JSON object
     * @default false
     */
    json: false,

    /**
     * @var {object} - defaults for util.inspect
     */
    inspectArgs: {
        depth: 15,
        breakLength: Number.POSITIVE_INFINITY,
        maxStringLength: 1500,
    },

    /**
     * @var {string} - default date format is $BKJS_LOG_DATE or local or iso or utc or none
     * @default iso
     */
    date: env(process.env.BKJS_LOG_DATE) || "iso",

    /**
     * @var {string} - pid is $BKJS_LOG_PID or the current process pid
     * @default process.pid
     */
    pid: env(process.env.BKJS_LOG_PID) || process.pid,

    /** @var {string} - default tag is $BKJS_LOG_TAG if present */
    tag: env(process.env.BKJS_LOG_TAG) || undefined,

    /** @var {string} - default role is $BKJS_LOG_ROLE if present */
    role: env(process.env.BKJS_LOG_ROLE) || undefined,

    file: null,
    stream: process.stdout,
    writable: true,
    // Registered custom levels
    modules: {},
    _syslog: {},
}

function pad(n) { return n > 9 ? n : '0' + n }

function env(v) { return typeof v === "string" && v.startsWith("$BKJS_") ? process.env[v.substr(1)] : v }

function date(d) {
    switch (logger.date) {
    case "none":
        return "";
    case "local":
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds())} `;
    case "utc":
        return new Date().toUTCString();
    default:
        return new Date().toISOString();
    }
}

function pid() {
    switch (logger.pid) {
    case 0:
    case "0":
    case false:
    case "false":
    case "":
    case null:
    case undefined:
        return "";
    default:
        return `[${logger.pid}]:`;
    }
}

function tag() {
    if (logger.tag && logger.role) return logger.tag + "." + logger.role;
    return logger.tag || logger.role || "";
}


/**
 * Close logger
 */
logger.shutdown = function(_options, callback)
{
    logger.setSyslog(0);
    if (logger.stream && logger.stream !== process.stdout) {
        logger.stream.destroySoon();
        logger.stream = process.stdout;
    }
    typeof callback === "function" && callback();
}

/**
 * Install a custom inspector with options
 * @param {function} inspect - function to output
 * @param {object} [inspectArgs]
 * @memberof module:logger
 * @method setInspect
 */
logger.setInspect = function(inspect, inspectArgs)
{
    if (typeof inspect === "function") {
        logger._inspect = inspect;
        logger._inspectArgs = inspectArgs;
    } else {
        logger._inspect = util.inspect;
        logger._inspectArgs = logger.inspectArgs;
    }
}

logger.setInspect();

/**
 * Register a custom level handler, must be invoked via `logger.logger` only, if no handler registered for given level
 * the whole message will be logger as an error. The custom handler is called in the context of the module which means
 * the options are available inside the handler.
 * @param {string} level - custom log level
 * @param {function} callback - call it for this level
 * @param {Object} [options]
 * @memberof module:logger
 * @method registerLevel
 */
logger.registerLevel = function(level, callback, options)
{
    if (typeof callback !== "function") return;
    logger.modules[level] = { name: level, callback, options };
}

/**
 * Redirect logging into a file, disables syslog
 * @param {string} file
 * @memberof module:logger
 * @method setFile
 * @example
 * logger.setFile('var/log/error.log')
 */
logger.setFile = function(file)
{
    if (logger.stream && logger.stream !== process.stdout) {
        logger.stream.destroySoon();
    }
    logger.file = file;
    if (logger.file) {
        logger.stream = fs.createWriteStream(logger.file, { flags: 'a' });
        logger.stream.on('error', (err) => {
            process.stderr.write(String(err));
            logger.stream = process.stderr;
        });
    } else {
        logger.stream = process.stdout;
    }
    logger.setSyslog(0);
}

/**
 * Enable or close syslog mode
 * @param {int|string} facility - syslog facility as a number or remote syslog server:, nullish value will disable syslog
 * @example
 * logger.setSyslog('unix://')
 * logger.setSyslog('udp://host?tag=app')
 * logger.setSyslog('tcp://host:514?facility=LOG_LOCAL0')
 *
 * // Back to console output
 * logger.setSyslog()
 *
 * @memberof module:logger
 * @method setSyslog
 */
logger.setSyslog = function(facility)
{
    if (facility === 1 || facility === true || (typeof facility === "string" && facility.includes(":"))) {
        const opts = Object.assign({ tag: this.tag }, this._syslog);

        if (typeof facility === "string" && facility !== 1) {
            const h = URL.parse(facility);
            if (h) {
                if (h.protocol === "udp:") opts.udp = 1;
                if (h.protocol === "unix:") opts.udp = 1, opts.path = "/dev/log";
                if (h.pathname) opts.path = h.pathname;
                if (h.hostname) opts.host = h.hostname;
                if (h.port) opts.port = h.port;
                for (const [key, val] of h.searchParams) opts[key] = val;
            }
        } else {
            // Use defaults per platform
            if (os.platform() === "linux") {
                opts.udp = 1;
                opts.path = "/dev/log";
            }
        }
        if (!opts.port && !opts.path) {
            opts.port = 514;
        }
        if (logger.syslog) {
            if (logger.syslog.udp === opts.udp && logger.syslog.path === opts.path &&
                logger.syslog.host === opts.host && logger.syslog.port === opts.port) return;
            logger.syslog.close();
        }
        logger.syslog = new syslog.Syslog(opts);
        logger.print = logger.printSyslog;
        logger.syslog.open();
    } else {
        logger.print = logger.printStream;
        if (logger.syslog) logger.syslog.close();
        logger.syslog = undefined;
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
 * @param {date} [options.date] - date format: `local, iso, utc`
 * @param {boolean} [options.oneline] - replace newlines if true
 * @param {boolean} [options.json] - enable JSON mode, each entry will be an Array
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
        const v = options[p];
        switch (p) {
        case "filter":
            logger.setDebugFilter(v);
            break;

        case "level":
            logger.setLevel(v);
            break;

        case "oneline":
        case "separator":
        case "json":
            logger[p] = v;
            break;

        case "tag":
        case "role":
            logger[p] = logger._syslog[p] = env(v);
            break;

        case "pid":
        case "date":
            logger[p] = env(v);
            break;

        default:
            if (p.startsWith("syslog-")) {
                logger._syslog[p.substr(7)] = env(v);
            }
        }
    }
    if (logger.syslog) {
        logger.syslog.setOptions(logger._syslog);
    }
}

/**
 * Set the output level, it can be a number or one of the supported level names,
 * on invalid level then `WARN` is set
 * @param {stream} level
 * @memberof module:logger
 * @method setLevel
 */
logger.setLevel = function(level)
{
    level = typeof level === "string" ? level.toUpperCase() : level;
    logger.level = logger.levels[level] !== undefined ? logger.levels[level] :
                   Number.
                   isNaN(Number.parseInt(level)) ? 0 : Number.parseInt(level);
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
        if (x === "null") {
            logger.filters = {};
        } else
        if (x[0] === "!" || x[0] === "-") {
            delete logger.filters[x.substr(1)];
        } else {
            if (x[0] === '+') x = x.substr(1);
            logger.filters[x] = handler || 1;
        }
    });
}

logger.checkDebugFilter = function(args)
{
    const filter = logger.filters[args[0]] || logger.filters[args[1]];
    if (typeof filter !== "function") return filter;
    filter.apply(logger, ...args);
}

logger.printSyslog = function(level, args)
{
    logger.syslog.log(0, logger.inspect(level, args));
}

logger.printStream = function(level, args)
{
    logger.stream.write(logger.inspect(level, args));
}

logger.print = logger.printStream.bind(logger);


/**
 * Log with LOG level
 * @param {...any} args
 * @memberof module:logger
 * @method log
 */
logger.log = function(...args)
{
    if (logger.level < logger.levels.LOG) return;
    logger.print("LOG", args);
}

/**
 * Log with INFO level
 * @param {...any} args
 * @memberof module:logger
 * @method info
 */

logger.info = function(...args)
{
    if (logger.level < logger.levels.INFO && !logger.checkDebugFilter(args)) return;
    logger.print('INFO', args);
}

/**
 * Log with WARN level
 * @param {...any} args
 * @memberof module:logger
 * @method warn
 */

logger.warn = function(...args)
{
    if (logger.level < logger.levels.WARN) return;
    logger.print('WARN', args);
}

/**
 * Log with DEBUG level, enabled debug filter will be logged if matched
 * @param {...any} args
 * @memberof module:logger
 * @method debug
 */

logger.debug = function(...args)
{
    if (logger.level < logger.levels.DEBUG && !logger.checkDebugFilter(args)) return;
    logger.print('DEBUG', args);
}

/**
 * Log with DEV level
 * @param {...any} args
 * @memberof module:logger
 * @method dev
 */

logger.dev = function(...args)
{
    if (logger.level < logger.levels.DEV && !logger.checkDebugFilter(args)) return;
    logger.print('DEV', args);
}

/**
 * Log with ERROR level
 * @param {...any} args
 * @memberof module:logger
 * @method error
 */

logger.error = function(...args)
{
    logger.print('ERROR', args);
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

/**
 * Raw output using util.format
 * @memberof module:logger
 * @method dump
 */
logger.dump = function(...args)
{
    logger.stream.write(util.formatWithOptions.apply(this, [this.inspectArgs, ...args]).replace(/[ \r\n\t]+/g, " ") + "\n");
}

/**
 * Print stack backtrace as error
 * @memberof module:logger
 * @method trace
 */
logger.trace = function(...args)
{
    const err = new Error('Trace');
    err.name = 'Trace';
    Error.captureStackTrace(err, logger.trace);
    logger.error(...args.concat(err.stack));
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
    if (typeof level === "string") level = level.trim().toLowerCase();
    var mod = logger.modules[level];
    if (logger[level]) {
        logger[level](...args);
    } else
    if (mod) {
        mod.callback.call(mod, ...args);
    } else {
        logger.error(level, ...args);
    }
}

function _jsonInspect(obj, options)
{
    try {
        return JSON.stringify(obj, (key, value) => {
            if (util.types.isNativeError(value)) {
                return Object.getOwnPropertyNames(value).reduce((a, b) => { a[b] = value[b]; return a }, {});
            }
            if (options?.ignore?.test(key)) return ;
            return value;
        })
    } catch (_e) {
        return ;
    }
}

/**
 * Called by logger methods to perform input formatting and cleaning, calls default or installed inspector
 * @param {string} level - current logging level
 * @param {any[]} args - items to output
 * @returns {string} - formatted output
 * @memberof module:logger
 * @method inspect
 */
logger.inspect = function(level, args)
{
    var list = [];
    var d = new Date();
    var arg, line;

    for (const i in args) {
        arg = args[i];
        if (arg === undefined) continue;
        if (logger.json) {
            line = _jsonInspect(arg, logger._inspectArgs);
        } else {
            line = logger._inspect(arg, logger._inspectArgs);
        }
        if (line === undefined || line === "") continue;

        if (logger.oneline) {
            line = line.replace(/[\r\n\t]+| {2,}/g, " ");
        }
        list.push(line);
    }

    if (logger.syslog) {
        return list.join(logger.separator);
    }

    if (logger.json) {
        return JSON.stringify({
            level,
            date: date(d),
            now: d.getTime(),
            tag: logger.tag || undefined,
            role: logger.role || undefined,
            pid: logger.pid || undefined
        }).slice(0, -1) + ', "data": [' + list.join(", ") + "] }\n";
    }

    return `${date(d)} ${tag()}${pid()} ${level}: ` + list.join(logger.separator) + "\n";
}

// Stream emulation
logger.write = function(str)
{
    if (str) logger.log(str);
    return true;
}

logger.end = function(str)
{
    if (str) logger.log(str);
}

if (process.env.BKJS_LOG_LEVEL) {
    logger.setLevel(process.env.BKJS_LOG_LEVEL);
}
if (process.env.BKJS_LOG_FILTER) {
    logger.setDebugFilter(process.env.BKJS_LOG_FILTER);
}
