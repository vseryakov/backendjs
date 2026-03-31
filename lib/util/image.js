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

    black: "#28282B",
    white: "#F9F9F3",
    background: "#FFFFFF",
    transparent: { r: 0, g: 0, b: 0, alpha: 0 },
};

/**
 * Scaling and composing images with Sharp.js
 */

module.exports = image;

var sharp;

function setProp(item, name, value)
{
    delete item[name];
    Object.defineProperty(item, name, { configurable: true, writable: true, enumerable: false, value });
    return value;
}

/**
 * Convert a value to a non-negative number, optionally scaling fractional values by a max.
 *
 * If `num` is between 0 and 1 (exclusive) and `max` is provided, the value is treated as
 * a ratio and converted to an integer by multiplying by `max` and rounding.
 *
 * Examples:
 * - `toNumber("10")` -> `10`
 * - `toNumber(0.5, 200)` -> `100`
 *
 * @param {number|number[]} num - Value to convert to a number, if array first number will be used
 * @param {number} [max] - Maximum used to scale fractional values (0 < num < 1).
 * @returns {number} A non-negative number (ratio scaled and rounded when applicable).
 */
image.toNumber = function(num, max)
{
    if (Array.isArray(num)) {
        num = lib.validNum(...num);
    }
    num = lib.toNumber(num, { min: 0 });
    if (num > 0 && num < 1 && max > 0) {
        num = Math.round(num * max);
    }
    return num;
}

/**
 * Normalize padding-related item into a rectangle object.
 *
 * Accepts either side-specific padding values or axis-wide or single padding:
 * - `padding_top`, `padding_right`, `padding_bottom`, `padding_left` (highest priority)
 * - `padding_y` applies to top/bottom, `padding_x` applies to left/right
 * - `padding` applies to all sides
 *
 * Values >= 1 are in pixels, > 0 and < 1 in percentages relative to the background dimenstions
 *
 * @param {object} [item] Input item object.
 * @param {number|string} [item.padding] Padding for all sides.
 * @param {number|string} [item.padding_x] Padding for left/right.
 * @param {number|string} [item.padding_y] Padding for top/bottom.
 * @param {number|string} [item.padding_top] Padding for top side.
 * @param {number|string} [item.padding_right] Padding for right side.
 * @param {number|string} [item.padding_bottom] Padding for bottom side.
 * @param {number|string} [item.padding_left] Padding for left side.
 * @param {number} [width] - max width to be used for fractions
 * @param {number} [height] - max height to be used for fractions
 * @returns {{top:number,left:number,right:number,bottom:number}} Padding rectangle.
 * @memberof module:image
 */
image.padding = function(item, width, height)
{
    return {
        top: this.toNumber(item.padding_top || item.padding_y || item.padding, height),
        left: this.toNumber(item.padding_left || item.padding_x || item.padding, width),
        right: this.toNumber(item.padding_right || item.padding_x || item.padding, width),
        bottom: this.toNumber(item.padding_bottom || item.padding_y || item.padding, height)
    }
}

/**
 * Return region corresponding to the item gravity or absolute coordinates (top, left ,width, height)
 * @param {object} item object
 * @param {int} width - background image width
 * @param {int} height - background image height
 * @returns {object} - object { left, top, width, height }
 * @memberof module:image
 */
