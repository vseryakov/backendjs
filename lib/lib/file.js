/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const fs = require('fs');
const util = require('util');
const path = require('path');
const child = require("child_process");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const os = require("os");

// Safe path.normalize, no exceptions
lib.normalize = function(...args)
{
    try {
        return path.normalize(path.join.apply(path, args.map((x) => (typeof x == "string" ? x : String(x))))).replace(/\\/g, "/");
    } catch (e) {
        logger.error("lib.normalize:", e, args);
        return "";
    }
}

// Respawn throttling
lib.respawn = { interval: 3000, timeout: 2000, delay: 30000, count: 4, time: null, events: 0 };

/**
 * Call callback for each line in the file
 * options may specify the following parameters:
 * - sync - read file synchronously and call callback for every line
 * - abort - signal to stop processing
 * - limit - number of lines to process and exit
 * - length - amount of data in bytes to process and exit
 * - count - accumulate up to this number of lines in an array before sending a batch for processing
 * - batchsize - accumulate up to this size before sending a batch for processing
 * - skip - number of lines to skip from the start
 * - progress - if > 0 report how many lines processed so far every specified lines
 * - until - skip lines until this regexp matches
 * - ignore - skip lines that match this regexp
 * - header - if true then skip first line because it is the a header, if `options.header` it is a function
 *   it will be called with the first line as an argument and must return true if this line needs to be skipped
 * - json - each line represents an JSON object, convert and pass it to the line callback if not null
 * - split - split every line before calling the callback, it uses phraseSplit
 * - keepempty - by default is enabled if split is set to keep empty fields in the line array
 * - separator - a string with characters to be used for splitting, default is `,`
 * - rxLine - a Regexp for line splitting, default is `lib.rxLine`
 * - quotes - a string with characters to be used for phrase splitting, default is `"'`
 * - quiet - do not report about open file errors
 * - direct - to pass to lib.forEachLimit for true async processing
 * - concurrency - how many lines to process at the same time
 * - buflength - size of the internal buffer, 4096 default
 * - tail - if > 0 async version will keep trying to read from file after this number of ms
 *
 * Properties updated and returned in the options:
 * - nlines - number of lines read from the file
 * - nbytes - amount of data passed to line callback
 * - ncalls - number of lines/batches passed to the line callback
 * - npos - current position in the file
 * - nskip - number of lines skipped
 */
lib.forEachLine = function(file, options, lineCallback, endCallback)
{
    if (!options) options = {};
    if (options.sync) {
        lib.forEachLineSync(file, options, lineCallback);
        return lib.tryCall(endCallback, null, options);
    }

    options.nlines = options.ncalls = options.nbytes = options.nskip = 0;
    if (options.split) {
        options.keepempty = true;
        if (!options.separator) options.separator = ",";
    }

    var ctx = {
        file: file,
        fd: typeof file == "number" ? file : null,
        batch: options.count > 0 ? [] : null,
        bsize: 0,
        buffer: Buffer.alloc(options.buflength || 4096),
        data: "",
        pos: options.start > 0 ? options.start : null,
    };
    options.npos = ctx.pos || 0;

    lib.series([
        function(next) {
            if (ctx.fd === file) return next();
            fs.open(file, 'r', (err, fd) => {
                if (err && !options.quiet) logger.error('forEachLine:', file, err);
                ctx.fd = fd;
                next(err, options);
            });
        },
        function(next) {
            const start = Date.now();
            lib.readLines(ctx, options, lineCallback, (err) => {
                if (ctx.fd !== file) fs.close(ctx.fd, lib.noop);
                options.elapsed = Date.now() - start;
                next(err, options);
            });
        },
    ], endCallback, true);
}

