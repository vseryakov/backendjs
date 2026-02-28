/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module files
  */

const path = require('path');
const util = require('util');
const fs = require('fs');
const http = require("http");
const modules = require(__dirname + '/modules');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');

const mod = {
    name: "files",
    args: [
        { name: "url", descr: "URL where files are stored, for cases of central file server(s), must be full URL with optional path" },
        { name: "s3", descr: "S3 bucket name where to store files uploaded with the File API" },
        { name: "root", type: "path", descr: "Root directory where to keep files" },
    ],
};

/**
 * Files storage, upload and retrieval, image manipulations
 */
module.exports = mod;

/**
 * Returns absolute file url if it is configured with any prefix or S3 bucket, otherwise returns empty string
 * @param {string} file
 * @param {object} [options]
 * @param {string} [options.filesUrl] - url prefix
 * @returns {string}
 * @memberof module:files
 * @method url
 */
mod.url = function(file, options)
{
    file = lib.normalize(file);
    var url = options?.filesUrl || this.url;
    if (url) file = url + file;
    return file;
}

/**
 * Send a file to the client
 * @param {Request} req
 * @param {string} file
 * @param {object} [options]
 * @param {boolean|string} [options.attachment] - download the file
 * @param {string} [options.filesS3] - S3 bucket
 * @param {string} [options.filesRoot] - root folder
 * @memberof module:files
 * @method send
 */
mod.send = function(req, file, options)
{
    logger.debug('send:', mod.name, file, options);

    if (options?.attachment) {
        var fname = typeof options.attachment == "string" ? options.attachment : path.basename(`${file}`);
        req.res.header("Content-Disposition", "attachment; filename=" + fname);
    }

    if (options?.filesS3 || this.s3) {
        file = lib.normalize(options?.filesS3 || this.s3, file);
        var rc = modules.aws.s3ParseUrl("s3://" + file);
        modules.aws.s3Proxy(req.res, rc.bucket, rc.path, options);
    } else {
        file = lib.normalize(options?.filesRoot || this.root, file);
        api.sendFile(req, file);
    }
}

/**
 * Returns contents of a file, all specific parameters are passed as is, the contents of the file is returned to the callback,
 * see {@link module:lib.readFile} or {@link module.aws.s3GetFile} for specific options.
 * @param {string} file
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method read
 */
mod.read = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug('readFile:', file, options);

    if (options?.filesS3 || this.s3) {
        file = lib.normalize(options?.filesS3 || this.s3, file);
        modules.aws.s3GetFile(file, options, (err, params) => {
            if (params.status == 200) {
                if (options?.json) params.data = lib.jsonParse(params.data, options); else
                if (options?.list) params.data = lib.split(params.data, options.list);
            } else
            if (params.status >= 400) {
                err = err || { status: params.status, message: params.data || http.STATUS_CODES[params.status] };
            }
            lib.tryCall(callback, err, params.data);
        });
    } else {
        file = lib.normalize(options?.filesRoot || this.root, file);
        lib.readFile(file, options, callback);
    }
}

/**
 * Copy a file from one location to another, can deal with local and S3 files if starts with s3:// prefix
 * @param {string} source
 * @param {string} dest
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method copy
 */
mod.copy = function(source, dest, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug('copyFile:', source, dest, options);

    if (options?.filesS3 || this.s3) {
        if (/^s3:/.test(source) && /^s3:/.test(dest)) {
            return modules.aws.s3CopyFile(dest, source, callback);
        } else

        if (/^s3:/.test(source) && !/^s3:/.test(dest)) {
            dest = lib.normalize(options?.filesRoot || this.root, dest);
            return modules.aws.s3GetFile(source, { file: dest }, callback);
        } else

        if (!/^s3:/.test(source) && /^s3:/.test(dest)) {
            source = lib.normalize(options?.filesS3 || this.s3, source);
            return modules.aws.s3PutFile(dest, source, callback);
        }
    }

    // both local files
    source = lib.normalize(options?.filesRoot || this.root, source);
    dest = lib.normalize(options?.filesRoot || this.root, dest);
    lib[options.move ? "moveFile" : "copyFile"](source, dest, options?.overwrite !== undefined ? options.overwrite : 1, callback);
}

/**
 * Returns a list of file names inside the given path or S3 bucket
 * @param {object} options
 * @param {string} [options.path] - path prefix
 * @param {string} [options.filter] - can be a regexp to restrict which files to return
 * @param {function} callback
 * @memberof module:files
 * @method list
 */
mod.list = function(options, callback)
{
    var files = [];
    if (options?.filesS3 || this.s3) {
        var opts = { query: { delimiter: '/' }, retryCount: 3, retryTimeout: 500, retryOnError: 1 };
        modules.aws.s3List(`${options?.filesS3 || this.s3}/${options?.path || ""}`, opts, (err, rows, prefixes) => {
            files.push(...prefixes.map((x) => (x.slice(0, -1))));
            for (const i in rows) {
                if (options?.filter && !options.filter.test(rows[i].Key)) continue;
                files.push(options?.details ? { file: path.basename(rows[i].Key), size: rows[i].Size, mtime: rows[i].LastModified } : path.basename(rows[i].Key));
            }
            lib.tryCall(callback, err, files);
        });
    } else {
        const root =`${options?.filesRoot || this.root}/${options?.path || ""}`;
        lib.findFile(root, { depth: 0, include: options?.filter, details: options?.details }, (err, rows) => {
            for (const i in rows) {
                files.push(options?.details ? rows[i] : path.basename(rows[i]));
            }
            lib.tryCall(callback, err, files);
        });
    }
}

