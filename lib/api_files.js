//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var msg = require(__dirname + '/msg');
var db = require(__dirname + '/db');
var api = require(__dirname + '/api');
var logger = require(__dirname + '/logger');

// Returns absolute file url if it is configured with any prefix or S3 bucket, otherwise returns empty string
api.fileUrl = function(file, options)
{
    if (file) {
        if (this.filesS3 && this.filesS3Options) {
            this.filesS3Options.url = true;
            file = core.modules.aws.signS3("GET", this.filesS3, path.normalize(file), "", this.filesS3Options);
        } else
        if (this.filesUrl && this.filesRaw) {
            file = this.filesUrl + path.normalize(file);
        }
    }
    return file || "";
}

// Send a file to the client
api.getFile = function(req, file, options)
{
    if (!options) options = {};
    var aws = core.modules.aws;
    logger.debug('sendFile:', file, options);

    if (options.filesS3 || this.filesS3) {
        var opts = {};
        var params = url.parse(aws.signS3("GET", options.filesS3 || this.filesS3, path.normalize(file), "", opts));
        params.headers = opts.headers;
        var s3req = http.request(params, function(s3res) {
            s3res.pipe(req.res, { end: true });
        });
        s3req.on("error", function(err) {
            logger.error('sendFile:', err);
            s3req.abort();
        });
        s3req.end();
    } else {
        this.sendFile(req, path.join(core.path.files, path.normalize(file)));
    }
}

// Upload file and store in the filesystem or S3, try to find the file in multipart form, in the body or query by the given name
// - name is the name property to look for in the multipart body or in the request body or query
// - callback will be called with err and actual filename saved
// Output file name is built according to the following options properties:
// - name - defines the output name for the file, if not given same name as property will be used
// - prefix - the folder prefix where the file will be uploaded, all leading folders will be created automatically
// - ext - what file extention to use, appended to the name, if no ext is given the extension from the uploaded file will be used or no extention if could not determine one.
// - extkeep - keep actual extention from the uploaded file, ignore the ext parameter
// - namekeep - keep the name of the uploaded file if present in the multipart form
// - encoding - encoding of the body, default is base64
// - filesize - size of the file in bytes if available
api.putFile = function(req, name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var btype = lib.typeName(req.body);
    var outfile = path.join(path.normalize(options.prefix || ""), path.basename(options.name || name) + (options.ext || ""));

    logger.debug("putFile:", name, outfile, options);

    if (req.files && req.files[name]) {
        if (options.namekeep && req.files[name].name) {
            outfile = path.join(path.dirname(outfile), path.basename(req.files[name].name));
        } else
        if (options.extkeep) {
            var ext = path.extname(req.files[name].name || req.files[name].path);
            if (ext) outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + ext);
        }
        options.filesize = req.files[name].size;
        this.storeFile(req.files[name].path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        var data = new Buffer(req.body[name], options.encoding || "base64");
        this.storeFile(data, outfile, options, callback);
    } else
    // Save a buffer as is
    if (btype == "buffer") {
        this.storeFile(req.body, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        var data = new Buffer(req.query[name], options.encoding || "base64");
        this.storeFile(data, outfile, options, callback);
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

    if (options.filesS3 || this.filesS3) {
        outfile = "s3://" + (options.filesS3 || this.filesS3) + "/" + path.normalize(outfile);
        core.modules.aws.s3PutFile(outfile, tmpfile, { postsize: options.filesize}, function(err, params) {
            if (err) logger.error('storeFile:', outfile, err, params.data);
            if (typeof callback == "function") callback(err, outfile, params);
        });
    } else {
        outfile = path.normalize(path.join(core.path.files, outfile));
        lib.makePath(path.dirname(outfile), function(err) {
            if (err) return callback ? callback(err) : null;
            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, function(err) {
                    if (err) logger.error('storeFile:', outfile, err);
                    if (callback) callback(err, outfile);
                });
            } else {
                lib.moveFile(tmpfile, outfile, true, function(err) {
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

    file = path.normalize(file);
    if (options.filesS3 || this.filesS3) {
        var aws = core.modules.aws;
        aws.queryS3(options.filesS3 || this.filesS3, file, { method: "DELETE" }, callback);
    } else {
        fs.unlink(path.join(core.path.files, file), function(err) {
            if (err) logger.error('delFile:', file, err);
            if (callback) callback(err);
        })
    }
}
