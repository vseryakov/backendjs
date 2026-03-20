/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module image
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const color = require(__dirname + '/color');

const image = {
    name: "image",

    args: [
        { name: "black", descr: "Default color to use for black text" },
        { name: "white", descr: "Default color to use for white text" },
        { name: "background", descr: "Default background color for new images" },

    ],

    black: '#333',
    white: '#DDD',
    background: "#FFFFFF",
};

/**
 * Scaling and composing images with Sharp.js
 */

module.exports = image;

var sharp;

/**
 * Normalize padding-related options into a rectangle object.
 *
 * Accepts either side-specific padding values or axis-wide or single padding:
 * - `padding_top`, `padding_right`, `padding_bottom`, `padding_left` (highest priority)
 * - `padding_y` applies to top/bottom, `padding_x` applies to left/right
 * - `padding` applies to all sides
 *
 * Missing/undefined values are coerced via `lib.toNumber(...)`.
 *
 * @param {object} [options] Input options object.
 * @param {number|string} [options.padding] Padding for all sides.
 * @param {number|string} [options.padding_x] Padding for left/right.
 * @param {number|string} [options.padding_y] Padding for top/bottom.
 * @param {number|string} [options.padding_top] Padding for top side.
 * @param {number|string} [options.padding_right] Padding for right side.
 * @param {number|string} [options.padding_bottom] Padding for bottom side.
 * @param {number|string} [options.padding_left] Padding for left side.
 * @returns {{top:number,left:number,right:number,bottom:number}} Padding rectangle.
 * @memberof module:image
 */
image.padding = function(options)
{
    return {
        top: lib.toNumber(options.padding_top || options.padding_y || options.padding),
        left: lib.toNumber(options.padding_left || options.padding_x || options.padding),
        right: lib.toNumber(options.padding_right || options.padding_x || options.padding),
        bottom: lib.toNumber(options.padding_bottom || options.padding_y || options.padding)
    }
}

/**
 * Return region corresponding to the gravity
 * @param {string} gravity
 * @param {int} width
 * @param {int} height
 * @returns {object} - object { left, top, width, height }
 * @memberof module:image
 */
image.gravityRegion = function(gravity, width, height)
{
    const w = Math.floor(width / 3);
    const h = Math.floor(height / 3);
    const map = {
      northwest: [0, 0], north: [1, 0], northeast: [2, 0],
      west: [0, 1], center: [1, 1], east: [2, 1],
      southwest: [0, 2], south: [1, 2], southeast: [2, 2],
    };
    const [col, row] = map[gravity] || map.center;
    return {
        top: row * h,
        left: col * w,
        width: h,
        height: h
    };
}

/**
 * Return the stats about given region with inverted dominant color, if no region provided stats for the whole image
 * @param {Buffer|object} input - buffer or sharp object
 * @param {object} [region] - region to extract and return stats for
 * @returns {object} region stats with additional properties:
 * - `dominant` - dominant color
 * - `mean` - mean color as RGB
 * - `meta` - meta data object
 * - `image` - image as hidden property
 * @memberof module:image
 */
