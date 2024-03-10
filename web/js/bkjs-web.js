/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.plugins = [];

bkjs.applyPlugins = function(target)
{
    if (!target) return;
    for (const i in this.plugins) {
        if (this.isF(this.plugins[i])) this.plugins[i](target);
    }
}

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
        if (!html || typeof html != "string") return html;
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

    const add = (k, v) => {
       rc.push(encodeURIComponent(k) + "=" + encodeURIComponent(this.isF(v) ? v() : v === null ? v: v === true ? "1" : v));
    }

    const build = (key, val) => {
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${typeof val[i] === "object" && val[i] != null ? i : ""}]`, val[i]);
        } else
        if (this.isObject(val)) {
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
    if (this.isF(options)) callback = options, options = null;
    const cb = this.isF(options?.callback) ? options.callback : () => {};
    this.forEach(urls, (url, next) => {
        let el;
        const ev = () => { cb(el, options); next() }
        if (/\.css/.test(url)) {
            el = this.createElement("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev)
        } else {
            el = this.createElement('script', "async", !!options?.async, "src", url, "load", ev, "error", ev)
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
        this.strSplit(r.getAllResponseHeaders(), /[\r\n]+/).forEach((line) => {
            line = line.split(': ');
            info.headers[line.shift()] = line.join(': ');
        });
        var data = r.response || "";
        if (/\/json/.test(info.headers["content-type"])) {
            try { data = JSON.parse(data) } catch (e) {}
        }
        if (r.status >= 200 && r.status < 300) {
            this.isF(callback) && callback(null, data, info);
        } else {
            this.isF(callback) && callback({ status: r.status, message: data.message || data || r.statusText }, data, info);
        }
    }
    try {
        r.send(opts.body || null);
    } catch (err) {
        this.isF(callback) && callback(err);
    }
}

// Simple router support
bkjs.appPath = (window.location.pathname.replace(/(\/+[^/]+)$|\/+$/, "") + "/").replace(/\/app.+$/, "/") + "app/";
bkjs.appLocation = window.location.origin + bkjs.appPath;

bkjs.appEvent = function(name, data)
{
    this.event("bkjs.event", [name, this.toCamel("on_" + name), data]);
}

bkjs.getBreakpoint = function()
{
    var w = $(document).innerWidth();
    return w < 576 ? 'xs' : w < 768 ? 'sm' : w < 992 ? 'md' : w < 1200 ? 'lg' : w < 1400 ? 'xl' : 'xxl';
}

bkjs.setBreakpoint = function()
{
    this.breakpoint = this.getBreakpoint();
    document.documentElement.style.setProperty('--height', (window.innerHeight * 0.01) + "px");
}

bkjs.resized = function(event)
{
    clearTimeout(this._resized);
    this._koResized = setTimeout(this.setBreakpoint.bind(this), 500);
}

bkjs.pushLocation = function(path, name, options)
{
    if (!path || !name || path == this._appLocation) return;
    window.history.pushState({ name: name, options: options }, name, this.appLocation + path);
    this._appLocation = path;
    this.trace("pushLocation:", path, name, options)
}

bkjs.parseLocation = function(path, dflt)
{
    var loc = window.location;
    if (path && (loc.origin + path).indexOf(this.appLocation) != 0) path = "";
    var location = loc.origin + (path || loc.pathname);
    var params = location.substr(this.appLocation.length).split("/");
    this.trace("parseLocation:", loc.pathname, "path:", path, "dflt:", dflt, "params:", params);
    return { path: path, dflt: dflt, params: params, component: this.findComponent(params[0]) };
}

bkjs.restoreComponent = function(path, dflt)
{
    var loc = this.parseLocation(path, dflt);
    this.showComponent(loc.component?.name || loc.dflt || "none", { param: loc.params[1], param2: loc.params[2], param3: loc.params[3] });
}

window.onpopstate = function(event)
{
    if (event?.state?.name) this.showComponent(event.state.name, event.state.options);
}

$(function() {
    bkjs.setBreakpoint();
    window.addEventListener("resize", bkjs.resized.bind(bkjs));
});

