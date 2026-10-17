/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const fs = require('node:fs');
const util = require('node:util');
const path = require('node:path');
const stream = require('node:stream');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * Removes invalid characters `..` and ` % : \ \x0 - \x1F, \x7F` to eliminate traversal errors but may result in completely
 * non-existent path or empty string.
 *
 * First arg is assumed but not enforced to be the root and trusted and resolved to the absolute path beforehand.
 *
 * @param {...any} args - concat all parts using path.join after sanitizing each part, non-strings are ignored
 * @return {string} sanitized and normalized path or empty string
 * @memberof module:lib
 * @method sanitizePath
 * @example
 * > lib.sanitizePath("/usr/www/root", "../%2e%2e//../etc/......./\r\necho/./pas\1swd\00.0\x00.exe")
 * '/usr/www/root/2e2e/etc/......./echo/passwd.0.exe'
 */
lib.sanitizePath = function(...args)
{
    try {
        return path.normalize(path.join(...args.map((x) => lib.isString(x).replace(lib.rxSanitizePath, ""))))
    } catch (e) {
        logger.error("sanitizePath:", e, lib.stringify(args));
    }
    return "";
}

/**
 * Validate very strictly given paths for invalid characters `..` and ` % : \ \x0 - \x1F, \x7F`,
 * return undefined on any invalid character or non-string, if all good join and normalize.
 * @param {...string} args - concat all parts using path.join after checking each part
 * @return {string|undefined} validated normalied path or undefined on error
 * @memberof module:lib
 * @method sanitizePath
 * @example
 * > lib.validatePath("/usr/www/root", "../%2e%2e//../etc/......./\r\necho/./pas\1swd\00.0\x00.exe")
 * undefined
 *
 * > lib.validatePath("/usr/www/root", "my/file.txt")
 * `/usr/www/root/my/file.txt`
 */
lib.validatePath = function(...args)
{
    if (args.find(x => (typeof x !== "string" || lib.rxSanitizePath.test(x)))) return;

    try {
        return path.normalize(path.join(...args));
    } catch (e) {
        logger.error("validatePath:", e, args);
    }
    return;
}

/**
 * Call callback for each line in the file options may specify the following parameters:
 * @param {string} file
 * @param {object} options
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
 * - keep_empty - by default is enabled if split is set to keep empty fields in the line array
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
 * @param {function} lineCallback
 * @param {function} [endCallback]
 * @memberof module:lib
 * @method forEachLine
 * @example
 * lib.forEachLine("file.csv" , { split: 1 }, (line, next) => {
 *     console.log(line[0], line[1]);
 * }, lib.log)
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
        options.keep_empty = true;
        if (!options.separator) options.separator = ",";
    }

    const ctx = {
        file,
        fd: typeof file === "number" ? file : null,
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
    fs.read(ctx.fd, ctx.buffer, 0, ctx.buffer.length, ctx.pos, (_err, nread) => {
        var lines;
        ctx.pos = null;
        ctx.nread = nread;
        options.npos += nread;

        if (nread) {
            ctx.data += ctx.buffer.slice(0, nread).toString(options.encoding || 'utf8');
            lines = ctx.data.split(options.rxLine || lib.rxLine);
            if (ctx.data.endsWith("\n")) {
                ctx.data = "";
                lines.length--;
            } else
            if (nread === ctx.buffer.length) {
                ctx.data = lines.pop();
            }
        } else

        if (ctx.data && !options.tail) {
            lines = [ctx.data];
        }

        lib.forEachLimit(lines, options.concurrency, (line, next) => {
            function doNext(err) {
                return options.nlines % 100 ? next(err) : setImmediate(next, err);
            }
            options.nlines++;
            if (options.nlines === 1 && options.header) {
                if (typeof options.header !== "function") return doNext();
                if (options.header(line)) return doNext();
            }
            if ((options.length && options.nbytes >= options.length) ||
                (options.limit && options.nlines > options.limit) ||
                (options.skip && options.nlines <= options.skip)) {
                options.nskip++;
                return doNext();
            }

            if (options.progress && options.nlines % options.progress === 0) logger.info('forEachLine:', ctx.file, options);

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
            if (options.ignore?.test(line)) {
                options.nskip++;
                return doNext();
            }
            if (options.json) {
                if (line[0] !== '{' && line[0] !== '[') {
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
 * Sync version of the {@link module:lib.forEachLine}, read every line and call callback which may not do any async operations
 * because they will not be executed right away but only after all lines processed
 * @memberof module:lib
 * @method forEachLineSync
 */
