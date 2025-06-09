//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const util = require('util');
const fs = require('fs');
const http = require("http");
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "api.files",
    args: [
        { name: "raw", type: "bool", descr: "Return raw urls for the files, requires files-url to be configured. The path will reflect the actual 2 level structure and user id in the file name" },
        { name: "url", descr: "URL where files are stored, for cases of central file server(s), must be full URL with optional path" },
        { name: "s3", descr: "S3 bucket name where to store files uploaded with the File API" },
    ],
};
module.exports = mod;

// Returns absolute file url if it is configured with any prefix or S3 bucket, otherwise returns empty string
mod.url = function(file, options)
{
    if (file) {
        var s3url = options?.filesS3 || this.s3;
        var s3opts = options?.filesS3Options || this.s3Options;
        if (s3url && s3opts) {
            s3opts.url = true;
            file = core.modules.aws.signS3("GET", s3url, api.normalize(file), "", s3opts);
        } else {
            var filesUrl = options?.filesUrl || this.url;
            if (filesUrl) {
                file = filesUrl + api.normalize(file);
            }
        }
    }
    return file || "";
}

// Send a file to the client
mod.send = function(req, file, options)
{
    logger.debug('sendFile:', file, options);

    if (options?.filesS3 || this.s3) {
        var rc = core.modules.aws.s3ParseUrl("s3://" + api.normalize(options?.filesS3 || this.s3, file));
        core.modules.aws.s3Proxy(req.res, rc.bucket, rc.path, options);
    } else {
        if (options?.attachment) {
            var fname = typeof options.attachment == "string" ? options.attachment : path.basename(`${file}`);
            req.res.header("Content-Disposition", "attachment; filename=" + fname);
        }
        file = api.normalize(options?.filesPath || core.path.files, file);
        api.sendFile(req, file);
    }
}

// Returns contents of a file, all specific parameters are passed as is, the contents of the file is returned to the callback,
// see `lib.readFile` or `aws.s3GetFile` for specific options.
mod.read = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug('readFile:', file, options);

    if (options?.filesS3 || this.s3) {
        file = api.normalize(options?.filesS3 || this.s3, file);
        core.modules.aws.s3GetFile(file, options, (err, params) => {
            if (params.status == 200) {
                if (options?.json) params.data = lib.jsonParse(params.data, options); else
                if (options?.xml) params.data = lib.xmlParse(params.data, options); else
                if (options?.list) params.data = lib.strSplit(params.data, options.list);
            } else
            if (params.status >= 400) {
                err = err || { status: params.status, message: params.data || http.STATUS_CODES[params.status] };
            }
            lib.tryCall(callback, err, params.data);
        });
    } else {
        file = api.normalize(options?.filesPath || core.path.files, file);
        lib.readFile(file, options, callback);
    }
}

// Copy a file from one location to another, can deal with local and S3 files if starts with s3:// prefix
mod.copy = function(source, dest, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug('copyFile:', source, dest, options);

    if (options?.filesS3 || this.s3) {
        if (/^s3:/.test(source) && /^s3:/.test(dest)) {
            return core.modules.aws.s3CopyFile(dest, source, callback);
        } else
        if (/^s3:/.test(source) && !/^s3:/.test(dest)) {
            dest = api.normalize(options?.filesPath || core.path.files, dest);
            return core.modules.aws.s3GetFile(source, { file: dest }, callback);
        } else
        if (!/^s3:/.test(source) && /^s3:/.test(dest)) {
            source = api.normalize(options?.filesS3 || this.s3, source);
            return core.modules.aws.s3PutFile(dest, source, callback);
        }
    }
    // both local files
    source = api.normalize(options?.filesPath || core.path.files, source);
    dest = api.normalize(options?.filesPath || core.path.files, dest);
    lib[options.move ? "moveFile" : "copyFile"](source, dest, options?.overwrite !== undefined ? options.overwrite : 1, callback);
}

// Returns a list of file names inside the given folder, `options.filter` can be a regexp to restrict which files to return
mod.list = function(options, callback)
{
    var files = [];
    if (options?.filesS3 || this.s3) {
        var opts = { query: { delimiter: '/' }, retryCount: 3, retryTimeout: 500, retryOnError: 1 };
        core.modules.aws.s3List(`${options?.filesS3 || this.s3}/${options?.path}`, opts, (err, rows, prefixes) => {
            files.push(...prefixes.map((x) => (x.slice(0, -1))));
            for (const i in rows) {
                if (options?.filter && !options.filter.test(rows[i].Key)) continue;
                files.push(options?.details ? { file: path.basename(rows[i].Key), size: rows[i].Size, mtime: rows[i].LastModified } : path.basename(rows[i].Key));
            }
            lib.tryCall(callback, err, files);
        });
    } else {
        lib.findFile(`${options?.filesPath || core.path.files}/${options?.path}`, { depth: 0, include: options?.filter, details: options?.details }, (err, rows) => {
            for (const i in rows) {
                files.push(options?.details ? rows[i] : path.basename(rows[i]));
            }
            lib.tryCall(callback, err, files);
        });
    }
}