// Process lines asynchronously, both callbacks must be provided
lib.readLines = function(ctx, options, lineCallback, endCallback)
{
    fs.read(ctx.fd, ctx.buffer, 0, ctx.buffer.length, ctx.pos, (err, nread) => {
        ctx.pos = null;
        ctx.nread = nread;
        options.npos += nread;
        var lines;
        if (nread) {
            ctx.data += ctx.buffer.slice(0, nread).toString(options.encoding || 'utf8');
            lines = ctx.data.split(options.rxLine || this.rxLine);
            if (ctx.data.endsWith("\n")) {
                ctx.data = "";
                lines.length--;
            } else {
                ctx.data = lines.pop();
            }
        }
        lib.forEachLimit(lines, options.concurrency, (line, next) => {
            function doNext(err) {
                return options.nlines % 100 ? next(err) : setImmediate(next, err);
            }
            options.nlines++;
            if (options.nlines == 1 && options.header) {
                if (typeof options.header != "function") return doNext();
                if (options.header(line)) return doNext();
            }
            if ((options.length && options.nbytes >= options.length) ||
                (options.limit && options.nlines > options.limit) ||
                (options.skip && options.nlines <= options.skip)) {
                options.nskip++;
                return doNext();
            }

            if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', ctx.file, options);

            line = line.trim();
            if (!line) {
                options.nskip++;
                return doNext();
            }

            // Skip lines until we see our pattern
            if (options.until && !options.until_seen) {
                options.until_seen = line.match(options.until);
                options.nskip++;
                return doNext();
            }
            if (options.ignore && options.ignore.test(line)) {
                options.nskip++;
                return doNext();
            }
            if (options.json) {
                if (line[0] != '{' && line[0] != '[') {
                    options.nskip++;
                    return doNext();
                }
                const obj = lib.jsonParse(line, options);
                if (!obj) {
                    options.nskip++;
                    return doNext();
                }
                options.nbytes += line.length;
                if (ctx.batch) ctx.batch.push(obj); else {
                    options.ncalls++;
                    return lineCallback(obj, doNext);
                }
            } else
            if (options.split) {
                const obj = lib.phraseSplit(line.trim(), options);
                if (!obj.length) {
                    options.nskip++;
                    return doNext();
                }
                options.nbytes += line.length;
                if (ctx.batch) ctx.batch.push(obj); else {
                    options.ncalls++;
                    return lineCallback(obj, doNext);
                }
            } else {
                options.nbytes += line.length;
                if (ctx.batch) ctx.batch.push(line); else {
                    options.ncalls++;
                    return lineCallback(line, doNext);
                }
            }
            ctx.bsize += line.length;
            if (!ctx.batch || (ctx.batch.length < options.count && (!options.batchsize || ctx.bsize < options.batchsize))) return doNext();

            options.ncalls++;
            lineCallback(ctx.batch, (err) => {
                ctx.batch = [];
                ctx.bsize = 0;
                doNext(err);
            }, ctx);
        }, (err) => {
            // Stop on reaching limit or end of file
            if (err || options.abort ||
                (options.length && options.nbytes >= options.length) ||
                (options.limit && options.nlines >= options.limit) ||
                (!options.tail && nread < ctx.buffer.length)) {
                if (err || !ctx.batch?.length) return endCallback(err);
                options.ncalls++;
                return lineCallback(ctx.batch, endCallback, ctx);
            }
            // Keep trying to read more after a delay
            if (options.tail && nread < ctx.buffer.length) {
                setTimeout(() => {
                    lib.readLines(ctx, options, lineCallback, endCallback)
                }, options.tail);
            } else {
                lib.readLines(ctx, options, lineCallback, endCallback);
            }
        }, options.direct);
    });
}

/**
 * Sync version of the `forEachLine`, read every line and call callback which may not do any async operations
 * because they will not be executed right away but only after all lines processed
 */
