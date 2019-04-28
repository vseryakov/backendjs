//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
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
var mime = require("mime");

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
    if (!options) options = lib.empty;
    logger.debug('sendFile:', file, options);

    if (options.filesS3 || this.filesS3) {
        core.modules.aws.s3Proxy(req.res, options.filesS3 || this.filesS3, path.normalize(file), options);
    } else {
        this.sendFile(req, path.join(options.filesPath || core.path.files, path.normalize(file)));
    }
}

// Returns contents of a file, all specific parameters are passed as is, the contents of the file is returned to the callback,
// see `lib.readFile` or `aws.s3GetFile` for specific options.
api.readFile = function(file, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    logger.debug('readFile:', file, options);

    if (options.filesS3 || this.filesS3) {
        file = path.join(options.filesS3 || this.filesS3, path.normalize(file));
        core.modules.aws.s3GetFile(file, options, (err, params) => {
            if (params.status == 200) {
                if (options.json) params.data = lib.jsonParse(params.data, options); else
                if (options.xml) params.data = lib.xmlParse(params.data, options); else
                if (options.list) params.data = lib.strSplit(params.data, options.list);
            }
            lib.tryCall(callback, err, params.data);
        });
    } else {
        file = path.join(options.filesPath || core.path.files, path.normalize(file));
        lib.readFile(file, options, callback);
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
// - namekeep - keep the name of the uploaded file if present in the multipart form
// - encoding - encoding of the body, default is base64
// - allow - a Regexp with allowed MIME types, this will use detectFile method to discover file type by the contents
//
// On return the options may have the following properties set:
// - filesize - size of the file in bytes if available
// - mimetype - file mime type if detected
api.putFile = function(req, name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var btype = lib.typeName(req.body);
    var ext = options.ext ? (options.ext[0] == '.' ? "" : ".") + options.ext : "";
    var outfile = path.join(path.normalize(options.prefix || ""), path.basename(options.name || name) + ext);

    logger.debug("putFile:", name, outfile, options);

    if (req.files && req.files[name]) {
        if (options.namekeep && req.files[name].name) {
            outfile = path.join(path.dirname(outfile), path.basename(req.files[name].name));
        } else
        if (options.extkeep) {
            var ext = path.extname(req.files[name].name || req.files[name].path);
            if (ext) {
                var d = path.parse(outfile);
                d.ext = ext;
                outfile = path.format(d);
            }
        }
        options.filesize = req.files[name].size;
        this.detectStoreFile(req.files[name].path, outfile, options, callback);
    } else
    // JSON object submitted with .name property with the icon contents
    if (btype == "object" && req.body[name]) {
        var data = Buffer.from(req.body[name], options.encoding || "base64");
        this.detectStoreFile(data, outfile, options, callback);
    } else
    // Save a buffer as is
    if (btype == "buffer") {
        this.detectStoreFile(req.body, outfile, options, callback);
    } else
    // Query base64 encoded parameter
    if (req.query[name]) {
        var data = Buffer.from(req.query[name], options.encoding || "base64");
        this.detectStoreFile(data, outfile, options, callback);
    } else {
        lib.tryCall(callback);
    }
}

api.detectStoreFile = function(file, outfile, options, callback)
{
    if (util.isRegExp(options.allow)) {
        this.detectFile(file, function(err, type, ext) {
            logger.debug("detectStoreFile:", file, outfile, type, ext, "allow:", options.allow);
            if (err || !options.allow.test(type)) return lib.tryCall(callback, err);
            options.mimetype = type;
            if (ext) {
                options.ext = ext;
                outfile = path.join(path.dirname(outfile), path.basename(outfile, path.extname(outfile)) + "." + ext);
            }
            api.storeFile(file, outfile, options, callback);
        });
    } else {
        this.storeFile(file, outfile, options, callback);
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
        core.modules.aws.s3PutFile(outfile, tmpfile, { postsize: options.filesize }, function(err, params) {
            if (!err) return lib.tryCall(callback, err, outfile, params);
            logger.error('storeFile:', outfile, err, params.data, options);
            lib.tryCall(callback, err);
        });
    } else {
        outfile = path.normalize(path.join(options.filesPath || core.path.files, outfile));
        lib.makePath(path.dirname(outfile), function(err) {
            if (err) return lib.tryCall(callback, err);
            if (Buffer.isBuffer(tmpfile)) {
                fs.writeFile(outfile, tmpfile, function(err) {
                    if (!err) return lib.tryCall(callback, err, outfile);
                    logger.error('storeFile:', outfile, err, options);
                    lib.tryCall(callback, err);
                });
            } else {
                lib.moveFile(tmpfile, outfile, true, function(err) {
                    if (!err) return lib.tryCall(callback, err, outfile);
                    logger.error('storeFile:', outfile, err, options);
                    lib.tryCall(callback, err);
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
        fs.unlink(path.join(options.filesPath || core.path.files, file), function(err) {
            if (err) logger.error('delFile:', file, err);
            lib.tryCall(callback, err);
        })
    }
}

// Returns detected mime type and ext for a file
api.detectFile = function(file, callback)
{
    try {
        var magic = require("mmmagic");
        var m = new magic.Magic(magic.MAGIC_MIME_TYPE);
        m[Buffer.isBuffer(file) ? "detect" : "detectFile"](file, function(err, type) {
            lib.tryCall(callback, err, type, mime.getExtension(type));
        });
    } catch(err) {
        if (err) logger.error("detectFile:", file, err);
        lib.tryCall(callback, err);
    }
}
