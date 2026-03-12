/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module files/image
 */

const lib = require(__dirname + '/../lib');

const mod = {
    name: "files.color",
};

/**
 * RGB color convertions
 */

module.exports = mod;

mod.hex2rgb = function(hex)
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

mod.hsl2rgb = function(hsl)
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

mod.hsv2rgb = function(hsv)
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

mod.hex = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase();
}

mod.luminance = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
}

// Relative luminance is given by W3C https://www.w3.org/TR/WCAG21/#dfn-relative-luminance.
mod.rluminance = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    const x = [r / 255, g / 255, b / 255].map((i) => (i <= 0.04045 ? i / 12.92 : Math.pow((i + 0.055) / 1.055, 2.4)));
    return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
}

mod.hsl = function(rgb)
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

mod.hsv = function(rgb)
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

mod.complement = function(rgb)
{
    const { h, s, l } = mod.hsl(rgb);
    return mod.hsl2rgb([(h + 180) % 360, s, l]);
}

mod.yiq = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return {
        y: 0.299 * r + 0.587 * g + 0.114 * b,
        i: 0.596 * r - 0.275 * g - 0.321 * b,
        q: 0.212 * r - 0.523 * g + 0.311 * b,
    }
}

mod.contrast = function(rgb1, rgb2)
{
    const lum1 = mod.luminance(rgb1);
    const lum2 = mod.luminance(rgb2);
    return lum1 > lum2 ? (lum1 + 0.05) / (lum2 + 0.05) : (lum2 + 0.05) / (lum1 + 0.05);
}

mod.negate = function(rgb)
{
    const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b];
    return { r: 255 - r, g: 255 - g, b: 255 - b }
}

mod.lighter = function(rgb, ratio)
{
    const { h, s, l } = mod.hsl(rgb);
    return mod.hsl2rgb([h, s, l * ratio]);
}

mod.darker = function(rgb, ratio)
{
    const { h, s, l } = mod.hsl(rgb);
    return mod.hsl2rgb([h, s, l - (l * ratio)]);
}
