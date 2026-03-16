/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module color
 */

const lib = require(__dirname + '/../lib');

const color = {
    name: "color",
};

/**
 * RGB color convertions
 */

module.exports = color;

/**
 * Convert a hex color string into an RGB object.
 *
 * Supports:
 * - #RGB (shorthand)
 * - #RRGGBB
 * - #RRGGBBAA (alpha is returned as 0..1 in `alpha`)
 *
 * @param {string} hex - Hex color string, typically starting with "#".
 * @returns {object} RGB components in 0..255 and optional alpha in 0..1.
 * @memberof module:color
 */
color.hex2rgb = function(hex)
{
    var rgb = { r: 0, g: 0, b: 0 };
    hex = lib.isString(hex);
    var d = hex.match(hex.length == 4 ? /^#([0-9A-Z])([0-9A-Z])([0-9A-Z])$/ : /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})?$/i)
    if (d) {
        rgb.r = parseInt(d[1], 16);
        rgb.g = parseInt(d[2], 16);
        rgb.b = parseInt(d[3], 16);
        const alpha = parseInt(d[4], 16);
        if (alpha) rgb.alpha = alpha / 255;
    }
    return rgb;
}

/**
 * Convert HSL to RGB.
 *
 * Input H is degrees (0..360), S and L are percentages (0..100).
 *
 * @param {object|number[]} hsl - HSL object or [h,s,l] array.
 * @returns {{r:number,g:number,b:number}} RGB components in 0..255.
 * @memberof module:color
 */
color.hsl2rgb = function(hsl)
{
    var [h, s, l] = Array.isArray(hsl) ? hsl : [hsl.h, hsl.s, hsl.l]

    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
        r = c; g = x; b = 0;
    } else
    if (h >= 60 && h < 120) {
        r = x; g = c; b = 0;
    } else
    if (h >= 120 && h < 180) {
        r = 0; g = c; b = x;
    } else
    if (h >= 180 && h < 240) {
        r = 0; g = x; b = c;
    } else
    if (h >= 240 && h < 300) {
        r = x; g = 0; b = c;
    } else
    if (h >= 300 && h < 360) {
        r = c; g = 0; b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

/**
 * Convert HSV/HSB to RGB.
 *
 * Input H is degrees (0..360), S and V are percentages (0..100).
 *
 * @param {object|number[]} hsv - HSV object or [h,s,v] array.
 * @returns {{r:number,g:number,b:number}} RGB components in 0..255.
 * @memberof module:color
 */
color.hsv2rgb = function(hsv)
{
    let [h, s, v] = Array.isArray(hsv) ? hsv : [hsv.h, hsv.s, hsv.v];

    h /= 360;
    s /= 100;
    v /= 100;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    }
}

/**
 * Convert RGB to a hex color string (#RRGGBB).
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {string} Hex color string in uppercase, e.g. "#FF00AA".
 * @memberof module:color
 */
color.hex = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase();
}

/**
 * Compute a simple (non-gamma-corrected) luminance value.
 *
 * Uses coefficients similar to Rec.709 on sRGB values without linearization.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {number} Luminance in roughly 0..1.
 * @memberof module:color
 */
color.luminance = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
}

/**
 * Compute relative luminance per WCAG (gamma-corrected / linearized sRGB).
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {number} Relative luminance (0..1).
 * @memberof module:color
 */
color.rluminance = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    const x = [r / 255, g / 255, b / 255].map((i) => (i <= 0.04045 ? i / 12.92 : Math.pow((i + 0.055) / 1.055, 2.4)));
    return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
}

/**
 * Convert RGB to HSL.
 *
 * Output H is degrees (0..360), S and L are percentages (0..100).
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {{h:number,s:number,l:number}} HSL values.
 * @memberof module:color
 */
color.hsl = function(rgb)
{
    let [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];

    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
        case g:
            h = (b - r) / d + 2;
            break;
        case b:
            h = (r - g) / d + 4;
            break;
        }
        h /= 6;
    }
    return {
        h: h * 360,
        s: s * 100,
        l: l * 100
    }
}

/**
 * Convert RGB to HSV/HSB.
 *
 * Output H is degrees (0..360), S and V are percentages (0..100).
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {{h:number,s:number,v:number}} HSV values (rounded to integers).
 * @memberof module:color
 */
color.hsv = function(rgb)
{
    let [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];

    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    var h = 0, s = 0, v = max;

    if (delta !== 0) {
        s = delta / max;
        if (max === r) {
            h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        } else
        if (max === g) {
            h = ((b - r) / delta + 2) / 6;
        } else {
            h = ((r - g) / delta + 4) / 6;
        }
    }
    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        v: Math.round(v * 100)
    }
}

/**
 * Rotate an RGB color around the hue wheel by a number of degrees.
 *
 * Uses RGB -> HSL -> RGB conversion; keeps S and L the same.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @param {number} [degrees=180] - Hue rotation amount in degrees (can be negative).
 * @returns {{r:number,g:number,b:number}} Rotated RGB color.
 * @memberof module:color
 */
color.rotate = function(rgb, degrees = 180)
{
    var { h, s, l } = color.hsl(rgb);
    h = (h + degrees) % 360;
    h = h < 0 ? 360 + h : h;
    return color.hsl2rgb([h, s, l]);
}

/**
 * Convert RGB to YIQ color space.
 *
 * Commonly used for legacy TV signal encoding and quick brightness-ish computations.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {{y:number,i:number,q:number}} YIQ components.
 * @memberof module:color
 */
color.yiq = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return {
        y: 0.299 * r + 0.587 * g + 0.114 * b,
        i: 0.596 * r - 0.275 * g - 0.321 * b,
        q: 0.212 * r - 0.523 * g + 0.311 * b,
    }
}

/**
 * Compute contrast ratio between two colors using WCAG relative luminance
 *
 * @param {object|number[]} rgb1 - First RGB color (0..255).
 * @param {object|number[]} rgb2 - Second RGB color (0..255).
 * @returns {number} Contrast ratio (>= 1).
 * @memberof module:color
 */
color.contrast = function(rgb1, rgb2)
{
    const lum1 = color.rluminance(rgb1);
    const lum2 = color.rluminance(rgb2);
    return lum1 > lum2 ? (lum1 + 0.05) / (lum2 + 0.05) : (lum2 + 0.05) / (lum1 + 0.05);
}

/**
 * Invert/negate an RGB color.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {{r:number,g:number,b:number}} Negated RGB color.
 * @memberof module:color
 */
color.negate = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return { r: 255 - r, g: 255 - g, b: 255 - b }
}

/**
 * Make a color lighter by scaling its HSL lightness.
 *
 * New lightness is `l + (l * ratio)`.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @param {number} [ratio=0.5] - Multiplier applied to HSL lightness.
 * @returns {{r:number,g:number,b:number}} Adjusted RGB color.
 * @memberof module:color
 */
color.lighter = function(rgb, ratio = 0.5)
{
    const { h, s, l } = color.hsl(rgb);
    return color.hsl2rgb([h, s, l + (l * ratio)]);
}

/**
 * Make a color darker by reducing its HSL lightness by a ratio.
 *
 * New lightness is `l - (l * ratio)`.
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @param {number} [ratio=0.5] - Fraction of lightness to remove.
 * @returns {{r:number,g:number,b:number}} Adjusted RGB color.
 * @memberof module:color
 */
color.darker = function(rgb, ratio = 0.5)
{
    const { h, s, l } = color.hsl(rgb);
    return color.hsl2rgb([h, s, l - (l * ratio)]);
}
