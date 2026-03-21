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
    var d, rgb = { r: 0, g: 0, b: 0 };
    hex = lib.isString(hex);
    if (hex.length == 4) {
        d = hex.match(/^#([0-9A-Z])([0-9A-Z])([0-9A-Z])$/);
        if (d) {
            for (let i = 1; i < 4; i++) d[i] = d[i] + d[i];
        }
    } else {
        d = hex.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})?$/i)
    }
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
 * Convert RGB to a hex color string (#RRGGBB).
 *
 * @param {object|number[]} rgb - RGB object or [r,g,b] array (0..255).
 * @returns {string} Hex color string in uppercase, e.g. "#FF00AA".
 * @memberof module:color
 */
color.hex = function(rgb)
{
    rgb = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b, rgb.alpha];
    return "#" + rgb.map(x => (x ? parseInt(x).toString(16).padStart(2, '0') : "")).join("")
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
 * @returns {number[]} HSL values.
 * @memberof module:color
 */
color.hsl = function(rgb)
{
    var [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];

    r /= 255;
    g /= 255;
    b /= 255;

    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const delta = max - min;

    let h = 0, s = 0;
    const l = (min + max) / 2;

    if (delta !== 0) {
        if (max === r) {
            h = ((g - b) / delta) % 6;
        } else if (max === g) {
            h = (b - r) / delta + 2;
        } else {
            h = (r - g) / delta + 4;
        }

        h *= 60;
        if (h < 0) h += 360;

        s = delta / (1 - Math.abs(2 * l - 1));
    }

    return [h, s * 100, l * 100];
}

/**
 * Convert HSL to RGB.
 *
 * Input H is degrees (0..360), S and L are percentages (0..100).
 *
 * @param {object|number[]} hsl - HSL object or [h,s,l] array.
 * @returns {number[]} RGB components in 0..255.
 * @memberof module:color
 */
color.hsl2rgb = function(hsl)
{
    let [h, s, l] = Array.isArray(hsl) ? hsl : [hsl.h, hsl.s, hsl.l];

    // Normalize inputs
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }

    const hk = h / 360;
    const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const t1 = 2 * l - t2;

    function hue2rgb(t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        let v;
        if (6 * t < 1) v = t1 + (t2 - t1) * 6 * t;
        else if (2 * t < 1) v = t2;
        else if (3 * t < 2) v = t1 + (t2 - t1) * (2 / 3 - t) * 6;
        else v = t1;
        return Math.round(Math.max(0, Math.min(1, v)) * 255);
    }

    return [
        hue2rgb(hk + 1/3),
        hue2rgb(hk),
        hue2rgb(hk - 1/3),
    ];
}

/**
 * Rotate an RGB color around the hue wheel by a number of degrees, i.e. complement color
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
    var [h, s, l] = color.hsl(rgb);
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
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b, rgb.a];
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
    const [h, s, l] = color.hsl(rgb);
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
    const [h, s, l] = color.hsl(rgb);
    return color.hsl2rgb([h, s, l - (l * ratio)]);
}

/**
 * Mix (blend) two RGB/RGBA colors together using a weight.
 *
 * The `weight` controls how much of `rgb1` is in the result:
 * - `weight = 1`   -> returns `rgb1`
 * - `weight = 0`   -> returns `rgb2`
 * - `weight = 0.5` -> equal mix
 *
 * Note: channels are returned as numbers (not clamped/rounded).
 *
 * @function mix
 * @memberof module:color
 * @param {number[]|object} rgb1 First color (array or object).
 * @param {number[]|object} rgb2 Second color (array or object).
 * @param {number} [weight=0.5] Blend weight from 0..1 (higher means more of `rgb1`).
 * @returns {{r:number,g:number,b:number,alpha:number}} Mixed color as an object.
 *
 * @example
 * color.mix({ r: 255, g: 0, b: 0, alpha: 1 }, { r: 0, g: 0, b: 255, alpha: 1 })
 * { r: 127.5, g: 0, b: 127.5, alpha: 1 }
 *
 * @example <caption>closer to black (because weight favors rgb2)</caption>
 * color.mix([255, 255, 255, 1], [0, 0, 0, 1], 0.25)
 * { r: 63.75, g: 63.75, b: 63.75, alpha: 1 }
 */
color.mix = function(rgb1, rgb2, weight = 0.5)
{
    const [r1, g1, b1, a1] = Array.isArray(rgb1) ? rgb1 : [rgb1.r, rgb1.g, rgb1.b, rgb1.alpha];
    const [r2, g2, b2, a2] = Array.isArray(rgb2) ? rgb2 : [rgb2.r, rgb2.g, rgb2.b, rgb2.alpha];

    const w = 2 * weight - 1;
    const a = (a1 ?? 0) - (a2 ?? 0);
    const w1 = ((w * a === -1 ? w : (w + a) / (1 + w * a)) + 1) / 2;
    const w2 = 1 - w1;
    return {
        r: w1 * r1 + w2 * r2,
        g: w1 * g1 + w2 * g2,
        b: w1 * b1 + w2 * b2,
        alpha: (a1 ?? 0) * weight + (a2 ?? 0) * (1 - weight)
    };
  }
