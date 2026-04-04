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
        num = lib.validNumber(...num);
    }
    num = lib.toNumber(num, { min: 0 });
    if (num > 0 && num < 1 && max > 0) {
        num = Math.round(num * max);
    }
    return num;
}

/**
 * Append opacity to the hex color
 * @param {string} color - hex color as #RRGGBB
 * @param {number} alpha - opacity as percentage 0-100%
 * @returns {string} hex color as #RRGGBBAA
 */
image.toColor = function(color, alpha)
{
    if (lib.isString(color)[0] == "#" && alpha >= 0 && alpha <= 100) {
        color = color.substr(0, 7) + Math.round(Number(255*lib.toNumber(alpha, { min: 0, max: 100 })/100)).toString(16).padStart(2, "0");
    }
    return color;
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
 * @returns {object} region stats with key properties:
 * - `dominant` - dominant color
 * - `mean` - mean color as RGB
 * - `stdev` - standard deviation color as RGB
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

        input = sharp(await sharp(input).extract(r).toBuffer());
    } else {
        input = Buffer.isBuffer(input) ? await sharp(input) : input;
    }

    const stats = await input.stats();
    stats.mean = {
        r: lib.toNumber(stats.channels[0]?.mean, { float: 0 }),
        g: lib.toNumber(stats.channels[1]?.mean, { float: 0 }),
        b: lib.toNumber(stats.channels[2]?.mean, { float: 0 }),
    };
    stats.stdev = {
        r: lib.toNumber(stats.channels[0]?.stdev, { float: 0 }),
        g: lib.toNumber(stats.channels[1]?.stdev, { float: 0 }),
        b: lib.toNumber(stats.channels[2]?.stdev, { float: 0 }),
    };
    stats._stdev = stats.channels.reduce((sum, c) => sum + lib.toNumber(c.stdev, { float: 0 }), 0) / stats.channels.length;

    stats.meta = await input.metadata();
    setProp(stats, "_image", input);

    logger.debug("stats:", image.name, "done:", region, "stats:", stats);
    return stats;
}

/**
 * Return metadata about the input
 * @param {object|Buffer} input - buffer or Sharp instance
 * @return {object} - { buffer, meta }
 * @async
 * @memberof module:image
 */
