//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const os = require('os');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

// Watch log files for errors and report via email or POST url, see config parameters starting with `logwatcher-` about how this works
core.watchLogs = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Use an alterntive method if exists or skip
    if (this.logwatcherMod) {
        var mod = core.modules[this.logwatcherMod];
        return mod && typeof mod.watchLogs == "function" ? mod.watchLogs(options, callback): lib.tryCall(callback);
    }

    this.logwatcherMtime = Date.now();
    logger.debug('watchLogs:', options, this.logwatcherSend, this.logwatcherFile);

    this.watchLogsInit(options, (err,opts) => {

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
            core.watchLogsSend(opts, callback);
        });
    });
}

core.watchLogsInit = function(options, callback)
{
    var opts = { match: {}, ignore: {}, once: {}, seen: {}, errors: {}, last_chan: "", last_line: 0, last_pos: {} };

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
    this.modules.db.select("bk_property", { name: 'logwatcher:' }, { ops: { name: 'begins_with' }, pool: this.modules.db.local }, (err, rows) => {
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
    this.modules.db.put("bk_property", { name: 'logwatcher:' + file, value: pos }, { pool: this.modules.db.local }, function(err) {
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
            options.errors.ignore += lines[i] + "\n";
            while (i < lines.length -1 && (lines[i + 1][0] == ' ' || lines[i + 1][0] == '\t')) {
                options.errors.ignore += lines[++i] + "\n";
            }
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
        if (chan) {
            // Attach to the previous channel, for cases when more error into like backtraces are matched with
            // a separate pattern. If no channel previously matched use any as the channel itself.
            chan = chan == "any" && i - options.last_line <= core.logwatcherAnyRange ? (options.last_chan || "any") : chan;
            if (!options.errors[chan]) options.errors[chan] = "";
            options.errors[chan] += lines[i] + "\n";
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
        logger.log('watchLogs:', type, 'found matches, sending to', core.logwatcherSend[type]);
        var uri = core.logwatcherSend[type];
        if (!uri) return next();
        var text = errors[type];
        for (const p in seen) {
            if (seen[p] > 1) text += `\n\n-- Pattern "${once[p]}"" detected ${seen[p]} times but shown only once.`;
        }
        var subject = "logwatcher: " + type + ": " + os.hostname() + "/" + core.ipaddr + "/" + core.instance.id + "/" + core.instance.tag + "/" + core.runMode + "/" + core.instance.region;
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
        lib.tryCall(callback, err, options.errors);
    });
}
