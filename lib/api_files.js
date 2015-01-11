//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/../core');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["file"] = "initFilesAPI";

// Generic file management
api.initFilesAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/file\/([a-z]+)$/, function(req, res) {
        var options = self.getOptions(req);

        if (!req.query.name) return self.sendReply(res, 400, "name is required");
        if (!req.query.prefix) return self.sendReply(res, 400, "prefix is required");
        var file = req.query.prefix.replace("/", "") + "/" + req.query.name.replace("/", "");
        if (options.tm) file += options.tm;

        switch (req.params[0]) {
        case "get":
            self.getFile(req, res, file, options);
            break;

        case "add":
        case "put":
            options.name = file;
            options.prefix = req.query.prefix;
            self.putFile(req, req.query._name || "data", options, function(err) {
                self.sendReply(res, err);
            });
            break;

        case "del":
            self.delFile(file, options, function(err) {
                self.sendReply(res, err);
            });
            break;

        default:
            self.sendReply(res, 400, "Invalid command");
        }
    });
}

// Send a file to the client
api.getFile = function(req, res, file, options)
{
    var self = this;
    if (!options) options = {};
    var aws = core.modules.aws;
    logger.debug('sendFile:', file, options);

    if (options.imagesS3 || self.imagesS3) {
        var opts = {};
        var params = url.parse(aws.signS3("GET", options.filesS3 || self.filesS3, file, opts));
        params.headers = opts.headers;
        var s3req = http.request(params, function(s3res) {
            s3res.pipe(res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendFile:', err);
            s3req.abort();
        });
        s3req.end();

    } else {
        self.sendFile(req, res, file);
    }
}

// Upload file and store in the filesystem or S3, try to find the file in multipart form, in the body or query by the given name
// - name is the name property to look for in the multipart body or in the request body or query
// - callback will be called with err and actual filename saved
// Output file name is built according to the following options properties:
// - name - defines the basename for the file, no extention, if not given same name as property will be used
// - prefix - the folder prefix where the file will be uploaded, all leading folders will be created automatically
// - ext - what file extention to use, appended to name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
// - extkeep - tells always to keep actual extention from the uploaded file
// - encoding - encoding of the body, default is base64
api.putFile = function(req, name, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var btype = core.typeName(req.body);
    var outfile = path.join(options.prefix || "", path.basename(options.name || name) + (options.ext || ""));

    logger.debug("putFile:", name, outfile, options);

    if (req.files && req.files[name]) {
        if (!options.ext || options.extkeep) outfile += path.extname(req.files[name].name || req.files[name].path);
        self.storeFile(req.files[name].path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        var data = new Buffer(req.body[name], options.encoding || "base64");
        self.storeFile(data, outfile, options, callback);
    } else
    // Save a buffer as is
    if (btype == "buffer") {
        self.storeFile(req.body, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        var data = new Buffer(req.query[name], options.encoding || "base64");
        self.storeFile(data, outfile, options, callback);
    } else {
        return callback();
    }
}

// Place the uploaded tmpfile to the destination pointed by outfile
api.storeFile = function(tmpfile, outfile, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    logger.debug("storeFile:", outfile);

    if (this.filesS3 || options.filesS3) {
        core.modules.aws.s3PutFile((options.filesS3 || this.filesS3) + "/" + outfile, tmpfile, callback);
    } else {
        outfile = path.join(core.path.files, outfile);
        core.makePath(path.dirname(outfile), function(err) {
            if (err) return callback ? callback(err) : null;
            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, function(err) {
                    if (err) logger.error('storeFile:', outfile, err);
                    if (callback) callback(err, outfile);
                });
            } else {
                core.moveFile(tmpfile, outfile, true, function(err) {
                    if (err) logger.error('storeFile:', outfile, err);
                    if (callback) callback(err, outfile);
                });
            }
        });
    }
}

// Delete file by name from the local filesystem or S3 drive if filesS3 is defined in api or options objects
api.delFile = function(file, options, callback)
{
    var self = this;
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (this.filesS3 || options.filesS3) {
        var aws = core.modules.aws;
        aws.queryS3(options.filesS3 || this.filesS3, file, { method: "DELETE" }, function(err) {
            if (callback) callback(err, outfile);
        });
    } else {
        fs.unlink(path.join(core.path.files, file), function(err) {
            if (err) logger.error('delFile:', file, err);
            if (callback) callback(err, outfile);
        })
    }
}
