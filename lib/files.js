/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module files
  */

const path = require('node:path');
const util = require('node:util');
const fs = require('node:fs');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const modules = require(__dirname + '/modules');

const mod =

/**
 * Files storage, upload and retrieval, local fs or S3
 */
module.exports = {
    name: "files",

    args: [
        { name: "default", descr: "Default storage module to use if file url doe snot have protocol, like keep all files on S3 in prod but use fs locally" },
    ],

};

/**
 * Return a module by path/url or type, the default module will be returns or  `files.file` if no protocol or module exist
 * @param {string} path - name, path or url, supports just `protocol:`
 * @returns {object} module by type
 * @memberof module:files
 * @method getModule
 */
mod.getModule = function(path)
{
    const d = lib.isString(path).match(/^([a-z0-9]+):/);
    return modules["files." + d?.[1]] || modules[mod.default] || modules["files.file"];
}

/**
 * Return Content-Disposition header for the given file name
 * @param {string} filename
 * @returns {string}
 * @memberof module:files
 * @method getContentDisposition
 */
mod.getContentDisposition = function(filename)
{
    var prop = "filename";

    if (/^[^:]+:/.test(filename)) {
        filename = filename.replace(/^[^:]+:/, "");
    }

    filename = lib.sanitizePath(filename);
    if (!filename) return "";

    filename = path.basename(filename);
    if (lib.rxPrintable.test(filename)) {
        filename = `"${filename.replace(/([\\"])/g, '\\$1')}"`;
    } else {
        prop = "filename*";
        filename = 'UTF-8\'\'' + lib.encodeURIComponent(filename, lib.rxNoSymbol);
    }
    return `attachment; ${prop}=${filename}`;
}

/**
 * Send a file to the client
 * @param {RequestContext} context - request
 * @param {string} file - file path
 * @param {object} [options]
 * @param {boolean|string} [options.attachment] - download the file, only ASCII charcters
 * @param {string} [options.bucket] - S3 bucket
 * @param {string} [options.root] - root folder, takes precedence over s3
 * @param {number} [options.maxAge] - file cache age in ms
 * @param {boolean} [options.noCache] - return no-cache header
 * @param {boolean} [options.lastModified] - send Last-Modified header
 * @param {boolean} [options.etag] - generate and check weak etag
 * @memberof module:files
 * @method send
 */
mod.send = function(context, file, options)
{
    logger.debug('send:', mod.name, file, options);

    if (options?.attachment) {
        context.setHeader("Content-Disposition", mod.getContentDisposition(lib.isString(options.attachment) || file));
    }

    mod.getModule(file).send(context, file, options);
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
    if (typeof options === "function") callback = options, options = null;
    logger.debug('read:', mod.name, file, options);

    mod.getModule(file).read(file, options, callback);
}

/**
 * Returns a list of file names inside the given path or S3 bucket
 * @param {string} root - path prefix or root folder/bucket
 * @param {object} [options]
 * @param {regexp} [options.exclude] - a regexp with file pattern to exclude, checks before the include buf after filter function
 * @param {regexp} [options.include] - can be a regexp to restrict which files to return
 * @param {function} [options.filter] - a function(file, stat) that return 1 if the given file matches, stat is a object returned by fs.statSync
 * @param {boolean} [options.details] - return list of objects as { file, size, mtime }
 * @param {boolean} [options.base] - if set only keep base file name in the result, not full path
 * @param {boolean} [options.strip] - if set strip root prefix from full paths in details only
 * @param {int} [options.depth] - if a number it specifies max depth to go into the subfolders, starts with 0
 * @param {function} callback
 * @memberof module:files
 * @method list
 */
mod.list = function(root, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    logger.debug('list:', mod.name, root, options);

    mod.getModule(root).list(root, options, callback);
}

/**
 * Delete file by name from the local filesystem or S3 drive,
 * no error is returned if the file does not exist to be compatible with S3 delete object
 * @param {string} file
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method del
 */
mod.del = function(file, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    logger.debug("del:", mod.name, file, options);

    mod.getModule(file).del(file, options, callback);
}

/**
 * Rename a file in place, can deal with local and S3 files if starts with s3:// prefix
 * @param {string} oldname
 * @param {string} newname
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method del
 */
