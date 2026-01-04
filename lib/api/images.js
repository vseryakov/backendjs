/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module api/images
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const modules = require(__dirname + '/../modules');
const lib = require(__dirname + '/../lib');
const api = require(__dirname + '/../api');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "api.images",
    args: [
        { name: "url", descr: "URL where images are stored, for cases of central image server(s), must be full URL with optional path" },
        { name: "s3", descr: "S3 bucket name where to store and retrieve images" },
        { name: "raw", type: "bool", descr: "Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and user id in the image name" },
        { name: "s3-options", type: "json", logger: "warn", descr: "S3 options to sign images urls, may have expires:, key:, secret: properties" },
        { name: "ext", descr: "Default image extension to use when saving images" },
        { name: "mod", descr: "Images scaling module, sharp" },
        { name: "path", descr: "Path to store images" },
    ],
    ext: "jpg",
};

/**
 * Saving and serving images
 */
module.exports = mod;

/**
 * Scale image return err if failed.
 *
 * If image module is not set (default) then the input data is returned or saved as is.
 *
 * @param {string} infile can be a string with file name or a Buffer with actual image data
 * @param {object} options
 * - options can specify image properties:
 *     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
 *     - width, height - new image dimensions
 *          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
 *          - if any is 0 that means keep the original size
 *     - ext - image format: png, gif, jpg, svg
 *
 * @param {function} callback takes 3 arguments: function(err, data, info)
 * where `data` will contain a new image data and `info` is an object with the info about the new or unmodified image: ext, width, height.
 * @memberof module:api/images
 * @method scale
 */
mod.scale = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var data, info = {};

    options.ext = options.ext || this.ext || "jpg";

    switch (this.mod) {
    case "sharp":
        if (!api.sharp) api.sharp = require('sharp');
        var img = api.sharp(infile);

        lib.series([
            function(next) {
                img.metadata((err, inf) => {
                    if (err) return next(err);

                    if (!options.height) delete options.height; else
                    if (options.height < 0) {
                        options.height = inf.height < Math.abs(options.height) ? inf.height : Math.abs(options.height);
                    }
                    if (!options.width) delete options.width; else
                    if (options.width < 0) {
                        options.width = inf.width < Math.abs(options.width) ? inf.width : Math.abs(options.width);
                    }
                    try {
                        img.toFormat(options.ext).resize(options);
                    } catch (e) {
                        err = e;
                    }
                    next(err);
                });
            },
            function(next) {
                if (options.outfile) {
                    img.toFile(options.outfile, (err, inf) => {
                        info = inf;
                        next(err);
                    });
                } else {
                    img.toBuffer((err, buf, inf) => {
                        data = buf;
                        info = inf;
                        next(err);
                    });
                }
            },
        ], (err) => {
            if (!err) info.ext = info.format == "jpeg" ? "jpg" : info.format;
            logger[err ? "error": "debug"]('scaleIcon:', Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, info, err);
            lib.tryCall(callback, err, data, info);
        }, true);
        break;

    default:
        info.ext = options.ext || this.ext || "jpg";
        if (Buffer.isBuffer(infile)) {
            if (options.outfile) {
                fs.writeFile(options.outfile, infile, (err) => {
                    lib.tryCall(callback, err, data, info);
                });
            } else {
                lib.tryCall(callback, null, infile, info);
            }
        } else {
            if (options.outfile) {
                lib.copyFile(infile, options.outfile, (err) => {
                    lib.tryCall(callback, err, data, info);
                });
            } else {
                fs.readFile(infile, (err, data) => {
                    lib.tryCall(callback, err, data, info);
                });
            }
        }
    }
}

/**
 * Full path to the icon, perform necessary hashing and sharding, id can be a number or any string.
 * @param {string} id
 * @param {object} options
 * `options.type` may contain special placeholders:
 * - @uuid@ - will be replaced with a unique UUID and placed back to the options.type
 * - @now@ - will be replaced with the current timestamp
 * - @filename@ - will be replaced with the basename of the uploaded file from the filename property if present
 * @returns {string}
 * @memberof module:api/images
 * @method getPath
 */
