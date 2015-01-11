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
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["icon"] = "initIconsAPI";

// Generic icon management
api.initIconsAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        if (!req.query.prefix) return self.sendReply(res, 400, "prefix is required");
        if (!req.query.id) req.query.id = req.account.id;
        if (!req.query.type) req.query.type = "";
        switch (req.params[0]) {
        case "get":
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select":
            self.selectIcon(req, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "upload":
            options.force = true;
            options.type = req.query.type;
            options.prefix = req.query.prefix;
            self.putIcon(req, req.account.id, options, function(err, icon) {
                var row = self.formatIcon({ id: req.account.id, type: req.query.prefix + ":" + req.query.type }, options);
                self.sendJSON(req, err, row);
            });
            break;

        case "del":
        case "put":
            options.op = req.params[0];
            self.handleIconRequest(req, res, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Full path to the icon, perform necessary hashing and sharding, id can be a number or any string
api.iconPath = function(id, options)
{
    if (!options) options = {};
    // Convert into string and remove all chars except numbers, this will support UUIDs as well as regular integers
    var num = String(id).replace(/[^0-9]/g, '');
    var ext = options.ext || "jpg";
    var name = (options.type ? options.type + '-' : "") + id + (ext[0] == '.' ? "" : ".") + ext;
    return path.join(core.path.images, options.prefix || "", num.substr(-2), num.substr(-4, 2), name);
}

// Download image and convert into JPG, store under core.path.images
// Options may be controlled using the properties:
// - force - force rescaling for all types even if already exists
// - id - id for the icon
// - type - type for the icon, prepended to the icon id
// - prefix - where to store all scaled icons
// - verify - check if the original icon is the same as at the source
api.downloadIcon = function(uri, options, callback)
{
    var self = this;

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('getIcon:', uri, options);

    if (!uri || (!options.id && !options.type)) return (callback ? callback(new Error("wrong args")) : null);
    var id = options.id || "";

    // Verify image size and skip download if the same
    if (options.verify) {
        var imgfile = this.iconPath(id, options);
        fs.stat(imgfile, function(err, stats) {
            logger.debug('getIcon:', id, imgfile, 'stats:', stats, err);
            // No image, get a new one
            if (err) return self.downloadIcon(uri, id, core.delObj(options, 'verify'), callback);

            core.httpGet(uri, { method: 'HEAD' }, function(err2, params) {
                if (err) logger.error('getIcon:', id, imgfile, 'size1:', stats.size, 'size2:', params.size, err);
                // Not the same, get a new one
                if (params.size !== stats.size) return self.downloadIcon(uri, id, core.delObj(options, 'verify'), callback);
                // Same, just verify types
                self.saveIcon(imgfile, id, options, callback);
            });
        });
        return;
    }

    // Download into temp file, make sure dir exists
    var opts = url.parse(uri);
    var tmpfile = path.join(core.path.tmp, core.random().replace(/[\/=]/g,'') + path.extname(opts.pathname));
    core.httpGet(uri, { file: tmpfile }, function(err, params) {
        // Error in downloading
        if (err || params.status != 200) {
            fs.unlink(tmpfile, function() {});
            if (err) logger.error('getIcon:', id, uri, 'not found', 'status:', params.status, err);
            return (callback ? callback(err || new Error('Status ' + params.status)) : null);
        }
        // Store in the proper location
        self.saveIcon(tmpfile, id, options, function(err2) {
            fs.unlink(tmpfile, function() {});
            if (callback) callback(err2);
        });
    });
}

// Save original or just downloaded file in the proper location according to the types for given id,
// this function is used after downloading new image or when moving images from other places. On success
// the callback will be called with the second argument set to the output file name where the image has been saved.
// Valid properties in the options:
// - type - icon type, this will be prepended to the name of the icon
// - prefix - top level subdirectory under images/
// - force - to rescale even if it already exists
// - width, height, filter, ext, quality for backend.resizeImage function
api.saveIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    logger.debug('putIcon:', id, file, options);

    options.outfile = self.iconPath(id, options);

    // Filesystem based icon storage, verify local disk
    fs.exists(options.outfile, function(yes) {
        // Exists and we do not need to rescale
        if (yes && !options.force) return callback();
        // Make new scaled icon
        self.scaleIcon(file, options, function(err) {
            if (err) logger.error("putIcon:", id, file, 'path:', options, err);
            if (callback) callback(err, options.outfile);
        });
    });
}

// Scale image using ImageMagick, return err if failed
// - infile can be a string with file name or a Buffer with actual image data
// - options can specify image properties:
//     - outfile - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
//     - width, height - new image dimensions
//          - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
//          - if any is 0 that means keep the original size
//     - filter - ImageMagick image filters, default is lanczos
//     - quality - 0-99 percent, image scaling quality
//     - ext - image format: png, gif, jpg, jp2
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
    utils.resizeImage(infile, options, function(err, data) {
        if (err) logger.error('scaleIcon:', Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, err);
        if (callback) callback(err, data);
    });
}

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
// Verify icon limits before adding new icons
api.handleIconRequest = function(req, res, options, callback)
{
    var self = this;
    var db = core.modules.db;
    var op = options.op || "put";

    options.force = true;
    options.type = req.query.type || "";
    options.prefix = req.query.prefix || "account";
    if (!req.query.id) req.query.id = req.account.id;

    // Max number of allowed icons per type or globally
    var limit = self.iconLimit[options.type] || self.iconLimit['*'];
    var icons = [];

    core.series([
       function(next) {
           options.ops = { type: "begins_with" };
           db.select("bk_icon", { id: req.query.id, type: options.prefix + ":" }, options, function(err, rows) {
               if (err) return next(err);
               switch (op) {
               case "put":
                   // We can override existing icon but not add a new one
                   if (limit > 0 && rows.length >= limit && !rows.some(function(x) { return x.type == options.type })) {
                       return next({ status: 400, message: "No more icons allowed" });
                   }
                   break;
               }
               icons = rows;
               next();
           });
       },

       function(next) {
           options.ops = {};
           req.query.type = options.prefix + ":" + options.type;
           if (options.ext) req.query.ext = options.ext;
           if (req.query.latitude && req.query.longitude) req.query.geohash = core.geoHash(req.query.latitude, req.query.longitude);

           db[op]("bk_icon", req.query, options, function(err, rows) {
               if (err) return next(err);

               switch (op) {
               case "put":
                   self.putIcon(req, req.query.id, options, function(err, icon) {
                       if (err || !icon) return db.del('bk_icon', req.query, options, function() { next(err || { status: 500, message: "Upload error" }); });
                       // Add new icons to the list which will be returned back to the client
                       if (!icons.some(function(x) { return x.type == options.type })) icons.push(self.formatIcon(req.query, options))
                       next();
                   });
                   break;

               case "del":
                   self.delIcon(req.query.id, options, function() {
                       icons = icons.filter(function(x) { return x.type != options.type });
                       next();
                   });
                   break;

               default:
                   next({ status: 500, message: "invalid op" });
               }
           });
       }], function(err) {
            if (callback) callback(err, icons);
    });
}

// Return formatted icon URL for the given account, verify permissions
api.formatIcon = function(row, options)
{
    var self = this;
    if (!options) options = row;
    var type = (row.type || "").split(":");
    row.type = type.slice(1).join(":");
    row.prefix = type[0];

    if ((this.imagesUrl || options.imagesUrl) && (this.imagesRaw || options.imagesRaw)) {
        row.url = (options.imagesUrl || this.imagesUrl) + this.iconPath(row.id, row);
    } else
    if ((this.imagesS3 || options.imagesS3) && (this.imagesS3Options || options.imagesS3Options)) {
        this.imagesS3Options.url = true;
        row.url = core.modules.aws.signS3("GET", options.imagesS3 || this.imagesS3, this.iconPath(row.id, row), options.imagesS3Options || this.imagesS3Options);
    } else
    if ((!row.acl_allow || row.acl_allow == "all") && this.allow.rx && ("/image/" + row.prefix + "/").match(this.allow.rx)) {
        row.url = (options.imagesUrl || this.imagesUrl) + '/image/' + row.prefix + '/' + row.id + '/' + row.type;
    } else {
        if (row.prefix == "account") {
            row.url = (options.imagesUrl || this.imagesUrl) + '/account/get/icon?';
            if (row.type != '0') row.url += 'type=' + row.type;
        } else {
            row.url = (options.imagesUrl || this.imagesUrl) + '/icon/get?prefix=' + row.prefix + "&type=" + row.type;
        }
        if (options && options.account && row.id != options.account.id) row.url += "&id=" + row.id;
    }
    return row;
}

// Verify icon permissions and format for the result, used in setProcessRow for the bk_icon table
api.checkIcon = function(row, options, cols)
{
    var self = this;
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
    api.formatIcon(row, options);
}

// Return list of icons for the account, used in /icon/get API call
api.selectIcon = function(req, options, callback)
{
    var self = this;
    var db = core.modules.db;

    options.ops = { type: "begins_with" };
    db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + (req.query.type || "") }, options, function(err, rows) {
        callback(err, rows);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
api.getIcon = function(req, res, id, options)
{
    var self = this;
    var db = core.modules.db;

    db.get("bk_icon", { id: id, type: req.query.prefix + ":" + req.query.type }, options, function(err, row) {
        if (err) return self.sendReply(res, err);
        if (!row) return self.sendReply(res, 404, "Not found or not allowed");
        if (row.ext) options.ext = row.ext;
        options.prefix = req.query.prefix;
        options.type = req.query.type;
        self.sendIcon(req, res, id, options);
    });
}

// Send an icon to the client, only handles files
api.sendIcon = function(req, res, id, options)
{
    var self = this;
    if (!options) options = {};
    var aws = core.modules.aws;
    var icon = this.iconPath(id, options);
    logger.debug('sendIcon:', icon, id, options);

    if (options.imagesS3 || self.imagesS3) {
        var opts = {};
        var params = url.parse(aws.signS3("GET", options.imagesS3 || self.imagesS3, icon, opts));
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
        self.sendFile(req, res, icon);
    }
}

// Store an icon for account, .type defines icon prefix
api.putIcon = function(req, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    // Multipart upload can provide more than one icon, file name can be accompanied by file_type property to define type for each icon, for
    // only one uploaded file req.query.type still will be used
    var nfiles = req.files ? Object.keys(req.files).length : 0;
    if (nfiles) {
        var outfile = null, type = options.type || req.query.type;
        core.forEachSeries(Object.keys(req.files), function(f, next) {
            var opts = core.extendObj(options, 'type', req.body[f + '_type'] || (type && nfiles == 1 ? type : ""));
            self.storeIcon(req.files[f].path, id, opts, function(err, ofile) {
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
        this.storeIcon(icon, id, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query.icon) {
        var icon = new Buffer(req.query.icon, "base64");
        this.storeIcon(icon, id, options, callback);
    } else {
        return callback();
    }
}

// Place the icon data to the destination, if api.imagesS3 or options.imagesS3 specified then plave the image on the S3 drive
api.storeIcon = function(file, id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.imagesS3 || options.imagesS3) {
        var icon = this.iconPath(id, options);
        this.scaleIcon(file, options, function(err, data) {
            if (err) return callback ? callback(err) : null;

            core.modules.aws.s3PutFile((options.imagesS3 || self.imagesS3) + "/" + icon, data, function(err) {
                if (callback) callback(err, icon);
            });
        });
    } else {
        this.saveIcon(file, id, options, callback);
    }
}

// Delete an icon for account, .type defines icon prefix
api.delIcon = function(id, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var icon = this.iconPath(id, options);
    logger.debug('delIcon:', id, options);

    if (this.imagesS3 || options.imagesS3) {
        var aws = core.modules.aws;
        aws.queryS3(options.imagesS3 || self.imagesS3, icon, { method: "DELETE" }, function(err) {
            if (callback) callback();
        });
    } else {
        fs.unlink(icon, function(err) {
            if (err) logger.error('delIcon:', id, err, options);
            if (callback) callback();
        });
    }
}

