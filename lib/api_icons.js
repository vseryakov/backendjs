//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var url = require('url');
var qs = require('qs');
var http = require('http');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new image dimensions
//          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
//          - if any is 0 that means keep the original size
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg, jp2, svg
//     - flip - flip horizontally
//     - flop - flip vertically
//     - blue_radius, blur_sigma - perform adaptive blur on the image
//     - crop_x, crop_y, crop_width, crop_height - perform crop using given dimensions
//     - sharpen_radius, sharpen_sigma - perform sharpening of the image
//     - brightness - use thing to change brightness of the image
//     - contrast - set new contrast of the image
//     - rotate - rotation angle
//     - bgcolor - color for the background, used in rotation
//     - quantized - set number of colors for quantize
//     - treedepth - set tree depth for quantixe process
//     - dither - set 0 or 1 for quantixe and posterize processes
//     - posterize - set number of color levels
//     - normalize - normalize image
//     - opacity - set image opacity
api.scaleIcon = function(infile, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var wand = require('bkjs-wand');
    wand.resizeImage(infile, options, function(err, data) {
        if (err) logger.error('scaleIcon:', Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, err);
        if (typeof callback == "function") callback(err, data);
    });
}

// Full path to the icon, perform necessary hashing and sharding, id can be a number or any string
api.iconPath = function(id, options)
{
    if (!options) options = {};
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = String(id).replace(/[^0-9]/g, '');
    var ext = options.ext || this.imagesExt || "jpg";
    var name = (options.type ? options.type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return path.join(core.path.images, options.prefix || "account", num.substr(-2), num.substr(-4, 2), name);
}

// Returns constructed icon url from the icon record
api.iconUrl = function(row, options)
{
    var self = this;
    if (!row) return "";
    function getCfg(name, dflt) { return (options && options[name]) || self[name] || dflt || ""; }
    function getOpt(name, dflt) { return row[name] || (options && options[name]) || dflt || ""; }

    // Direct access without the backend API processing
    if (getCfg('imagesUrl') && getCfg('imagesRaw')) {
        return getCfg('imagesUrl') + this.iconPath(row.id, row);
    } else
    // Pull images from the public S3 bucket directly
    if (getCfg('imagesS3') && getCfg('imagesS3Options')) {
        this.imagesS3Options.url = true;
        return core.modules.aws.signS3("GET", getCfg('imagesS3'), this.iconPath(row.id, row), getCfg('imagesS3Options'));
    } else
    // Public images allowed by the access regexp, return images via public /images endpoint, i.e.
    // piping image contents from the actual storage by the API server
    if ((!row.acl_allow || row.acl_allow == "all") && this.allow.rx && ("/image/" + getOpt('prefix', 'account') + "/").match(this.allow.rx)) {
        var url = getCfg('imagesUrl') + '/image/' + getOpt('prefix', 'account') + '/' + row.id + '/' + (row.type || "");
        if (getOpt('ext')) url += "." + getOpt('ext');
        return url;
    } else {
        // Account special case via /account endpoint and optional type
        if (getOpt('prefix', 'account') == "account") {
            var url = getCfg('imagesUrl') + '/account/get/icon?';
            if (row.type && row.type != '0') url += 'type=' + row.type;
        } else {
            // Use the icons endpoint with permission checks
            var url = getCfg('imagesUrl') + '/icon/get?prefix=' + getOpt('prefix', 'account') + "&type=" + (row.type || "");
        }
        // When requesting an icon from other accounts
        if (options && options.account && row.id != options.account.id) url += "&id=" + row.id;
        if (getOpt('ext')) url += "?_ext=" + getOpt('ext');
        return url;
    }
}

// Verify icon permissions and format for the result, used in setProcessRow for the bk_icon table
api.checkIcon = function(op, row, options)
{
    var id = options.account ? options.account.id : "";

    if (row.acl_allow && row.acl_allow != "all") {
        if (row.acl_allow == "auth") {
            if (!id) return true;
        } else
        if (acl) {
            if (!row.acl_allow.split(",").some(function(x) { return x == id })) return true;
        } else
        if (row.id != id) return true;
    }
    // Use direct module reference due to usage in the callback without proper context
    row.url = api.iconUrl(row, options);
}

// Send an icon to the client, only handles files
api.sendIcon = function(req, res, id, options)
{
    if (!options) options = {};
    var icon = this.iconPath(id, options);
    logger.debug('sendIcon:', icon, id, options);

    if (options.imagesS3 || this.imagesS3) {
        var opts = {};
        var params = url.parse(core.modules.aws.signS3("GET", options.imagesS3 || this.imagesS3, icon, opts));
        params.headers = opts.headers;
        var s3req = http.request(params, function(s3res) {
            s3res.pipe(res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendIcon:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        this.sendFile(req, res, icon);
    }
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    if (typeof callback != "function") callback = lib.noop;

    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property to define type for each icon, for
    // only one uploaded file req.query.type still will be used
    var nfiles = req.files ? Object.keys(req.files).length : 0;
    if (nfiles) {
        var outfile = null, type = options.type || req.query.type;
        lib.forEachSeries(Object.keys(req.files), function(f, next) {
            var opts = lib.extendObj(options, 'type', req.body[f + '_type'] || (type && nfiles == 1 ? type : ""), "filesize", req.files[f].size);
            self.saveIcon(req.files[f].path, id, opts, function(err, ofile) {
                outfile = ofile;
                next(err);
            });
        }, function(err) {
            callback(err, outfile);
        });
    } else
    // JSON object submitted with .icon property
    if (typeof req.body == "object" && req.body.icon) {
        var icon = new Buffer(req.body.icon, "base64");
        this.saveIcon(icon, id, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query.icon) {
        var icon = new Buffer(req.query.icon, "base64");
        this.saveIcon(icon, id, options, callback);
    } else {
        return callback();
    }
}

// Save the icon data to the destination, if api.imagesS3 or options.imagesS3 specified then plave the image on the S3 drive.
// Store in the proper location according to the types for given id, this function is used after downloading new image or
// when moving images from other places. On success the callback will be called with the second argument set to the output
// file name where the image has been saved.
// Valid properties in the options:
// - type - icon type, this will be prepended to the name of the icon
// - prefix - top level subdirectory under images/
// - width, height, filter, ext, quality for `resizeImage` function
// - filesize - file size if available
api.saveIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var outfile = this.iconPath(id, options);
    logger.debug('saveIcon:', id, file, outfile, options);
    if (this.imagesS3 || options.imagesS3) {
        delete options.outfile;
        this.scaleIcon(file, options, function(err, data) {
            if (err) return callback(err);
            outfile = "s3://" + (options.imagesS3 || self.imagesS3) + "/" + outfile;
            core.modules.aws.s3PutFile(outfile, data, { postsize: options.filesize, retryCount: 3 }, function(err) {
                if (typeof callback == "function") callback(err, outfile);
            });
        });
    } else {
        options.outfile = outfile;
        this.scaleIcon(file, options, function(err) {
            if (typeof callback == "function") callback(err, outfile);
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

    if (this.imagesS3 || options.imagesS3) {
        core.modules.aws.queryS3(options.imagesS3 || this.imagesS3, icon, { method: "DELETE", retryCount: 3 }, callback);
    } else {
        fs.unlink(icon, function(err) {
            if (err) logger.error('delIcon:', id, err, options);
            if (typeof callback == "function") callback(err);
        });
    }
}

