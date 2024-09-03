//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const os = require('os');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const db = require(__dirname + '/db');
const aws = require(__dirname + '/aws');

const mod = {
    name: "logwatcher",

    args: [
        { name: "pool", descr: "DB pool to keep track of positions for log files, default is local" },
        { name: "from", descr: "Email address to send logwatcher notifications from, for cases with strict mail servers accepting only from known addresses" },
        { name: "subject", descr: "Email subject template, all placeholders have access to the core module only" },
        { name: "interval", min: 0, type: "number", descr: "How often to check for errors in the log files in seconds, 0 to disable" },
        { name: "any-range", type: "number", min: 1, descr: "Number of lines for matched channel `any` to be attached to the previous matched channel, if more than this number use the channel `any` on its own" },
        { name: "matches-[a-z]+", obj: "matches", array: 1, descr: "Regexp patterns that match conditions for logwatcher notifications, this is in addition to default backend logger patterns, suffix defines the log channel to use, like error, warning.... Special channel `any` is reserved to send matched lines to the previously matched channel if within configured range. Example: `-logwatcher-match-error=^failed:` `-match-any=line:[0-9]+`" },
        { name: "send-[a-z]+", obj: "send", descr: "Email address or other supported transport for the logwatcher notifications, the monitor process scans system and backend log files for errors and sends them to this email address, if not specified no log watching will happen, each channel must define a transport separately, one of error, warning, info, all. Supported transports: table://TABLE, http://URL, sns://ARN, ses://EMAIL, email@addr. Example: `-logwatcher-send-error=help@error.com`" },
        { name: "ignore-[a-z]+", obj: "ignore", array: 1, descr: "Regexp with patterns that need to be ignored by the logwatcher process, it is added to the list of existing patterns for each specified channel separately" },
        { name: "once-[a-z0-9]+", obj: "once", array: 1, descr: "Regexp with patterns that need to be included only once by the logwatcher process, it is added to the list of existng patterns by tag to keep track each pattern separately, example: -logwatcher-once-restart 'restarting.+' -logwatcher-once-recon 'reconnecting:.+'" },
        { name: "files(-[a-z]+)?", obj: "files", type: "callback", callback: function(v,o) { if (v) this.files.push({ file: v, type: o.name }) }, descr: "Add a file to be watched by the logwatcher, it will use all configured match patterns" },
        { name: "save", type: "map", obj: "save", maptype: "auto", merge: 1, descr: "Save matched lines in local file, ex. file:filename, size:maxsize, ext:ext" },
        { name: "cw-run", type: "bool", descr: "Run AWS Cloudwatch logwatcher" },
        { name: "cw-filter", descr: "AWS Cloudwatch Logs filter pattern, only matched events will be returned and analyzed the the core logwatcher regexps" },
        { name: "cw-groups", type: "map", maptype: "str", descr: "List of AWS Cloudwatch Logs groups to watch for errors, format is: name:type,..." },
        { name: "cw-filters-(.+)", obj: "cw-filters", make: "$1", nocamel: 1, descr: "AWS Cloudwatch Logs filter pattern by group, overrides the global filter" },
        { name: "cw-matches-(.+)", obj: "cw-matches", make: "$1", type: "regexp", empty: 1, nocamel: 1, descr: "Logwatcher line regexp patterns by group, overrides default regexp patterns" },
    ],

    max: 1000000,
    interval: 0,
    anyRange: 5,
    send: {},
    ignore: {},
    once: {},
    save: { newline: 1, size: 1024*1024*100 },
    subject: "logwatcher: @counter@ @type@s: @hostname@/@ipaddr@/@instance.id@/@instance.tag@/@runMode@/@instance.region@",

    // Default patterns are for syslog and the logger format
    matches: {
        error: [ '\\]: (ERROR|ALERT|EMERG|CRIT): ' ],
        warning: [ '\\]: (WARNING|WARN): ' ],
    },

    // List of files to watch, every file is an object with the following properties:
    //   - file: absolute path to the log file - or -
    //   - name: name of the property in the core which hold the file path
    //   - ignore: a regexp with the pattern to ignore
    //   - match: a regexp with the pattern to match and report
    //   - type: channel if match is specified, otherwise it will go to the channel 'all'
    files: [
        { name: "logFile" },
        { name: "errFile", match: /.+/, type: "error" }
    ],

    cwGroups: {},
    cwFilters: {},
    cwMatches: {},
};
module.exports = mod;

mod.configureMaster = function(options, callback)
{
    // Log watcher job, always runs to allow turn on/off anytime
    this._interval = setInterval(this.run.bind(this), 30000);

    callback();
}

