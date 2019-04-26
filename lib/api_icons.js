//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const path = require('path');
const util = require('util');
const fs = require('fs');
const url = require('url');
const https = require('https');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const api = require(__dirname + '/api');
const logger = require(__dirname + '/logger');

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new image dimensions
//          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
//          - if any is 0 that means keep the original size
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg, svg
//     - flip - flip horizontally
//     - flop - flip vertically
//     - blue_radius, blur_sigma - perform adaptive blur on the image
//     - crop_x, crop_y, crop_width, crop_height - perform crop using given dimensions
//     - sharpen_radius, sharpen_sigma - perform sharpening of the image
//     - brightness - use thing to change brightness of the image
//     - contrast - set new contrast of the image
//     - rotate - rotation angle, if 1 strip=1 is assigned automatically
//     - bgcolor - color for the background, used in rotation
//     - quantized - set number of colors for quantize
//     - treedepth - set tree depth for quantixe process
//     - dither - set 0 or 1 for quantixe and posterize processes
//     - posterize - set number of color levels
//     - normalize - normalize image
//     - opacity - set image opacity
//     - strip - remove EXIF meta data, if not specified defaults to 1
//
// The callback takes 4 arguments: function(err, data, info)
//
// where `data` will contain a new image data and `info` is an object with the info about the new or unmodified image: ext, width, height.
// For animated GIF files it will not convert but return it as is unless it is specified in the options to do so, frame and no_animation
// must be used if no animation is required, see bk_wand for more info. This means that the resulting image type must be consulted
// from the info.format because it may be not the desired format.
//
api.scaleIcon = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    options.ext = options.ext || this.imagesExt || "jpg";
    if (typeof options.strip == "undefined") options.strip = 1;
    const wand = require('bkjs-wand');
    wand.resizeImage(infile, options, function(err, data, info) {
        logger[err ? "error": "debug"]('scaleIcon:', Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, info, err);
        lib.tryCall(callback, err, data, info);
    });
}