lib.forEachLineSync = function(file, options, lineCallback)
{
    if (!options) options = {};
    try {
        var fd = typeof file == "number" ? file : fs.openSync(file, 'r');
    } catch (err) {
        if (!options.quiet) logger.error('forEachLine:', file, err);
        return err;
    }

    options.nlines = options.ncalls = options.nbytes = options.nskip = 0;
    if (options.split) {
        options.keepempty = true;
        if (!options.separator) options.separator = ",";
    }

    const start = Date.now();
    const buffer = Buffer.alloc(options.buflength || 4096);
    var batch = options.count > 0 ? [] : null, bsize = 0;
    var pos = options.start > 0 ? options.pos : null;
    var data = "", lines;

    options.npos = pos || 0;

    while (!options.abort) {
        const nread = fs.readSync(fd, buffer, 0, buffer.length, pos);
        pos = null;
        lines = null;
        if (nread) {
            options.npos += nread;
            data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
            lines = data.split(options.rxLine || lib.rxLine);
            if (data.endsWith("\n")) {
                data = "";
                lines.length--;
            } else {
                data = lines.pop();
            }
        }

        for (let i = 0; i < lines.length; i++) {
            options.nlines++;
            if (!options.nlines == 1 && options.header) {
                if (typeof options.header != "function") continue;
                if (options.header(lines[i])) continue;
            }
            if ((options.length && options.nbytes >= options.length) ||
                (options.limit && options.nlines > options.limit) ||
                (options.skip && options.nlines <= options.skip)) {
                options.nskip++;
                continue;
            }

            if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', file, options);

            // Skip lines until we see our pattern
            if (options.until && !options.until_seen) {
                options.nskip++;
                options.until_seen = lines[i].match(options.until);
                continue;
            }
            if (options.ignore && options.ignore.test(lines[i])) {
                options.nskip++;
                continue;
            }
            if (options.json) {
                const obj = lib.jsonParse(lines[i], options);
                if (!obj) {
                    options.nskip++;
                    continue;
                }
                options.nbytes += lines[i].length;
                if (batch) batch.push(obj); else {
                    options.ncalls++;
                    lineCallback(obj);
                }
            } else
            if (options.split) {
                const line = lib.phraseSplit(lines[i].trim(), options);
                if (!line.length) {
                    options.nskip++;
                    continue;
                }
                options.nbytes += lines[i].length;
                if (batch) batch.push(line); else {
                    options.ncalls++;
                    lineCallback(line);
                }
            } else {
                const line = lines[i].trim();
                if (!line) {
                    options.nskip++;
                    continue;
                }
                options.nbytes += lines[i].length;
                if (batch) batch.push(line); else {
                    options.ncalls++;
                    lineCallback(line);
                }
            }
            bsize += lines[i].length;
            if (!batch || (batch.length < options.count && (!options.batchsize || bsize < options.batchsize))) continue;

            options.ncalls++;
            lineCallback(batch);
            batch = [];
            bsize = 0;
        }
        // Stop on reaching limit or end of file
        if (nread < buffer.length) break;
        if (options.length && options.nbytes >= options.length) break;
        if (options.limit && options.nlines >= options.limit) break;
    }
    if (batch?.length) {
        options.ncalls++;
        lineCallback(batch);
    }
    if (fd !== file) fs.close(fd, lib.noop);
    options.elapsed = Date.now() - start;
}

/**
 * Write given lines into a file, lines can be a string or list of strings or numbers
 * - size - rotate if the file is larger, keep 2 files
 * - ext - file ext to append on rotation, without dot, `old` is default, it can be in the `strftime` format to use date, like %w, %d, %m
 * - mode - open file mode, usually a or w
 * - newline - if true newlines are added for each line
 */
lib.writeLines = function(file, lines, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    lib.series([
        function(next) {
            if (!file) return next();
            fs.open(file, options?.mode || 'a', (err, fd) => {
                if (err) return next(err);
                if (typeof lines == "string") lines = [ lines ];
                lib.forEachSeries(lines, (line, next2) => {
                    if (typeof line != "string") line = String(line);
                    fs.write(fd, line + (options?.newline ? "\n" : ""), next2);
                }, (err) => {
                    fs.close(fd, lib.noop);
                    next(err);
                });
            });
        },
        function(next) {
            if (!file || !options?.size) return next();
            fs.stat(file, (err, st) => {
                if (err || st.size < options.size) return next(err);
                var ext = `${options?.ext || "old"}`;
                if (ext[0] == "%") ext = lib.strftime(Date.now(), ext);
                fs.rename(file, file + "." + ext, next);
            });
        },
    ], callback);
}