image.stats = async function(input, region)
{
    if (!sharp) sharp = lib.tryRequire('sharp');

    if (region?.width && region?.height) {
        input = Buffer.isBuffer(input) ? input : await input.toBuffer();
        const buffer = await sharp(input).extract(region).toBuffer();
        input = sharp(buffer);
    } else {
        input = Buffer.isBuffer(input) ? await sharp(input) : input;
    }

    const stats = await input.stats();
    stats.mean = {
        r: parseInt(stats.channels[0].mean),
        g: parseInt(stats.channels[1].mean),
        b: parseInt(stats.channels[2].mean)
    };

    stats.meta = await input.metadata();

    Object.defineProperty(stats, "image", {
        enumerable: false,
        value: input,
    })
    logger.debug("stats:", image.name, region, "stats:", stats);
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
 * @param {int} [options.width] - desired width, max width for text
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
 * @memberof module:image
 * @async
 */

image.create = async function(options)
{
    logger.debug("create:", image.name, "start:", options);

    const images = [];
    const border = lib.toNumber(options.border, { min: 0 });
    const radius = lib.toNumber(options.radius, { min: 0 });
    const padding = image.padding(options);

    let width = lib.toNumber(options.width, { min: 0 });
    let height = lib.toNumber(options.height, { min: 0 }) || width;

    if (!sharp) sharp = lib.tryRequire('sharp');

    var innerImage;

    if (options.data instanceof sharp && !(width || height)) {
        innerImage = options.data;
    } else

    if (options.file || options.data) {
        let input = lib.isString(options.file);

        if (options.data instanceof sharp) {
            input = await options.data.toBuffer();
        } else

        if (Buffer.isBuffer(options.data)) {
            input = options.data;
        } else

        if (lib.isString(options.data).startsWith("data:image/")) {
            input = Buffer.from(options.data.substr(options.data.indexOf("base64,") + 7), "base64");
        }

        innerImage = sharp(input, options.sharp);

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

            innerImage = sharp(buffer);
        }

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

        innerImage = sharp({
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

    } else {
        innerImage = sharp({
            create: {
                width: width || 1280,
                height: height || 1024,
                channels: 4,
                background: options.background || image.background,
            }
        });
    }

    const meta = await innerImage.metadata();
    width = options.inner_width = meta.width;
    height = options.inner_height = meta.height;
    const cw = width + border * 2;
    const ch = height + border * 2;

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
            border_color += Math.round(Number(255*lib.toNumber(options.border_alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
        }
        const borderImage = await sharp({
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
        padding_color += Math.round(Number(255*lib.toNumber(options.padding_alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
    }

    const pw = cw + padding.left + padding.right;
    const ph = ch + padding.top + padding.bottom;
    const outterImage = sharp({
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

    logger.debug("create:", image.name, "size:", options.id, width, height, "CW:", cw, ch, "PW:", pw, ph, "B:", border, "I:", images.length, "P:", padding);

    return image.convert(outterImage.composite(images), options);
}

/**
 * Apply Sharp image filters and conversions
 * @param {object} input - sharp image
 * @param {object}
 * @param {object[]} [options.filters] - filters, each operation must provide filter name and value as a map or an object
 * @returns {object} transformed image
 * @memberof module:image
 */
image.convert = async function(input, options)
{
    if (!lib.isArray(options?.filters)) return input.png();

    input = sharp(Buffer.isBuffer(input) ? input : await input.png().toBuffer());

    for (const filter of options.filters) {
        if (!ops.includes(filter?.name)) continue;
        let value = filter.value || undefined;
        if (lib.isString(value)) {
            value = lib.toMap(value, { maptype: "auto" });
        }
        logger.debug("convert:", image.name, options.id, filter);
        input[filter.name](value);
    }
    return input.png();
}

/**
 * Merge options from defaults to an item, supports format `id.name` where id must match options.id
 * @param {object} options
 * @param {object} [defaults]
 * @returns {object}
 * @memberof module:image
 */
image.mergeOptions = function(options, defaults)
{
    for (const p in defaults) {
        const v = defaults[p];
        if (v === undefined || v === null || v === "") continue;
        const [id, name] = p.split(".");
        // Item specific
        if (name) {
            if (id != options.id) continue;
            if (options[name] === undefined || options[name] === "") {
                options[name] = v;
                continue;
            }
        }
        // Global
        if (options[p] === undefined || options[p] === "") {
            options[p] = v;
        }
    }
    return options;
}

/**
 * Detect a text color to place on top of the area inside given background
 * @param {object} options - input item
 * @param {object} bgimage - Sharp image with background
 * @memberof module:image
 * @async
 */
image.detect = async function(options, bgimage)
{
    const input = await image.create(options);
    const meta = await input.metadata();

    const bgmeta = await bgimage.metadata();
    const region = image.gravityRegion(options.gravity, bgmeta.width, bgmeta.height);

    Object.assign({ id: options.id, gravity: options.gravity }, {
        top: options.top || region.top,
        left: options.left || region.left,
        width: meta.width,
        height: meta.height,
    });

    const stats = await image.stats(bgimage, region);

    let ncolor = color.negate(stats.dominant);

    lib.split(options.text_auto).forEach(x => {
        const old = ncolor;
        switch (x) {
        case "mean":
            ncolor = color.negate(stats.mean);
            break;

        case "complement":
            ncolor = color.rotate(ncolor);
            break;

        case "luminance":
            ncolor = color.rluminance(ncolor) > 0.179 ? color.hex2rgb(options.white || image.white) : color.hex2rgb(options.black || image.black);
            break;

        case "lighter":
            ncolor = color.lighter(ncolor);
            break;

        case "darker":
            ncolor = color.darker(ncolor);
            break;
        }
        logger.debug("detect:", image.name, options.id, x, ncolor, "old:", old, color.rluminance(old));
    });

    options.color = color.hex(ncolor);

    logger.debug("detect:", image.name, options, stats);

    return stats;
}

image.gradient = function(item)
{
    const width = item.meta.width;
    const height = item.meta.height;
    const tcolor = color.hex2rgb(item.color || "#000");
    let gcolor = color.negate(tcolor);

    const contrast = color.contrast(tcolor, gcolor);

    if (contrast < 2.5) {
        gcolor = color.lighter(gcolor);
    }
    const gl = color.rluminance(gcolor);
    if (gl < 0.5) {
        gcolor = { r: 128, g: 128, b: 128 };
    }
    const tl = color.rluminance(tcolor);

    gcolor = color.hex(gcolor);
    logger.debug("gradient:", image.name, item.id, width, height, "t:", item.color, tcolor, "g:", gcolor, "l:", tl, gl, contrast)

    return Buffer.from(`
    <svg width="${width}" height="${height}">
      <defs>
        <radialGradient id="grad" cx="50%" cy="50%" r="100%" fx="50%" fy="50%">
          <stop offset="0%"  stop-color="${gcolor}" stop-opacity="0.40"/>
          <stop offset="35%" stop-color="${gcolor}" stop-opacity="0.32"/>
          <stop offset="55%" stop-color="${gcolor}" stop-opacity="0.18"/>
          <stop offset="70%" stop-color="${gcolor}" stop-opacity="0.08"/>
          <stop offset="85%" stop-color="${gcolor}" stop-opacity="0.02"/>
          <stop offset="100%" stop-color="${gcolor}" stop-opacity="0"/>
        </radialGradient>
      </defs>
    <ellipse cx="${Math.round(width/2)}" cy="${Math.round(height/2)}" rx="${Math.round(width/2.5)}" ry="${Math.round(height/2.5)}" fill="url(#grad)" />
    </svg>`);
}

/**
 * Blend multiple images together, first image is used as the background for remaning items
 * @param {object[]} items - list of objects representing an image or text, properties are given to {@link module:image.create},
 *  additional string property `id` can be used to describe or distinguish items from each other
 * @param {object} [defaults] - defaults global for all items, same parameters
 * @returns {object[]} - same items list with additional properties: buffer, meta
 * @memberof module:image
 * @async
 */
image.composite = async function(items, defaults)
{
    logger.debug("composite:", image.name, items, defaults);

    if (!lib.isArray(items)) return [];

    // Use the first image as background
    const bgitem = items[0];
    const bgimage = await image.create(bgitem);

    // Render remaning elements individually, preseve the order
    const other = items.slice(1).filter(x => (x.file || x.data || x.text));

    await Promise.all(other.map(async (item) => {
        image.mergeOptions(item, defaults);

        // Autodetect text color for texts
        if (item.text && !item.color) {
            await image.detect(item, bgimage);
        }

        const img = await image.create(item);
        Object.defineProperty(item, "buffer", {
            enumerable: false,
            value: await img.toBuffer(),
        })
        item.meta = await img.metadata();

        if (lib.isFlag(lib.split(item.gradient), ["1", "true", item.type, item.id])) {
            let gradient = image.gradient(item);
            if (gradient) {
                gradient = await sharp(gradient).
                                   blur({ sigma: item.gradient_sigma || 25, minAmplitude: 0.01 }).
                                   png().
                                   toBuffer();

                Object.defineProperty(item, "gradient_buffer", {
                    enumerable: false,
                    value: gradient,
                })
            }
        }
    }));

    // Composite all elements onto the background
    const buffers = [];
    other.forEach(async (item) => {
        if (item.gradient_buffer) {
            buffers.push({
                input: item.gradient_buffer,
                blend: item.gradient_blend || undefined,
                gravity: item.gravity || undefined,
                top: item.top || undefined,
                left: item.left || undefined,
            })
        }
        buffers.push({
            input: item.buffer,
            gravity: item.gravity || undefined,
            blend: item.blend || undefined,
            top: item.top || undefined,
            left: item.left || undefined
        });
    });

    bgimage.composite(buffers);

    Object.defineProperty(bgitem, "buffer", {
        enumerable: false,
        value: await bgimage.png().toBuffer(),
    })
    bgitem.meta = await bgimage.metadata();

    logger.debug("composite:", image.name, "bg:", bgitem);

    return items;
}