/**
 * Upload file and store in the filesystem or S3, try to find the file in multipart form or in the body by the given name
 * On return the options may have the following properties set:
 * - filesize - size of the file in bytes if available
 * - filetype - file extention with dot
 * - mimetype - file mime type if detected
 * @param {Request} req
 * @param {string} name is the name property to look for in the multipart body or in the request body
 * @param {object} options - Output file name is built according to the following options properties:
 * @param {string} [options.name] - defines the output name for the file, if not given same name as property will be used
 * @param {string} [options.prefix] - the folder prefix where the file will be uploaded, all leading folders will be created automatically
 * @param {string} [options.ext] - what file extention to use, appended to the name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
 * @param {boolean} [options.extkeep] - keep actual extention from the uploaded file, ignore the ext parameter
 * @param {object} [options.extmap] - an object which extensions must be replaced
 * @param {boolean} [options.namekeep] - keep the name of the uploaded file if present in the multipart form
 * @param {string} [options.encoding] - encoding of the body, default is base64
 * @param {regexp} [options.allow] - a Regexp with allowed MIME types, this will use detectFile method to discover file type by the contents
 * @param {int} [options.maxsize] - refuse to save if the payload exceeds the given size
 * @param {function} callback will be called with err and actual filename saved
 *
 * @memberof module:files
 * @method upload
 */
mod.upload = function(req, name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var btype = lib.typeName(req.body);
    var ext = options?.ext ? (options.ext[0] == '.' ? "" : ".") + options.ext : "";
    var outfile = lib.normalize(options?.prefix || "", path.basename(`${options?.name || name}`) + ext);
    var file = req.files?.[name];

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
        this.detectAndStore(file.path, outfile, options, callback);
    } else

    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        const data = Buffer.isBuffer(req.body[name]) ? req.body[name] : Buffer.from(req.body[name], options?.encoding || "base64");
        this.detectAndStore(data, outfile, options, callback);
    } else

    // Save a buffer as is
    if (btype == "buffer") {
        this.detectAndStore(req.body, outfile, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

/**
 * Detect file type and storee in one set
 * @param {string} file
 * @param {string} outfile
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method detectAndStore
 */
mod.detectAndStore = function(file, outfile, options, callback)
{
    var len = Buffer.isBuffer(file) && file.length || options?.filesize;
    if (options?.maxsize > 0 && len > options.maxsize) {
        return lib.tryCall(callback, { status: 413, message: options.maxsize_errmsg || "Attachment is too large, must be less than " + lib.toSize(options.maxsize), maxsize: options.maxsize, length: len });
    }
    if (util.types.isRegExp(options?.allow)) {
        this.detect(file, (err, type, ext) => {
            logger.debug("detectAndStore:", file, outfile, type, ext, "allow:", options.allow);
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

/**
 * Place the uploaded tmpfile to the destination pointed by outfile
 * @param {string} tmpfile
 * @param {string} outfile
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method store
 */
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

    if (options?.filesS3 || this.s3) {
        outfile = "s3://" + lib.normalize(options?.filesS3 || this.s3, outfile);
        logger.debug("storeFile:", tmpfile, outfile, options);

        modules.aws.s3PutFile(outfile, tmpfile, { postsize: options?.filesize }, (err, params) => {
            if (!err) return lib.tryCall(callback, err, outfile, params);

            logger.error('storeFile:', outfile, err, params.data, options);
            lib.tryCall(callback, err);
        });
    } else {
        outfile = path.normalize(path.join(options?.filesRoot || this.root, outfile));
        logger.debug("storeFile:", tmpfile, outfile, options);

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

/**
 * Delete file by name from the local filesystem or S3 drive if filesS3 is defined in api or options objects
 * @param {string} file
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method del
 */
mod.del = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    file = lib.normalize(file);
    if (options?.filesS3 || this.s3) {
        modules.aws.queryS3(options?.filesS3 || this.s3, file, { method: "DELETE" }, callback);
    } else {
        fs.unlink(path.join(options?.filesRoot || this.root, file), (err) => {
            if (err) logger.error('delFile:', file, err);
            lib.tryCall(callback, err);
        })
    }
}

/**
 * Returns detected mime type and ext for a file, using the "file" utility,
 * flags can be passed to the `file` utility to customize the output
 * @param {string} file
 * @param {string} [flags]
 * @param {function} [callback]
 * @memberof module:files
 * @method detect
 */
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
        if (!err) stdout = lib.split(stdout, ":")[1];
        lib.tryCall(callback, err, stdout, app.mime.extension(stdout));
    });
}

