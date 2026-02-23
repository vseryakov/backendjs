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
 * @param {string} [options.outfile] - if not empty is a file name where to store scaled image or if empty the new image contents will be returned in the callback as a buffer
 * @param {int} [options.width] - new width
 * @param {int} [options.height] - new image height
 *  - if width or height is negative this means do not perform upscale, keep the original size if smaller than given positive value,
 *  - if any is 0 that means keep the original size
 * @param {string} [options.ext] - image format: png, gif, jpg, svg
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
        if (!mod.sharp) mod.sharp = lib.tryRequire('sharp');
        if (!mod.sharp) {
            return lib.tryCall(callback, { status: 500, message: "service unavailable" });
        }

        var img = mod.sharp(infile);

        lib.series([
            function(next) {
                img.metadata((err, inf) => {
                    if (err) return next(err);

                    if (!options.height) {
                        delete options.height;
                    } else
                    if (options.height < 0) {
                        options.height = inf.height < Math.abs(options.height) ? inf.height : Math.abs(options.height);
                    }
                    if (!options.width) {
                        delete options.width;
                    } else
                    if (options.width < 0) {
                        options.width = inf.width < Math.abs(options.width) ? inf.width : Math.abs(options.width);
                    }
                    try {
                        img.toFormat(options.ext).resize(options);
                    } catch (e) {
                        return next(e);
                    }
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
                });
            },
        ], (err) => {
            if (!err) info.ext = info.format == "jpeg" ? "jpg" : info.format;
            logger[err ? "error": "debug"]('scale:', mod.name, Buffer.isBuffer(infile) ? "Buffer:" + infile.length : infile, options, info, err);
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
 * @param {string} [options.type] may contain special placeholders:
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
        var s3url = options?.imagesS3 || this.s3;
        var s3opts = options?.imagesS3Options || this.s3Options;
        if (s3url && s3opts) {
            s3opts.url = true;
            file = modules.aws.signS3("GET", s3url, path.normalize(file), "", s3opts);
        } else {
            var imagesUrl = options?.imagesUrl || this.url;
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
 * @param {boolean} [options.autodel] - if true, auto delete the base64 icon property from the query or the body after it is decoded, this is to
 *   mark it for deallocation while the icon is being processed, the worker queue is limited so with large number of requests
 *   all these query objects will remain in the query wasting memory
 * @param {boolean} [options.verify] - check the given image of file header for known image types
 * @param {regexp} [options.extkeep] - a regexp with image types to preserve, not to convert into the specified image type
 * @param {string} [options.ext] - the output file extention without dot, ex: jpg, png, gif....
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
 * @param {object} options - same properties as in {@link module:api/images.scale}: width, height, filter, ext, quality
 * @param {string} [options.type] - icon type, this will be prepended to the name of the icon, there are several special types:
 *     - @uuid@ - auto generate an UUID
 *     - @now@ - use current timestamp
 *     - @filename@ - if filename is present the basename without extension will be used
 * @param {string} [options.prefix] - top level subdirectory under images/
 * @param {int} [options.filesize] - file size if available
 * @param {string} [options.filename] - name of a file uploaded if available
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

    if (this.s3 || options.imagesS3) {
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
mod.del = function(id, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var icon = this.getPath(id, options);
    logger.debug('delImage:', id, options);

    if (this.s3 || options?.imagesS3) {
        modules.aws.queryS3(options?.imagesS3 || this.s3, icon, { method: "DELETE" }, (err, params) => {
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
 * Returns detected image type if the given buffer contains an image, it checks the header only
 * @param {buffer} buf
 * @Returns {string}
 * @memberof module:api/images
 * @method isImage
 */
mod.isImage = function(buf)
{
    if (!Buffer.isBuffer(buf)) return;
    var hdr = buf.slice(0, 4).toString("hex");
    if (hdr === "ffd8ffe0") return "jpg";
    if (hdr === "ffd8ffe1") return "jpg";
    if (hdr === "89504e47") return "png";
    if (hdr === "47494638") return "gif";
    if (hdr.slice(0, 4) === "424d") return "bmp";
}

/**
 * Returns an object with padding values to be used in sharp.extend method
 * @param {object} options
 * @Returns {object}
 * @memberof module:api/images
 * @method getPadding
 */
mod.getPadding = function(options)
{
    return {
        top: lib.toNumber(options?.padding_top || options?.padding_y || options?.padding),
        left: lib.toNumber(options?.padding_left || options?.padding_x || options?.padding),
        right: lib.toNumber(options?.padding_right || options?.padding_x || options?.padding),
        bottom: lib.toNumber(options?.padding_bottom || options?.padding_y || options?.padding)
    }
}

/**
 * Return region corresponding to the gravity
 * @param {string=center} gravity
 * @param {int} width
 * @param {int} height
 * @returns {object} - object { left, top, width, height }
 * @memberof module:api/images
 * @method getGravityRegion
 */
mod.getGravityRegion = function(gravity, width, height)
{
    const w = Math.round(width / 3);
    const h = Math.round(height / 3);
    const map = {
      northwest: [0, 0], north: [1, 0], northeast: [2, 0],
      west: [0, 1], center: [1, 1], east: [2, 1],
      southwest: [0, 2], south: [1, 2], southeast: [2, 2],
    };
    const [col, row] = map[gravity] || map.center;
    return { left: col * w, top: row * h, width: h, height: h };
}

/**
 * Return the stats about given region with inverted dominant color
 * @param {Buffer|object} image
 * @param {object|string} [options] - gravity string or an object
 * @param {string} [options.gravity]
 * @param {object} [options.region] { top, left, width, height }
 * @param {boolean} [options.mean] - use mean color for inverted text color
 * @returns {object} region stats with additional properties:
 *   `color` - inverted diminant color, `mean` color
 * @memberof module:api/images
 * @method getRegionStats
 */
mod.getRegionStats = async function(image, options)
{
    if (!mod.sharp) mod.sharp = lib.tryRequire('sharp');
    image = Buffer.isBuffer(image) ? image : await image.toBuffer();
    const meta = await mod.sharp(image).metadata();
    const region = options?.region?.width ? options.region :
                      mod.getGravityRegion(options?.gravity || options, meta.width, meta.height)
    logger.debug("getRegionStats:", mod.name, options, meta, region);
    const buffer = await mod.sharp(image).extract(region).toBuffer();
    const stats = await mod.sharp(buffer).stats();

    stats.mean = {
        r: parseInt(stats.channels[0].mean),
        g: parseInt(stats.channels[1].mean),
        b: parseInt(stats.channels[2].mean)
    };
    const { r, g, b } = options?.mean ? stats.mean : stats.dominant;
    stats.color = "#" +
           parseInt(255 - r).toString(16).padStart(2, "0") +
           parseInt(255 - g).toString(16).padStart(2, "0") +
           parseInt(255 - b).toString(16).padStart(2, "0");
    return stats;
}

const ops = [
    "autoOrient", "rotate", "flip", "flop", "affine", "sharpen", "erode",
    "dilate", "median", "blur", "flatten", "unflatten", "gamma", "negate", "normalise",
    "normalize", "clahe", "convolve", "threshold", "boolean", "linear", "recomb", "modulate",
    "trim", "extend", "extract",
];

/**
 * Apply image filters and conversions
 * @param {object} sharp image
 * @param {object} options, each operation must provide its own object with params by name
 * @returns {object}
 * @memberof module:api/images
 * @method convertImage
 */
mod.convertImage = function(image, options)
{
    for (const op in options) {
        if (ops.includes(op)) image[op](options[op]);
    }
    return image;
}

/**
 * Create an image from a photo or text, supports raunded corners, borders
 * @param {object} options
 * @param {string|Buffer} [options.file] - input file or image data
 * @param {object} [options.sharp] - raw Sharp options
 * @param {string} [options.background=#FFFFFF] - main background color
 * @param {int} [options.border] - border size in px
 * @param {string} [options.border_color=FFFFFFF0] - border color
 * @param {number} [options.border_radius] - make border round, this is divider of the size
 * @param {int} [options.padding] - transparent padding around avatar
 * @param {int} [options.padding_color] - padding background color
 * @param {number} [options.radius] - make it round, inner and outer layers, this is divider of the size
 * @param {string} [options.text] - text to render
 * @param {string} [options.color] - text color
 * @param {string} [options.alpha] - text opacity 0-65535 or 50%
 * @param {string} [options.bgalpha] - text background opacity 0-65535 or 50%
 * @param {string} [options.font] - font family
 * @param {string} [options.fontfile] - font file
 * @param {string} [options.weight] - One of `ultralight, light, normal, bold, ultrabold, heavy`, or a numeric weight.
 * @param {int} [options.size] - font size in 1024ths of a point, or in points (e.g. 12.5pt), or one of the absolute sizes
 *  xx-small, x-small, small, medium, large, x-large, xx-large, or a percentage (e.g. 200%), or one of
 *  the relative sizes smaller or larger.
 * @param {string} [options.stretch] - One of `ultracondensed, extracondensed, condensed, semicondensed, normal, semiexpanded,
 *   expanded, extraexpanded, ultraexpanded`.
 * @param {string} [options.style] - One of `normal, oblique, italic`.
 * @param {int} [options.spacing] - font spacing
 * @param {int} [options.dpi=72] - text size in DPI
 * @param {boolean} [options.justify=true] - text justification
 * @param {string} [options.wrap] - text wrapping if width is provided: `word, char, word-char, none`
 * @param {string} [options.align] - text aligment: `left, centre, center, right`
 * @param {string} [options.blend] - how to blend image, one of `clear, source, over, in, out, atop, dest,
 *  dest-over, dest-in, dest-out, dest-atop, xor, add, saturate, multiply, screen, overlay, darken,
 * lighten, colour-dodge, color-dodge, colour-burn,color-burn, hard-light, soft-light, difference, exclusion`.
 * @returns {Promise} - a sharp object containing an image
 * @memberof module:api/images
 * @method createAvatar
 * @async
 */
mod.createImage = async function(options)
{
    logger.debug("createImage:", mod.name, "start:", options);

    const images = [];
    const padding = mod.getPadding(options);
    const border = lib.toNumber(options.border, { min: 0 });
    const radius = lib.toNumber(options.radius, { min: 0 });

    let width = lib.toNumber(options.width, { min: 0 });
    let height = lib.toNumber(options.height, { min: 0 }) || width;

    let cw = width + border * 2;
    let ch = height + border * 2;

    if (!mod.sharp) mod.sharp = lib.tryRequire('sharp');

    var innerImage;

    if (options.file) {
        innerImage = await mod.sharp(options.file, options.sharp);

        if (width || height) {
            innerImage.resize({
                width,
                height,
                fit: options.fit || "cover",
                position: options.position,
                strategy: options.strategy,
                kernel: options.kernel,
                background: options.background,
                withoutEnlargement: options.withoutEnlargement,
                withoutReduction: options.withoutReduction,
                fastShrinkOnLoad: options.fastShrinkOnLoad,
            });
        } else {
            const meta = await innerImage.metadata();
            width = meta.width;
            height = meta.height;
            cw = width + border * 2;
            ch = height + border * 2;
        }

    } else

    if (options.text) {
        let text = lib.isString(options.text).replaceAll("\\n", "\n");
        const attrs = [];
        for (const p of ["color", "size", "weight", "style", "stretch",
                         "strikethrough", "strikethrough_color",
                         "underline", "underline_color",
                         "line_height", "segment", "letter_spacing", "allow_breaks", "rise", "baseline_shift",
                         "font_features", "gravity_hint", "text_gravity",
                         "alpha", "bgalpha"]) {
            if (options[p]) attrs.push(`${p.replace(/^text_/, "")}="${options[p]}"`);
        }
        if (attrs.length) text = `<span ${attrs.join(" ")}>${text}</span>`;

        innerImage = await mod.sharp({
            text: {
                rgba: true,
                text,
                height: height || undefined,
                width: width || undefined,
                font: options.font || undefined,
                fontfile: options.fontfile || undefined,
                dpi: options.dpi || undefined,
                spacing: options.spacing || undefined,
                align: options.align || undefined,
                justify: lib.toBool(options.justify),
                wrap: options.wrap || "word",
            }
        });

        const meta = await innerImage.metadata();
        width = meta.width;
        height = meta.height;
        cw = width + border * 2;
        ch = height + border * 2;

    } else {
        innerImage = mod.sharp({
            create: {
                width: width || 1280,
                height: height || 1024,
                channels: 4,
                background: options.background || "#FFFFFF"
            }
        });
    }

    if (radius) {
        innerImage.
            composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(width/radius)}" ry="${Math.round(height/radius)}"/></svg>`),
                blend: options.radius_blend || options.blend || 'dest-in'
            }]);
    }

    if (border) {
        const borderImage = await mod.sharp({
            create: {
                width: cw,
                height: ch,
                channels: 4,
                background: options.border_color || { r: 255, g: 255, b: 255, alpha: 0.5 }
            }
        });

        const bradius = lib.toNumber(options.border_radius || radius, { min: 0 });
        if (bradius) {
            borderImage.composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${cw}" height="${ch}" rx="${Math.round(cw/bradius)}" ry="${Math.round(ch/bradius)}"/></svg>`),
                blend: options.border_blend || options.blend || 'dest-in'
            }]);
        }

        images.push({
            input: await borderImage.png().toBuffer(),
            top: padding.top,
            left: padding.left,
        });
    }

    logger.debug("createImage:", mod.name, "size:", width, height, "CW:", cw, ch, "B:", border, "I:", images.length, "P:", padding);

    // Return if nothing to merge with
    if (!images.length && !border && !(padding.top + padding.left + padding.right + padding.bottom)) {
        return innerImage.png();
    }

    // Place inside the border background
    images.push({
        input: await innerImage.png().toBuffer(),
        top: border + padding.top,
        left: border + padding.left,
    });

    return mod.sharp({
        create: {
            width: cw + padding.left + padding.right,
            height: ch + padding.top + padding.bottom,
            channels: 4,
            background: options.padding_color || { r: 0, g: 0, b: 0, alpha: 0 }
        }
    }).
    composite(images).
    png();
}