// Full path to the icon, perform necessary hashing and sharding, id can be a number or any string.
//
// `options.type` may contain special placeholders:
// - @uuid@ - will be replaced with a unique UUID and placed back to the options.type
// - @now@ - will be replaced with the current timestamp
// - @filename@ - will be replaced with the basename of the uploaded file from the filename property if present
api.iconPath = function(id, options)
{
    if (!options) options = {};
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = String(id).replace(/[^0-9]/g, '');
    var ext = String(options.ext || this.imagesExt || "jpg").toLowerCase();
    var type = String(options.type || "");
    if (type.indexOf("@uuid@") > -1) {
        type = options.type = type.replace("@uuid@", lib.uuid());
    }
    if (type.indexOf("@now@") > -1) {
        type = options.type = type.replace("@now@", Date.now());
    }
    if (type.indexOf("@filename@") > -1 && options.filename) {
        type = options.type = type.replace("@filename@", path.basename(options.filename, path.extname(options.filename)));
    }
    var name = (type ? type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return path.join(core.path.images, options.prefix || "account", num.substr(-2), num.substr(-4, 2), name);
}

// Returns constructed icon url from the icon record
api.iconUrl = function(row, options)
{
    if (!row) return "";
    options = options || lib.empty;
    var path = typeof row == "string" ? row : this.iconPath(row.id, row);
    var imagesUrl = options.imagesUrl || this.imagesUrl || "";
    var local = row.localIcon || options.localIcon;

    // Direct access without the backend API processing
    if (!local && imagesUrl && (options.imagesRaw || this.imagesRaw)) return imagesUrl + path;

    // Pull images from the public S3 bucket directly
    var s3url = options.imagesS3 || this.imagesS3;
    var s3opts = options.imagesS3Options || this.imagesS3Options;
    if (!local && s3url && s3opts) {
        s3opts.url = true;
        return core.modules.aws.signS3("GET", s3url, path, "", s3opts);
    }

    var prefix = row.prefix || options.prefix || 'account';
    var ext = row.ext || options.ext, url;

    // Public images allowed by the access regexp, return images via public /images endpoint, i.e.
    // piping image contents from the actual storage by the API server
    var pubUrl = "/image/" + prefix + "/";
    if ((!row.acl_allow || row.acl_allow == "all") && this.checkAcl(this.allow, this.allowAcl, pubUrl)) {
        url = imagesUrl + pubUrl + row.id + (row.type ? "/" + row.type : "");
        if (ext) url += "." + ext;
        return url;
    }

    // Account special case via /account endpoint and optional type
    if (prefix == "account") {
        url = imagesUrl + '/account/get/icon';
        if (row.type && row.type != '0') url += '?type=' + row.type;
    } else {
        // Use the icons endpoint with permission checks
        url = imagesUrl + '/icon/get?prefix=' + prefix + "&type=" + (row.type || "");
    }
    // When requesting an icon from other accounts
    if (options.account && row.id != options.account.id) url += "&id=" + row.id;
    if (ext) url += "?_ext=" + ext;
    return url;
}

// Verify icon permissions and format for the result, used in setProcessRow for the bk_icon table
api.checkIcon = function(req, row)
{
    var id = req.options.account ? req.options.account.id : "";

    if (row.acl_allow && row.acl_allow != "all") {
        if (row.acl_allow == "auth") {
            if (!id) return true;
        } else
        if (row.acl_allow) {
            if (!row.acl_allow.split(",").some(function(x) { return x == id })) return true;
        } else
        if (row.id != id) return true;
    }
    // Use direct module reference due to usage in the callback without proper context
    row.url = api.iconUrl(row, req.options);
}

// Send an icon to the client, only handles files
api.sendIcon = function(req, id, options)
{
    if (!options) options = {};
    var icon = this.iconPath(id, options);
    logger.debug('sendIcon:', icon, id, options);

    if (!options.localIcon && (options.imagesS3 || this.imagesS3)) {
        var opts = {};
        var params = url.parse(core.modules.aws.signS3("GET", options.imagesS3 || this.imagesS3, icon, "", opts));
        params.headers = opts.headers;
        var s3req = https.request(params, function(s3res) {
            req.res.writeHead(s3res.statusCode, s3res.headers);
            s3res.pipe(req.res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendIcon:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        this.sendFile(req, icon);
    }
}

// Store an icon for account, the options are the same as for the `iconPath` method
// - name is the name property to look for in the multipart body or in the request body or query
// - id is used in `iconPath` along with the options to build the icon absolute path
// - autodel - if true, auto delete the base64 icon property from the query or the body after it is decoded, this is to
//   mark it for deallocation while the icon is being processed, the worker queue is limited so with large number of requests
//   all these query objects will remain in the query wasting memory
// - verify - check the given image of file header for known image types
// - extkeep - a regexp with image types to preserve, not to convert into the specified image type
api.putIcon = function(req, name, id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug("putIcon:", name, id, options);
    var ext, icon;

    if (req.files && req.files[name]) {
        options.filesize = req.files[name].size;
        options.filename = path.basename(req.files[name].name);
        if (options.verify) {
            lib.readFile(req.files[name].path, { length: 4, encoding: "binary" }, function(err, data) {
                if (!err) ext = api.isIcon(data);
                if (!err && !ext) err = "unknown image";
                if (err) logger.debug("putIcon:", name, id, req.files[name].path, err, data);
                if (err) return lib.tryCall(callback, err);
                if (util.isRegExp(options.extkeep) && options.extkeep.test(ext)) options.ext = ext;
                api.saveIcon(req.files[name].path, id, options, callback);
            });
        } else {
            ext = path.extname(req.files[name].path);
            if (util.isRegExp(options.extkeep) && options.extkeep.test(ext)) options.ext = ext;
            this.saveIcon(req.files[name].path, id, options, callback);
        }
    } else
    // JSON object submitted with the property `name`
    if (typeof req.body == "object" && req.body[name]) {
        icon = Buffer.from(req.body[name], "base64");
        ext = api.isIcon(icon);
        if (options.autodel) delete req.body[name];
        if (options.verify && !ext) return lib.tryCall(callback, "unknown image");
        if (util.isRegExp(options.extkeep) && options.extkeep.test(ext)) options.ext = ext;
        this.saveIcon(icon, id, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query && req.query[name]) {
        icon = Buffer.from(req.query[name], "base64");
        ext = api.isIcon(icon);
        if (options.autodel) delete req.query[name];
        if (options.verify && !ext) return lib.tryCall(callback, "unknown image");
        if (util.isRegExp(options.extkeep) && options.extkeep.test(ext)) options.ext = ext;
        this.saveIcon(icon, id, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

// Save the icon data to the destination, if api.imagesS3 or options.imagesS3 specified then plave the image on the S3 drive.
// Store in the proper location according to the types for given id, this function is used after downloading new image or
// when moving images from other places. On success the callback will be called with the second argument set to the output
// file name where the image has been saved.
// Valid properties in the options:
// - type - icon type, this will be prepended to the name of the icon, there are several special types:
//     - @uuid@ - auto generate an UUID
//     - @now@ - use current timestamp
//     - @filename@ - if filename is present the basename without extension will be used
// - prefix - top level subdirectory under images/
// - width, height, filter, ext, quality for `resizeImage` function
// - filesize - file size if available
// - filename - name of a file uploaded if available
api.saveIcon = function(file, id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var outfile = this.iconPath(id, options);
    logger.debug('saveIcon:', id, file, outfile, options);
    if (!options.localIcon && (this.imagesS3 || options.imagesS3)) {
        delete options.outfile;
        this.scaleIcon(file, options, function(err, data, info) {
            if (err) return lib.tryCall(callback, err);
            if (info && info.format) {
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + info.format);
            }
            outfile = "s3://" + (options.imagesS3 || api.imagesS3) + "/" + outfile;
            core.modules.aws.s3PutFile(outfile, data, { postsize: options.filesize }, function(err) {
                if (!err) return lib.tryCall(callback, err, outfile, info);
                logger.error("saveIcon:", outfile, err, options);
                lib.tryCall(callback, err);
            });
        });
    } else {
        // To auto append the extension we need to pass file name without it
        options.outfile = outfile;
        this.scaleIcon(file, options, function(err, data, info) {
            if (!err) return lib.tryCall(callback, err, outfile, info);
            logger.error("saveIcon:", outfile, err, options);
            lib.tryCall(callback, err);
        });
    }
}

// Delete an icon for account, .type defines icon prefix
api.delIcon = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = this.iconPath(id, options);
    logger.debug('delIcon:', id, options);

    if (!options.localIcon && (this.imagesS3 || options.imagesS3)) {
        core.modules.aws.queryS3(options.imagesS3 || this.imagesS3, icon, { method: "DELETE" }, function(err, params) {
            lib.tryCall(callback, err);
        });
    } else {
        fs.unlink(icon, function(err) {
            if (err) logger.error('delIcon:', id, err, options);
            lib.tryCall(callback, err);
        });
    }
}

// Return true if the given file or url point ot an image
api.isIconUrl = function(url)
{
    if (typeof url != "string") return false;
    if (url.indexOf("?") > -1) url = url.split("?")[0];
    return /\.(png|jpg|jpeg|gif)$/i.test(url);
}

// Returns detected image type if the given buffer contains an image, it checks the header only
api.isIcon = function(buf)
{
    if (!Buffer.isBuffer(buf)) return;
    var hdr = buf.slice(0, 4).toString("hex");
    if (hdr === "ffd8ffe0") return "jpg";
    if (hdr === "ffd8ffe1") return "jpg";
    if (hdr === "89504e47") return "png";
    if (hdr === "47494638") return "gif";
    if (hdr.slice(0, 4) === "424d") return "bmp";
}
