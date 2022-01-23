//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const os = require('os');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

core.describeArgs("core", [
    { name: "logwatcher-pool", descr: "DB pool to keep track of positions for log files, default is local" },
    { name: "logwatcher-mod", descr: "Alternative module to be used for watching logs, it must have the `watchLogs` method, if no such method defined there the logwatcher does not run at all" },
    { name: "logwatcher-from", descr: "Email address to send logwatcher notifications from, for cases with strict mail servers accepting only from known addresses" },
    { name: "logwatcher-subject", descr: "Email subject template, all placeholders have access to the core module only" },
    { name: "logwatcher-interval", type: "number", min: 5, descr: "How often to check for errors in the log files in seconds" },
    { name: "logwatcher-any-range", type: "number", min: 1, descr: "Number of lines for matched channel `any` to be attached to the previous matched channel, if more than this number use the channel `any` on its own" },
    { name: "logwatcher-match-[a-z]+", obj: "logwatcher-match", array: 1, descr: "Regexp patterns that match conditions for logwatcher notifications, this is in addition to default backend logger patterns, suffix defines the log channel to use, like error, warning.... Special channel `any` is reserved to send matched lines to the previously matched channel if within configured range. Example: `-logwatcher-match-error=^failed:` `-logwatcher-match-any=line:[0-9]+`" },
    { name: "logwatcher-send-[a-z]+", obj: "logwatcher-send", descr: "Email address or other supported transport for the logwatcher notifications, the monitor process scans system and backend log files for errors and sends them to this email address, if not specified no log watching will happen, each channel must define a transport separately, one of error, warning, info, all. Supported transports: table://TABLE, http://URL, sns://ARN, ses://EMAIL, email@addr. Example: `-logwatcher-send-error=help@error.com`" },
    { name: "logwatcher-ignore-[a-z]+", obj: "logwatcher-ignore", array: 1, descr: "Regexp with patterns that need to be ignored by the logwatcher process, it is added to the list of existing patterns for each specified channel separately" },
    { name: "logwatcher-once-[a-z0-9]+", obj: "logwatcher-once", array: 1, descr: "Regexp with patterns that need to be included only once by the logwatcher process, it is added to the list of existng patterns by tag to keep track each pattern separately, example: -logwatcher-once-restart 'restarting.+' -logwatcher-once-recon 'reconnecting:.+'" },
    { name: "logwatcher-file(-[a-z]+)?", obj: "logwatcher-file", type: "callback", callback: function(v,o) { if (v) this.logwatcherFile.push({ file: v, type: o.name }) }, descr: "Add a file to be watched by the logwatcher, it will use all configured match patterns" },
]);

// Log watcher config, define different named channels for different patterns, email notification can be global or per channel
core.logwatcherMax = 1000000;
core.logwatcherInterval = 300;
core.logwatcherAnyRange = 5;
core.logwatcherSend = {};
core.logwatcherIgnore = {};
core.logwatcherOnce = {};
core.logwatcherSubject = "logwatcher: @counter@ @type@s: @hostname@/@ipaddr@/@instance.id@/@instance.tag@/@runMode@/@instance.region@";

// Default patterns are for syslog and the logger format
core.logwatcherMatch = {
    error: [ '\\]: (ERROR|ALERT|EMERG|CRIT): ' ],
    warning: [ '\\]: (WARNING|WARN): ' ],
};

// List of files to watch, every file is an object with the following properties:
//   - file: absolute pth to the log file - or -
//   - name: name of the property in the core which hold the file path
//   - ignore: a regexp with the pattern to ignore
//   - match: a regexp with the pattern to match and report
//   - type: channel if match is specified, otherwise it will go to the channel 'all'
core.logwatcherFile = [
    { file: "/var/log/messages" },
    { name: "logFile" },
    { name: "errFile", match: /.+/, type: "error" }
];

// Watch log files for errors and report via email or POST url, see config parameters starting with `logwatcher-` about how this works
core.watchLogs = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (this.logwatcherRunning || Date.now() - this.logwatcherMtime < this.logwatcherInterval * 1000) return lib.tryCall(callback);
    this.logwatcherMtime = this.logwatcherRunning = Date.now();

    // Use an alterntive method if exists or skip
    if (this.logwatcherMod) {
        var mod = core.modules[this.logwatcherMod];
        if (!mod || typeof mod.watchLogs != "function") {
            this.logwatcherRunning = 0;
            return lib.tryCall(callback);
        }
        return mod.watchLogs(options, (err, rc) => {
            this.logwatcherRunning = 0;
            lib.tryCall(callback, err, rc);
        });
    }

    this.watchLogsInit(options, (err, opts) => {
        logger.debug('watchLogs:', core.name, err, opts);

        // For every log file
        lib.forEach(core.logwatcherFile, (log, next) => {
            var file = log.file;
            if (!file && core[log.name]) file = core[log.name];
            if (!file) return next();

            fs.stat(file, (err, st) => {
                if (err) return next();
                // Last saved position, start from the end if the log file is too big or got rotated
                var pos = lib.toNumber(opts.last_pos[file], { min: 0 });
                if (st.size - pos > core.logwatcherMax || pos > st.size) pos = st.size - core.logwatcherMax;

                fs.open(file, "r", (err, fd) => {
                    if (err) return next();
                    var buf = Buffer.alloc(core.logwatcherMax);
                    fs.read(fd, buf, 0, buf.length, Math.max(0, pos), (err, nread, buffer) => {
                        fs.close(fd, function() {});
                        if (err || !nread) return next();

                        core.watchLogsMatch(opts, buffer.slice(0, nread).toString().split("\n"), log);

                        if (options && options.dryrun) return next();

                        // Save current size to start from next time
                        core.watchLogsSave(file, st.size, () => (next()));
                    });
                });
            });
        }, function(err) {
            core.logwatcherRunning = 0;
            core.watchLogsSend(opts, callback);
        });
    });
}

