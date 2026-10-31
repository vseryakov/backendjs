/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module files
  */

const path = require('node:path');
const http = require("node:http");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const aws = require(__dirname + '/../aws');

const mod =

/**
 * S3 files
 */
module.exports = {
    name: "files.s3",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "bucket", descr: "Default bucket where to keep files: bucket, s3://bucket, http://hostname/bucket" },
    ],
};

mod._parse = function(file, options)
{
    file = lib.isString(file);
    if (file[0] !== "/") file = "/" + file;
    const s3 = aws.s3ParseUrl(file);
    s3.bucket = s3.bucket || options?.s3bucket || mod.bucket || "";
    s3.url = aws.s3FormatUrl(s3);
    return s3;
}

mod.send = function(context, file, options)
{
    file = mod._parse(file, options).url;

    aws.s3Proxy(context.res, file, options);
}

mod.read = function(file, options, callback)
{
    file = mod._parse(file, options).url;

    aws.s3GetFile(file, options, (err, rc) => {
        if (rc.status === 200) {
            if (options?.json) rc.data = lib.jsonParse(rc.data, options); else
            if (options?.list) rc.data = lib.split(rc.data, options.list); else
            if (options.cfg) rc.data = lib.configParse(rc.data, options);
        } else

        if (rc.status >= 400) {
            err = err || { status: rc.status, message: rc.data || http.STATUS_CODES[rc.status] };
        }
        lib.tryCall(callback, err, rc.data);
    });
}

mod.list = function(root, options, callback)
{
    root = mod._parse(root, options).url;
    if (root.at(-1) !== "/") root += "/";

    options = lib.objCreate(options, { delimiter: "/" });

    _findFile(root, options, callback, [], 0)
}

function _findFile(root, options, callback, list, level)
{
    if (typeof options === "function") callback = options, options = null;

    logger.debug("_findFile:", mod.name, root, options, level);

    aws.s3List(root, options, (err, { s3, keys, prefixes }) => {
        if (err) return lib.tryCall(callback, err, list);

        keys.push(...prefixes);

        let _stack = 0;

        lib.forEachSeries(keys, (item, next) => {
            if (options?.done) return next();

            const file = item.Key || item.Prefix;
            const stat = {
                name: path.basename(file),
                file,
                size: lib.toNumber(item.Size),
                mtime: item.LastModified,
                access: item.Key ? "frwxrwxrwx" : "drwxrwxrwx",
                isFile() { return item.Key ? true : false },
                isSymbolicLink() { return false },
                isDirectory() { return item.Prefix ? true: false },
                isBlockDevice() { return false },
                isCharacterDevice() { return false },
                isFIFO() { return false },
                isSocket() { return false },
            };
            let name = options?.base ?  stat.name : file;

            if (lib.findFileExclude(name, stat, options)) return next();

            const strip = lib.isString(options?.strip);
            if (strip) {
                if (options?.details) {
                    stat.file = stat.file.replace(strip, "");
                } else {
                    name = name.replace(strip, "");
                }
            }

            if (lib.findFileInclude(name, stat, options)) {
                list.push(options?.details ? stat: name);
            }

            if (item.Prefix) {

                // We reached our directory depth
                const depth = lib.toNumber(options?.depth);
                if (level >= depth) {
                    return next();
                }

                _findFile(s3.bucket + item.Prefix, options, next, list, level + 1);
            } else {
                if (++_stack <= lib.maxStackDepth) return next();
                _stack = 0;
                setImmediate(next);
            }
        }, (err) => {
            lib.tryCall(callback, err, list);
        }, true);
    });
}

mod.store = function(tmpfile, outfile, options, callback)
{
    outfile = mod._parse(outfile, options).url;

    aws.s3PutFile(outfile, tmpfile, options, (err) => {
        lib.tryCall(callback, err, outfile);
    });
}

mod.copy = function(oldfile, newfile, options, callback)
{
    oldfile = mod._parse(oldfile, options).url;
    newfile = mod._parse(newfile, options).url;

    aws.s3CopyFile(newfile, oldfile, options, callback);
}

mod.move = function(oldfile, newfile, options, callback)
{
    oldfile = mod._parse(oldfile, options).url;
    newfile = mod._parse(newfile, options).url;

    aws.s3CopyFile(newfile, oldfile, options, (err) => {
        if (err) return lib.tryCall(callback, err);
        aws.s3DeleteFile(oldfile, options, callback);
    });
}

mod.del = function(file, options, callback)
{
    file = mod._parse(file, options).url;

    aws.s3DeleteFile(file, options, callback);
}
