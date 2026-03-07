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

const _padding = (options, name, side) => (
    lib.isNumber(options[name]) || lib.toNumber(options[name]) ||
    lib.isNumber(options[side]) || lib.toNumber(options[side]) ||
    lib.toNumber(options.padding)
)

mod.paddingRegion = function(options)
{
    return {
        left: _padding(options, "padding_left", "padding_x"),
        right: _padding(options, "padding_right", "padding_x"),
        top: _padding(options, "padding_top", "padding_y"),
        bottom: _padding(options, "padding_bottom", "padding_y"),
    }
}

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
    const w = Math.floor(width / 3);
    const h = Math.floor(height / 3);
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
        let region, meta;
        image = Buffer.isBuffer(image) ? image : await image.toBuffer();

        if (options.region?.width) {
            region = options.region;
        } else {
            meta = await mod.sharp(image).metadata();
            region = mod.gravityRegion(options.gravity, meta.width, meta.height);
        }

        logger.debug("stats:", mod.name, options.id, options.gravity, "region:", region, "meta:", meta?.width, meta?.height);
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
 * Create an image from a photo or text, supports raunded corners, borders
 * @param {object} options
 * @param {string|Buffer} [options.file] - input file name
 * @param {Buffer|string} [options.data] - image buffer or data:image/*;base64, takes precedence over file name
 * @param {int} [options.width] - desired width, max widthfor texts
 * @param {int} [options.height] - desired height, defaults to width if not given
 * @param {string} [options.background=#FFFFFF] - main background color
 * @param {int} [options.border] - border size in px
 * @param {string} [options.border_color=FFFFFFF0] - border color
 * @param {number} [options.border_radius] - make border round, this is divider of the size
 * @param {number} [options.padding] - transparent padding around image
 * @param {number} [options.padding_x]
 * @param {number} [options.padding_y]
 * @param {number} [options.padding_top]
 * @param {number} [options.padding_bottom]
 * @param {number} [options.padding_left]
 * @param {number} [options.padding_right]
 * @param {int} [options.padding_color] - padding background color
 * @param {number} [options.padding_radius] - make padding round
 * @param {string} [options.fit] - resize mode
 * @param {string} [options.position]
 * @param {string} [options.kernel]
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
 * @param {string} [options.size] - font size in 1024ths of a point, or in points (e.g. 12.5pt), or one of the absolute sizes
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
 * @param {object} [options.sharp] - additional raw Sharp options
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
    const padding = mod.paddingRegion(options);

    let width = lib.toNumber(options.width, { min: 0 });
    let height = lib.toNumber(options.height, { min: 0 }) || width;

    let cw = width + border * 2;
    let ch = height + border * 2;

    if (!mod.sharp) mod.sharp = lib.tryRequire('sharp');

    var innerImage;

    if (options.file || options.data) {
        let file = options.file;

        if (Buffer.isBuffer(options.data)) {
            file = options.data;
        } else

        if (lib.isString(options.data).startsWith("data:image/")) {
            file = Buffer.from(options.data.substr(options.data.indexOf("base64,") + 7), "base64");
        }

        innerImage = await mod.sharp(file, options.sharp);

        if (width || height) {
            const buffer = await innerImage.resize({
                width,
                height,
                fit: options.fit || undefined,
                position: options.position || undefined,
                kernel: options.kernel || undefined,
                background: options.background,
                withoutEnlargement: options.withoutEnlargement,
                withoutReduction: options.withoutReduction,
                fastShrinkOnLoad: options.fastShrinkOnLoad,
            }).toBuffer();

            innerImage = await mod.sharp(buffer);
        }

        const meta = await innerImage.metadata();
        width = meta.width;
        height = meta.height;
        cw = width + border * 2;
        ch = height + border * 2;

    } else

    if (options.text) {
        let text = lib.isString(options.text).replaceAll("\\n", "\n");
        const attrs = [];
        for (const p of ["color", "bgcolor", "size", "weight", "style", "stretch",
                         "strikethrough", "strikethrough_color",
                         "underline", "underline_color",
                         "line_height", "segment", "letter_spacing", "allow_breaks", "rise", "baseline_shift",
                         "font_features", "gravity_hint", "text_gravity",
                         "alpha", "bgalpha"]) {
            let val = options[p];
            if (val) {
                if (p.endsWith("alpha") && val.at(-1) != "%") val += "%";
                attrs.push(`${p.replace(/^text_/, "")}="${val}"`);
            }
        }
        if (attrs.length) text = `<span ${attrs.join(" ")}>${text}</span>`;

        logger.debug("composite:", "text:", options.id, text);

        innerImage = await mod.sharp({
            text: {
                rgba: true,
                text,
                height: !options.dpi && height || undefined,
                width: width || undefined,
                font: options.font || undefined,
                fontfile: options.fontfile || undefined,
                dpi: lib.toNumber(options.dpi) || undefined,
                spacing: lib.toNumber(options.spacing) || undefined,
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
        let border_color = options.border_color;
        if (border_color && options.border_alpha) {
            border_color += Math.round(Number(255*lib.toNumber(options.border_alpha, { min: 0, max: 100 })/100)).toString(16);
        }
        const borderImage = await mod.sharp({
            create: {
                width: cw,
                height: ch,
                channels: 4,
                background: border_color || { r: 255, g: 255, b: 255, alpha: 0.5 }
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

    // Place inside the border background
    images.push({
        input: await innerImage.png().toBuffer(),
        top: border + padding.top,
        left: border + padding.left,
    });

    let padding_color = options.padding_color;
    if (padding_color && options.padding_alpha) {
        padding_color += Math.round(Number(255*lib.toNumber(options.padding_alpha, { min: 0, max: 100 })/100)).toString(16);
    }

    const pw = cw + padding.left + padding.right;
    const ph = ch + padding.top + padding.bottom;
    const outterImage = mod.sharp({
        create: {
            width: pw,
            height: ph,
            channels: 4,
            background: padding_color || { r: 0, g: 0, b: 0, alpha: 0 }
        }
    });

    const pradius = lib.toNumber(options.padding_radius, { min: 0 });
    if (pradius) {
        images.push({
            input: Buffer.from(`<svg><rect x="0" y="0" width="${pw}" height="${ph}" rx="${Math.round(pw/pradius)}" ry="${Math.round(ph/pradius)}"/></svg>`),
            blend: options.padding_blend || options.blend || 'dest-in'
        });
    }

    logger.debug("create:", mod.name, "size:", options.id, width, height, "CW:", cw, ch, "PW:", pw, ph, "B:", border, "I:", images.length, "P:", padding);

    return mod.convert(outterImage.composite(images), options);
}

/**
 * Apply Sharp image filters and conversions
 * @param {object} sharp image
 * @param {object}
 * @param {object[]} [options.filters] - filters, each operation must provide filter name and value as a map or an object
 * @returns {object} transformed image
 * @memberof module:files/image
 * @method convert
 */
