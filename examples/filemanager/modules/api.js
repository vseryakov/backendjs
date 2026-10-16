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
    ],

    configureMiddleware(_options, callback)
    {
        api.app.
            get("/api/find", find).
            get("/api/ls", ls).
            get("/api/cat", cat).
            post("/api/upload", upload).
            post("/api/rm", rm).
            post("/api/mv", mv);

        callback();
    },
};

function ls(context)
{
    const file = context.query.file || "/";
    const include = lib.toRegexp(context.query.q);

    files.list(file, { depth: 0, details: true, base: true, include }, (err, data) => {
        if (err) return context.reply(err);

        context.json(data.map(x => ({
            name: x.name,
            type: x.isSymbolicLink() ? "l" : x.isDirectory() ? "d" :  "f",
            owner: x.uid,
            group: x.gid,
            size: x.size,
            mtime: x.mtime,
            ctime: x.ctime
        })));
    });
}

function find(context)
{

}

function cat(context)
{
    files.send(context, context.query.file)
}

function upload(context)
{
}

function rm(context)
{
    files.send(context, context.query.file)
}

function mv(context)
{
    files.rename(context.query.file, context.query.dest)
}