mod.getPath = function(id, options)
{
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = lib.toDigits(id);
    var ext = String(options?.ext || this.ext || "jpg").toLowerCase();
    var type = String(options?.type || "");
    if (type.indexOf("@") > -1) {
        if (type.indexOf("@uuid@") > -1) {
            type = type.replace("@uuid@", lib.uuid());
        }
        if (type.indexOf("@now@") > -1) {
            type = type.replace("@now@", Date.now());
        }
        if (type.indexOf("@filename@") > -1 && options?.filename) {
            type = type.replace("@filename@", path.basename(options?.filename, path.extname(options?.filename)));
        }
    }
    var name = (type ? type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return lib.normalize(this.path, options?.prefix || "user", num.substr(-2), num.substr(-4, 2), name);
}

/**
 * Returns constructed icon url from the icon record
 * @param {string} file
 * @param {object} options
 * @returns {string}
 * @memberof module:api/images
 * @method getUrl
 */
mod.getUrl = function(file, options)
{
    if (file) {
        if (lib.isObject(file)) {
            options = file;
            file = this.getPath(file.id, file);
        }
        options = options || lib.empty;
        var s3url = options.imagesS3 || this.s3;
        var s3opts = options.imagesS3Options || this.s3Options;
        if (s3url && s3opts) {
            s3opts.url = true;
            file = modules.aws.signS3("GET", s3url, path.normalize(file), "", s3opts);
        } else {
            var imagesUrl = options.imagesUrl || this.url;
            if (imagesUrl) {
                file = imagesUrl + path.normalize(file);
            }
        }
    }
    return file || "";
}

/**
 * Send an icon to the client, only handles files
 * @param {Request} req
 * @param {string} id
 * @param {object} options
 * @memberof module:api/images
 * @method send
 */
mod.send = function(req, id, options)
{
    var icon = this.getPath(id, options);
    logger.debug('sendImage:', icon, id, options);

    if (options?.imagesS3 || this.s3) {
        var opts = {};
        var params = URL.parse(modules.aws.signS3("GET", options?.imagesS3 || this.s3, icon, "", opts)) || {};
        params.headers = opts.headers;
        var s3req = https.request(params, (s3res) => {
            req.res.writeHead(s3res.statusCode, s3res.headers);
            s3res.pipe(req.res, { end: true });
        });
        s3req.on("error", (err) => {
            logger.error('sendImage:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        api.sendFile(req, icon);
    }
}

/**
 * Store an icon for user, the options are the same as for the `path` method
 * @param {Request} req
 * @param {string} name is the name property to look for in the multipart body or in the request body or query
 * @param {string} id is used in `iconPath` along with the options to build the icon absolute path
 * @param {object} options
 * - autodel - if true, auto delete the base64 icon property from the query or the body after it is decoded, this is to
 *   mark it for deallocation while the icon is being processed, the worker queue is limited so with large number of requests
 *   all these query objects will remain in the query wasting memory
 * - verify - check the given image of file header for known image types
 * - extkeep - a regexp with image types to preserve, not to convert into the specified image type
 * - ext - the output file extention without dot, ex: jpg, png, gif....
 * @param {function} callback
 * @memberof module:api/images
 * @method put
 */
mod.put = function(req, name, id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug("putImage:", name, id, options);
    var ext, icon;

    if (req.files && req.files[name]) {
        options.filesize = req.files[name].size;
        options.filename = path.basename(req.files[name].name);
        if (options.verify) {
            lib.readFile(req.files[name].path, { length: 4, encoding: "binary" }, function(err, data) {
                if (!err) ext = mod.isImage(data);
                if (!err && !ext) err = "unknown image";
                if (err) logger.debug("putImage:", name, id, req.files[name].path, err, data);
                if (err) return lib.tryCall(callback, err);
                if (lib.testRegexp(ext, options.extkeep)) options.ext = ext;
                mod.save(req.files[name].path, id, options, callback);
            });
        } else {
            ext = path.extname(req.files[name].path);
            if (lib.testRegexp(ext, options.extkeep)) options.ext = ext.substr(1);
            mod.save(req.files[name].path, id, options, callback);
        }
    } else
    // JSON object submitted with the property `name`
    if (typeof req.body == "object" && req.body[name]) {
        icon = Buffer.from(req.body[name], "base64");
        ext = mod.isImage(icon);
        if (options.autodel) delete req.body[name];
        if (options.verify && !ext) return lib.tryCall(callback, "unknown image");
        if (lib.testRegexp(ext, options.extkeep)) options.ext = ext;
        mod.save(icon, id, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query && req.query[name]) {
        icon = Buffer.from(req.query[name], "base64");
        ext = mod.isImage(icon);
        if (options.autodel) delete req.query[name];
        if (options.verify && !ext) return lib.tryCall(callback, "unknown image");
        if (lib.testRegexp(ext, options.extkeep)) options.ext = ext;
        mod.save(icon, id, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

/**
 * Save the icon data to the destination, if mod.s3 or options.imagesS3 specified then plave the image on the S3 drive.
 * Store in the proper location according to the types for given id, this function is used after downloading new image or
 * when moving images from other places. On success the callback will be called with the second argument set to the output
 * file name where the image has been saved.
 * @param {string} file
 * @param {string} id
 * @param {object} options
 * Valid properties in the options:
 * - type - icon type, this will be prepended to the name of the icon, there are several special types:
 *     - @uuid@ - auto generate an UUID
 *     - @now@ - use current timestamp
 *     - @filename@ - if filename is present the basename without extension will be used
 * - prefix - top level subdirectory under images/
 * - width, height, filter, ext, quality for `scale` function
 * - filesize - file size if available
 * - filename - name of a file uploaded if available
 * @param {function} callback
 * @memberof module:api/images
 * @method save
 */
mod.save = function(file, id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var outfile = this.getPath(id, options);
    logger.debug('saveImage:', id, file, outfile, options);

    if (!options.localIcon && (this.s3 || options.imagesS3)) {
        delete options.outfile;
        mod.scale(file, options, (err, data, info) => {
            if (err) return lib.tryCall(callback, err);
            if (info?.ext) {
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + info.ext);
            }
            outfile = "s3://" + (options.imagesS3 || mod.s3) + "/" + outfile;
            modules.aws.s3PutFile(outfile, data, { postsize: options.filesize }, (err) => {
                if (!err) return lib.tryCall(callback, err, outfile, info);
                logger.error("saveImage:", outfile, err, options);
                lib.tryCall(callback, err);
            });
        });
    } else {
        // To auto append the extension we need to pass file name without it
        lib.makePath(path.dirname(outfile), (err) => {
            options.outfile = outfile;
            mod.scale(file, options, (err, data, info) => {
                if (!err) return lib.tryCall(callback, err, outfile, info);
                logger.error("saveImage:", outfile, err, options);
                lib.tryCall(callback, err);
            });
        });
    }
}

/**
 * Delete an icon for user, .type defines icon prefix
 * @param {string} id
 * @param {object} options
 * @param {function} callback
 * @memberof module:api/images
 * @method del
 */
api.del = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = this.getPath(id, options);
    logger.debug('delImage:', id, options);

    if (!options.localIcon && (this.s3 || options.imagesS3)) {
        modules.aws.queryS3(options.imagesS3 || this.s3, icon, { method: "DELETE" }, (err, params) => {
            lib.tryCall(callback, err);
        });
    } else {
        fs.unlink(icon, (err) => {
            if (err) logger.error('delImage:', id, err, options);
            lib.tryCall(callback, err);
        });
    }
}

/**
 * Return true if the given file or url point ot an image
 * @param {string} url
 * @returns {boolean}
 * @memberof module:api/images
 * @method isUrl
 */
api.isUrl = function(url)
{
    if (typeof url != "string") return false;
    if (url.indexOf("?") > -1) url = url.split("?")[0];
    return /\.(png|jpg|jpeg|gif)$/i.test(url);
}

/**
 * Returns detected image type if the given buffer contains an image, it checks the header only
 * @param {buffer} buf
 * @Returns {string}
 * @memberof module:api/images
 * @method isImage
 */
api.isImage = function(buf)
{
    if (!Buffer.isBuffer(buf)) return;
    var hdr = buf.slice(0, 4).toString("hex");
    if (hdr === "ffd8ffe0") return "jpg";
    if (hdr === "ffd8ffe1") return "jpg";
    if (hdr === "89504e47") return "png";
    if (hdr === "47494638") return "gif";
    if (hdr.slice(0, 4) === "424d") return "bmp";
}
