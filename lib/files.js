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
        { name: "s3", descr: "S3 bucket name where to store files uploaded with the File API" },
        { name: "root", type: "path", descr: "Root directory where to keep files" },
    ],
};

/**
 * Files storage, upload and retrieval, local fs or S3
 */
module.exports = mod;

function isS3(options)
{
    return !options?.root ? "" : options?.s3 || this.s3;
}

/**
 * Send a file to the client
 * @param {Request} req - Express request
 * @param {string} file - file path
 * @param {object} [options]
 * @param {boolean|string} [options.attachment] - download the file
 * @param {string} [options.s3] - S3 bucket
 * @param {string} [options.root] - root folder, takes precedence over s3
 * @memberof module:files
 * @method send
 */
mod.send = function(req, file, options)
{
    logger.debug('send:', mod.name, file, options);

    if (options?.attachment) {
        const filename = path.basename(lib.sanitizePath(lib.isString(options.attachment) || file));
        req.res.header("Content-Disposition", "attachment; filename=" + filename);
    }

    const s3 = isS3(options);
    if (s3) {
        file = path.join(s3, file);
        var rc = modules.aws.s3ParseUrl("s3://" + file);
        modules.aws.s3Proxy(req.res, rc.bucket, rc.path, options);
    } else {
        const root = options?.root || this.root;
        if (!options?.root && root) {
            options = Object.assign(options || {}, { root });
        }
        api.sendFile(req, file, options);
    }
}

/**
 * Returns contents of a file, all specific parameters are passed as is, the contents of the file is returned to the callback,
 * see {@link module:lib.readFile} or {@link module.aws.s3GetFile} for specific options.
 * @param {string} file
 * @param {object} [options]
 * @param {boolean} [options.cfg] - parse file in config format, name=value per line, return a list of args
 * @param {boolean} [options.json] - parse file as JSON, return an object, in case of error an empty object
 * @param {string} [options.list] - split contents with the given separator
 * @param {function} callback
 * @memberof module:files
 * @method read
 */
mod.read = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    logger.debug('read:', mod.name, file, options);

    const s3 = isS3(options);
    if (s3) {
        file = path.join(s3, file);
        modules.aws.s3GetFile(file, options, (err, rc) => {
            if (rc.status == 200) {
                if (options?.json) rc.data = lib.jsonParse(rc.data, options); else
                if (options?.list) rc.data = lib.split(rc.data, options.list); else
                if (options.cfg) rc.data = lib.configParse(rc.data, options);
            } else

            if (rc.status >= 400) {
                err = err || { status: rc.status, message: rc.data || http.STATUS_CODES[rc.status] };
            }
            lib.tryCall(callback, err, rc.data);
        });
    } else {
        file = lib.sanitizePath(options?.root || this.root, file);
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
    logger.debug('copy:', mod.name, source, dest, options);

    const s3 = isS3(options);
    if (s3) {
        if (/^s3:/.test(source) && /^s3:/.test(dest)) {
            return modules.aws.s3CopyFile(dest, source, callback);
        } else

        if (/^s3:/.test(source) && !/^s3:/.test(dest)) {
            dest = path.join(options?.root || this.root, dest);
            return modules.aws.s3GetFile(source, { file: dest }, callback);
        } else

        if (!/^s3:/.test(source) && /^s3:/.test(dest)) {
            source = path.join(s3, source);
            return modules.aws.s3PutFile(dest, source, callback);
        }
    }

    // both local files
    source = lib.sanitizePath(options?.root || this.root, source);
    dest = lib.sanitizePath(options?.root || this.root, dest);
    lib[options.move ? "moveFile" : "copyFile"](source, dest, options?.overwrite !== undefined ? options.overwrite : 1, callback);
}

/**
 * Returns a list of file names inside the given path or S3 bucket
 * @param {object} options
 * @param {string} [options.path] - path prefix
 * @param {string} [options.filter] - can be a regexp to restrict which files to return
 * @param {boolean} [options.details] - return list of objects as { file, size, mtime }
 * @param {function} callback
 * @memberof module:files
 * @method list
 */
mod.list = function(options, callback)
{
    var files = [];
    const s3 = isS3(options);
    if (s3) {
        const opts = { query: { delimiter: '/' }, retryCount: 3, retryTimeout: 500, retryOnError: 1 };
        const root = path.join(s3, options.path || "");
        modules.aws.s3List(root, opts, (err, rows, prefixes) => {
            files.push(...prefixes.map((x) => (x.slice(0, -1))));
            for (const i in rows) {
                if (options?.filter?.test && !options.filter.test(rows[i].Key)) continue;
                files.push(options?.details ? { file: rows[i].Key, size: rows[i].Size, mtime: rows[i].LastModified } : path.basename(rows[i].Key));
            }
            lib.tryCall(callback, err, files);
        });
    } else {
        const root = lib.sanitizePath(options?.root || this.root, options?.path);
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
 * @param {regexp} [options.allow] - a Regexp with allowed MIME types, this will use `detect` method to discover file type by the contents
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
    var outfile = lib.sanitizePath(options?.prefix || "", path.basename(options?.name || name), ext);
    var file = req.files?.[name];

    logger.debug("upload:", mod.name, name, outfile, file, options);

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
 * @param {string|Buffer} file
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
            logger.debug("detectAndStore:", mod.name, file, outfile, type, ext, "allow:", options.allow);

            if (type) options.mimetype = type;

            if (err || !options.allow.test(type)) {
                return lib.tryCall(callback, err || { status: 415, message: options.allow_errmsg || "Unsupported media type: " + type, type: type });
            }

            if (ext && options.extkeep) {
                options.ext = ext;
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + ext);
            }
            mod.store(file, outfile, options, callback);
        });
    } else {
        mod.store(file, outfile, options, callback);
    }
}