// Copy file and then remove the source, do not overwrite existing file
lib.moveFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function _copyIfFailed(err) {
        if (!err) return lib.tryCall(callback, null);
        lib.copyFile(src, dst, overwrite, (err2) => {
            if (!err2) {
                fs.unlink(src, (err) => { lib.tryCall(callback, err) });
            } else {
                lib.tryCall(callback, err2);
            }
        });
    }

    logger.debug('moveFile:', src, dst, overwrite);
    fs.stat(dst, (err) => {
        if (!err && !overwrite) return lib.tryCall(callback, lib.newError("File " + dst + " exists."));
        fs.rename(src, dst, _copyIfFailed);
    });
}

// Copy file, overwrite is optional flag, by default do not overwrite
lib.copyFile = function(src, dst, overwrite, callback)
{
    if (typeof overwrite == "function") callback = overwrite, overwrite = false;

    function _copyFile(err) {
        var ist, ost;
        if (!err && !overwrite) return lib.tryCall(callback, lib.newError("File " + dst + " exists."));
        fs.stat(src, (err2) => {
            if (err2) return lib.tryCall(callback, err2);
            ist = fs.createReadStream(src);
            ost = fs.createWriteStream(dst);
            ist.on('end', () => { lib.tryCall(callback) });
            ist.pipe(ost);
        });
    }
    logger.debug('copyFile:', src, dst, overwrite);
    fs.stat(dst, _copyFile);
}

/**
 * Non-exception version, returns empty object,
 * mtime is 0 in case file does not exist or number of seconds of last modified time
 * mdate is a Date object with last modified time
 */
lib.statSync = function(file)
{
    try {
        var stat = fs.statSync(file);
        stat.mdate = stat.mtime.toISOString();
        stat._mtime = stat.mtime.getTime();
        return stat;
    } catch (e) {
        if (e.code != "ENOENT") logger.error('statSync:', e, e.stack);
        return {
            size: 0,
            mdate: "",
            mtime: new Date(0),
            _mtime: 0,
            isFile: function() { return false },
            isSymbolicLink: function() { return false },
            isDirectory: function() { return false },
        };
    }
}

/**
 * Return contents of a file, empty if not exist or on error.
 *
 * Options can specify the format:
 * - cfg - parse file in config format, name=value per line, return a list of args
 * - json - parse file as JSON, return an object, in case of error an empty object
 * - xml - parse the file as XML, return an object
 * - list - split contents with the given separator
 * - encoding - file encoding when converting to string
 * - logger - log level for error messages
 * - missingok - if set ENOENT will not be logged
 * - offset - read from the position in the file, if negative the offset is from the end of file
 * - length - read only this much of the data, otherwise read till the end of file
 */
lib.readFileSync = function(file, options)
{
    if (!file) return "";
    var binary = options && options.encoding == "binary";
    try {
        var data = binary ? Buffer.from("") : "";
        var offset = this.toNumber(options && options.offset);
        var length = this.toNumber(options && options.length);
        if (offset || (offset === 0 && length > 0)) {
            var buf = Buffer.alloc(length > 0 ? Math.min(length, 4096) : 4096);
            var bufsize = buf.length;
            var fd = fs.openSync(file, "r");
            var size = fs.statSync(file).size;
            if (offset < 0) offset = Math.max(0, size + offset);
            while (offset < size) {
                var nread = fs.readSync(fd, buf, 0, bufsize, offset);
                if (nread <= 0) break;
                if (binary) {
                    data = Buffer.concat([data, buf.slice(0, nread)]);
                } else {
                    data += buf.slice(0, nread).toString(options.encoding || 'utf8');
                }
                offset += nread;
                if (length > 0) {
                    if (data.length >= length) break;
                    if (length - data.length < bufsize) bufsize = length - data.length;
                }
            }
            fs.closeSync(fd);
        } else {
            data = fs.readFileSync(file);
            if (!binary) data = data.toString(options && options.encoding ? options.encoding : "utf8");
        }
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.list) data = lib.strSplit(data, options.list); else
            if (options.cfg) data = lib.configParse(data, options);
        }
        return data;
    } catch (e) {
        if (options) {
            if (options.logger && !(options.missingok && e.code == "ENOENT")) logger.logger(options.logger, 'readFileSync:', file, e.stack);
            if (options.json) return {};
            if (options.list || options.cfg) return [];
        }
        return "";
    }
}