mod.move = function(oldname, newname, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    logger.debug("move:", mod.name, oldname, newname, options);

    mod.getModule(oldname).move(oldname, newname, options, callback);
}

/**
 * Copy a file from one location to another, can deal with local and S3 files if starts with s3:// prefix
 * @param {string} source - source file, if not local this will be the files module
 * @param {string} dest -  destination file, if it is not local but the source is local this will be files module
 * @param {object} options
 * @param {function} callback
 * @memberof module:files
 * @method copy
 */
mod.copy = function(source, dest, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    logger.debug('copy:', mod.name, source, dest, options);

    const smod = mod.getModule(source);
    const dmod = mod.getModule(dest);

    (smod.name !== "files.file" ? smod : dmod).copy(source, dest, callback);
}

/**
 * Place a tmpfile to the destination pointed by outfile
 * @param {string|Buffer|Stream} tmpfile
 * @param {string} outfile
 * @param {object} [options]
 * @param {boolean} [options.copy] - use copy instead of move for local files
 * @param {boolean} [options.no_replace] - prevent overwriting existing files
 * @param {object} [options.ext_map] - replace file extentions according this map: `{ oldext: newext }`
 * @param {function} callback(err, outfile) - return final output file, it can be prefixed with url or root folder
 * @memberof module:files
 * @method store
 */
mod.store = function(tmpfile, outfile, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    if (options?.ext_map) {
        const ext = path.extname(outfile);
        const ext2 = options.extmap[ext] || options.extmap[ext.substr(1)];
        if (ext2) {
            options.ext = (ext2[0] === "." ? "" : ".") + ext2;
            outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + options.ext);
        }
    }
    logger.debug('store:', mod.name, tmpfile, outfile, options);

    mod.getModule(outfile).store(tmpfile, outfile, options, callback);
}

/**
 * Upload file and store in the filesystem or S3, try to find the file in multipart form or in the body by the given name
 * @param {RequestContext} context
 * @param {string} name is the property to look for in the multipart body or in the request body, default is `file`
 * @param {object} [options]
 * @param {string} [options.name] - defines the output name for the file, if not given same name as property will be used
 * @param {string} [options.prefix] - the folder prefix where the file will be uploaded, all leading folders will be created automatically
 * @param {string} [options.ext] - what file extention to use, appended to the name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
 * @param {boolean} [options.keep_ext] - keep actual extention from the uploaded file, ignore the ext parameter
 * @param {object} [options.ext_map] - an object which extensions must be replaced
 * @param {boolean} [options.keep_name] - keep the name of the uploaded file if present in the multipart form
 * @param {string} [options.encoding] - encoding of the body, default is base64
 * @param {regexp} [options.allow_mime] - a Regexp with allowed MIME types, this will use `detect` method to discover file type by the contents
 * @param {int} [options.max_size] - refuse to save if the payload exceeds the given size
 * @param {function} callback(err, options) - retuns same options or a clone with additional properties:
 * - file_size - size of the file in bytes if available
 * - file_name - final name of the file saved
 * - file_type - mime type of tmpfile if asked and detected
 *
 * @memberof module:files
 * @method upload
 */
