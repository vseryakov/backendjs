//
//  Author: Vlad Seryakov
//  backendjs / pings example
//
'use strict';

const { api, lib, files } = require('backendjs');

const mod =

module.exports = {
    name: "filemanager",

    args: [
        { name: "read-only", type: "bool", descr: "Read only mode, no delete or rename" },
        { name: "depth", type: "int", descr: "Max folder depth in search" },
    ],

    depth: 7,
    readOnly: true,

    configureMiddleware(_options, callback)
    {
        api.app.
            get("/api/ls", ls).
            get("/api/find", find).
            get("/api/cat", cat).
            post("/api/upload", upload).
            post("/api/rm", readOnly, rm).
            post("/api/mv", readOnly, mv);

        callback();
    },
};

function prepare(data)
{
    return data.map(x => ({
            name: x.name,
            file: x.file,
            type: x.isSymbolicLink() ? "l" : x.isDirectory() ? "d" :  "f",
            owner: x.uid,
            group: x.gid,
            size: x.size,
            mode: lib.fileAccessMode(x.mode),
            mtime: x.mtime,
            ctime: x.ctime
        }))
}

function readOnly(context, next)
{
    if (mod.readOnly) return context.reply({ status: 403, message: "Read only mode" })
    next();
}

function ls(context)
{
    const file = context.query.file || "/";

    files.list(file, { strip: true, details: true, base: true }, (err, data) => {
        if (err) return context.reply(err);

        context.json(prepare(data));
    });
}

function find(context)
{
    const include = lib.toRegexp(context.query.q);
    if (!include) return context.json([]);

    files.list("", { depth: mod.depth, strip: true, details: true, base: true, include }, (err, data) => {
        if (err) return context.reply(err);
        context.json(prepare(data));
    });
}

function cat(context)
{
    files.send(context, context.query.file)
}

function upload(context)
{
    files.upload(context, "file", (err, opts) => {
        context.reply(err);
    });
}

function rm(context)
{
    files.del(context, context.query.file, err => {
        context.reply(err);
    })
}

function mv(context)
{
    files.move(context.query.file, context.query.name, err => {
        context.reply(err);
    })
}