// Same as `lib.readFileSync` but asynchronous
lib.readFile = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var offset = this.toNumber(options && options.offset);
    var length = this.toNumber(options && options.length);
    var binary = options && options.encoding == "binary";
    var fd;

    function onError(err) {
        var data = "";
        if (options) {
            if (options.logger && !(options.missingok && err.code == "ENOENT")) logger.logger(options.logger, 'readFile:', file, err.stack);
            if (options.json) data = {};
            if (options.list || options.cfg) data = [];
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, err, data);
    }
    function onEnd(data) {
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.list) data = lib.strSplit(data, options.list); else
            if (options.cfg) data = lib.configParse(data, options);
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, null, data);
    }

    if (offset || (offset === 0 && length > 0)) {
        fs.open(file, 'r', function(err, handle) {
            if (err) return onError(err);
            fd = handle;
            var data = binary ? Buffer.from("") : "";
            var buf = Buffer.alloc(length > 0 ? Math.min(length, 4096) : 4096);
            var bufsize = buf.length;
            function onRead() {
                fs.read(fd, buf, 0, bufsize, offset, function(err, nread, buffer) {
                    if (nread <= 0) return onEnd(data);
                    if (binary) {
                        data = Buffer.concat([data, buffer.slice(0, nread)]);
                    } else {
                        data += buffer.slice(0, nread).toString(options && options.encoding || 'utf8');
                    }
                    if (nread < bufsize) return onEnd(data);
                    if (length > 0) {
                        if (data.length >= length) return onEnd(data);
                        if (length - data.length < bufsize) bufsize = length - data.length;
                    }
                    offset += nread;
                    onRead();
                });
            }
            if (offset < 0) {
                fs.fstat(fd, function(err, stats) {
                    if (err) return onError(err);
                    offset = Math.max(0, stats.size + offset);
                    onRead();
                });
            } else {
                onRead();
            }
        });
    } else {
        fs.readFile(file, function(err, data) {
            if (err) return onError(err);
            if (!binary) data = data.toString(options && options.encoding || 'utf8');
            onEnd(data);
        });
    }
}

// Filter function to be used in findFile methods
lib.findFilter = function(file, stat, options)
{
    if (!options) return 1;
    if (typeof options.filter == "function") return options.filter(file, stat);
    if (util.types.isRegExp(options.exclude) && options.exclude.test(file)) return 0;
    if (util.types.isRegExp(options.include) && !options.include.test(file)) return 0;
    if (options.types) {
        if (stat.isFile() && options.types.indexOf("f") == -1) return 0;
        if (stat.isDirectory() && options.types.indexOf("d") == -1) return 0;
        if (stat.isBlockDevice() && options.types.indexOf("b") == -1) return 0;
        if (stat.isCharacterDevice() && options.types.indexOf("c") == -1) return 0;
        if (stat.isSymbolicLink() && options.types.indexOf("l") == -1) return 0;
        if (stat.isFIFO() && options.types.indexOf("p") == -1) return 0;
        if (stat.isSocket() && options.types.indexOf("s") == -1) return 0;
    }
    return 1;
}

/**
 * Return list of files than match filter recursively starting with given path, dir is the starting path.
 *
 * The options may contain the following:
 *   - include - a regexp with file pattern to include
 *   - exclude - a regexp with file pattern to exclude
 *   - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
 *   - depth - if a number it specifies max depth to go into the subfolders, starts with 1
 *   - types - a string with types of files to include: d - a dir, f - a file, l - a symlink, c - char dev, b - block dev, s - socket, p - a FIFO
 *   - base - if set only keep base file name in the result, not full path
 *   - details - return the whole stat structure instead of just names
 *
 *  Example:
 *
 *        lib.findFileSync("modules/", { depth: 1, types: "f", include: /\.js$/ }).sort()
 */