// Watch log files for errors and report via email or POST url
mod.run = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (this.running || !this.interval || Date.now() - this.mtime < this.interval * 1000) {
        return lib.tryCall(callback);
    }
    this.mtime = this.running = Date.now();

    this.prepare(options, (err, opts) => {
        this[this.cwRun ? "runCw" : "runLocal"](opts, (err) => {
            mod.running = 0;
            mod.notify(opts, callback);
        });
    });
}

mod.runLocal = function(options, callback)
{
    lib.forEach(this.files, (log, next) => {
        var file = log.file;
        if (!file && core[log.name]) file = core[log.name];
        if (!file) return next();

        fs.stat(file, (err, st) => {
            if (err) return next();
            // Last saved position, start from the end if the log file is too big or got rotated
            var pos = lib.toNumber(options.last_pos[file], { min: 0 });
            if (st.size - pos > this.max || pos > st.size) pos = st.size - this.max;

            fs.open(file, "r", (err, fd) => {
                if (err) return next();
                var buf = Buffer.alloc(this.max);
                fs.read(fd, buf, 0, buf.length, Math.max(0, pos), (err, nread, buffer) => {
                    fs.close(fd, function() {});
                    if (err || !nread) return next();

                    mod.match(options, buffer.slice(0, nread).toString().split("\n"), log);

                    if (options?.dryrun) return next();

                    // Save current size to start from next time
                    mod.save(file, st.size, () => (next()));
                });
            });
        });
    }, callback, true)
}

mod.runCw = function(options, callback)
{
    logger.debug('cwRun:', mod.name, this.cwGroups, this.cwFilter, options);

    lib.forEach(Object.keys(mod.cwGroups), (name, next) => {
        var q = {
            name: name,
            filter: typeof mod.cwFilters[name] != "undefined" ? mod.cwFilters[name] : mod.cwFilter,
            stime: lib.toNumber(options.last_pos[name]) || (Date.now() - 3600000),
            etime: Date.now(),
            timeout: options.interval,
        };
        aws.cwlFilterLogEvents(q, (err, rc) => {
            logger.debug('cwRun:', mod.name, err, q, "matches:", rc.events.length);
            if (err) return next();

            var log = mod.cwMatches[name] ? { match: mod.cwMatches[name], type: mod.cwGroups[name] } : null;
            var lines = rc.events.map((x) => (x.message));
            mod.match(options, lines, log);

            if (options?.dryrun) return next();

            mod.save(name, q.etime, () => {
                if (!mod.save?.file) return next();

                lib.writeLines(mod.save?.file, lines, mod.save, (err) => {
                    if (err) logger.error("cwRun:", mod.name, q, "save:", err);
                    next();
                });
            });
        });
    }, callback, true);
}

