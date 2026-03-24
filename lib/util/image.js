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
 * Normalize padding-related item into a rectangle object.
 *
 * Accepts either side-specific padding values or axis-wide or single padding:
 * - `padding_top`, `padding_right`, `padding_bottom`, `padding_left` (highest priority)
 * - `padding_y` applies to top/bottom, `padding_x` applies to left/right
 * - `padding` applies to all sides
 *
 * Missing/undefined values are coerced via `lib.toNumber(...)`.
 *
 * @param {object} [item] Input item object.
 * @param {number|string} [item.padding] Padding for all sides.
 * @param {number|string} [item.padding_x] Padding for left/right.
 * @param {number|string} [item.padding_y] Padding for top/bottom.
 * @param {number|string} [item.padding_top] Padding for top side.
 * @param {number|string} [item.padding_right] Padding for right side.
 * @param {number|string} [item.padding_bottom] Padding for bottom side.
 * @param {number|string} [item.padding_left] Padding for left side.
 * @returns {{top:number,left:number,right:number,bottom:number}} Padding rectangle.
 * @memberof module:image
 */
image.padding = function(item)
{
    return {
        top: lib.toNumber(item.padding_top || item.padding_y || item.padding),
        left: lib.toNumber(item.padding_left || item.padding_x || item.padding),
        right: lib.toNumber(item.padding_right || item.padding_x || item.padding),
        bottom: lib.toNumber(item.padding_bottom || item.padding_y || item.padding)
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

    logger.debug("stats:", image.name, "start:", region);

    if (region?.width > 0 && region?.height > 0) {
        input = Buffer.isBuffer(input) ? input : await input.toBuffer();

        // Keep region bounds valid
        const meta = await sharp(input).metadata();
        const r = Object.keys(region).reduce((a, b) => { a[b] = lib.toNumber(region[b]); return a }, {});
        if (r.top + r.height > meta.height) r.height = meta.height - r.top;
        if (r.left + r.width > meta.width) r.width = meta.width - r.left;

        const buffer = await sharp(input).extract(r).toBuffer();
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

    Object.defineProperty(stats, "_image", {
        configurable: true,
        writable: true,
        enumerable: false,
        value: input,
    })
    logger.debug("stats:", image.name, "done:", region, "stats:", stats);
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
 * @param {object} input - sharp image
 * @param {object}
 * @param {object[]} [item.filters] - filters, each operation must provide filter name and value as a map or an object
 * @returns {object} transformed image
 * @memberof module:image
 */
image.convert = async function(input, item)
{
    if (!lib.isArray(item?.filters)) return input.png();

    input = sharp(Buffer.isBuffer(input) ? input : await input.png().toBuffer());

    for (const filter of item.filters) {
        if (!ops.includes(filter?.name)) continue;
        let value = filter.value || undefined;
        if (lib.isString(value)) {
            value = lib.toMap(value, { maptype: "auto" });
        }
        logger.debug("convert:", image.name, item.id, filter);
        input[filter.name](value);
    }
    return input.png();
}

/**
 * Merge defaults into an item, supports format `id.name` or `type.name` where id must match item.id and type item.type
 * @param {object} item
 * @param {object} [defaults]
 * @returns {object}
 * @memberof module:image
 */
image.mergeDefaults = function(item, defaults)
{
    for (const p in defaults) {
        const v = defaults[p];
        if (v === undefined || v === null || v === "") continue;
        const [id, name] = p.split(".");
        // Item specific
        if (name) {
            if ((id === item.id || id === item.type) &&
                (item[name] === undefined || item[name] === "")) {
                item[name] = v;
            }
            continue;
        }
        // Global
        if (item[p] === undefined || item[p] === "") {
            item[p] = v;
        }
    }
    return item;
}

/**
 * Detect a text color to place on top of the area inside given background
 * @param {object} item - input item
 * @param {object} bgimage - Sharp image with background
 * @memberof module:image
 * @async
 */
image.detect = async function(item, bgimage)
{
    const input = await image.create(item);
    const meta = await input.metadata();

    const bgmeta = await bgimage.metadata();
    const region = image.gravityRegion(item.gravity, bgmeta.width, bgmeta.height);

    Object.assign(region,
        { id: item.id, gravity: item.gravity },
        {
            top: item.top || region.top,
            left: item.left || region.left,
            width: item.width || region.width || meta.width,
            height: item.height || region.height || meta.height,
        });

    logger.debug("detect:", image.name, "start:", item.id, "region:", region);

    const stats = await image.stats(bgimage, region);

    let ncolor = color.negate(stats.dominant);

    lib.split(item.text_auto).forEach(x => {
        const old = ncolor;
        switch (x) {
        case "mean":
            ncolor = color.negate(stats.mean);
            break;

        case "complement":
            ncolor = color.rotate(ncolor);
            break;

        case "luminance":
            ncolor = color.rluminance(ncolor) > 0.179 ? color.hex2rgb(item.white || image.white) : color.hex2rgb(item.black || image.black);
            break;

        case "lighter":
            ncolor = color.lighter(ncolor);
            break;

        case "darker":
            ncolor = color.darker(ncolor);
            break;
        }
        logger.debug("detect:", image.name, item.id, x, ncolor, "old:", old, color.rluminance(old));
    });

    item._mean = stats.mean;
    item._dominant = stats.dominant;
    item._color = color.hex(ncolor);

    logger.debug("detect:", image.name, "done:", item, "STATS:", stats);

    return stats;
}

/**
 * Generate an SVG radial-gradient ellipse overlay for an image item and return it as a Buffer.
 *
 * Picks a gradient color (`gcolor`) based on `item.color` and `item.gradient_type`, adjusting for
 * luminance/contrast, then builds an SVG sized to `item.meta.width`/`item.meta.height`.
 *
 * @param {Object} item
 * @param {Object} item._meta
 * @param {number} item._meta.width - SVG width in pixels.
 * @param {number} item._meta.height - SVG height in pixels.
 * @param {string} [item.color="#000"] - Base color in hex format.
 * @param {string} [item.gradient_type] - Gradient mode, e.g. "mid" (default uses negate).
 * @param {string|number} [item.id] - Identifier used for debug logging.
 * @returns {Buffer} SVG markup as a Buffer.
 * @memberof module:image
 */
image.gradient = function(item)
{
    const width = item._meta.width;
    const height = item._meta.height;

    const tcolor = color.hex2rgb(item.color || "#000");
    const tlum = color.rluminance(tcolor);

    let gcolor, contrast;

    switch (item.gradient_type) {
    case "mid":
        gcolor = tlum >= 0.55 ? color.darker(tcolor, 1) : color.lighter(tcolor, 1);
        contrast = color.contrast(tcolor, gcolor);
        if (contrast < 1.6) gcolor = tlum >= 0.55 ? color.darker(gcolor, 1) : color.lighter(gcolor, 1);
        contrast = color.contrast(tcolor, gcolor);
        if (contrast < 1.6) gcolor = tlum >= 0.55 ? color.darker(gcolor, 1) : color.lighter(gcolor, 1);
        break;

    default:
        gcolor = color.negate(tcolor);
        contrast = color.contrast(tcolor, gcolor);
        if (contrast < 2.5) gcolor = color.lighter(gcolor);
    }

    const glum = color.rluminance(gcolor);
    if (glum < 0.25) gcolor = color.lighter(gcolor, 1);
    if (glum > 0.85) gcolor = color.darker(gcolor, 1);

    gcolor = item._gcolor = color.hex(gcolor);
    logger.debug("gradient:", image.name, item.id, width, height, "t:", item.color, tcolor, tlum, "g:", gcolor, glum, contrast)

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
            <ellipse cx="${Math.round(width/2)}" cy="${Math.round(height/2)}" rx="${Math.round(width/2.5)}" ry="${Math.round(height/3.5)}" fill="url(#grad)" />
        </svg>`);
}

/**
 * Create an image from a photo or text, supports raunded corners, borders
 * @param {object} item
 * @param {string|Buffer} [item.file] - input file name
 * @param {Buffer|string} [item.data] - image buffer or data:image/*;base64, takes precedence over file name
 * @param {int} [item.width] - desired width, max width for text
 * @param {int} [item.height] - desired height, defaults to width if not given
 * @param {string} [item.background=#FFFFFF] - main background color
 * @param {int} [item.border] - border size in px
 * @param {string} [item.border_color=FFFFFFF0] - border color
 * @param {number} [item.border_radius] - make border round, this is divider of the size
 * @param {number} [item.padding] - transparent padding around image
 * @param {number} [item.padding_x]
 * @param {number} [item.padding_y]
 * @param {number} [item.padding_top]
 * @param {number} [item.padding_bottom]
 * @param {number} [item.padding_left]
 * @param {number} [item.padding_right]
 * @param {int} [item.padding_color] - padding background color
 * @param {number} [item.padding_radius] - make padding round
 * @param {string} [item.fit] - resize mode
 * @param {string} [item.position]
 * @param {string} [item.kernel]
 * @param {string} [item.gravity]
 * @param {boolean} [item.withoutEnlargement]
 * @param {boolean} [item.withoutReduction]
 * @param {boolean} [item.fastShrinkOnLoad]
 * @param {number} [item.radius] - make it round, inner and outer layers, this is divider of the size
 * @param {string} [item.text] - text to render
 * @param {string} [item.color] - text color
 * @param {string} [item.alpha] - text opacity 0-65535 or 50%
 * @param {string} [item.bgalpha] - text background opacity 0-65535 or 50%
 * @param {string} [item.font] - font family
 * @param {string} [item.fontfile] - font file
 * @param {string} [item.weight] - One of `ultralight, light, normal, bold, ultrabold, heavy`, or a numeric weight.
 * @param {string} [item.size] - font size in 1024ths of a point, or in points (e.g. 12.5pt), or one of the absolute sizes
 *  xx-small, x-small, small, medium, large, x-large, xx-large, or a percentage (e.g. 200%), or one of
 *  the relative sizes smaller or larger.
 * @param {string} [item.stretch] - One of `ultracondensed, extracondensed, condensed, semicondensed, normal, semiexpanded,
 *   expanded, extraexpanded, ultraexpanded`.
 * @param {string} [item.style] - One of `normal, oblique, italic`.
 * @param {int} [item.spacing] - font spacing
 * @param {int} [item.dpi=72] - text size in DPI
 * @param {boolean} [item.justify=true] - text justification
 * @param {string} [item.wrap] - text wrapping if width is provided: `word, char, word-char, none`
 * @param {string} [item.align] - text aligment: `left, centre, center, right`
 * @param {string} [item.blend] - how to blend image, one of `clear, source, over, in, out, atop, dest,
 *  dest-over, dest-in, dest-out, dest-atop, xor, add, saturate, multiply, screen, overlay, darken,
 * lighten, colour-dodge, color-dodge, colour-burn,color-burn, hard-light, soft-light, difference, exclusion`.
 * @param {object} [item.sharp] - additional raw Sharp item
 * @returns {Promise} - a sharp object containing an image, as PNG
 * @memberof module:image
 * @async
 */

image.create = async function(item)
{
    logger.debug("create:", image.name, "start:", item);

    const images = [];
    const border = lib.toNumber(item.border, { min: 0 });
    const radius = lib.toNumber(item.radius, { min: 0 });
    const padding = image.padding(item);

    let width = lib.toNumber(item.width, { min: 0 });
    let height = lib.toNumber(item.height, { min: 0 }) || width;

    if (!sharp) sharp = lib.tryRequire('sharp');

    var innerImage;

    if (item.data instanceof sharp && !(width || height)) {
        innerImage = item.data;
    } else

    if (item.file || item.data) {
        let input = lib.isString(item.file);

        if (item.data instanceof sharp) {
            input = await item.data.toBuffer();
        } else

        if (Buffer.isBuffer(item.data)) {
            input = item.data;
        } else

        if (lib.isString(item.data).startsWith("data:image/")) {
            input = Buffer.from(item.data.substr(item.data.indexOf("base64,") + 7), "base64");
        }

        innerImage = sharp(input, item.sharp);

        if (width || height) {
            const buffer = await innerImage.resize({
                width,
                height,
                fit: item.fit || undefined,
                position: item.position || undefined,
                kernel: item.kernel || undefined,
                background: item.background,
                withoutEnlargement: item.withoutEnlargement,
                withoutReduction: item.withoutReduction,
                fastShrinkOnLoad: item.fastShrinkOnLoad,
            }).toBuffer();

            innerImage = sharp(buffer);
        }

    } else

    if (item.text) {
        let text = lib.isString(item.text).replaceAll("\\n", "\n");
        const attrs = [];
        for (const p of ["_color", "color", "bgcolor", "size", "weight", "style", "stretch",
                         "strikethrough", "strikethrough_color",
                         "underline", "underline_color",
                         "line_height", "segment", "letter_spacing", "allow_breaks", "rise", "baseline_shift",
                         "font_features", "gravity_hint", "text_gravity",
                         "alpha", "bgalpha"]) {
            let val = item[p];
            if (val) {
                if (p.endsWith("alpha") && val.at(-1) != "%") val += "%";
                attrs.push(`${p.replace(/^_|^text_/, "")}="${val}"`);
            }
        }
        if (attrs.length) text = `<span ${attrs.join(" ")}>${text}</span>`;

        logger.debug("composite:", "text:", item.id, text);

        innerImage = sharp({
            text: {
                rgba: true,
                text,
                height: !item.dpi && height || undefined,
                width: width || undefined,
                font: item.font || undefined,
                fontfile: item.fontfile || undefined,
                dpi: lib.toNumber(item.dpi) || undefined,
                spacing: lib.toNumber(item.spacing) || undefined,
                align: item.align || undefined,
                justify: lib.toBool(item.justify),
                wrap: item.wrap || "word",
            }
        });

    } else

    if (item.outline) {
        const filter = `
            <filter id="outline">
                <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius="5"></feMorphology>
                <feFlood flood-color="#32DFEC" flood-opacity="0.5" result="PINK"></feFlood>
                <feComposite in="PINK" in2="DILATED" operator="in" result="OUTLINE"></feComposite>
                <feMerge>
                    <feMergeNode in="OUTLINE" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>`;

        const svg = `
            <svg width="${svgWidth}" height="${svgHeight}">
                <text
                    x="50%"
                    y="50%"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    font-family="sans-serif"
                    font-size="${fontSize}"
                    font-weight="${fontWeiight}"
                    fill="${textColor}"
                    stroke="${outlineColor}"
                    stroke-width="${strokeWidth}"
                    stroke-linejoin="miter"
                    paint-order="stroke">
                    ${item.outline}
                </text>
            </svg>`

        innerImage = sharp({ input: Buffer.from(svg) });

    } else {
        innerImage = sharp({
            create: {
                width: width || 1280,
                height: height || 1024,
                channels: 4,
                background: item.background || image.background,
            }
        });
    }

    const meta = await innerImage.metadata();
    width = item._inner_width = meta.width;
    height = item._inner_height = meta.height;
    const cw = width + border * 2;
    const ch = height + border * 2;

    if (radius) {
        innerImage.
            composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(width/radius)}" ry="${Math.round(height/radius)}"/></svg>`),
                blend: item.radius_blend || item.blend || 'dest-in'
            }]);
    }

    if (border) {
        let border_color = item.border_color;
        if (border_color && item.border_alpha) {
            border_color += Math.round(Number(255*lib.toNumber(item.border_alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
        }
        const borderImage = await sharp({
            create: {
                width: cw,
                height: ch,
                channels: 4,
                background: border_color || { r: 255, g: 255, b: 255, alpha: 0.5 }
            }
        });

        const bradius = lib.toNumber(item.border_radius || radius, { min: 0 });
        if (bradius) {
            borderImage.composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${cw}" height="${ch}" rx="${Math.round(cw/bradius)}" ry="${Math.round(ch/bradius)}"/></svg>`),
                blend: item.border_blend || item.blend || 'dest-in'
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

    let padding_color = item.padding_color;
    if (padding_color && item.padding_alpha) {
        padding_color += Math.round(Number(255*lib.toNumber(item.padding_alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
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

    const pradius = lib.toNumber(item.padding_radius, { min: 0 });
    if (pradius) {
        images.push({
            input: Buffer.from(`<svg><rect x="0" y="0" width="${pw}" height="${ph}" rx="${Math.round(pw/pradius)}" ry="${Math.round(ph/pradius)}"/></svg>`),
            blend: item.padding_blend || item.blend || 'dest-in'
        });
    }

    logger.debug("create:", image.name, "done:", item.id, width, height, "CW:", cw, ch, "PW:", pw, ph, "B:", border, "I:", images.length, "P:", padding);

    return image.convert(outterImage.composite(images), item);
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

    items = lib.isArray(items, []).
                map(item => image.mergeDefaults(item, defaults)).
                filter(item => (item.file || item.data || item.text || item.outline));
    if (!items.length) return items;

    // Use the first image as background, no padding
    const bgitem = image.mergeDefaults(items[0], defaults);
    for (const p in bgitem) {
        if (p.startsWith("padding")) delete bgitem[p];
    }

    const bgimage = await image.create(bgitem);

    // Render remaning elements individually, preseve the order
    const other = items.slice(1);

    await Promise.all(other.map(async (item) => {
        // Autodetect color for texts
        if ((item.text || item.outline) && !item.color) {
            await image.detect(item, bgimage);
        }

        const img = await image.create(item);

        delete item.buffer;
        Object.defineProperty(item, "_buffer", {
            configurable: true,
            writable: true,
            enumerable: false,
            value: await img.toBuffer(),
        })

        delete item.meta;
        Object.defineProperty(item, "_meta", {
            configurable: true,
            writable: true,
            enumerable: false,
            value: await img.metadata(),
        })

        if (lib.isFlag(lib.split(item.gradient), ["1", "true", item.type, item.id])) {
            let gradient = image.gradient(item);
            if (gradient) {
                gradient = await sharp(gradient).
                                   blur({ sigma: item.gradient_sigma || 25, minAmplitude: 0.01 }).
                                   png().
                                   toBuffer();

                Object.defineProperty(item, "_gradient_buffer", {
                    configurable: true,
                    writable: true,
                    enumerable: false,
                    value: gradient,
                })
            }
        }
    }));

    // Composite all elements onto the background
    const buffers = [];
    other.forEach(async (item) => {
        if (item._gradient_buffer) {
            buffers.push({
                input: item._gradient_buffer,
                blend: item.gradient_blend || undefined,
                gravity: item.gravity || undefined,
                top: item.top || undefined,
                left: item.left || undefined,
            })
        }
        buffers.push({
            input: item._buffer,
            gravity: item.gravity || undefined,
            blend: item.blend || undefined,
            top: item.top || undefined,
            left: item.left || undefined
        });
    });

    bgimage.composite(buffers);

    delete bgitem.buffer;
    Object.defineProperty(bgitem, "_buffer", {
        configurable: true,
        writable: true,
        enumerable: false,
        value: await bgimage.png().toBuffer(),
    })

    delete bgitem.meta;
    Object.defineProperty(bgitem, "_meta", {
        configurable: true,
        writable: true,
        enumerable: false,
        value: await bgimage.toBuffer(),
    })

    logger.debug("composite:", image.name, "bg:", bgitem);

    return items;
}