lib.findFileSync = function(dir, options)
{
    var list = [];
    var level = arguments[2];
    if (typeof level != "number") level = 0;

    try {
        var stat = this.statSync(dir);
        var name = options?.base ? path.basename(dir) : dir;
        if (options?.details) stat.file = dir;

        if (stat.isFile()) {
            if (this.findFilter(name, stat, options)) {
                list.push(options?.details ? stat : name);
            }
        } else
        if (stat.isDirectory()) {
            if (this.findFilter(name, stat, options)) {
                list.push(options?.details ? stat: name);
            }
            // We reached our directory depth
            if (typeof options?.depth == "number" && level >= options.depth) return list;
            var files = fs.readdirSync(dir);
            for (var i in files) {
                list = list.concat(this.findFileSync(path.join(dir, files[i]), options, level + 1));
            }
        }
    } catch (e) {
        logger.error('findFileSync:', dir, options, e.stack);
    }
    return list;
}

// Async version of find file, same options as in the sync version, the starting dir is not included
lib.findFile = function(dir, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {}
    if (!Array.isArray(options.files)) options.files = [];

    var level = arguments[3];
    if (typeof level != "number") level = 0;
    if (typeof dir != "string") dir = "";

    fs.readdir(dir, (err, files) => {
        if (err) return lib.tryCall(callback, err, options.files);

        lib.forEachSeries(files, (file, next) => {
            if (options.done) return next();
            var full = path.join(dir, file);

            fs.stat(full, (err, stat) => {
                if (err) return next(err);
                if (options.details) stat.file = full;

                if (stat.isFile()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.details ? stat : options.base ? file : full);
                    }
                    next();
                } else
                if (stat.isDirectory()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.details ? stat : options.base ? file : full);
                    }
                    // We reached our directory depth
                    if (options && typeof options.depth == "number" && level >= options.depth) return next();
                    lib.findFile(full, options, next, level + 1);
                } else {
                    next();
                }
            });
        }, (err) => {
            lib.tryCall(callback, err, options.files);
        }, true);
    });
}

/**
 * Watch files in a dir for changes and call the callback, the parameters:
 * - root - a string with root path
 * - files - a regexp to watch files individually, if omitted watch the whole dir
 * - match - a regexp to watch files when using the whole dir, only for matched files the callback will be called
 * - ignore - a regexp to ignore files
 * - recursive - watch files in root subfolders
 * - depth - how deep to look for files in case of individual files
 */
lib.watchFiles = function(options, fileCallback, endCallback)
{
    logger.debug('watchFiles:', options);

    function watcher(event, file) {
        // Check stat if no file name, Mac OS X does not provide it
        fs.stat(file.file, (err, stat) => {
            if (err) return logger.error("watcher:", event, file.file, file.size, err);
            switch (event) {
            case "rename":
                file.watcher.close();
                file.watcher = fs.watch(file.file, (event) => { watcher(event, file); });
                break;
            default:
                if (stat.size == file.size && stat.mtime.getTime() == file.mtime.getTime()) return;
            }
            logger.log('watchFiles:', event, file.file, file.ino, stat.size, stat.mtime);
            for (const p in stat) file[p] = stat[p];
            fileCallback(file);
        });
    }

    var root = options.root;
    var ignore = options.ignore && lib.toRegexp(options.ignore) || null;

    if (options.files) {
        var opts = { details: 1, include: lib.toRegexp(options.files), exclude: ignore, depth: options.depth, types: options.types };
        lib.findFile(options.root, opts, (err, list) => {
            if (err) return lib.tryCall(endCallback, err);
            list.forEach((file) => {
                logger.debug('watchFiles:', file.file, file.ino, file.size);
                file.watcher = fs.watch(file.file, (event) => { watcher(event, file) });
            });
            lib.tryCall(endCallback, err, list);
        });
    } else {
        var match = options.match && lib.toRegexp(options.match) || null;
        try {
            fs.watch(root, { recursive: !!options.recursive }, (event, file) => {
                logger.dev('watcher:', event, root, file);
                file = path.join(root, file);
                if (ignore && ignore.test(file)) return;
                if (match && !match.test(file)) return;
                fs.stat(file, (err, stat) => {
                    if (err) return logger.error("watcher:", file, err);
                    logger.log('watchFiles:', event, file, stat.size, stat.mtime);
                    fileCallback({ name: file, stat: stat });
                });
            });
            lib.tryCall(endCallback);
        } catch (err) {
            lib.tryCall(endCallback, err);
        }
    }
}

