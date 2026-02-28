/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module files/image
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod = {
    name: "files.image",
};

/**
 * Scaling and composing images with Sharp.js
 */

module.exports = mod;

/**
 * Return region corresponding to the gravity
 * @param {string} gravity
 * @param {int} width
 * @param {int} height
 * @returns {object} - object { left, top, width, height }
 * @memberof module:files/image
 * @method gravityRegion
 */
mod.gravityRegion = function(gravity, width, height)
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
 * Return the stats about given region with inverted dominant color, if no region provided stats for the whole image
 * @param {Buffer|object} image
 * @param {object|string} [options] - gravity string or an object
 * @param {string} [options.gravity]
 * @param {object} [options.region] { top, left, width, height }
 * @param {boolean} [options.mean] - use mean color for inverted text color
 * @returns {object} region stats with additional properties:
 *  - `color` - inverted diminant color
 *  - `mean` - mean color as RGB
 *  - `meta` - meta data object
 * @memberof module:files/image
 * @method stats
 */
mod.stats = async function(image, options)
{
    if (!mod.sharp) mod.sharp = lib.tryRequire('sharp');

    if (options?.region?.width || options?.gravity) {
        let region;
        image = Buffer.isBuffer(image) ? image : await image.toBuffer();

        if (options.region?.width) {
            region = options.region;
        } else {
            const meta = await mod.sharp(image).metadata();
            region = mod.gravityRegion(options.gravity, meta.width, meta.height);
        }
        const buffer = await mod.sharp(image).extract(region).toBuffer();
        image = mod.sharp(buffer);
    } else {
        image = Buffer.isBuffer(image) ? await mod.sharp(image) : image;
    }

    const stats = await image.stats();

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

    stats.meta = await image.metadata();
    return stats;
}

const ops = [
    "autoOrient", "rotate", "flip", "flop", "affine", "sharpen", "erode",
    "dilate", "median", "blur", "flatten", "unflatten", "gamma", "negate", "normalise",
    "normalize", "clahe", "convolve", "threshold", "boolean", "linear", "recomb", "modulate",
    "trim", "extend", "extract",
];

/**
 * Apply Sharp image filters and conversions
 * @param {object} sharp image
 * @param {object} options, each operation must provide its own object with params by name
 * @returns {object}
 * @memberof module:files/image
 * @method convert
 */
mod.convert = function(image, options)
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
 * @param {int} [options.width]
 * @param {int} [options.height]
 * @param {string} [options.background=#FFFFFF] - main background color
 * @param {int} [options.border] - border size in px
 * @param {string} [options.border_color=FFFFFFF0] - border color
 * @param {number} [options.border_radius] - make border round, this is divider of the size
 * @param {int} [options.padding] - transparent padding around image
 * @param {number} [options.padding_x]
 * @param {number} [options.padding_y]
 * @param {number} [options.padding_top]
 * @param {number} [options.padding_bottom]
 * @param {number} [options.padding_left]
 * @param {number} [options.padding_right]
 * @param {int} [options.padding_color] - padding background color
 * @param {string} [options.fit] - resize mode
 * @param {string} [options.position]
 * @param {string} [options.kernel]
 * @param {string} [options.strategy]
 * @param {string} [options.gravity]
 * @param {boolean} [options.withoutEnlargement]
 * @param {boolean} [options.withoutReduction]
 * @param {boolean} [options.fastShrinkOnLoad]
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
 * @returns {Promise} - a sharp object containing an image, as PNG
 * @memberof module:files/image
 * @method create
 * @async
 */

mod.create = async function(options)
{
    logger.debug("create:", mod.name, "start:", options);

    const images = [];
    const border = lib.toNumber(options.border, { min: 0 });
    const radius = lib.toNumber(options.radius, { min: 0 });
    const padding = {
        top: lib.toNumber(options.padding_top || options.padding_y || options.padding),
        left: lib.toNumber(options.padding_left || options.padding_x || options.padding),
        right: lib.toNumber(options.padding_right || options.padding_x || options.padding),
        bottom: lib.toNumber(options.padding_bottom || options.padding_y || options.padding)
    };

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

    logger.debug("create:", mod.name, "size:", width, height, "CW:", cw, ch, "B:", border, "I:", images.length, "P:", padding);

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

const add = async (rc, name, opts, image) => {
    const meta = await image.metadata();
    logger.debug("add:", name, opts, meta);
    rc[name] = Object.assign(opts, { meta });
    rc[name].buffer = await image.toBuffer();
}

/**
 * Blend multiple images together
 * @param {object} options - an object with each image represented by a named object
 * @returns {object} - resulting image with $ property to be the final composite
 * @memberof module:files/image
 * @method composite
 * @async
 */
mod.composite = async function(options)
{
    logger.debug("compose:", mod.name, options);

    // Render the first image as background
    const bg = Object.keys(options).find(x => (options[x].file));
    const bgopts = Object.assign({ name: bg }, options[bg]);
    const bgimage = await mod.create(bgopts);

    const rc = Object.keys(options).
               filter(name => (name != bg && (options[name]?.text || options[name]?.file))).
               reduce((a, b) => { a[b] = ""; return a }, {});

    // Render all elements individually, preseve the order
    await Promise.all(Object.keys(rc).
        map(async (name) => {
            const opts = Object.assign({ name }, options[name]);

            // Autodetect text color from the background
            if (opts.text && !opts.color) {
                const stats = await mod.stats(bgimage, opts);
                opts.color = stats.color;
                logger.debug("compose:", "dominant:", name, opts, stats);
            }

            return mod.create(opts).then(async (image) => {
                await add(rc, name, opts, image);
            });
        }));

    // Composite all elements onto the background
    const buffers = Object.keys(rc).map(x => ({
        input: rc[x].buffer,
        gravity: rc[x].gravity,
        top: rc[x].top,
        left: rc[x].left
    }));

    bgimage.composite(buffers).jpeg();

    await add(rc, "$", bgopts, bgimage);

    return rc;
}