lib.forEachLineSync = function(file, options, lineCallback)
{
    var fd;
    if (!options) options = {};
    try {
        fd = typeof file === "number" ? file : fs.openSync(file, 'r');
    } catch (err) {
        if (!options.quiet) logger.error('forEachLine:', file, err);
        return err;
    }

    options.nlines = options.ncalls = options.nbytes = options.nskip = 0;
    if (options.split) {
        options.keep_empty = true;
        if (!options.separator) options.separator = ",";
    }

    const start = Date.now();
    const buffer = Buffer.alloc(options.buflength || 4096);
    let batch = options.count > 0 ? [] : null, bsize = 0;
    let pos = options.start > 0 ? options.pos : null;
    let data = "", lines;

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
            } else

            if (nread === buffer.length) {
                data = lines.pop();
            }
        } else

        if (data) {
            lines = [data];
        }

        for (let i = 0; i < lines?.length; i++) {
            options.nlines++;
            if (!options.nlines === 1 && options.header) {
                if (typeof options.header !== "function") continue;
                if (options.header(lines[i])) continue;
            }
            if ((options.length && options.nbytes >= options.length) ||
                (options.limit && options.nlines > options.limit) ||
                (options.skip && options.nlines <= options.skip)) {
                options.nskip++;
                continue;
            }

            if (options.progress && options.nlines % options.progress === 0) logger.info('forEachLine:', file, options);

            // Skip lines until we see our pattern
            if (options.until && !options.until_seen) {
                options.nskip++;
                options.until_seen = lines[i].match(options.until);
                continue;
            }
            if (options.ignore?.test(lines[i])) {
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
 * @param {string} file
 * @param {string|string[]} lines
 * @param {object} [options]
 * @param {int} [options.size] - rotate if the file is larger, keep 2 files
 * @param {string} [options.ext] - file ext to append on rotation, without dot, `old` is default, it can be in the `strftime` format to use date, like %w, %d, %m
 * @param {string} [options.mode=w] - open file mode, usually a or w
 * @param {boolean} [options.newline] - if true newlines are added for each line
 * @param {function} [callback]
 * @memberof module:lib
 * @method writeLines
 */
lib.writeLines = function(file, lines, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    lib.series([
        function(next) {
            if (!file) return next();
            fs.open(file, options?.mode || 'w', (err, fd) => {
                if (err) return next(err);

                if (typeof lines === "string") lines = [ lines ];
                lib.forEachSeries(lines, (line, next2) => {
                    if (typeof line !== "string") line = String(line);
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

                let ext = `${options?.ext || "old"}`;
                if (ext[0] === "%") ext = lib.strftime(Date.now(), ext);
                fs.rename(file, file + "." + ext, next);
            });
        },
    ], callback);
}

/**
 * Async version of {@link module:lib.writeLines}
 * @param {string} file
 * @param {string|string[]} lines
 * @param {object} [options]
 * @return {object} in format { err }
 * @memberOf module:lib
 * @method areadFile
 * @async
 */

lib.awriteLines = function(file, lines, options)
{
    return new Promise((resolve, _reject) => {
        lib.writeLines(file, lines, options, (err) => {
            resolve({ err });
        });
    });
}

/**
 * Try rename, on error copy file first and then remove the source, overwrites existing files by default
 * @param {string} src
 * @param {string} dst
 * @param {object} [options]
 * @param {boolean} [options.no_replace] true to prevent overwrite existing files
 * @param {function} [callback]
 * @memberof module:lib
 * @method moveFile
 */
lib.moveFile = function(src, dst, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    function _copyIfFailed(err) {
        if (!err) return lib.tryCall(callback);

        lib.copyFile(src, dst, options, (err) => {
            if (err) return lib.tryCall(callback, err);
            lib.unlink(src, callback);
        });
    }

    logger.debug('moveFile:', src, dst, options);
    try {
        fs.stat(dst, (err) => {
            if (!err && options?.no_replace) {
                return lib.tryCall(callback, lib.newError("File " + dst + " exists."));
            }
            try {
                fs.rename(src, dst, _copyIfFailed);
            } catch (e) {
                lib.tryCall(callback, e);
            }
        });
    } catch (e) {
        lib.tryCall(callback, e);
    }
}

/**
 * Copy file, overwrite is optional flag, by default it overwrites existing files
 * @param {string} src
 * @param {string} dst
 * @param {object} [options]
 * @param {boolean} [options.no_replace] true to overwrite
 * @param {function} [callback]
 * @memberof module:lib
 * @method copyFile
 */
lib.copyFile = function(src, dst, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    function _copyFile(err) {
        if (!err && options?.no_replace) {
            return lib.tryCall(callback, lib.newError("File " + dst + " exists."));
        }
        fs.stat(src, (err) => {
            if (err) return lib.tryCall(callback, err);

            stream.pipeline(fs.createReadStream(src),
                            fs.createWriteStream(dst), (err) => {
                lib.tryCall(callback, err)
            });
        });
    }
    logger.debug('copyFile:', src, dst, options);
    try {
        fs.stat(dst, _copyFile);
    } catch (e) {
        lib.tryCall(callback, e);
    }
}

/**
 * Non-exception version of fs.stat, returns empty fs.Dirent on error
 * @param {string} file
 * @param {boolean} [lstat] - use lstat
 * @return {object}
 * @memberof module:lib
 * @method statSync
 */
lib.statSync = function(file, lstat)
{
    try {
        return fs[lstat ? "lstatSync" : "statSync"](file);
    } catch (e) {
        if (e.code !== "ENOENT") logger.error('statSync:', e, e.stack);
        return new fs.Dirent();
    }
}

/**
 * Return contents of a file, empty if not exist or on error.
 * @param {string} file
 * @param {object} [options]
 * @param {boolean} [options.cfg] - parse file in config format, name=value per line, return a list of args
 * @param {boolean} [options.json] - parse file as JSON, return an object, in case of error an empty object
 * @param {string} [options.list] - split contents with the given separator
 * @param {string} [options.encoding] - file encoding when converting to string, "binary" to return Buffer
 * @param {string} [options.logger] - log level for error messages, default no logging
 * @param {boolean} [options.missingok] - ignore ENOENT errors
 * @param {number} [options.offset] - read from the position in the file, if negative the offset is from the end of file
 * @param {number} [options.length] - read only this much of the data, otherwise read till the end of file
 * @return {string|Buffer}
 * @memberof module:lib
 * @method readFileSync
 */
lib.readFileSync = function(file, options)
{
    if (!file) return "";
    const binary = options?.encoding === "binary";
    try {
        let data = binary ? Buffer.from("") : "";
        let offset = lib.toNumber(options?.offset);
        const length = lib.toNumber(options?.length);
        if (offset || (offset === 0 && length > 0)) {
            const buf = Buffer.alloc(length > 0 ? Math.min(length, 4096) : 4096);
            let bufsize = buf.length;
            const fd = fs.openSync(file, "r");
            const size = fs.statSync(file).size;
            if (offset < 0) offset = Math.max(0, size + offset);
            while (offset < size) {
                const nread = fs.readSync(fd, buf, 0, bufsize, offset);
                if (nread <= 0) break;
                if (binary) {
                    data = Buffer.concat([data, buf.slice(0, nread)]);
                } else {
                    data += buf.slice(0, nread).toString(options?.encoding || 'utf8');
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
            if (!binary) data = data.toString(options?.encoding || "utf8");
        }
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.list) data = lib.split(data, options.list); else
            if (options.cfg) data = lib.configParse(data, options);
        }
        return data;
    } catch (e) {
        if (options) {
            if (options.logger && !(options.missingok && e.code === "ENOENT")) logger.logger(options.logger, 'readFileSync:', file, e.stack);
            if (options.json) return {};
            if (options.list || options.cfg) return [];
        }
        return "";
    }
}

/**
 * Same as {@link module:lib.readFileSync} but asynchronous
 * @param {string} file
 * @param {object} [options]
 * @param {function} [callback]
 * @memberof module:lib
 * @method readFile
 */
lib.readFile = function(file, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    let offset = lib.toNumber(options?.offset);
    const length = lib.toNumber(options?.length);
    const binary = options?.encoding === "binary";
    let fd;

    function onError(err) {
        var data = "";
        if (options) {
            if (options.logger && !(options.missingok && err.code === "ENOENT")) logger.logger(options.logger, 'readFile:', file, err.stack);
            if (options.json) data = {};
            if (options.list || options.cfg) data = [];
        }
        if (typeof fd === "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, err, data);
    }
    function onEnd(data) {
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.list) data = lib.split(data, options.list); else
            if (options.cfg) data = lib.configParse(data, options);
        }
        if (typeof fd === "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, null, data);
    }

    if (offset || (offset === 0 && length > 0)) {
        fs.open(file, 'r', (err, handle) => {
            if (err) return onError(err);
            fd = handle;
            const buf = Buffer.alloc(length > 0 ? Math.min(length, 4096) : 4096);
            let bufsize = buf.length;
            let data = binary ? Buffer.from("") : "";
            function onRead() {
                fs.read(fd, buf, 0, bufsize, offset, function(_err, nread, buffer) {
                    if (nread <= 0) return onEnd(data);
                    if (binary) {
                        data = Buffer.concat([data, buffer.slice(0, nread)]);
                    } else {
                        data += buffer.slice(0, nread).toString(options?.encoding || 'utf8');
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
                fs.fstat(fd, (err, stats) => {
                    if (err) return onError(err);
                    offset = Math.max(0, stats.size + offset);
                    onRead();
                });
            } else {
                onRead();
            }
        });
    } else {
        fs.readFile(file, (err, data) => {
            if (err) return onError(err);
            if (!binary) data = data.toString(options?.encoding || 'utf8');
            onEnd(data);
        });
    }
}

/**
 * Async version of {@link module:lib.readFile}
 * @param {string} file
 * @param {object} [options]
 * @return {object} in format { data, err }
 * @memberOf module:lib
 * @method areadFile
 * @async
 */

lib.areadFile = function(file, options)
{
    return new Promise((resolve, _reject) => {
        lib.readFile(file, options, (err, data) => {
            resolve({ data, err });
        });
    });
}

/**
 * Return list of files than match filter recursively starting with given path.
 * @param {string} root - root directory
 * @param {object} [options]
 * @param {regexp} [options.include] - a regexp with file pattern to include
 * @param {regexp} [options.exclude] - a regexp with file pattern to exclude, checks before the include buf after filter function
 * @param {function} [options.filter] - a function(file, stat, options) that return true if the given file matches, stat is a object returned by fs.statSync
 * @param {string} [options.types] - a string with types of files to return: d - a dir, f - a file, l - a symlink, c - char dev, b - block dev, s - socket, p - a FIFO
 * @param {boolean} [options.details] - return the whole stat structure instead of just names, added properties:
 *  - file - full file path
 *  - name - base name
 *  - access - access mode from {@link module:lib.fileAccessMode}
 * @param {boolean} [options.base] - if set only keep base file name in the result, not full path
 * @param {int} [options.depth=7] - if a number it specifies max depth to go into the subfolders, starts with 0
 * @param {boolean} [options.lstat] - use lstat not to follow symlinks
 * @param {string} [options.strip] - strip this prefix from returned file path, common to strip the root prefix
 * @return {string[]|object[]}
 * @example
 * lib.findFileSync("modules/", { depth: 1, types: "f", include: /\.js$/ }).sort()
 * @memberof module:lib
 * @method findFileSync
 */
lib.findFileSync = function(root, options)
{
    const cache = new Set();
    return _findFileSync(root, options, [], 0, cache);
}

function _findExclude(name, stat, options)
{
    if (typeof options?.filter === "function" && !options.filter(name, stat, options)) {
        return true;
    }

    if (util.types.isRegExp(options?.exclude) && options.exclude.test(name)) {
        return true;
    }
}

function _findInclude(name, stat, options)
{
    if (util.types.isRegExp(options?.include) && !options.include.test(name)) return;

    if (typeof options?.types == "string" && !options.types.includes(stat.access[0])) return;

    return true;
}

function _findFileSync(root, options, list, level, cache)
{
    logger.debug("findFileSync:", root, options, level);

    try {
        const files = fs.readdirSync(root);

        for (const file of files) {
            if (options?.done) continue;

            const full = path.join(root, file);
            let name = options?.base ? file : full;

            const stat = lib.statSync(full, options?.lstat);

            stat.name = file;
            stat.file = full;
            stat.access = lib.fileAccessMode(stat.mode);

            if (_findExclude(name, stat, options)) continue;

            const strip = lib.isString(options?.strip);
            if (strip) {
                if (options?.details) {
                    stat.file = stat.file.replace(strip, "");
                } else {
                    name = name.replace(strip, "");
                }
            }

            if (_findInclude(name, stat, options)) {
                list.push(options?.details ? stat: name);
            }

            if (stat.isDirectory()) {
                if (cache.has(stat.ino)) continue;
                cache.add(stat.ino);

                // We reached our directory depth
                const depth = lib.isNumber(options?.depth, 7);
                if (level > depth) continue;

                _findFileSync(full, options, list, level + 1, cache);
            }
        }
    } catch (e) {
        logger.error('findFileSync:', root, options, e.stack);
    }
    return list;
}

/**
 * Async version of {@link module:lib.findFileSync}, same options as in the sync version.
 * @memberof module:lib
 * @method findFile
 */
lib.findFile = function(root, options, callback)
{
    const cache = new Set();
    return _findFile(root, options, callback, [], 0, cache);
}

function _findFile(root, options, callback, list, level, cache)
{
    if (typeof options === "function") callback = options, options = null;

    root = lib.isString(root);

    logger.debug("findFile:", root, options, level);

    fs.readdir(root, (err, files) => {
        if (err) return lib.tryCall(callback, err, list);

        lib.forEachSeries(files, (file, next) => {
            if (options?.done) return next();

            const full = path.join(root, file);
            let name = options?.base ? file : full;

            fs[options?.lstat ? "lstat" : "stat"](full, (err, stat) => {
                if (err) return next(err);

                stat.name = file;
                stat.file = full;
                stat.access = lib.fileAccessMode(stat.mode);

                if (_findExclude(name, stat, options)) return next();

                const strip = lib.isString(options?.strip);
                if (strip) {
                    if (options?.details) {
                        stat.file = stat.file.replace(strip, "");
                    } else {
                        name = name.replace(strip, "");
                    }
                }

                if (_findInclude(name, stat, options)) {
                    list.push(options?.details ? stat: name);
                }

                if (stat.isDirectory()) {
                    if (cache.has(stat.ino)) return next();
                    cache.add(stat.ino);

                    // We reached our directory depth
                    const depth = lib.isNumber(options?.depth, 7);
                    if (level >= depth) {
                        return next();
                    }

                    _findFile(full, options, next, list, level + 1, cache);
                } else {
                    next();
                }
            });
        }, (err) => {
            lib.tryCall(callback, err, list);
        }, true);
    });
}

/**
 * Watch files in a dir for changes and call the callback
 * @param {object} options
 * - root - a string with root path
 * - files - a regexp to watch files individually, if omitted watch the whole dir
 * - match - a regexp to watch files when using the whole dir, only for matched files the callback will be called
 * - ignore - a regexp to ignore files
 * - recursive - watch files in root subfolders
 * - depth - how deep to look for files in case of individual files
 * @param {function} fileCallback - called on changes (file)
 * @param {function} [endCallback]
 * @example
 * lib.watchFiles({ root: "./", match: /\.js$/ }, (file) => {
 * });
 * @memberof module:lib
 * @method watchFiles
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
                if (stat.size === file.size && stat.mtime.getTime() === file.mtime.getTime()) return;
            }
            logger.log('watchFiles:', event, file.file, file.ino, stat.size, stat.mtime);
            for (const p in stat) file[p] = stat[p];
            fileCallback(file);
        });
    }

    const root = options.root;
    const ignore = options.ignore && lib.toRegexp(options.ignore) || null;

    if (options.files) {
        const opts = { details: 1, include: lib.toRegexp(options.files), exclude: ignore, depth: options.depth, types: options.types };
        lib.findFile(options.root, opts, (err, list) => {
            if (err) return lib.tryCall(endCallback, err);
            list.forEach((file) => {
                logger.debug('watchFiles:', file.file, file.ino, file.size);
                file.watcher = fs.watch(file.file, (event) => { watcher(event, file) });
            });
            lib.tryCall(endCallback, err, list);
        });
    } else {
        const match = options.match && lib.toRegexp(options.match) || null;
        try {
            fs.watch(root, { recursive: !!options.recursive }, (event, file) => {
                logger.dev('watcher:', event, root, file);
                file = path.join(root, file);
                if (ignore?.test(file)) return;
                if (match && !match.test(file)) return;
                fs.stat(file, (err, stat) => {
                    if (err) return logger.error("watcher:", file, err);
                    logger.log('watchFiles:', event, file, stat.size, stat.mtime);
                    fileCallback({ name: file, stat });
                });
            });
            lib.tryCall(endCallback);
        } catch (err) {
            lib.tryCall(endCallback, err);
        }
    }
}

/**
 * Recursively create all directories, return 1 if created or 0 on error or if exists, no exceptions are raised, error is logged only
 * @param {string} dir
 * @memberof module:lib
 * @method makePathSync
 */
lib.makePathSync = function(dir)
{
    try {
        fs.mkdirSync(path.normalize(dir), { recursive: true });
        return 1;
    } catch (err) {
        if (err?.code !== "EEXIST") logger.error('makePathSync:', err);
        return 0;
    }
}

/**
 * Async version of makePath, stops on first error, EEXIST is ignored
 * @param {string} dir
 * @param {function} [callback]
 * @memberof module:lib
 * @method makePath
 */
lib.makePath = function(dir, callback)
{
    fs.mkdir(path.normalize(dir), { recursive: true }, (err) => {
        if (err?.code === "EEXIST") err = null;
        if (err) logger.error('makePath:', dir, err);
        lib.tryCall(callback, err);
    });
}

/**
 * Unlink a file, no error on non-existent file (ENOENT is ignored), callback is optional
 * @param {string} name
 * @param {function} [callback]
 * @memberof module:lib
 * @method unlink
 */
lib.unlink = function(name, callback)
{
    fs.unlink(name, (err) => {
        if (err?.code === "ENOENT") err = null;
        if (err) logger.error('unlink:', name, err);
        lib.tryCall(callback, err);
    });
}

/**
 * Unlink a file, no expections
 * @param {string} name
 * @memberof module:lib
 * @method unlinkSync
 */
lib.unlinkSync = function(name)
{
    try {
        fs.unlinkSync(name);
    } catch (e) {
        if (e.code !== 'ENOENT') logger.error('unlinkSync:', name, e);
    }
}


/**
 * Recursively remove all files and folders in the given path, returns an error to the callback if any
 * @param {string} dir
 * @param {function} [callback]
 * @memberof module:lib
 * @method unlinkPath
 */
lib.unlinkPath = function(dir, callback)
{
    fs.stat(dir, (err, stat) => {
        if (err) return lib.tryCall(callback, err);
        if (stat.isDirectory()) {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    logger.error("unlinkPath:", dir, err);
                    return lib.tryCall(callback, err);
                }
                lib.forEachSeries(files, (f, next) => {
                    lib.unlinkPath(path.join(dir, f), next);
                }, (err) => {
                    if (err) {
                        logger.error("unlinkPath:", dir, err);
                        return lib.tryCall(callback, err);
                    }
                    fs.rmdir(dir, callback);
                }, true);
            });
        } else {
            fs.unlink(dir, callback);
        }
    });
}

/**
 * Recursively remove all files and folders in the given path, stops on first error
 * @param {string} dir
 * @memberof module:lib
 * @method unlinkPathSync
 */
lib.unlinkPathSync = function(dir)
{
    var files = lib.findFileSync(dir);
    // Start from the end to delete files first, then folders
    for (let i = files.length - 1; i >= 0; i--) {
        try {
            const stat = lib.statSync(files[i]);
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

const permissions = [
    { bit: 0x0100, char: 'r' }, // User Read
    { bit: 0x0080, char: 'w' }, // User Write
    { bit: 0x0040, char: 'x' }, // User Execute
    { bit: 0x0020, char: 'r' }, // Group Read
    { bit: 0x0010, char: 'w' }, // Group Write
    { bit: 0x0008, char: 'x' }, // Group Execute
    { bit: 0x0004, char: 'r' }, // Other Read
    { bit: 0x0002, char: 'w' }, // Other Write
    { bit: 0x0001, char: 'x' }  // Other Execute
];

/**
 * Return string representation of Unix permissions and file type from the `fs.Dirent` or `fs.Stats`
 * @param {number} - mode
 * @return {string}
 * @memberof module:lib
 * @method fileAccessMode
 */
lib.fileAccessMode = function(mode)
{
    mode = lib.isNumber(mode, 0);

    const perms = permissions.map(p => ((mode & p.bit) ? p.char : '-')).join('').split('');

    if (mode & 0x0800) {
        perms[2] = (mode & 0x0040) ? 's' : 'S';
    }
    if (mode & 0x0400) {
        perms[5] = (mode & 0x0008) ? 's' : 'S';
    }
    if (mode & 0x0200) {
        perms[8] = (mode & 0x0001) ? 't' : 'T';
    }

    const type = (mode & 0x4000) === 0x4000 ? 'd' :
                 (mode & 0xA000) === 0xA000 ? 'l' :
                 (mode & 0x6000) === 0x6000 ? 'b' :
                 (mode & 0x2000) === 0x2000 ? 'c' :
                 (mode & 0x1000) === 0x1000 ? 'p' :
                 (mode & 0xC000) === 0xC000 ? 's' : "f";

    return type + perms.join('');
}

/**
 * Return mime type from file contents,
 * supports only limited number of files: doc, zip, jpeg, png, mp4, pdf
 * @param {Buffer} data
 * @return {string}
 * @method fileMimeType
 * @memberof module:lib
 */
lib.fileMimeType = function(data)
{
    if (!Buffer.isBuffer(data)) return "";

    const hdr4 = data.slice(0, 4).toString("hex");
    switch (hdr4) {
    case "ffd8ffe0":
    case "ffd8ffe1": return "image/jpeg";
    case "89504e47": return "image/png";
    case "47494638": return "image/gif";
    case "25504446": return "application/pdf";
    case "7b5c727466": return "application/rtf";
    case "504b0304": return "application/zip";
    }

    const hdr8 = data.slice(0, 8);
    switch (hdr8) {
    case "d0cf11e0a1b11ae1": return "application/msword";
    case "6674797069736f6d":
    case "667479704d534e56": return "video/mp4";
    case "7573746172003030": return "application/tar"
    }

    if (hdr4.slice(0, 6) === "1f8b08") return "application/gzip";
    if (hdr4.slice(0, 4) === "424d") return "image/bmp";
    if (data.slice(0, 12) === "0000000c6a5020200d0a870a") return "image/jpeg";
    if (data.slice(0, 7) === "526172211a0700") return "application/rar";
    return "";
}