mod.upload = function(context, name, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    name = lib.isString(name, "file");

    const body = context.body;
    const btype = lib.typeName(body);
    const file = context.files?.[name];

    let ext = options?.ext ? (options.ext[0] === '.' ? "" : ".") + options.ext : "";

    let outfile = lib.sanitizePath(options?.prefix || "", path.basename(lib.isString(options?.name, name)), ext);

    logger.debug("upload:", mod.name, name, outfile, file, options, btype, context.path);

    if (file?.path) {
        if (options?.keep_name && file.name) {
            outfile = path.join(path.dirname(outfile), path.basename(file.name));
        } else
        if (options?.keep_ext) {
            ext = path.extname(file.name || file.path);
            if (ext) {
                const d = path.parse(outfile);
                d.base = undefined;
                d.ext = ext;
                outfile = path.format(d);
            }
        }
        mod.detectAndStore(file, outfile, options, callback);
    } else

    // JSON object submitted with .name property with the icon contents
    if (btype === "object" && body[name]) {
        const data = Buffer.isBuffer(body[name]) ? body[name] : Buffer.from(body[name], options?.encoding || "base64");
        mod.detectAndStore(data, outfile, options, callback);
    } else

    // Save a buffer as is
    if (btype === "buffer") {
        mod.detectAndStore(body, outfile, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

/**
 * Detect file type and store in one set
 * @param {string|Buffer|File} tmpfile
 * @param {string} outfile
 * @param {object} [options]
 * @param {function} callback(err, options)
 * @memberof module:files
 * @method detectAndStore
 */
mod.detectAndStore = function(tmpfile, outfile, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const max_size = lib.toNumber(options?.max_size);
    const size = Buffer.isBuffer(tmpfile) ? tmpfile.length : tmpfile?.size;

    if (max_size > 0 && size > max_size) {
        return lib.tryCall(callback, { status: 413, message: options.size_errmsg || "File is too large, must be less than " + lib.toSize(max_size), max_size, size });
    }

    const file = tmpfile?.path || tmpfile;

    if (util.types.isRegExp(options?.allow_mime)) {

        mod.detect(file, (err, type, ext) => {
            logger.debug("detectAndStore:", mod.name, file, outfile, type, ext, "allow:", options.allow_mime, "ERR:", err);

            if (err) {
                return lib.tryCall(callback, { status: 415, message: options.file_errmsg || "File is not available" });
            }

            if (!options.allow_mime.test(type)) {
                return lib.tryCall(callback, err || { status: 415, message: options.allow_errmsg || "Unsupported media type: " + type, type });
            }

            if (ext && options?.keep_ext) {
                options.ext = ext;
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + ext);
            }

            mod.store(file, outfile, options, (err, outfile) => {
                options = Object.assign(options || {}, {
                    file_name: outfile,
                    file_size: size,
                    file_type: type
                });
                lib.tryCall(callback, err, options);
            });
        });
    } else {
        mod.store(file, outfile, options, (err, outfile) => {
            options = Object.assign(options || {}, {
                file_name: outfile,
                file_size: size,
                file_type: lib.fileMimeType(tmpfile)
            });
            lib.tryCall(callback, err, options);
        });
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
    if (typeof flags === "function") callback = flags, flags = "";

    if (Buffer.isBuffer(file)) {
        const d = file;
        file = `tmp/${lib.randomUInt()}`;
        fs.writeFileSync(file, d);
    } else {
        file = lib.sanitizePath(file).replace(/[$;&|\r\n]/g, "");
    }
    flags = lib.isString(flags) || "--mime-type";
    if (flags) {
        flags = flags.replace(/[$;&|\r\n]/g, "");
    }
    lib.execProcess(`file -E ${flags} '${file}'`, (err, stdout, stderr) => {
        logger.debug("detect:", mod.name, file, stdout, stderr, "ERR:", err);

        stdout = err ? "" : lib.split(stdout, ":")[1];
        lib.tryCall(callback, err, stdout, lib.getExtension(stdout));
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
mod.aread = function(file, options)
{
    return new Promise((resolve, _reject) => {
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
mod.acopy = function(source, dest, options)
{
    return new Promise((resolve, _reject) => {
        mod.copy(source, dest, options, (err, data) => {
            resolve({ err, data });
        });
    });
}

/**
 * Async version of {@link module:files.list}
 * @param {string} root - folder to show files
 * @param {object} options
 * @returns {Promise(object)} in format { err, data }
 * @async
 * @memberof module:files
 * @method alist
 */
mod.alist = function(root, options)
{
    return new Promise((resolve, _reject) => {
        mod.list(root, options, (err, data) => {
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
mod.aupload = function(req, name, options)
{
    return new Promise((resolve, _reject) => {
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
mod.adetectAndStore = function(file, outfile, options)
{
    return new Promise((resolve, _reject) => {
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
mod.astore = function(tmpfile, outfile, options)
{
    return new Promise((resolve, _reject) => {
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
mod.adel = function(file, options)
{
    return new Promise((resolve, _reject) => {
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
mod.adetect = function(file, flags)
{
    return new Promise((resolve, _reject) => {
        mod.detect(file, flags, (err, data, ext) => {
            resolve({ err, data, ext });
        });
    });
}