image.metadata = async function(input)
{
    if (!sharp) sharp = lib.tryRequire('sharp');

    const buffer = Buffer.isBuffer(input) ? input : await input.png().toBuffer();
    input = Buffer.isBuffer(input) ? sharp(input) : input;
    return {
        buffer,
        meta: await input.metadata(),
    }
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
    if (!sharp) sharp = lib.tryRequire('sharp');

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

        case "stdev":
            _color = color.negate(stats.stdev);
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
 * Clip (crop) an item's image buffer so it fits within the background item's bounds.
 *
 * If the item is completely outside the background, it marks it as skipped.
 *
 * Side effects:
 * - May set `item._skip = 1` when the item is fully outside the background.
 * - Replaces `item._buffer` with the cropped image buffer.
 * - Replaces `item._meta` with metadata of the cropped image.
 *
 * @async
 * @memberof module:image
 * @param {Object} item item to be clipped.
 * @param {Buffer} item._buffer Source image buffer.
 * @param {Object} item._meta Source image metadata.
 * @param {number} item._meta.width Source image width.
 * @param {number} item._meta.height Source image height.
 * @param {(number|string)} [item.top] Top position (relative to background).
 * @param {(number|string)} [item.left] Left position (relative to background).
 * @param {string|number} [item.id] Item identifier (used for logging).
 * @param {Object} bgitem Background item that defines the clipping bounds.
 * @param {Object} bgitem._meta Background metadata.
 * @param {number} bgitem._meta.width Background width.
 * @param {number} bgitem._meta.height Background height.
 * @returns {Promise} Resolves when clipping is complete. Returns early if no clipping is needed.
 */
image.clip = async function(item, bgitem)
{
    const { width, height } = bgitem._meta;
    const w = item._meta.width, h = item._meta.height;
    const region = { top: 0, left: 0, width: 0, height: 0 };

    // Absolute position
    if (lib.isNumber(item.top) && lib.isNumber(item.left)) {
        const top = this.toNumber(item.top, height);
        const left = this.toNumber(item.left, width);
        if (top >= height || left >= width) {
            item._skip = 1;
            return;
        }
        if (top + h > height) region.height = height - top;
        if (left + w > width) region.width = width - left;

    } else {
        switch (item.gravity) {
        case "north":
            if (h > height) {
                region.height = height;
            }
            if (w > width) {
                region.left = Math.round((w - width)/2);
                region.width = width;
            }
            break;

        case "south":
            if (h > height) {
                region.height = height;
                region.top = h - height;
            }
            if (w > width) {
                region.left = Math.round((w - width)/2);
                region.width = width;
            }
            break;

        case "west":
            if (h > height) {
                region.top = Math.round((h - height)/2);
                region.height = height;
            }
            if (w > width) {
                region.width = width;
            }
            break;

        case "east":
            if (h > height) {
                region.top = Math.round((h - height)/2);
                region.height = height;
            }
            if (w > width) {
                region.left = w - width;
                region.width = width;
            }
            break;

        case "northwest":
            if (h > height) {
                region.height = height;
            }
            if (w > width) {
                region.width = width;
            }
            break;

        case "northeast":
            if (h > height) {
                region.height = height;
            }
            if (w > width) {
                region.left = w - width;
                region.width = width;
            }
            break;

        case "southwest":
            if (h > height) {
                region.height = height;
                region.top = h - height;
            }
            if (w > width) region.width = width;
            break;

        case "southeast":
            if (h > height) {
                region.height = height;
                region.top = h - height;
            }
            if (w > width) {
                region.left = w - width;
                region.width = width;
            }
            break;
        }
    }

    if (region.width || region.height) {
        region.width = region.width || w;
        region.height = region.height || h;

        logger.debug("clip:", image.name, item.id, item.gravity, w, h, "region:", region);

        const img = sharp(await sharp(item._buffer).extract(region).toBuffer());

        setProp(item, "_buffer", await img.toBuffer());
        setProp(item, "_meta", await img.metadata());
    }
}

/**
 * Stitch multiple images into a single vertically stacked image.
 *
 * Each input image is loaded and normalized via {@link module:image/metadata}, then composited onto a
 * transparent RGBA background. Images are placed in the order provided, starting at the top (0),
 * with each subsequent image positioned directly below the previous one.
 *
 * The resulting canvas size is:
 * - width: max width of all successfully processed images
 * - height: sum of heights of all successfully processed images
 *
 * @async
 * @memberof module:image
 * @param {Array<Buffer|string|Object>} images
 *   List of images to stitch. Each item must be accepted by {@link image.metadata}
 *   (commonly a Buffer, file path, URL, or an object supported by that helper).
 *
 * @returns {Promise<Sharp>}
 *   A Sharp instance containing the stitched PNG image.
 *
 * @throws {Error}
 *   May throw if creating/compositing/encoding fails, or if the input set produces an invalid
 *   canvas size (e.g., no valid images).
 */
image.stitch = async function(images)
{
    const results = await Promise.allSettled(images.map(async (img) => (image.metadata(img))));

    let width = 0, height = 0;
    const buffers = [];

    results.forEach(res => {
        if (!res.value) {
            logger.error("stitch:", image.name, res);
            return;
        }
        buffers.push({ input: res.value.buffer, left: 0, top: height });
        width = Math.max(width, res.value.meta.width);
        height += res.value.meta.height;
    });

    const bg = sharp({
            create: { width, height, channels: 4, background: image.transparent }
        });

    return sharp(await bg.composite(buffers).png().toBuffer());
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
 * @returns {Promise<object>} Sharp instance with rendered image
 * @memberof module:image
 * @async
 */
image.createGradient = async function(item, bgitem)
{
    const width = Math.max(item._meta.width, item._inner_width * 2);
    const height = Math.max(item._meta.height, item._inner_height * 2);

    const ncolor = color.negate(color.hex2rgb(item.color || item._color || "#fff"));

    var gcolor = item.gradient_color;
    if (!gcolor) {
        gcolor = item._gcolor = color.rluminance(ncolor) > 0.179 ? image.white : image.black;
    }

    const images = [
        {
            input: Buffer.from(`
            <svg width="${width}" height="${height}">
                <defs>
                    <radialGradient id="grad">
                        <stop offset="0%"  stop-color="${gcolor}" stop-opacity="0.8"/>
                        <stop offset="10%" stop-color="${gcolor}" stop-opacity="0.8"/>
                        <stop offset="20%" stop-color="${gcolor}" stop-opacity="0.75"/>
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

    logger.debug("gradient:", image.name, item.id, "t:", item._color, item.color, "n:", ncolor, "g:", gcolor, "region:", width, height, region)

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

    const img = sharp(await sharp(buffer).extract(region).toBuffer());

    setProp(item, "_buffer", await img.toBuffer());
    setProp(item, "_meta", await img.metadata());

    return img;
}

/**
 * Render an SVG text block (optionally with stroke + outline dilation or drop shadow) into an image buffer,
 * trimming each line and stitching multiple lines together when needed.
 *
 * The function builds an SVG based on `item` properties, renders it with `sharp`, then:
 * - if `item.text` contains multiple lines (`\n`), renders each line separately and stitches results
 * - otherwise returns a single rendered image
 *
 * Supported effects (mutually exclusive; dilation takes precedence over shadow):
 * - Dilation/outline via SVG filter when `item.dilate_radius|dilate_alpha|dilate_color` is set
 * - Drop shadow via SVG filter when `item.shadow_width|shadow_alpha|shadow_color` is set
 *
 * Notes:
 * - Width/height and padding may be derived from `bgitem._meta.width/height`.
 * - `item.text` supports simple Pango-like tags: `<b>`, `<i>`, `<small>`, `<big>`, and closing tags `</...>`
 *   which are mapped to `<tspan>` elements.
 * - `item.size` can be a fraction (0..1) meaning a percentage of background height.
 *
 * @async
 * @memberof module:image
 * @param {Object} item - Text/rendering configuration.
 * @param {string} [item.text] - Text to render; `\\n` and `\n` create multiple lines.
 * @param {string|number} [item.width] - Output width; if omitted, derived from background width minus padding.
 * @param {string|number} [item.height] - Output height; if omitted, derived from background height minus padding.
 * @param {string} [item.color="#fff"] - Text fill color.
 * @param {number} [item.alpha] - Fill opacity/alpha (implementation-specific; passed to `toColor`).
 * @param {string} [item._color] - Fallback internal fill color.
 *
 * @param {string} [item.stroke_color] - Stroke color; if omitted it is auto-picked (black/white) based on fill luminance.
 * @param {number} [item.stroke_alpha] - Stroke opacity/alpha (passed to `toColor`).
 * @param {number} [item.stroke_width=0] - Stroke width.
 * @param {string} [item.stroke_linejoin="miter"] - Stroke line join.
 * @param {string} [item.paint_order="stroke"] - SVG `paint-order` for text (e.g. "stroke fill").
 *
 * @param {string} [item.font="sans-serif"] - Font family.
 * @param {number|string} [item.size=50] - Font size. If numeric between 0 and 1, treated as fraction of background height.
 * @param {string} [item.weight] - Weight keyword mapped to SVG font-weight ("ultralight","light","ultrabold","heavy","bold").
 * @param {string} [item.style="normal"] - Font style.
 * @param {string} [item.stretch="normal"] - Font stretch.
 * @param {string} [item.baseline="hanging"] - SVG `dominant-baseline`.
 *
 * @param {number} [item.dilate_radius=5] - Dilation radius for outline filter (enables dilation effect if set).
 * @param {number} [item.dilate_alpha=25] - Outline opacity in percent (0-100).
 * @param {string} [item.dilate_color] - Outline color; defaults to fill color.
 *
 * @param {number} [item.shadow_width=3] - Shadow offset in px for x/y (enables shadow effect if set).
 * @param {number} [item.shadow_blur=3] - Shadow blur deviation.
 * @param {number} [item.shadow_alpha=50] - Shadow opacity in percent (0-100).
 * @param {string} [item.shadow_color] - Shadow color; defaults to negated fill color (or black).
 *
 * @param {number} [item.wrap] - a factor for text wrapping, using naive formula: `width/fontSize*item.wrap`
 *
 * @param {Object} [bgitem] - Background item used for sizing/padding.
 * @param {Object} [bgitem._meta]
 * @param {number} [bgitem._meta.width] - Background width used to resolve relative sizes.
 * @param {number} [bgitem._meta.height] - Background height used to resolve relative sizes.
 *
 * @returns {Promise<Sharp>} A Sharp instance for the rendered outline/shadow text image.
 */
image.createOutline = async function(item, bgitem)
{
    const _w = bgitem?._meta?.width;
    const _h = bgitem?._meta?.height;
    const padding = this.padding(item, _w, _h);
    const width = this.toNumber(item.width, _w) || (_w - padding.left);
    const height = this.toNumber(item.height, _h) || (_h - padding.top);

    const fcolor = this.toColor(item.color || item._color || "#fff", item.alpha);
    const ncolor = color.negate(color.hex2rgb(fcolor));

    let scolor = this.toColor(item.stroke_color, item.stroke_alpha);
    if (!scolor) {
        scolor = item._scolor = this.toColor(color.rluminance(ncolor) > 0.179 ? image.white : image.black, item.stroke_alpha);
    }

    let fontSize = item.size;
    if (lib.isNumeric(fontSize) && fontSize > 0 && fontSize < 1) {
        fontSize = this.toNumber(fontSize, _h);
    }
    const fontWeight = { ultralight: "ligher", light: "lighter", ultrabold: "bolder", heavy: "bold", bold: "bold" }[item.weight];

    let lines = lib.split(lib.isString(item.text).replaceAll("\\n", "\n"), "\n");

    // Naive approximate wrapping
    if (item.wrap > 0 && fontSize > 0) {
        lines = lines.flatMap(line => lib.split(lib.wrap(line, { wrap: (width / fontSize) * item.wrap, over: 0.5 }), "\n"))
    }

    let filter = "";

    if (item.dilate_radius || item.dilate_alpha || item.dilate_color) {
        filter = `
        <filter id="filter">
            <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius="${item.dilate_radius || 5}"></feMorphology>
            <feFlood flood-color="${item.dilate_color || fcolor}" flood-opacity="${item.dilate_alpha/100 || 0.25}" result="FLOOD"></feFlood>
            <feComposite in="FLOOD" in2="DILATED" operator="in" result="OUTLINE"></feComposite>
            <feMerge>
                <feMergeNode in="OUTLINE" />
                <feMergeNode in="SourceGraphic" />
            </feMerge>
        </filter>`;
    } else

    if (item.shadow_width || item.shadow_alpha || item.shadow_color) {
        const scolor = item.shadow_color || color.hex(ncolor) || "#000";

        filter = `
        <filter id="filter" x="0" y="0" width="200%" height="200%">
            <feDropShadow dx="${item.shadow_width || 3}"
                          dy="${item.shadow_width || 3}"
                          stdDeviation="${item.shadow_blur || 3}"
                          flood-color="${scolor}"
                          flood-opacity="${item.shadow_alpha/100 || 0.5}"/>
        </filter>`;
    }

    const results = await Promise.allSettled(lines.map(async (line) => {
        // Pango compatibility
        line = line.replace(/<([^>]+)>/gi, (tag, name) => {
            if (name[0] == "/") return "</tspan>";
            switch (name) {
            case "b": return `<tspan font-weight="bolder">`
            case "i": return `<tspan font-style="italic">`
            case "small": return `<tspan font-size="smaller">`
            case "big": return `<tspan font-size="larger">`
            default: return "<tspan>"
            }
        });

        const svg = `
            <svg width="${width}" height="${height}">
                ${filter}
                <text
                    x="${padding.left}"
                    y="${padding.top}"
                    dominant-baseline="${item.baseline || "hanging"}"
                    font-family="${item.font || "sans-serif"}"
                    font-size="${fontSize || 50}"
                    font-weight="${fontWeight || "normal"}"
                    font-style="${item.style || "normal"}"
                    font-stretch="${item.stretch || "normal"}"
                    fill="${fcolor}"
                    stroke="${scolor}"
                    stroke-width="${item.stroke_width || 0}"
                    stroke-linejoin="${item.stroke_linejoin || "miter"}"
                    paint-order="${item.paint_order || "stroke"}"
                    filter="url(#filter)">${line}</text>
            </svg>`;

        logger.debug("outline:", image.name, item.id, svg);
        return sharp(Buffer.from(svg)).trim({ threshold: 1, lineArt: true }).toBuffer();
    }));

    if (results.length == 1) {
        return sharp(results[0].value);
    }

    return image.stitch(results.map(x => x.value));
}

/**
 * Create a Sharp image instance that renders a text block using Pango rendering.
 *
 * Builds an optional `<span ...>...</span>` wrapper around the provided text using supported
 * attributes (color, size, weight, underline, etc.), normalizes newline sequences (`"\\n"` -> `"\n"`),
 * and passes sizing/font/layout options to `sharp({ text: ... })`.
 *
 * @param {Object} item - Text render options.
 * @param {number|string} [item.width] - Target width. If not provided, falls back to `bgitem._meta.width`.
 * @param {number|string} [item.height] - Target height. If not provided, falls back to `bgitem._meta.height`.
 * @param {string} item.text - Text to render. `"\\n"` sequences are converted to newlines and trimmed.
 * @param {string} [item.font] - Font family name to use.
 * @param {string} [item.fontfile] - Path to a font file to use.
 * @param {number|string} [item.dpi] - Text rendering DPI. When set, height is not passed to Sharp.
 * @param {number|string} [item.spacing] - Line/paragraph spacing passed to Sharp.
 * @param {string} [item.align] - Text alignment passed to Sharp (e.g. "left", "center", "right").
 * @param {boolean|string|number} [item.justify] - Whether to justify text (coerced via `lib.toBool`).
 * @param {string} [item.wrap="word"] - Wrapping mode passed to Sharp.
 *
 * @param {string} [item._color] - Text color (becomes `color="..."` attribute).
 * @param {string} [item.color] - Text color.
 * @param {string} [item.bgcolor] - Background color.
 * @param {string|number} [item.size] - Font size, Pango format or a fraction of the height if < 1
 * @param {string|number} [item.weight] - Font weight.
 * @param {string} [item.style] - Font style.
 * @param {string|number} [item.stretch] - Font stretch.
 * @param {string|boolean} [item.strikethrough] - Strikethrough enable/value.
 * @param {string} [item.strikethrough_color] - Strikethrough color.
 * @param {string|boolean} [item.underline] - Underline enable/value.
 * @param {string} [item.underline_color] - Underline color.
 * @param {string|number} [item.line_height] - Line height.
 * @param {string|number} [item.segment] - Pango segment attribute.
 * @param {string|number} [item.letter_spacing] - Letter spacing.
 * @param {string|boolean} [item.allow_breaks] - Allow line breaks.
 * @param {string|number} [item.rise] - Text rise.
 * @param {string|number} [item.baseline_shift] - Baseline shift.
 * @param {string} [item.font_features] - Font features string.
 * @param {string} [item.gravity_hint] - Gravity hint.
 * @param {string} [item.text_gravity] - Text gravity (stored as `gravity` attribute).
 * @param {string|number} [item.alpha] - Text alpha; if not ending in `%`, `%` is appended.
 * @param {string|number} [item.bgalpha] - Background alpha; if not ending in `%`, `%` is appended.
 *
 * @param {Object} [bgitem] - Optional background item used for default sizing.
 * @param {Object} [bgitem._meta]
 * @param {number} [bgitem._meta.width] - Default width fallback.
 * @param {number} [bgitem._meta.height] - Default height fallback.
 *
 * @returns {object} A Sharp instance configured with a text input.
 * @memberof module:image
 */
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
        if (!val) continue;

        if (p.endsWith("alpha") && val.at(-1) != "%") {
            val += "%";
        } else
        if (p == "size") {
            if (item.dpi) val = null;
            if (lib.isNumeric(val)) {
                val = this.toNumber(val, bgitem?._meta?.height) + "pt";
            }
        }
        if (val) {
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

/**
 * Create a Sharp image instance from different input sources and optionally resize it.
 *
 * Accepts an image from a file path/URL (`item.file`), an existing Sharp instance (`item.data`),
 * a Buffer (`item.data`), or a base64 data URL (`item.data` starting with `"data:image/"`).
 * If `width`/`height` are provided (or derived from `bgitem._meta`), the image is resized and
 * a new Sharp instance is returned.
 *
 * @async
 * @memberof module:image
 * @param {Object} item
 * @param {number|string} [item.width] - Target width. If not provided, may be taken from `bgitem._meta.width`.
 * @param {number|string} [item.height] - Target height. If not provided, may be taken from `bgitem._meta.height`.
 *                                       If still missing, defaults to `width` (square).
 * @param {string} [item.file] - Image input as a file path/URL (anything Sharp can open).
 * @param {object|Buffer|string} [item.data] - Image input:
 *   - a Sharp instance (will be converted to Buffer),
 *   - a Buffer,
 *   - a base64 data URL beginning with `"data:image/"`.
 * @param {Object} [item.sharp] - Options passed to `sharp(input, item.sharp)` constructor.
 *
 * @param {string} [item.fit] - Sharp resize `fit` option (e.g. `"cover"`, `"contain"`, `"fill"`, `"inside"`, `"outside"`).
 * @param {string|Object} [item.position] - Sharp resize `position` option (gravity/strategy).
 * @param {string} [item.kernel] - Sharp resize `kernel` option.
 * @param {string|Object} [item.background] - Background color used for padding when applicable.
 * @param {boolean} [item.withoutEnlargement] - Do not enlarge if image is smaller than target size.
 * @param {boolean} [item.withoutReduction] - Do not reduce if image is larger than target size.
 * @param {boolean} [item.fastShrinkOnLoad] - Use fast shrink-on-load where supported.
 *
 * @param {Object} [bgitem] - Optional background item used only as a source of fallback dimensions.
 * @param {Object} [bgitem._meta]
 * @param {number} [bgitem._meta.width] - Fallback width if `item.width` is not provided.
 * @param {number} [bgitem._meta.height] - Fallback height if `item.height` is not provided.
 *
 * @returns {Promise<object>} A Sharp instance for the loaded (and possibly resized) image.
 */
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

/**
 * Create a border image buffer with optional rounded corners.
 *
 * Builds an RGBA image of the given size filled with `item.border_color` (and `item.border_alpha`),
 * falling back to semi-transparent white when no color is provided. If a radius is specified
 * (`item.border_radius` or `item.radius`), it applies an SVG rounded-rectangle mask using a composite
 * operation (default `dest-in` or `item.border_blend`).
 *
 * @async
 * @memberof module:image
 * @param {Object} item - Border configuration.
 * @param {string|Object} [item.border_color] - Border color (passed through `this.toColor`).
 * @param {number} [item.border_alpha] - Alpha used with `border_color` (passed through `this.toColor`).
 * @param {number} [item.border_radius] - Corner radius (falls back to `item.radius`).
 * @param {number} [item.radius] - Alternate corner radius if `border_radius` is not provided.
 * @param {string} [item.border_blend='dest-in'] - Sharp composite blend mode used for the radius mask.
 * @param {number} width - Output image width in pixels.
 * @param {number} height - Output image height in pixels.
 * @returns {Promise<Buffer>} PNG-encoded image buffer.
 */
image.createBorder = async function(item, width, height)
{
    const border_color = this.toColor(item.border_color, item.border_alpha)

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
 * @param {number} [item.stroke_width] - trigger outlined text with given stroke width, color is used as the fill
 * @param {string} [item.stroke_color] - outline stroke color
 * @param {number} [item.stroke_alpha] - opacity for the outline fill color
 * @param {number} [item.dilate_radius] - trigger outline dilate filter with given radius around text
 * @param {string} [item.dilate_color] - outline delate filter color
 * @param {number} [item.dilate_alpha] - opacity for the outline delate color
 * @param {string} [item.stroke_linejoin] - dilate stroke line join, miter, arcs, bevel, round
 * @param {number} [item.shadow_width] - width of the drop shadow for SVG texts
 * @param {number} [item.shadow_alpha] - opacity for drop shadows
 * @param {string} [item.shadow_color] - drop shadow color, if not given oposite of the stroke is used
 * @param {number} [item.shadow_blur] -
 * @param {object} [bgitem] - background item
 * @returns {Promise<object>} - a sharp object containing an image, as PNG
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
        if (item.stroke_width || item.dilate_radius ||
            item.shadow_width || item.shadow_blur || item.shadow_alpha) {
            innerImage = await image.createOutline(item, bgitem);
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

    const padding_color = this.toColor(item.padding_color, item.padding_alpha)

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
    const other = items.slice(1);

    const results = await Promise.allSettled(other.map(async (item) => {
        // Autodetect color for texts
        if (item.text && !item.color) {
            await image.detect(item, bgitem);
        }

        await image.create(item, bgitem);

        if (lib.isFlag(lib.split(item.gradient), ["1", "true", item.type, item.id])) {
            await image.createGradient(item, bgitem);
        }

        await image.clip(item, bgitem);

        return item;
    }));

    const buffers = results.map((res, i) => {
        const item = res.value;
        logger.logger(item?._buffer ? "debug" : "error", "composite:", image.name, "result:", res, res.value ? "" : items[i]);
        if (!item?._buffer || item?._skip) return 0;

        return {
            input: item._buffer,
            gravity: item.gravity || undefined,
            blend: item.blend || undefined,
            top: lib.isNumber(item.top) ? this.toNumber(item.top, bgitem._meta.height) : undefined,
            left: lib.isNumber(item.left) ? this.toNumber(item.left, bgitem._meta.width) : undefined,
        };
    }).filter(x => x);

    // Composite all elements onto the background
    bgimage.composite(buffers);

    setProp(bgitem, "_buffer", await bgimage.png().toBuffer())
    setProp(bgitem, "_meta", await bgimage.metadata())

    logger.debug("composite:", image.name, "bg:", bgitem);

    return items;
}
