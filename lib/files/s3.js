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
        { name: "headers", type: "list", descr: "Pass HTTP headers in proxy mode from the context" },
    ],

    headers: ["cache-control", "etag", "content-type", "content-length"],
};

mod._parse = function(file, options)
{
    file = lib.isString(file);

    if (!/^\/|s3:\/|https?:\//.test(file)) {
        file = "/" + file;
    }

    let s3 = aws.s3ParseUrl(file);
    if (!s3.bucket) {
        const bucket = options?.s3bucket || mod.bucket;
        if (bucket) {
            s3 = aws.s3ParseUrl(bucket + "/" + s3.path);
        }
    }
    s3.url = aws.s3FormatUrl(s3);
    return s3;
}

class S3Stats {
    constructor(item) {
        this.file = `/${item?.Key || item?.Prefix || ""}`;
        this.name = path.basename(this.file);
        this.size = lib.toNumber(item?.Size);
        this.mtime = item?.LastModified || "";
        this.mtimeMs = lib.toMtime(item?.LastModified);
        this.access = item?.Key ? "frwxrwxrwx" : "drwxrwxrwx";
    }
    isFile() { return this.access[0] === "f" }
    isDirectory() { return this.access[0] === "d" }
    isSymbolicLink() { return false }
    isBlockDevice() { return false }
    isCharacterDevice() { return false }
    isFIFO() { return false }
    isSocket() { return false }
}

mod.stat = function(file, options, callback)
{
    file = mod._parse(file, options).url;

    options = lib.objCreate(options, { method: "HEAD" });

    const s3 = aws.s3ParseUrl(file, options);

    aws.queryS3(s3.bucket, s3.pathname, options, (err, rc) => {
        if (rc.status === 200) {
            rc = new S3Stats({
                Key: s3.pathname,
                LastModified: rc.resheaders?.["last-modified"],
                Size: rc.resheaders?.["content-length"],
            });
        }
        lib.tryCall(callback, err, rc);
    });
}

mod.send = function(context, file, options)
{
    file = mod._parse(file, options).url;

    if (mod.headers?.length) {
        options = lib.objCreate(options);
        if (!options.headers) options.headers = {};
        for (const p of mod.headers) {
            options.headers[p] = options.headers[p] ?? context.headers?.[p];
        }
    }

    aws.s3Proxy(context.res, file, options);
}

mod.read = function(file, options, callback)
{
    const s3 = mod._parse(file, options);

    if (options?.encoding === "binary") {
        options = lib.objCreate(options, { binary: true });
    }

    aws.s3GetFile(s3.url, options, (err, rc) => {
        var stat;

        if (rc?.status === 200) {
            if (!options?.binary) {
                if (options?.json) rc.data = lib.jsonParse(rc.data, options); else
                if (options?.list) rc.data = lib.split(rc.data, options.list); else
                if (options?.cfg) rc.data = lib.configParse(rc.data, options);
            }

            stat = new S3Stats({
                Key: s3.pathname,
                LastModified: rc.resheaders?.["last-modified"],
                Size: rc.resheaders?.["content-length"],
            });
        } else

        if (rc?.status >= 400) {
            err = err || { status: rc.status, message: rc.data || http.STATUS_CODES[rc.status] };
        }
        lib.tryCall(callback, err, rc.data, stat);
    });
}

mod.list = function(root, options, callback)
{
    root = mod._parse(root, options).url;

    options = lib.objCreate(options, { delimiter: "/" });

    _findFile(root, options, callback, [], 0)
}

function _findFile(root, options, callback, list, level)
{
    if (typeof options === "function") callback = options, options = null;

    logger.debug("findFile:", mod.name, root, options, level);

    if (root.at(-1) !== "/") root += "/";

    aws.s3List(root, options, (err, { s3, keys, prefixes }) => {
        if (err) return lib.tryCall(callback, err, list);

        keys.push(...prefixes);

        let _stack = 0;

        lib.forEachSeries(keys, (item, next) => {
            if (options?.done) return next();

            const stat = new S3Stats(item);
            let name = options?.base ? stat.name : stat.file;

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

                root += item.Key || item.Prefix;

                _findFile(root, options, next, list, level + 1);
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