image.region = function(item, width, height)
{
    const w = Math.floor(width / 3);
    const h = Math.floor(height / 3);
    const map = {
        northwest: [0, 0],  north: [1, 0], northeast: [2, 0],
             west: [0, 1], center: [1, 1],      east: [2, 1],
        southwest: [0, 2],  south: [1, 2], southeast: [2, 2],
    };
    const [col, row] = map[item.gravity] || map.center;
    return {
        id: item.id,
        top: this.toNumber(item.top, height) || row * h,
        left: this.toNumber(item.left, width) || col * w,
        width: item._meta?.width || this.toNumber(item.width, width) || h,
        height: item._meta?.height || this.toNumber(item.height, height) || h
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
    stats.stddev = stats.channels.reduce((sum, c) => sum + c.stdev, 0) / stats.channels.length;

    stats.meta = await input.metadata();
    setProp(stats, "_image", input);

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
    const filters = item.filters || [];

    // Common shortcuts
    if (item.blur_sigma) {
        if (item.blur_sigma == "auto") {
            const stats = item._stats;
            item.blur_sigma = stats.entropy > 7.5 ? 7 :
                              stats.entropy > 7.3 ? 6 :
                              stats.entropy > 7.1 ? 5 :
                              stats.entropy > 6.8 ? 4 :
                              stats.entropy > 6.3 ? 3 :
                              stats.entropy > 6 ? 2 : 1;
        }
        filters.push({ name: "blur", value: { sigma: lib.toNumber(item.blur_sigma) } });
    }

    if (!filters.length) return input.png();

    input = sharp(Buffer.isBuffer(input) ? input : await input.png().toBuffer());

    for (const filter of filters) {
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
 * @param {object} bgitem - background item generated
 * @memberof module:image
 * @async
 */
image.detect = async function(item, bgitem)
{
    await image.create(item, bgitem);

    const region = image.region(item, bgitem._meta.width, bgitem._meta.height);

    logger.debug("detect:", image.name, "start:", item.id, "region:", region);

    const stats = await image.stats(bgitem._buffer, region);

    let _color = color.negate(stats.dominant);

    lib.split(item.text_auto || "1").forEach(x => {
        const old = _color;
        switch (x) {
        case "dominant":
            _color = color.negate(stats.dominant);
            break;

        case "mean":
            _color = color.negate(stats.mean);
            break;

        case "complement":
            _color = color.rotate(_color);
            break;

        case "lighter":
            _color = color.lighter(_color);
            break;

        case "darker":
            _color = color.darker(_color);
            break;

        case "softlight":
            _color = color.rluminance(_color) > 0.179 ? color.lighter(_color) : color.darker(_color);
            break;

        case "luminance":
        default:
            _color = color.rluminance(_color) > 0.179 ? color.hex2rgb(item.white || image.white) : color.hex2rgb(item.black || image.black);
            break;
        }
        logger.debug("detect:", image.name, item.id, x, _color, "old:", old);
    });

    item._color = color.hex(_color);
    setProp(item, "_detect", { color: item._color, _color, stats });

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
 * @param {string} [item.color="#fff"] - Base color in hex format.
 * @param {string} [item._color="#fff"] - Detected color in hex format.
 * @param {string} [item.gradient_type] - Gradient mode, e.g. "mid" (default uses negate).
 * @param {string|number} [item.id] - Identifier used for debug logging.
 * @returns {Buffer} SVG markup as a Buffer.
 * @memberof module:image
 */
image.createGradient = async function(item, bgitem)
{
    const width = item._inner_width * 2;
    const height = item._inner_height * 2;

    let gcolor = item.gradient_color;

    if (!gcolor) {
        const _color = item.color || item._color || "#fff";
        const ncolor = color.negate(color.hex2rgb(_color));

        gcolor = item._gcolor = color.rluminance(ncolor) > 0.179 ? image.white : image.black;

        logger.debug("gradient:", image.name, item.id, "t:", _color, ncolor, "g:", gcolor)
    }

    const images = [
        {
            input: Buffer.from(`
            <svg width="${width}" height="${height}">
                <defs>
                    <radialGradient id="grad">
                        <stop offset="0%"  stop-color="${gcolor}" stop-opacity="0.9"/>
                        <stop offset="10%" stop-color="${gcolor}" stop-opacity="0.9"/>
                        <stop offset="20%" stop-color="${gcolor}" stop-opacity="0.8"/>
                        <stop offset="30%" stop-color="${gcolor}" stop-opacity="0.7"/>
                        <stop offset="40%" stop-color="${gcolor}" stop-opacity="0.6"/>
                        <stop offset="50%" stop-color="${gcolor}" stop-opacity="0.45"/>
                        <stop offset="60%" stop-color="${gcolor}" stop-opacity="0.3"/>
                        <stop offset="70%" stop-color="${gcolor}" stop-opacity="0.2"/>
                        <stop offset="80%" stop-color="${gcolor}" stop-opacity="0.1"/>
                        <stop offset="90%" stop-color="${gcolor}" stop-opacity="0.05"/>
                        <stop offset="100%" stop-color="${gcolor}" stop-opacity="0"/>
                    </radialGradient>
                </defs>
                <rect width="${width}" height="${height}" fill="url(#grad)" />
            </svg>`)
        },
        {
            input: item._buffer,
        },
    ];

    const region = { top: 0, left: 0, width, height };
    const padding = image.padding(item, bgitem._meta.width, bgitem._meta.height)

    const h = Math.round(height/4);
    const w = Math.round(width/4);

    switch (item.gravity) {
    case "northwest":
        region.top += h - padding.top;
        region.left += w - padding.left;
        break;
    case "north":
        region.top += h - padding.top;
        break;
    case "northeast":
        region.top += h - padding.top;
        region.width -= w - padding.right;
        break;
    case "west":
        region.left += w - padding.left;
        break;
    case "east":
        region.width -= w - padding.right;
        break;
    case "southwest":
        region.height -= h - padding.bottom;
        region.left += w - padding.left;
        break;
    case "south":
        region.height -= h - padding.bottom;
        break;
    case "southeast":
        region.height -= h - padding.bottom;
        region.width -= w - padding.right;
        break;
    }

    if (region.top + region.height > height) region.height = height - region.top;
    if (region.left + region.width > width) region.width = width - region.left;

    const buffer = await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: image.transparent
        }
    }).composite(images).
       png().
       toBuffer();

    const img = sharp(buffer).extract(region).png();

    setProp(item, "_buffer", await img.toBuffer());

    return img;
}

image.createOutline = function(item, bgitem)
{
    const width = this.toNumber(item.width, bgitem?._meta?.width);
    const height = this.toNumber(item.height, bgitem?._meta?.height);

    const text = lib.isString(item.text).replaceAll("\\n", "\n").trim();

    const filter = `
        <filter id="filter">
            <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius="5"></feMorphology>
            <feFlood flood-color="#32DFEC" flood-opacity="0.5" result="PINK"></feFlood>
            <feComposite in="PINK" in2="DILATED" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>`;

    const svg = `
        <svg width="${width}" height="${height}">
            <text
                x="50%"
                y="50%"
                text-anchor="${item.outline_anchor || "middle"}"
                dominant-baseline="${item.outline_baseline || "middle"}"
                font-family="${item.outline_font || "sans-serif"}"
                font-size="${item.outline_size || 13}"
                font-weight="${item.outline_weight || ""}"
                fill="${item.outline_fill || ""}"
                stroke="${item.outline_stroke || ""}"
                stroke-width="${item.outline_width || ""}"
                stroke-linejoin="${item.outline_linejoin || "miter"}"
                paint-order="${item.outline_order || "stroke"}"
                filter="${filter}">
                ${text}
            </text>
        </svg>`

    return sharp({ input: Buffer.from(svg) });
}

image.createText = function(item, bgitem)
{
    const width = this.toNumber(item.width, bgitem?._meta?.width);
    const height = this.toNumber(item.height, bgitem?._meta?.height);

    let text = lib.isString(item.text).replaceAll("\\n", "\n").trim();

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

    logger.debug("text:", image.name, item.id, text);

    return sharp({
        text: {
            rgba: true,
            text,
            width: width || undefined,
            height: !item.dpi && height || undefined,
            font: item.font || undefined,
            fontfile: item.fontfile || undefined,
            dpi: lib.toNumber(item.dpi) || undefined,
            spacing: lib.toNumber(item.spacing) || undefined,
            align: item.align || undefined,
            justify: lib.toBool(item.justify),
            wrap: item.wrap || "word",
        }
    });
}

image.createImage = async function(item, bgitem)
{
    const width = this.toNumber(item.width, bgitem?._meta?.width);
    const height = this.toNumber(item.height, bgitem?._meta?.height) || width;

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

    let img = sharp(input, item.sharp);

    if (width || height) {
        img = await img.resize({
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

        img = sharp(img);
    }

    return img;
}

image.createBorder = async function(item, width, height)
{
    let border_color = item.border_color;
    if (border_color && item.border_alpha) {
        border_color += Math.round(Number(255*lib.toNumber(item.border_alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
    }
    const borderImage = await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: border_color || { r: 255, g: 255, b: 255, alpha: 0.5 }
        }
    });

    const radius = lib.toNumber(item.border_radius || item.radius, { min: 0 });
    if (radius) {
        borderImage.composite([{
            input: Buffer.from(`<svg><rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(width/radius)}" ry="${Math.round(height/radius)}"/></svg>`),
            blend: item.border_blend || 'dest-in'
        }]);
    }

    return borderImage.png().toBuffer();
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
 * @param {object} [bgitem] - background item
 * @returns {Promise} - a sharp object containing an image, as PNG
 * @memberof module:image
 * @async
 */

image.create = async function(item, bgitem)
{
    const _w = bgitem?._meta?.width;
    const _h = bgitem?._meta?.height;

    let width = this.toNumber(item.width, _w);
    let height = this.toNumber(item.height, _h);
    const border = this.toNumber(item.border, _h);
    const padding = image.padding(item, _w, _h);

    logger.debug("create:", image.name, "start:", item, "C:", width, height, border, padding);

    if (!sharp) sharp = lib.tryRequire('sharp');

    var innerImage;

    if (item.data instanceof sharp && !(width || height)) {
        innerImage = item.data;

    } else

    if (item.file || item.data) {
        innerImage = await image.createImage(item, bgitem);

    } else

    if (item.text) {
        if (item.outline) {
            innerImage = image.createOutline(item, bgitem);
        } else {
            innerImage = image.createText(item, bgitem);
        }

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

    item._inner_width = width = meta.width;
    item._inner_height = height = meta.height;
    item._inner_top = border + padding.top;
    item._inner_left = border + padding.left;

    const cw = width + border * 2;
    const ch = height + border * 2;
    const images = [];

    setProp(item, "_stats", await innerImage.stats());

    const radius = lib.toNumber(item.radius, { min: 0 });
    if (radius) {
        innerImage.
            composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${width}" height="${height}" rx="${Math.round(width/radius)}" ry="${Math.round(height/radius)}"/></svg>`),
                blend: item.radius_blend || 'dest-in'
            }]);
    }

    if (border) {
        const borderImage = await image.createBorder(item, cw, ch);
        images.push({
            input: borderImage,
            top: padding.top,
            left: padding.left,
        });
    }

    // Place inside the padding background
    images.push({
        input: await innerImage.png().toBuffer(),
        top: item._inner_top,
        left: item._inner_left,
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
            background: padding_color || image.transparent,
        }
    });

    const pradius = lib.toNumber(item.padding_radius, { min: 0 });
    if (pradius) {
        images.push({
            input: Buffer.from(`<svg><rect x="0" y="0" width="${pw}" height="${ph}" rx="${Math.round(pw/pradius)}" ry="${Math.round(ph/pradius)}"/></svg>`),
            blend: item.padding_blend || 'dest-in'
        });
    }

    logger.debug("create:", image.name, "done:", item.id, width, height, "CW:", cw, ch, pw, ph, "B:", border, "I:", images.length, "P:", padding);

    const img = await image.convert(outterImage.composite(images), item);

    setProp(item, "_buffer", await img.toBuffer())
    setProp(item, "_meta", await img.metadata());

    return img;
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
                filter(item => (item.file || item.data || item.text || item.background));
    if (!items.length) return items;

    // Use the first image as background, no padding
    const bgitem = image.mergeDefaults(items[0], defaults);
    for (const p in bgitem) {
        if (p.startsWith("padding")) delete bgitem[p];
    }

    const bgimage = await image.create(bgitem);

    // Render remaning elements individually, preseve the order

    const results = await Promise.allSettled(items.slice(1).map(async (item) => {
        // Autodetect color for texts
        if (item.text && !item.color) {
            await image.detect(item, bgitem);
        }

        await image.create(item, bgitem);

        if (lib.isFlag(lib.split(item.gradient), ["1", "true", item.type, item.id])) {
            await image.createGradient(item, bgitem);
        }

        // Clip to avoid errors
        item._top = this.toNumber([item._top, item.top], bgitem._meta.height);
        item._left = this.toNumber([item._left, item.left], bgitem._meta.width);

        let w, h;
        if (item._top + item._meta.height > bgitem._meta.height) h = bgitem._meta.height - item._top;
        if (item._left + item._meta.width > bgitem._meta.width) w = bgitem._meta.width - item._left;
        if (h || w) {
            if (w) item._meta.width = w;
            if (h) item._meta.height = h;
            const buffer = await sharp(item._buffer).
                                 extract({ top: 0, left: 0, width: item._meta.width, height: item._meta.height }).
                                 png().
                                 toBuffer();
            setProp(item, "_buffer", buffer);
        }

        return item;
    }));

    const buffers = [];
    for (const res of results) {
        const item = res.value;
        logger.logger(item?._buffer ? "debug" : "error", "composite:", image.name, "result:", res);
        if (!item?._buffer) continue;

        buffers.push({
            input: item._buffer,
            gravity: item._gravity || item.gravity || undefined,
            blend: item._blend | item.blend || undefined,
            top: item._top || undefined,
            left: item._left || undefined,
        });
    }

    // Composite all elements onto the background
    bgimage.composite(buffers);

    setProp(bgitem, "_buffer", await bgimage.png().toBuffer())
    setProp(bgitem, "_meta", await bgimage.toBuffer())

    logger.debug("composite:", image.name, "bg:", bgitem);

    return items;
}
