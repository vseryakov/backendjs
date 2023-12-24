/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

// Based on Bootstrap internal sanitizer
bkjs.sanitizer = {
    _attrs: new Set(['background','cite','href','itemtype','longdesc','poster','src','xlink:href']),
    _urls: /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i,
    _data: /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i,
    _tags: {
        '*': ['class', 'dir', 'id', 'lang', 'role', /^aria-[\w-]*$/i],
        a: ['target', 'href', 'title', 'rel'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'style'],
        area: [], b: [], br: [], col: [], code: [], div: [], em: [], hr: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], i: [],
        li: [], ol: [], p: [], pre: [], s: [], small: [], span: [], sub: [], sup: [], strong: [], u: [], ul: [],
        table: [], thead: [], tbody: [], th: [], tr: [], td: [], blockquote: []
    },

    isattr: function(attr, list) {
        const name = attr.nodeName.toLowerCase();
        if (list.includes(name)) {
            if (this._attrs.has(name)) {
                return this._urls.test(attr.nodeValue) || this._data.test(attr.nodeValue);
            }
            return true;
        }
        return list.some((x) => (x instanceof RegExp && x.test(name)));
    },

    run: function(html) {
        if (!html || !bkjs.isS(html)) return html;
        const dom = new window.DOMParser();
        const doc = dom.parseFromString(html, 'text/html');
        const elements = [...doc.body.querySelectorAll('*')];
        for (const el of elements) {
            const name = el.nodeName.toLowerCase();
            if (this._tags[name]) {
                const allow = [...this._tags['*'], ...this._tags[name] || []];
                for (const attr of [...el.attributes]) {
                    if (!this.isattr(attr, allow)) el.removeAttribute(attr.nodeName);
                }
            } else {
                el.remove();
            }
        }
        return doc.body.innerHTML;
    }
}

// Convert an object into a query string
bkjs.toQuery = function(obj)
{
    var rc = [];

    function add(k, v) {
       rc.push(encodeURIComponent(k) + "=" + encodeURIComponent(bkjs.isF(v) ? v() : v === null ? v: v === true ? "1" : v));
    }

    function build(key, val) {
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${typeof val[i] === "object" && val[i] != null ? i : ""}]`, val[i]);
        } else
        if (bkjs.isObject(val)) {
            for (const n in val) build(`${key}[${n}]`, val[n]);
        } else {
            add(key, val);
        }
    }
    for (const p in obj) build(p, obj[p]);
    return rc.join("&");
}

// A shortcut to create an element with attributes, functions will be added as event handlers
bkjs.createElement = function()
{
    const el = document.createElement(arguments[0]);
    for (let i = 1; i < arguments.length - 1; i+= 2) {
        if (typeof arguments[i + 1] == "function") {
            el.addEventListener(arguments[i], arguments[i + 1], false);
        } else {
            el[arguments[i]] = arguments[i + 1];
        }
    }
    return el;
}

// Inject CSS/Script resources into the current page, loading is async, all pages are loaded at the same time,
// if options.async set then scripts executed as soon as loaded otherwise executing scripts will be in the order provided
// options.callback will be called with (el, opts) args for customizations after the log or error
bkjs.loadResources = function(urls, options, callback)
{
    if (bkjs.isF(options)) callback = options, options = null;
    const cb = bkjs.isF(options?.callback) ? options.callback : () => {};
    this.forEach(urls, (url, next) => {
        let el;
        const ev = () => { cb(el, options); next() }
        if (/\.css/.test(url)) {
            el = bkjs.createElement("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev)
        } else {
            el = bkjs.createElement('script', "async", !!options?.async, "src", url, "load", ev, "error", ev)
        }
        for (const p in options?.attrs) el[p] = options.attrs[p];
        document.head.appendChild(el);
    }, callback);
}

bkjs.xhr = function(options, callback)
{
    const opts = this.fetchOpts(options);
    const r = new XMLHttpRequest();
    r.open(opts.method, options.url, options.sync ? false : true);
    if (options.dataType == "blob") r.responseType = "blob";
    for (const h in opts.headers) r.setRequestHeader(h, opts.headers[h]);
    r.onloadend = (ev) => {
        var info = { status: r.status, headers: {}, readyState: r.readyState };
        bkjs.strSplit(r.getAllResponseHeaders(), /[\r\n]+/).forEach((line) => {
            line = line.split(': ');
            info.headers[line.shift()] = line.join(': ');
        });
        var data = r.response || "";
        if (/\/json/.test(info.headers["content-type"])) {
            try { data = JSON.parse(data) } catch (e) {}
        }
        if (r.status >= 200 && r.status < 300) {
            bkjs.isF(callback) && callback(null, data, info);
        } else {
            bkjs.isF(callback) && callback({ status: r.status, message: data.message || data || r.statusText }, data, info);
        }
    }
    try {
        r.send(opts.body || null);
    } catch (err) {
        bkjs.isF(callback) && callback(err);
    }
}