// Upload file and store in the filesystem or S3, try to find the file in multipart form, in the body or query by the given name
// - name is the name property to look for in the multipart body or in the request body or query
// - callback will be called with err and actual filename saved
//
// Output file name is built according to the following options properties:
// - name - defines the output name for the file, if not given same name as property will be used
// - prefix - the folder prefix where the file will be uploaded, all leading folders will be created automatically
// - ext - what file extention to use, appended to the name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
// - extkeep - keep actual extention from the uploaded file, ignore the ext parameter
// - extmap - an object which extensions must be replaced
// - namekeep - keep the name of the uploaded file if present in the multipart form
// - encoding - encoding of the body, default is base64
// - allow - a Regexp with allowed MIME types, this will use detectFile method to discover file type by the contents
// - maxsize - refuse to save if the payload exceeds the given size
//
// On return the options may have the following properties set:
// - filesize - size of the file in bytes if available
// - filetype - file extention with dot
// - mimetype - file mime type if detected
mod.put = function(req, name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var btype = lib.typeName(req.body);
    var ext = options?.ext ? (options.ext[0] == '.' ? "" : ".") + options.ext : "";
    var outfile = api.normalize(options?.prefix || "", path.basename(`${options?.name || name}`) + ext);
    var file = req.files && req.files[name];

    logger.debug("putFile:", name, outfile, file, options);

    if (file?.path) {
        if (options?.namekeep && file.name) {
            outfile = path.join(path.dirname(outfile), path.basename(file.name));
        } else
        if (options?.extkeep) {
            ext = path.extname(file.name || file.path);
            if (ext) {
                const d = path.parse(outfile);
                delete d.base;
                d.ext = ext;
                outfile = path.format(d);
            }
        }
        options.filesize = file.size;
        this.detectStore(file.path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        const data = Buffer.isBuffer(req.body[name]) ? req.body[name] : Buffer.from(req.body[name], options?.encoding || "base64");
        this.detectStore(data, outfile, options, callback);
    } else
    // Save a buffer as is
    if (btype == "buffer") {
        this.detectStore(req.body, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        const data = Buffer.isBuffer(req.query[name]) ? req.query[name] : Buffer.from(req.query[name], options?.encoding || "base64");
        this.detectStore(data, outfile, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

mod.detectStore = function(file, outfile, options, callback)
{
    var len = Buffer.isBuffer(file) && file.length || options?.filesize;
    if (options?.maxsize > 0 && len > options.maxsize) {
        return lib.tryCall(callback, { status: 413, message: options.maxsize_errmsg || "Attachment is too large, must be less than " + lib.toSize(options.maxsize), maxsize: options.maxsize, length: len });
    }
    if (util.types.isRegExp(options?.allow)) {
        this.detect(file, (err, type, ext) => {
            logger.debug("detectStoreFile:", file, outfile, type, ext, "allow:", options.allow);
            if (type) options.mimetype = type;
            if (err || !options.allow.test(type)) {
                return lib.tryCall(callback, err || { status: 415, message: options.allow_errmsg || "Unsupported media type: " + type, type: type });
            }
            if (ext && options.extkeep) {
                options.ext = ext;
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + ext);
            }
            mod.storeFile(file, outfile, options, callback);
        });
    } else {
        mod.storeFile(file, outfile, options, callback);
    }
}

// Place the uploaded tmpfile to the destination pointed by outfile
mod.store = function(tmpfile, outfile, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (options?.extmap) {
        var ext = path.extname(outfile);
        var ext2 = options.extmap[ext] || options.extmap[ext.substr(1)];
        if (ext2) {
            options.ext = (ext2[0] == "." ? "" : ".") + ext2;
            outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + options.ext);
        }
    }
    if (options) options.filetype = path.extname(outfile);
    logger.debug("storeFile:", outfile, options);

    if (options?.filesS3 || this.s3) {
        outfile = "s3://" + api.normalize(options?.filesS3 || this.s3, outfile);
        core.modules.aws.s3PutFile(outfile, tmpfile, { postsize: options?.filesize }, (err, params) => {
            if (!err) return lib.tryCall(callback, err, outfile, params);
            logger.error('storeFile:', outfile, err, params.data, options);
            lib.tryCall(callback, err);
        });
    } else {
        outfile = path.normalize(path.join(options?.filesPath || core.path.files, outfile));
        lib.makePath(path.dirname(outfile), (err) => {
            if (err) return lib.tryCall(callback, err);
            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, (err) => {
                    if (!err) return lib.tryCall(callback, err, outfile);
                    logger.error('storeFile:', outfile, err, options);
                    lib.tryCall(callback, err);
                });
            } else {
                lib[options.copy ? "copyFile" : "moveFile"](tmpfile, outfile, true, (err) => {
                    if (!err) return lib.tryCall(callback, err, outfile);
                    logger.error('storeFile:', outfile, err, options);
                    lib.tryCall(callback, err);
                });
            }
        });
    }
}

// Delete file by name from the local filesystem or S3 drive if filesS3 is defined in api or options objects
mod.del = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    file = api.normalize(file);
    if (options?.filesS3 || this.s3) {
        var aws = core.modules.aws;
        aws.queryS3(options?.filesS3 || this.s3, file, { method: "DELETE" }, callback);
    } else {
        fs.unlink(path.join(options?.filesPath || core.path.files, file), (err) => {
            if (err) logger.error('delFile:', file, err);
            lib.tryCall(callback, err);
        })
    }
}

// Returns detected mime type and ext for a file,
// flags can be passed to the `file` utility to customize the output
mod.detect = function(file, flags, callback)
{
    if (typeof flags == "function") callback = flags, flags = "";
    if (Buffer.isBuffer(file)) {
        var d = file;
        file = `tmp/${lib.randomUInt()}`;
        fs.writeFileSync(file, d);
    }
    if (flags) flags = flags.replace(/[$;&|]/gi, "");
    lib.execProcess(`file ${flags || "--mime-type"} '${file}'`, (err, stdout, stderr) => {
        if (!err) stdout = lib.strSplit(stdout, ":")[1];
        lib.tryCall(callback, err, stdout, core.mime.extension(stdout));
    });
}
