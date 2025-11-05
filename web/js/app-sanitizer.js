/*
 *   app client
 *   Vlad Seryakov vseryakov@gmail.com 2018
 */

/* global window */

(() => {
var app = window.app;

function isattr(attr, list)
{
    const name = attr.nodeName.toLowerCase();
    if (list.includes(name)) {
        if (sanitizer._attrs.has(name)) {
            return sanitizer._urls.test(attr.nodeValue) || sanitizer._data.test(attr.nodeValue);
        }
        return true;
    }
    return list.some((x) => (x instanceof RegExp && x.test(name)));
}

// Based on Bootstrap internal sanitizer
function sanitizer(html, list)
{
    if (!html || typeof html != "string") return list ? [] : html;
    const body = app.$parse(html);
    const elements = [...body.querySelectorAll('*')];
    for (const el of elements) {
        const name = el.nodeName.toLowerCase();
        if (sanitizer._tags[name]) {
            const allow = [...sanitizer._tags['*'], ...sanitizer._tags[name] || []];
            for (const attr of [...el.attributes]) {
                if (!isattr(attr, allow)) el.removeAttribute(attr.nodeName);
            }
        } else {
            el.remove();
        }
    }
    return list ? Array.from(body.childNodes) : body.innerHTML;
}

sanitizer._attrs = new Set(['background','cite','href','itemtype','longdesc','poster','src','xlink:href'])
sanitizer._urls = /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i
sanitizer._data = /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i
sanitizer._tags = {
    '*': ['class', 'dir', 'id', 'lang', 'role', /^aria-[\w-]*$/i,
    'data-bs-toggle', 'data-bs-target', 'data-bs-dismiss', 'data-bs-parent'],
    a: ['target', 'href', 'title', 'rel'], area: [],
    b: [], blockquote: [], br: [], button: [],
    col: [], code: [],
    div: [], em: [], hr: [],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'style'],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    i: [], li: [], ol: [], p: [], pre: [],
    s: [], small: [], span: [], sub: [], sup: [], strong: [],
    table: [], thead: [], tbody: [], th: [], tr: [], td: [],
    u: [], ul: [],
}

app.sanitizer = sanitizer;

})();
