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
        { name: "bucket", type: "path", descr: "Default bucket where to keep files" },
    ],
};

mod.send = function(context, file, options)
{
    const bucket = options?.s3bucket || mod.bucket;
    if (bucket) file = path.join(bucket, file);

    aws.s3Proxy(context.res, file, options);
}

mod.read = function(file, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket;
    if (bucket) file = path.join(bucket, file);

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

mod.copy = function(source, dest, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket;

    if (/^s3:/.test(source) && /^s3:/.test(dest)) {
        return aws.s3CopyFile(dest, source, callback);
    } else

    if (/^s3:/.test(source) && !/^s3:/.test(dest)) {
        dest = path.join(options?.root || this.root, dest);
        return aws.s3GetFile(source, { file: dest }, callback);
    } else

    if (!/^s3:/.test(source) && /^s3:/.test(dest)) {
        if (bucket) source = path.join(bucket, source);
        return aws.s3PutFile(dest, source, callback);
    }
}

mod.list = function(root, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket || "";

    root = path.join(bucket, root || "");

    const strip = lib.isString(options?.strip);
    const filter = lib.isFunc(options?.filter);
    const opts = { query: { delimiter: '/' }, retryCount: 3, retryTimeout: 500, retryOnError: 1 };

    const files = [];
    aws.s3List(root, opts, (err, rows, prefixes) => {
        files.push(...prefixes.map((x) => (x.slice(0, -1))));
        for (const row of rows) {
            const key = row.Key;
            const base = path.basename(key);
            const name = options?.base ? base : key;
            if (filter && !filter(key, row)) continue;
            if (options?.exclude?.test && options.exclude.test(name)) continue;
            if (options?.include?.test && !options.include.test(name)) continue;
            if (options?.details) {
                const details = { name: base, file: key, size: row.Size, mtime: row.LastModified };
                files.push(details);
                if (strip) {
                    details.file = details.file.replace(strip, "");
                }
            } else {
                files.push(name);
            }
        }
        lib.tryCall(callback, err, files);
    });
}

mod.store = function(tmpfile, outfile, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket;
    if (bucket) outfile = path.join(bucket, outfile);

    aws.s3PutFile(outfile, tmpfile, { postsize: options?.filesize }, (err) => {
        logger.logger(err ? "error" : "debug", 'store:', mod.name, outfile, err, options);
        lib.tryCall(callback, err, outfile);
    });
}

mod.move = function(oldname, newname, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket;
    if (bucket) {
        newname = path.join(bucket, newname);
        oldname = path.join(bucket, oldname);
    }
    return aws.s3CopyFile(newname, oldname, callback);
}

mod.del = function(file, options, callback)
{
    const bucket = options?.s3bucket || mod.bucket;

    aws.queryS3(bucket, file, { method: "DELETE" }, callback);
}