// Recursively create all directories, return 1 if created or 0 on error or if exists, no exceptions are raised, error is logged only
lib.makePathSync = function(dir)
{
    try {
        fs.mkdirSync(path.normalize(dir), { recursive: true });
        return 1;
    } catch (e) {
        logger.error('makePathSync:', dir, e);
        return 0;
    }
}

// Async version of makePath, stops on first error
lib.makePath = function(dir, callback)
{
    fs.mkdir(path.normalize(dir), (err) => {
        if (err) logger.error('makePath:', err);
        lib.tryCall(callback, err);
    });
}

// Unlink a file, no error on non-existent file, callback is optional
lib.unlink = function(name, callback)
{
    fs.unlink(name, (err) => {
        if (err && err.code == "ENOENT") err = null;
        lib.tryCall(callback, err);
    });
}

// Recursively remove all files and folders in the given path, returns an error to the callback if any
lib.unlinkPath = function(dir, callback)
{
    fs.stat(dir, (err, stat) => {
        if (err) return lib.tryCall(callback, err);
        if (stat.isDirectory()) {
            fs.readdir(dir, (err, files) => {
                if (err) return lib.tryCall(callback, err);
                lib.forEachSeries(files, (f, next) => {
                    lib.unlinkPath(path.join(dir, f), next);
                }, (err) => {
                    if (err) return lib.tryCall(callback, err);
                    fs.rmdir(dir, callback);
                }, true);
            });
        } else {
            fs.unlink(dir, callback);
        }
    });
}

// Recursively remove all files and folders in the given path, stops on first error
lib.unlinkPathSync = function(dir)
{
    var files = this.findFileSync(dir);
    // Start from the end to delete files first, then folders
    for (var i = files.length - 1; i >= 0; i--) {
        try {
            var stat = this.statSync(files[i]);
            if (stat.isDirectory()) {
                fs.rmdirSync(files[i]);
            } else {
                fs.unlinkSync(files[i]);
            }
        } catch (e) {
            logger.error("unlinkPath:", dir, e);
            return 0;
        }
    }
    return 1;
}

/**
 * Change file owner, multiples files can be specified, do not report errors about non existent files, the uid/gid must be set to non-root user
 * for this function to work and it is called by the root only, all the rest of the arguments are used as files names
 *
 * Example:
 *
 *           lib.chownSync(1, 1, "/path/file1", "/path/file2")
 */
lib.chownSync = function(uid, gid)
{
    if (this.getuid() || !uid) return;
    for (var i = 2; i < arguments.length; i++) {
        var file = arguments[i];
        if (!file) continue;
        try {
            fs.chownSync(file, uid, gid);
        } catch (e) {
            if (e.code != 'ENOENT') logger.error('chownSync:', uid, gid, file, e);
        }
    }
}

// Return a list of matching processes, Linux only
lib.findProcess = function(options, callback)
{
    if (os.platform() == "linux") {
        lib.findFile("/proc", { include: /^\/proc\/[0-9]+$/, exclude: new RegExp("^/proc/" + process.pid + "$"), depth: 0, base: 1 }, (err, files) => {
            if (!err) {
                files = files.map((x) => ({ pid: x, cmd: lib.readFileSync(`/proc/${x}/cmdline`).replace(/\0/g," ").trim() })).
                        filter((x) => (options.filter ? x.cmd.match(options.filter) : x.cmd));
            }
            callback(err, files);
        });
    } else {
        lib.execProcess("/bin/ps agx -o pid,args", (err, stdout, stderr) => {
            var list = stdout.split("\n").
                              filter((x) => (lib.toNumber(x) != process.pid && (options.filter ? x.match(options.filter) : 1))).
                              map((x) => ({ pid: lib.toNumber(x), cmd: x.replace(/^[0-9]+/, "").trim() }));

            callback(err, list);
        });
    }
}

