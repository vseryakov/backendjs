
/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/multipart
  */

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "middleware.multipart",
    args: [
        { name: "err-(.+)", descr: "Error messages for various cases" },
        { name: "path", type: "regexpobj", descr: "Paths that expect multipart/form-data payloads, parsing will happen after the signature processed automatically, other routes need to call middleware.multipart.handle explicitely", example: "middleware-multipart-path = ^/upload" },
        { name: "max-size", type: "number", descr: "Max size for uploads in bytes" },
        { name: "max-(files|fields)", type: "number", descr: "Max number of files or fields in uploads" },
    ],

    maxFiles: 10,
    maxFields: 100,
    maxSize: 25000000,

    errTooLarge: "Unable to process the request, it is too large",
};

module.exports = mod;

var _formidable;

/**
 * Parse multipart forms for uploaded files, this must be called explicitly by the endpoints that need uploads.
 * The api module handles uploads automatically for configured paths via `-api-body-multipart` config parameter.
 * Store parsed data in the `context.files` and `context.body`.
 *
 * @example
 *
 * api.app.use(middleware.multipart.handle);
 *
 * api.app.post("/upload", (req, res, next) => {
 *     if (req.files.file) ....
 * })
 *
 * // Another global way to handle uploads for many endpoints is to call it for all known paths at once before the actual upload handlers.
 *
 * api.app.post(/^\/upload\//, middleware.multipart.handle, (req, res, next) => (next("route")));
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 * ...
 * api.app.post("/upload/icon", (req, res, next) => {
 */
    
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
    if (_formidable === undefined) {
        _formidable = lib.tryRequire('formidable', { logger: "debug", message: "multipart uploads are disabled" });
    }
    if (!_formidable) return next();

    const { req, contentType } = context;

    if (contentType != 'multipart/form-data') return next();

    if (!this.path?.rx || !this.path.rx.test(context.path)) return next();

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
    const trace = context.trace?.start("handleMultipart");

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
        form.emit("error", lib.newError({ message: mod.errTooLarge, code: "toolarge", status: 413, maxsize: this.maxSize, length: bytesExpected }));
    });

    form.parse(req, (err) => {
        logger.debug("parse:", mod.name, err, context, data, Object.keys(files));
        if (err) {
            if (err && /maxFile|maxField|maxTotal/.test(err.message)) {
                err = { message: mod.errTooLarge, code: "toolarge", status: 413 };
            }
            trace.stop(err);
            return next(err);
        }
        try {
            context.body = data;
            context.files = files;
            context.on("destroy", (ctx) => {
                for (const p in ctx.files) {
                    if (ctx.files[p]?.path) {
                        lib.unlink(ctx.files[p].path);
                    }
                }
            });

            trace?.stop();
            next();
        } catch (e) {
            e.status = 400;
            e.title = "handle:" + mod.name;
            trace?.stop(e);
            next(e);
        }
    });
}