mod.convert = async function(image, options)
{
    if (!lib.isArray(options?.filters)) return image.png();

    image = await mod.sharp(Buffer.isBuffer(image) ? image : await image.png().toBuffer());

    for (const filter of options.filters) {
        if (!ops.includes(filter?.name)) continue;
        let value = filter.value || undefined;
        if (lib.isString(value)) {
            value = lib.toMap(value, { maptype: "auto" });
        }
        logger.debug("convert:", mod.name, options.id, filter);
        image[filter.name](value);
    }
    return image.png();
}

/**
 * Blend multiple images together
 * @param {object[]} items - list of objects representing an image or text, properties are given to {@link module:files/image.create},
 *  additional string property `id` can be used to describe or distinguish items from each other
 * @param {object} [options] - defaults global for all items, same parameters
 * @returns {object[]} - resulting images, the last image is the final composite of all
 * @memberof module:files/image
 * @method composite
 * @async
 */
mod.composite = async function(items, options)
{
    logger.debug("composite:", mod.name, items, options);

    const rc = [];
    if (!lib.isArray(items)) return rc;

    // Render the first image as background
    const bgitem = items.find(item => item.file) || {};
    const bgimage = await mod.create(bgitem);

    // Remaining valid items to render
    items = items.filter(item => (item !== bgitem && (item.text || item.file)));

    // Render all elements individually, preseve the order
    await Promise.all(items.
        map(async (item) => {
            // Apply global defaults
            for (const p in options) {
                if (options[p] !== undefined && (item[p] === undefined || item[p] === "")) {
                    item[p] = options[p];
                }
            }

            // Autodetect text color from the background
            if (item.text && !item.color) {
                const stats = await mod.stats(bgimage, item);
                item.color = stats.color;
                logger.debug("composite:", "dominant:", item, stats);
            }

            return mod.create(item).then(async (image) => {
                item.meta = await image.metadata();
                item.buffer = await image.toBuffer();
                rc.push(item);
            });
        }));

    // Composite all elements onto the background
    const buffers = Object.keys(rc).map(x => ({
        input: rc[x].buffer,
        gravity: rc[x].gravity || undefined,
        blend: rc[x].blend || undefined,
        top: rc[x].top || undefined,
        left: rc[x].left || undefined
    }));

    bgimage.composite(buffers).png();

    bgitem.meta = await bgimage.metadata();
    bgitem.buffer = await bgimage.toBuffer();
    rc.push(bgitem);

    return rc;
}