/**
 * Run the process and return all output to the callback, this a simple wrapper around child_processes.exec so the lib.runProcess
 * can be used without importing the child_processes module. All fatal errors are logged.
 * - options.merge if set append stdout to stderr and return combined single value separated by 2 newlines
 */
lib.execProcess = function(cmd, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    return child.exec(cmd, (err, stdout, stderr) => {
        logger.debug('execProcess:', cmd, err, stderr);
        if (options?.merge) {
            stdout = lib.toString(stderr) + "\n\n" + lib.toString(stdout);
            stderr = "";
        }
        lib.tryCall(callback, err, typeof stdout == "string" ? stdout : "", typeof stderr == "string" ? stderr : "");
    });
}
lib.aexecProcess = util.promisify(lib.execProcess.bind(lib));

/**
 * Run specified command with the optional arguments, this is similar to child_process.spawn with callback being called after the process exited
 *
 *  Example
 *
 *          lib.spawProcess("ls", "-ls", { cwd: "/tmp" }, lib.log)
 */
lib.spawnProcess = function(cmd, args, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd() };
    if (!options.stdio) options.stdio = "inherit";
    if (!Array.isArray(args)) args = [ args ];
    var proc = child.spawn(cmd, args, options);
    proc.on("error", function(err) {
        logger.error("spawnProcess:", cmd, args, err);
        lib.tryCall(callback, err);
    });
    proc.on('exit', function (code, signal) {
        logger.debug("spawnProcess:", cmd, args, "exit", code || signal);
        lib.tryCall(callback, code || signal);
    });
    return proc;
}
lib.aspawnProcess = util.promisify(lib.spawnProcess.bind(lib));

// If respawning too fast, delay otherwise call the callback after a short timeout
lib.checkRespawn = function(callback)
{
    if (this.exiting) return;
    var now = Date.now();
    logger.debug('checkRespawn:', this.respawn, now - this.respawn.time);
    if (this.respawn.time && now - this.respawn.time < this.respawn.interval) {
        if (this.respawn.count && this.respawn.events >= this.respawn.count) {
            logger.log('checkRespawn:', 'throttling for', this.respawn.delay, 'after', this.respawn.events, 'respawns');
            this.respawn.events = 0;
            this.respawn.time = now;
            return setTimeout(callback, this.respawn.delay);
        }
        this.respawn.events++;
    } else {
        this.respawn.events = 0;
    }
    this.respawn.time = now;
    setTimeout(callback, this.respawn.timeout);
}

/**
 * Run a series of commands, `cmds` is an object where a property name is a command to execute and the value is an array of arguments or null.
 * if `options.error` is 1, then stop on first error or if non-zero status on a process exit.
 *
 *  Example:
 *
 *          lib.spawnSeries({"ls": "-la",
 *                            "ps": "augx",
 *                            "du": { argv: "-sh", stdio: "inherit", cwd: "/tmp" },
 *                            "uname": ["-a"] },
 *                           lib.log)
 */
lib.spawnSeries = function(cmds, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd };
    this.forEachSeries(Object.keys(cmds), function(cmd, next) {
        var argv = cmds[cmd], opts = options;
        switch (lib.typeName(argv)) {
        case "null":
            argv = [];
            break;

        case "object":
            opts = argv;
            argv = opts.argv;
            break;

        case "array":
        case "string":
            break;

        default:
            logger.error("spawnSeries:", "invalid arguments", cmd, argv);
            return next(options.error ? lib.newError("invalid args", cmd) : null);
        }
        if (!options.stdio) options.stdio = "inherit";
        if (typeof argv == "string") argv = [ argv ];
        lib.spawnProcess(cmd, argv, opts, function(err) {
            next(options.error ? err : null);
        });
    }, callback);
}

lib.aspawnSeries = util.promisify(lib.spawnSeries.bind(lib));
