/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module files
  */

const path = require('node:path');
const fs = require('node:fs');
const stream = require('node:stream');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * Local files
 */
module.exports = {
    name: "files.file",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "root", type: "path", descr: "Root directory where to keep files" },
        { name: "max-age", type: "int", descr: "Max age for files in ms, -1 to disable" },
        { name: "no-cache", type: "bool", descr: "Serve files as non cacheable" },
        { name: "last-modified", type: "bool", descr: "Serve Last-Modified header to support conditional requests" },
        { name: "etag", type: "bool", descr: "Produce weak ETag header for static files" },
    ],
    lastModified: true,
    maxAge: 0,
    etag: true,
};

mod.send = function(context, file, options)
{
    const opts = Object.assign({
        root: mod.root,
        maxAge: mod.maxAge,
        noCache: mod.noCache,
        lastModified: mod.lastModified,
        etag: mod.etag,
    }, options);
    context.sendFile(file, opts);
}

mod.read = function(file, options, callback)
{
    file = lib.sanitizePath(options?.root || mod.root, file);

    lib.readFile(file, options, callback);
}

mod.copy = function(source, dest, options, callback)
{
    source = lib.sanitizePath(options?.root || mod.root, source);
    dest = lib.sanitizePath(options?.root || mod.root, dest);

    lib[options.move ? "moveFile" : "copyFile"](source, dest, options?.overwrite !== undefined ? options.overwrite : 1, callback);
}

mod.move = function(oldname, newname, options, callback)
{
    oldname = lib.sanitizePath(options?.root || mod.root, oldname);
    newname = lib.sanitizePath(options?.root || mod.root, newname);

    lib.moveFile(oldname, newname, options?.overwrite !== undefined ? options.overwrite : 1, callback);
}

mod.list = function(root, options, callback)
{
    root = lib.sanitizePath(options?.root || mod.root, root);

    if (options?.strip) {
        options = lib.clone(options, { strip: options?.root || mod.root });
    }

    lib.findFile(root, options, callback);
}

mod.store = function(tmpfile, outfile, options, callback)
{
    outfile = lib.sanitizePath(options?.root || mod.root, outfile);

    logger.debug("store:", mod.name, tmpfile, outfile, options);

    lib.makePath(path.dirname(outfile), (err) => {
        if (err) return lib.tryCall(callback, err);

        if (stream.isReadable(tmpfile)) {
            stream.pipeline(tmpfile, fs.createWriteStream(outfile), err => {
                logger.logger(err ? "error" : "debug", 'store:', mod.name, outfile, err, options);
                lib.tryCall(callback, err);
            });
        } else

        if (Buffer.isBuffer(tmpfile)) {
            fs.writeFile(outfile, tmpfile, (err) => {
                logger.logger(err ? "error" : "debug", 'store:', mod.name, outfile, err, options);
                lib.tryCall(callback, err, outfile);
            });
        } else

        if (lib.isString(tmpfile)) {
            lib[options?.copy ? "copyFile" : "moveFile"](tmpfile, outfile, options, (err) => {
                logger.logger(err ? "error" : "debug", 'store:', mod.name, outfile, err, options);
                lib.tryCall(callback, err, outfile);
            });
        } else {
            lib.tryCall(callback, { status: 404, message: "No input provided" });
        }
    });
}

mod.del = function(file, options, callback)
{
    const path = lib.sanitizePath(options?.root || mod.root, file);
    lib.unlink(path, callback);
}
