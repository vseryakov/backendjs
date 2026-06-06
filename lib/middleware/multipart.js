
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/multipart
  */

const app = require(__dirname + '/../app');
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.multipart",
    args: [
        { name: "global", type: "bool", descr: "Enable the middlware to serve multipart by content type for all routes" },
        { name: "max-size", type: "number", descr: "Max size for uploads in bytes" },
        { name: "max-(files|fields)", type: "number", descr: "Max number of files or fields in uploads" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    maxFiles: 10,
    maxFields: 100,
    maxSize: 25000000,

    errTooLarge: "Unable to process the request, it is too large",
};

/**
 * Parse multipart content for uploaded files.
 *
 * Store parsed data in the `context.files` and `context.body`.
 *
 * In global mode the middleware handles uploads automatically for all paths via `-middleware-multipart-global = true` or manually
 * enabling it for all paths.
 *
 * @example <caption> Config bkjs.conf </caption>
 *
 * middleware-multipart-global = true
 *
 * @example <caption>In the code:</caption>
 *
 * api.app.post("*", middleware.multipart);
 *
 * api.app.post("/upload", (context, next) => {
 *     if (context.files.file) ....
 * })
 *
 * @example <caption>Another global way to handle uploads for many endpoints is to call it for all known
 * paths at once before the actual upload handlers.</caption>
 *
 * api.app.post("/upload/", middleware.multipart);
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 */
module.exports = mod;

var _formidable;


/**
 * Start global middleware, enable multipart parser for all endpoints
 *
 * @memberof module:middleware/multipart
 * @method configureMiddleware
 */
mod.configureMiddleware = function(options, callback)
{
    if (this.global) {
        api.app.post("*", mod);
    }

    callback();
}
    
/**
 * Multipart middleware
 * 
 * @param {RequestContext} context
 * @param {function} next
 *
 * @memberof module:middleware/multipart
 * @method handle
 */
mod.handle = function(context, next)
{
    const { req, contentType } = context;

    if (contentType != 'multipart/form-data') return next();

    if (_formidable === undefined) {
        _formidable = lib.tryRequire('formidable', { logger: "debug", message: "multipart uploads are disabled" });
    }
    if (!_formidable) return next();

    const opts = {
        uploadDir: app.tmpDir,
        allowEmptyFiles: true,
        keepExtensions: true,
        maxFiles: this.maxFiles,
        maxFileSize: this.maxSize,
        maxFields: this.maxFields,
        maxFieldsSize: this.maxSize,
    };

    const form = _formidable.formidable(opts);

    var data = Object.create(null), files = Object.create(null);

    form.on('field', (name, val) => {
        if (Array.isArray(data[name])) {
            data[name].push(val);
        } else
        if (data[name]) {
            data[name] = [data[name], val];
        } else {
            data[name] = val;
        }
    });

    form.on('file', (name, val) => {
        val = val.toJSON();
        val.path = val.filepath;
        val.name = val.originalFilename;
        files[name] = val;
    });

    form.on('progress', (bytesReceived, bytesExpected) => {
        if (bytesExpected < this.maxSize) return;
        form.emit("error", { message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: bytesExpected });
    });

    form.parse(req, (err) => {
        if (err) {
            if (err && /maxFile|maxField|maxTotal/.test(err.message)) {
                logger.debug("handle:", mod.name, "too large:", context, err);
                err = { message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize };
            }
            return next(err);
        }
        logger.debug("parse:", mod.name, err, context, data, Object.keys(files));

        context.body = data;
        context.files = files;
        context.on("destroy", (ctx) => {
            for (const p in ctx.files) {
                if (ctx.files[p]?.path) {
                    lib.unlink(ctx.files[p].path);
                }
            }
        });

        next();
    });
}