mod.prepare = function(options, callback)
{
    var opts = {
        dryrun: options.dryrun,
        ctime: Date.now(),
        interval: this.interval * 1000,
        match: {},
        ignore: {},
        once: {},
        seen: {},
        errors: {},
        counter: {},
        last_chan: "",
        last_line: 0,
        last_pos: {},
    };

    for (const p in this.matches) {
        const r = this.matches[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|");
        if (r) opts.match[p] = lib.toRegexp(r);
    }
    for (const p in this.ignore) {
        const r = this.ignore[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|")
        if (r) opts.ignore[p] = lib.toRegexp(r);
    }
    for (const p in this.once) {
        const r = this.once[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|");
        if (r) opts.once[p] = lib.toRegexp(r);
    }

    // Load all previous positions for every log file, we start parsing file from the previous last stop
    var qopts = { ops: { name: 'begins_with' }, fullscan: 1, count: 100, pool: this.pool || db.local };
    db.select("bk_property", { name: 'logwatcher:' }, qopts, (err, rows) => {
        if (options?.dryrun) rows = [];
        for (var i = 0; i < rows.length; i++) {
            opts.last_pos[rows[i].name.substr(11)] = rows[i].value;
        }
        logger.debug('prepare:', mod.name, err, opts);
        callback(err, opts);
    });
}

// Save current position for a log file
mod.save = function(file, pos, callback)
{
    db.put("bk_property", { name: 'logwatcher:' + file, value: pos }, { pool: this.pool || db.local }, (err) => {
        if (err) logger.error('save:', mod.name, file, err);
        lib.tryCall(callback, err);
    });
}

mod.match = function(options, lines, log)
{
    // Run over all regexps in the object, return channel name if any matched
    function matchObj(obj, line) {
        for (const p in obj) if (lib.testRegexp(line, obj[p])) return p;
        return "";
    }

    lines = lib.isArray(lines, []);
    for (var i = 0; i < lines.length; i++) {
        // Skip local or global ignore list first
        if (log && lib.testRegexp(lines[i], log.ignore) || matchObj(options.ignore, lines[i])) {
            if (!options.errors.ignore) options.errors.ignore = "";
            options.errors.ignore += "\n\n" + lines[i] + "\n";
            lib.objIncr(options.counter, "ignore");

            while (i < lines.length -1 && (lines[i + 1][0] == ' ' || lines[i + 1][0] == '\t')) {
                options.errors.ignore += lines[++i] + "\n";
            }
            logger.debug("match:", mod.name, "ignore", log, "LINE:", lines[i]);
            continue;
        }

        // Match both global or local filters
        var chan = log && lib.testRegexp(lines[i], log.match) ? (log.type || "all") : "";
        if (!chan) chan = matchObj(options.match, lines[i]);
        if (chan) {
            // Skip if already in the log
            var tag = matchObj(options.once, lines[i]);
            if (tag && lib.objIncr(options.seen, tag) > 1) chan = null;
        }
        logger.debug("match:", mod.name, chan || "none", log, "LINE:", lines[i]);

        if (chan) {
            // Attach to the previous channel, for cases when more error into like backtraces are matched with
            // a separate pattern. If no channel previously matched use any as the channel itself.
            chan = chan == "any" && i - options.last_line <= mod.anyRange ? (options.last_chan || "any") : chan;
            if (!options.errors[chan]) options.errors[chan] = "";
            options.errors[chan] += "\n\n" + lines[i] + "\n";
            lib.objIncr(options.counter, chan);

            // Add all subsequent lines starting with a space or tab, those are continuations of the error or stack traces
            while (i < lines.length -1 && (lines[i + 1][0] == ' ' || lines[i + 1][0] == '\t')) {
                options.errors[chan] += lines[++i] + "\n";
            }
        }
        options.last_chan = chan;
        options.last_line = i;
    }
}

mod.notify = function(options, callback)
{
    var errors = options.errors || {};
    var once = options.once || {};
    var seen = options.seen || {};
    // From address, use current hostname
    if (!this.from) this.from = "logwatcher@" + core.domain;

    lib.forEvery(lib.objKeys(errors), (type, next) => {
        if (lib.isEmpty(errors[type])) return next();

        logger.log('notify:', mod.name, type, options.counter[type], 'matches found, sending to', mod.send[type]);
        var uri = mod.send[type];
        if (!uri) return next();

        var text = errors[type];
        for (const p in seen) {
            if (seen[p] > 1) text += `\n\n-- Pattern "${once[p]}"" detected ${seen[p]} times but shown only once.`;
        }
        var subject = lib.toTemplate(mod.subject, [{ type: type, hostname: os.hostname(), counter: options.counter[type] }, core]);
        var d = uri.match(/^([a-z]+:\/\/)?(.+)/);
        switch (d[1]) {
        case "console://":
            if (typeof console[d[2]] == "function") console[d[2]](subject + "\n" + text);
            next();
            break;

        case "logger://":
            logger.logger(d[2], subject, text);
            next();
            break;

        case "file://":
            fs.appendFile(d[2], text, next);
            break;

        case "db://":
            db.add(d[2], {
               mtime: Date.now(),
               type: type,
               ipaddr: core.ipaddr,
               host: os.hostname(),
               instance_id: core.instance.id,
               instance_tag: core.instance.tag,
               instance_region: core.instance.region,
               run_mode: core.runMode,
               data: subject + "\n" + text
            }, (err) => {
               if (err) logger.info("send:", mod.name, err);
               next()
            });
            break;

        case "http://":
        case "https://":
            core.sendRequest({ url: uri,
                  headers: {
                     "content-type": "text/plain",
                     "bk-type": type,
                     "bk-ipaddr": core.ipaddr,
                     "bk-host": os.hostname(),
                     "bk-instance-id": core.instance.id,
                     "bk-instance-tag": core.instance.tag,
                     "bk-instance-region": core.instance.region,
                     "bk-run-mode": core.runMode,
                  },
                  method: "POST",
                  retryCount: 3,
                  retryOnError: 1,
                  retryTimeout: 3000,
                  postdata: subject + "\n" + text
            }, (err) => {
                 if (err) logger.info("notify:", mod.name, err);
                 next()
            });
            break;

        case "sns://":
            aws.snsPublish(d[2], subject + "\n" + text, { subject: subject }, (err) => {
                if (err) logger.info("notify:", mod.name, err);
                next()
            });
            break;

        default:
            core.sendmail({ from: mod.from, to: d[2], subject: subject, text: text }, (err) => {
                if (err) logger.info("notify:", mod.name, err);
                next()
            });
        }
    }, callback);
}
