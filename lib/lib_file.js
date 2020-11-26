//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const util = require('util');
const path = require('path');
const logger = require(__dirname + '/logger');
const lib = require(__dirname + '/lib');


// Call callback for each line in the file
// options may specify the following parameters:
// - sync - read file synchronously and call callback for every line
// - abort - signal to stop processing
// - limit - number of lines to process and exit
// - length - amount of data in bytes to process and exit
// - count - return this number of lines in an array if greater than 0
// - skip - number of lines to skip from the start
// - progress - if > 0 report how many lines processed so far every specified lines
// - until - skip lines until this regexp matches
// - ignore - skip lines that match this regexp
// - header - if true then skip first line because it is the a header, if `options.header` it is a function
//   it will be called with the first line as an argument and must return true if this line needs to be skipped
// - json - each line represents an JSON object, convert and pass it to the line callback if not null
// - split - split every line before calling the callback, it uses phraseSplit
// - keepempty - by default is enabled if split is set to keep empty fields in the line array
// - separator - a string with characters to be used for splitting, default is `,`
// - quotes - a string with characters to be used for phrase splitting, default is `"'`
//
// Properties updated and returned in the options:
// - nlines - number of lines read from the file
// - ncalls - number of lines passed to the line callback
//
lib.forEachLine = function(file, options, lineCallback, endCallback)
{
    if (!options) options = {};
    var batch = options.count > 0 ? [] : null;
    var buffer = Buffer.alloc(4096);
    var data = '';
    options.nlines = options.ncalls = options.nbytes = 0;
    if (options.split) {
        options.keepempty = true;
        if (!options.separator) options.separator = ",";
    }
    var rxLine = options.lineseparator || this.rxLine;

    function readData(fd, pos, finish) {
        fs.read(fd, buffer, 0, buffer.length, pos, function(err, nread) {
            data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
            var lines = data.split(rxLine), n = 0;
            // Only if not the last part
            if (nread == buffer.length) data = lines.pop();
            lib.forEachSeries(lines, function(line, next) {
                function doNext(err) {
                    if (n > 100) n = 0;
                    return n ? next(err) : setImmediate(next, err);
                }
                n++;
                options.nlines++;
                if (options.nlines == 1 && options.header) {
                    if (typeof options.header != "function") return doNext();
                    if (options.header(line)) return doNext();
                }
                if (options.length && options.nbytes >= options.length) return doNext();
                if (options.limit && options.nlines >= options.limit) return doNext();
                if (options.skip && options.nlines < options.skip) return doNext();
                if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', file, options);
                line = line.trim();
                if (!line) return doNext();
                // Skip lines until we see our pattern
                if (options.until && !options.until_seen) {
                    options.until_seen = line.match(options.until);
                    return doNext();
                }
                if (options.ignore && options.ignore.test(line)) return doNext();
                if (options.json) {
                    if (line[0] != '{' && line[0] != '[') return doNext();
                    const obj = lib.jsonParse(line, options);
                    if (!obj) return doNext();
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(obj); else return lineCallback(obj, doNext);
                } else
                if (options.split) {
                    const obj = lib.phraseSplit(line.trim(), options);
                    if (!obj.length) return doNext();
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(obj); else return lineCallback(obj, doNext);
                } else {
                    options.ncalls++;
                    options.nbytes += line.length;
                    if (batch) batch.push(line); else return lineCallback(line, doNext);
                }
                if (!batch || batch.length < options.count) return doNext();
                lineCallback(batch, function(err) {
                    batch = [];
                    doNext(err);
                });
            }, function(err) {
                // Stop on reaching limit or end of file
                if (options.abort || err ||
                    (options.length && options.nbytes >= options.length) ||
                    (options.limit && options.nlines >= options.limit) ||
                    nread < buffer.length) {
                    if (err || !batch || !batch.length) return finish(err);
                    return lineCallback(batch, function(err) { finish(err) });
                }
                readData(fd, null, finish);
            });
        });
    }

    fs.open(file, 'r', function(err, fd) {
        if (err) {
            logger.error('forEachLine:', file, err);
            return (endCallback ? endCallback(err, options) : null);
        }
        // Synchronous version, read every line and call callback which may not do any async operations
        // because they will not be executed right away but only after all lines processed
        if (options.sync) {
            while (!options.abort) {
                var nread = fs.readSync(fd, buffer, 0, buffer.length, options.nlines == 0 ? options.start : null);
                data += buffer.slice(0, nread).toString(options.encoding || 'utf8');
                var lines = data.split(rxLine);
                if (nread == buffer.length) data = lines.pop();
                for (var i = 0; i < lines.length; i++) {
                    options.nlines++;
                    if (!options.nlines == 1 && options.header) {
                        if (typeof options.header != "function") continue;
                        if (options.header(lines[i])) continue;
                    }
                    if (options.length && options.nbytes >= options.length) continue;
                    if (options.limit && options.nlines >= options.limit) continue;
                    if (options.skip && options.nlines < options.skip) continue;
                    if (options.progress && options.nlines % options.progress == 0) logger.info('forEachLine:', file, options);
                    // Skip lines until we see our pattern
                    if (options.until && !options.until_seen) {
                        options.until_seen = lines[i].match(options.until);
                        continue;
                    }
                    if (options.ignore && options.ignore.test(lines[i])) continue;
                    if (options.json) {
                        const obj = lib.jsonParse(lines[i], options);
                        if (!obj) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(obj); else lineCallback(obj);
                    } else
                    if (options.split) {
                        const line = lib.phraseSplit(lines[i].trim(), options);
                        if (!line.length) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(line); else lineCallback(line);
                    } else {
                        const line = lines[i].trim();
                        if (!line) continue;
                        options.ncalls++;
                        options.nbytes += lines[i].length;
                        if (batch) batch.push(line); else lineCallback(line);
                    }
                }
                // Stop on reaching limit or end of file
                if (nread < buffer.length) break;
                if (options.length && options.nbytes >= options.length) break;
                if (options.limit && options.nlines >= options.limit) break;
                if (!batch || batch.length < options.count) continue;
                lineCallback(batch);
                batch = [];
            }
            if (batch && batch.length) lineCallback(batch);
            fs.close(fd, function() {});
            return (endCallback ? endCallback(null, options) : null);
        }

        // Start reading data from the optional position or from the beginning
        setImmediate(() => {
            readData(fd, options.start, function(err) {
                fs.close(fd, function() {});
                return (endCallback ? endCallback(err, options) : null);
            });
        });
    });
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

// Non-exception version, returns empty object,
// mtime is 0 in case file does not exist or number of seconds of last modified time
// mdate is a Date object with last modified time
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

// Return contents of a file, empty if not exist or on error.
//
// Options can specify the format:
// - json - parse file as JSON, return an object, in case of error an empty object
// - xml - parse the file as XML, return an object
// - list - split contents with the given separator
// - encoding - file encoding when converting to string
// - logger - log level for error messages
// - missingok - if set ENOENT will not be logged
// - offset - read from the position in the file, if negative the offset is from the end of file
// - length - read only this much of the data, otherwise read till the end of file
lib.readFileSync = function(file, options)
{
    if (!file) return "";
    var binary = options && options.encoding == "binary";
    try {
        var data = binary ? Buffer.from("") : "";
        var offset = this.toNumber(options && options.offset);
        var length = this.toNumber(options && options.length);
        if (offset || (offset === 0 && length > 0)) {
            var buf = Buffer.alloc(4096);
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
            if (options.xml) data = lib.xmlParse(data, options); else
            if (options.list) data = data.split(options.list);
        }
        return data;
    } catch (e) {
        if (options) {
            if (options.logger && !(options.missingok && e.code == "ENOENT")) logger.logger(options.logger, 'readFileSync:', file, e.stack);
            if (options.json) return {};
            if (options.list) return [];
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
            if (options.list) data = [];
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, err, data);
    }
    function onEnd(data) {
        if (options) {
            if (options.json) data = lib.jsonParse(data, options); else
            if (options.xml) data = lib.xmlParse(data, options); else
            if (options.list) data = lib.strSplit(data, options.list);
        }
        if (typeof fd == "number") fs.close(fd, lib.noop);
        lib.tryCall(callback, null, data);
    }

    if (offset || (offset === 0 && length > 0)) {
        fs.open(file, 'r', function(err, handle) {
            if (err) return onError(err);
            fd = handle;
            var data = binary ? Buffer.from("") : "";
            var buf = Buffer.alloc(4096);
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
    if (options.filter) return options.filter(file, stat);
    if (util.isRegExp(options.exclude) && options.exclude.test(file)) return 0;
    if (util.isRegExp(options.include) && !options.include.test(file)) return 0;
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

// Return list of files than match filter recursively starting with given path, file is the starting path.
//
// The options may contain the following:
//   - include - a regexp with file pattern to include
//   - exclude - a regexp with file pattern to exclude
//   - filter - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
//   - depth - if a number it specifies max depth to go into the subfolders, starts with 1
//   - types - a string with types of files to include: d - a dir, f - a file, l - a symlink, c - char dev, b - block dev, s - socket, p - a FIFO
//   - base - if set only keep base file name in the result, not full path
//
//  Example:
//
//        lib.findFileSync("modules/", { depth: 1, types: "f", include: /\.js$/ }).sort()
//
lib.findFileSync = function(file, options)
{
    var list = [];
    var level = arguments[2];
    if (typeof level != "number") level = 0;

    try {
        var stat = this.statSync(file);
        var name = options && options.base ? path.basename(file) : file;
        if (stat.isFile()) {
            if (this.findFilter(name, stat, options)) {
                list.push(name);
            }
        } else
        if (stat.isDirectory()) {
            if (this.findFilter(name, stat, options)) {
                list.push(name);
            }
            // We reached our directory depth
            if (options && typeof options.depth == "number" && level >= options.depth) return list;
            var files = fs.readdirSync(file);
            for (var i in files) {
                list = list.concat(this.findFileSync(path.join(file, files[i]), options, level + 1));
            }
        }
    } catch (e) {
        logger.error('findFileSync:', file, options, e.stack);
    }
    return list;
}

// Async version of find file, same options as in the sync version
lib.findFile = function(dir, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {}
    if (!Array.isArray(options.files)) options.files = [];

    var level = arguments[3];
    if (typeof level != "number") level = 0;

    fs.readdir(dir, function(err, files) {
        if (err) return lib.tryCall(callback, err, options.files);

        lib.forEachSeries(files, function(file, next) {
            if (options.done) return next();
            var full = path.join(dir, file);

            fs.stat(full, function(err, stat) {
                if (err) return next(err);

                if (stat.isFile()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    next();
                } else
                if (stat.isDirectory()) {
                    if (lib.findFilter(full, stat, options)) {
                        options.files.push(options.base ? file : full);
                    }
                    // We reached our directory depth
                    if (options && typeof options.depth == "number" && level >= options.depth) return next();
                    lib.findFile(full, options, next, level + 1);
                } else {
                    next();
                }
            });
        }, function(err) {
            lib.tryCall(callback, err, options.files);
        });
    });
}

// Watch files in a dir for changes and call the callback, the parameters:
// - root - a string with root path
// - files - a regexp to watch files individually, if omitted watch the whole dir
// - match - a regexp to watch files when using the whole dir, only for matched files the callback will be called
// - ignore - a regexp to ignore files
lib.watchFiles = function(options, fileCallback, endCallback)
{
    logger.debug('watchFiles:', options);

    function watcher(event, file) {
        // Check stat if no file name, Mac OS X does not provide it
        fs.stat(file.name, function(err, stat) {
            if (err) return logger.error("watcher:", event, file.name, file.stat.size, err);
            switch (event) {
            case "rename":
                file.watcher.close();
                file.watcher = fs.watch(file.name, function(event) { watcher(event, file); });
                break;
            default:
                if (stat.size == file.stat.size && stat.mtime.getTime() == file.stat.mtime.getTime()) return;
            }
            logger.log('watchFiles:', event, file.name, file.ino, stat.size, stat.mtime);
            file.stat = stat;
            fileCallback(file);
        });
    }

    var root = options.root;
    var ignore = options.ignore && lib.toRegexp(options.ignore) || null;

    if (options.files) {
        var files = lib.toRegexp(options.files);
        fs.readdir(options.root, function(err, list) {
            if (err) return lib.tryCall(endCallback, err);
            list = list.filter(function(file) {
                return (!ignore || !ignore.test(file)) && files.test(file);
            }).map(function(file) {
                file = path.join(options.root, file);
                return ({ name: file, stat: fs.statSync(file) });
            });
            list.forEach(function(file) {
                logger.debug('watchFiles:', file.name, file.stat.ino, file.stat.size);
                file.watcher = fs.watch(file.name, function(event) { watcher(event, file) });
            });
            lib.tryCall(endCallback, err, list);
        });
    } else {
        var match = options.match && lib.toRegexp(options.match) || null;
        try {
            fs.watch(root, function(event, file) {
                logger.dev('watcher:', event, root, file);
                file = path.join(root, file);
                if (ignore && ignore.test(file)) return;
                if (match && !match.test(file)) return;
                fs.stat(file, function(err, stat) {
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
    var rc = 0;
    var list = path.normalize(dir).split("/");
    for (let i = 0, dir = ''; i < list.length; i++) {
        dir += list[i] + '/';
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                rc = 1;
            }
        } catch (e) {
            logger.error('makePath:', dir, e);
            return 0;
        }
    }
    return rc;
}

// Async version of makePath, stops on first error
lib.makePath = function(dir, callback)
{
    var list = path.normalize(dir).split("/");
    var full = "";
    lib.forEachSeries(list, function(d, next) {
        full += d + '/';
        fs.stat(full, function(err) {
            if (!err) return next();
            fs.mkdir(full, function(err) {
                next(err && err.code != 'EEXIST' && err.code != 'EISDIR' ? err : null);
            });
        });
    }, function(err) {
        if (err) logger.error('makePath:', err);
        if (callback) callback(err);
    });
}

// Unlink a file, no error on non-existent file, callback is optional
lib.unlink = function(name, callback)
{
    fs.unlink(name, function(err) {
        if (err && err.code == "ENOENT") err = null;
        if (typeof callback == "function") callback(err);
    });
}

// Recursively remove all files and folders in the given path, returns an error to the callback if any
lib.unlinkPath = function(dir, callback)
{
    fs.stat(dir, function(err, stat) {
        if (err) return callback ? callback(err) : null;
        if (stat.isDirectory()) {
            fs.readdir(dir, function(err, files) {
                if (err) return callback && callback(err);
                lib.forEachSeries(files, function(f, next) {
                    lib.unlinkPath(path.join(dir, f), next);
                }, function(err) {
                    if (err) return callback ? callback(err) : null;
                    fs.rmdir(dir, callback);
                });
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

// Change file owner, multiples files can be specified, do not report errors about non existent files, the uid/gid must be set to non-root user
// for this function to work and it is called by the root only, all the rest of the arguments are used as files names
//
// Example:
//
//           lib.chownSync(1, 1, "/path/file1", "/path/file2")
lib.chownSync = function(uid, gid)
{
    if (process.getuid() || !uid) return;
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

// Create a directories if do not exist, multiple dirs can be specified, all preceeding directories are not created
//
// Example:
//
//             lib.mkdirSync("dir1", "dir2")
lib.mkdirSync = function()
{
    for (var i = 0; i < arguments.length; i++) {
        var dir = arguments[i];
        if (!dir) continue;
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir) } catch (e) { logger.error('mkdirSync:', dir, e); }
        }
    }
}