/**
 * Place the uploaded tmpfile to the destination pointed by outfile
 * @param {string|Buffer} tmpfile
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
    if (options) {
        options.filetype = path.extname(outfile);
    }

    const s3 = isS3(options);
    if (s3) {
        outfile = path.join(s3, outfile);
        logger.debug("store:", mod.name, tmpfile, outfile, options);

        modules.aws.s3PutFile(outfile, tmpfile, { postsize: options?.filesize }, (err, params) => {
            if (!err) return lib.tryCall(callback, err, outfile, params);

            logger.error('store:', mod.name, outfile, err, params.data, options);
            lib.tryCall(callback, err);
        });
    } else {
        outfile = lib.sanitizePath(options?.root || this.root, outfile);
        logger.debug("store:", mod.name, tmpfile, outfile, options);

        lib.makePath(path.dirname(outfile), (err) => {
            if (err) return lib.tryCall(callback, err);

            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, (err) => {
                    if (!err) return lib.tryCall(callback, err, outfile);

                    logger.error('store:', mod.name, outfile, err, options);
                    lib.tryCall(callback, err);
                });
            } else

            if (lib.isString(tmpfile)) {
                lib[options?.copy ? "copyFile" : "moveFile"](tmpfile, outfile, true, (err) => {
                    if (!err) return lib.tryCall(callback, err, outfile);

                    logger.error('store:', mod.name, outfile, err, options);
                    lib.tryCall(callback, err);
                });
            } else {
                lib.tryCall(callback, { status: 404, message: "No input provided" });
            }
        });
    }
}

/**
 * Delete file by name from the local filesystem or S3 drive if s3 is defined in api or options objects,
 * no error is returned if the file does not exist to be compatible with S3 delete object
 * @param {string} file
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method del
 */
mod.del = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    logger.debug("del:", mod.name, file, options);

    const s3 = isS3(options);
    if (s3) {
        modules.aws.queryS3(s3, file, { method: "DELETE" }, callback);
    } else {
        const path = lib.sanitizePath(options?.root || this.root, file);
        lib.unlink(path, callback);
    }
}

/**
 * Returns detected mime type and ext for a file, using the "file" utility,
 * flags can be passed to the `file` utility to customize the output
 * @param {string|Buffer} file - file or data
 * @param {string} [flags] - command line flags for the file utility (--mime-type)
 * @param {function} [callback] - (err, mimeType, ext)
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
    } else {
        file = lib.sanitizePath(file).replace(/[$;&|\r\n]/g, "");
    }
    flags = lib.isString(flags) || "--mime-type";
    if (flags) {
        flags = flags.replace(/[$;&|\r\n]/g, "");
    }
    lib.execProcess(`file ${flags} '${file}'`, (err, stdout, stderr) => {
        logger.debug("detect:", mod.name, file, stdout, stderr);

        if (!err) stdout = lib.split(stdout, ":")[1];
        lib.tryCall(callback, err, stdout, app.getExtension(stdout));
    });
}


/**
 * Async version of {@link module:files.read}
 * @param {string} file
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method aread
 */
mod.aread = async function(file, options)
{
    return new Promise((resolve, reject) => {
        mod.read(file, options, (err, data) => {
            resolve({ err, data });
        })
    });
}

/**
 * Async version of {@link module:files.copy}
 * @param {string} source
 * @param {string} dest
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method acopy
 */
mod.acopy = async function(source, dest, options)
{
    return new Promise((resolve, reject) => {
        mod.copy(source, dest, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.list}
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method alist
 */
mod.alist = async function(options)
{
    return new Promise((resolve, reject) => {
        mod.list(options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.upload}
 * @param {Request} req
 * @param {string} name
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method aupload
 */
mod.aupload = async function(req, name, options)
{
    return new Promise((resolve, reject) => {
        mod.upload(req, name, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.detectAndStore}
 * @param {string|Buffer} file
 * @param {string} outfile
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method adetectAndStore
 */
mod.adetectAndStore = async function(file, outfile, options)
{
    return new Promise((resolve, reject) => {
        mod.detectAndStore(file, outfile, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.store}
 * @param {string|Buffer} tmpfile
 * @param {string} outfile
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method astore
 */
mod.astore = async function(tmpfile, outfile, options)
{
    return new Promise((resolve, reject) => {
        mod.store(tmpfile, outfile, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.del}
 * @param {string} file
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method adel
 */
mod.adel = async function(file, options)
{
    return new Promise((resolve, reject) => {
        mod.del(file, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.detect}
 * @param {string|Buffer} file
 * @param {string} [flags]
 * @returns {Promise(object)} in format { err, data, ext }
 * @async
 * @memberof module:files
 * @method adetect
 */
mod.adetect = async function(file, flags)
{
    return new Promise((resolve, reject) => {
        mod.detect(file, flags, (err, data, ext) => {
            resolve({ err, data, ext });
        });
    });
}