core.watchLogsInit = function(options, callback)
{
    var opts = {
        ctime: Date.now(),
        interval: this.logwatcherInterval * 1000,
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

    for (const p in this.logwatcherMatch) {
        const r = this.logwatcherMatch[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|");
        if (r) opts.match[p] = lib.toRegexp(r);
    }
    for (const p in this.logwatcherIgnore) {
        const r = this.logwatcherIgnore[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|")
        if (r) opts.ignore[p] = lib.toRegexp(r);
    }
    for (const p in this.logwatcherOnce) {
        const r = this.logwatcherOnce[p].filter((x) => (x)).map((x) => ("(" + x + ")")).join("|");
        if (r) opts.once[p] = lib.toRegexp(r);
    }
    // Load all previous positions for every log file, we start parsing file from the previous last stop
    var qopts = { ops: { name: 'begins_with' }, fullscan: 1, count: 100, pool: this.logwatcherPool || this.modules.db.local };
    this.modules.db.select("bk_property", { name: 'logwatcher:' }, qopts, (err, rows) => {
        if (options && options.dryrun) rows = [];
        for (var i = 0; i < rows.length; i++) {
            opts.last_pos[rows[i].name.substr(11)] = rows[i].value;
        }
        callback(err, opts);
    });
}

// Save current position for a log file
core.watchLogsSave = function(file, pos, callback)
{
    this.modules.db.put("bk_property", { name: 'logwatcher:' + file, value: pos }, { pool: this.logwatcherPool || this.modules.db.local }, function(err) {
        if (err) logger.error('watchLogsSave:', file, err);
        lib.tryCall(callback, err);
    });
}

core.watchLogsMatch = function(options, lines, log)
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
            logger.debug("watchLogsMatch:", "ignore", log, "LINE:", lines[i]);
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
        logger.debug("watchLogsMatch:", chan || "none", log, "LINE:", lines[i]);
        if (chan) {
            // Attach to the previous channel, for cases when more error into like backtraces are matched with
            // a separate pattern. If no channel previously matched use any as the channel itself.
            chan = chan == "any" && i - options.last_line <= core.logwatcherAnyRange ? (options.last_chan || "any") : chan;
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

core.watchLogsSend = function(options, callback)
{
    var errors = options.errors || {};
    var once = options.once || {};
    var seen = options.seen || {};
    // From address, use current hostname
    if (!this.logwatcherFrom) this.logwatcherFrom = "logwatcher@" + this.domain;

    lib.forEvery(lib.objKeys(errors), function(type, next) {
        if (lib.isEmpty(errors[type])) return next();
        logger.log('watchLogs:', type, options.counter[type], 'matches found, sending to', core.logwatcherSend[type]);
        var uri = core.logwatcherSend[type];
        if (!uri) return next();
        var text = errors[type];
        for (const p in seen) {
            if (seen[p] > 1) text += `\n\n-- Pattern "${once[p]}"" detected ${seen[p]} times but shown only once.`;
        }
        var subject = lib.toTemplate(core.logwatcherSubject, [{ type: type, hostname: os.hostname(), counter: options.counter[type] }, core]);
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
        case "table://":
            core.modules.db.add(d[2], {
               mtime: Date.now(),
               type: type,
               ipaddr: core.ipaddr,
               host: os.hostname(),
               instance_id: core.instance.id,
               instance_tag: core.instance.tag,
               instance_region: core.instance.region,
               run_mode: core.runMode,
               data: subject + "\n" + text
            }, function(err) {
               if (err) logger.info("watchLogs:", err);
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
            }, function(err) {
                 if (err) logger.info("watchLogs:", err);
                 next()
            });
            break;

        case "sns://":
            core.modules.aws.snsPublish(d[2], subject + "\n" + text, { subject: subject }, function(err) {
                if (err) logger.info("watchLogs:", err);
                next()
            });
            break;

        case "ses://":
            core.modules.aws.sesSendEmail(d[2], subject, text, { from: core.logwatcherFrom }, function(err) {
                if (err) logger.info("watchLogs:", err);
                next()
            });
            break;

        default:
            core.sendmail({ from: core.logwatcherFrom, to: d[2], subject: subject, text: text }, function(err) {
                if (err) logger.info("watchLogs:", err);
                next()
            });
        }
    }, function(err) {
        lib.tryCall(callback, err, options);
    });
}
