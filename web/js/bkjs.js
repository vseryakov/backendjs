/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

var bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: 1,

    htz: "bk-tz",
    hcsrf: "bk-csrf",

    // HTTP headers to be sent with every request
    headers: {},

    // For urls without host this will be used to make a full absolute URL, can be used for CORS
    locationUrl: "",

    // Current account record
    account: {},

    // i18n locales by 2-letter code, uses account.lang to resolve the translation
    locales: {},

    isF: (x) => (typeof x === "function"),
    isS: (x) => (typeof x === "string"),
    isB: (x) => (typeof x === "boolean"),
    isO: (x) => (typeof x === "object"),
    isN: (x) => (typeof x === "number"),
    isU: (x) => (typeof x === "undefined"),
    isE: (x) => (x === null || typeof x === "undefined"),
    cb: (c, e, ...a) => (bkjs.isF(c) && c(e, ...a)),
};

bkjs.fetchOpts = function(options)
{
    var headers = options.headers || {};
    var opts = this.objExtend({
        headers: headers,
        method: options.type || "POST",
        cache: "default",
    }, options.fetchOptions);

    if (opts.method == "GET" || opts.method == "HEAD") {
        if (this.isO(options.data)) {
            options.url += "?" + this.toQuery(options.data);
        }
    } else
    if (this.isS(options.data)) {
        opts.body = options.data;
        headers["content-type"] = options.contentType || 'application/x-www-form-urlencoded; charset=UTF-8';
    } else
    if (options.data instanceof FormData) {
        opts.body = options.data;
        delete headers["content-type"];
    } else
    if (this.isO(options.data)) {
        opts.body = JSON.stringify(options.data);
        headers["content-type"] = "application/json; charset=UTF-8";
    } else
    if (options.data) {
        opts.body = options.data;
        headers["content-type"] = options.contentType || "application/octet-stream";
    }
    return opts;
}

bkjs.fetch = function(options, callback)
{
    try {
        const opts = this.fetchOpts(options);
        window.fetch(options.url, opts).
        then(async (res) => {
            var err, data;
            var info = { status: res.status, headers: {}, type: res.type };
            for (const h of res.headers) info.headers[h[0].toLowerCase()] = h[1];
            if (!res.ok) {
                if (/\/json/.test(info.headers["content-type"])) {
                    const d = await res.json();
                    err = { status: res.status };
                    for (const p in d) err[p] = d[p];
                } else {
                    err = { message: await res.text(), status: res.status };
                }
                return this.cb(callback, err, data, info);
            }
            switch (options.dataType) {
            case "text":
                data = await res.text();
                break;
            case "blob":
                data = await res.blob();
                break;
            default:
                data = /\/json/.test(info.headers["content-type"]) ? await res.json() : await res.text();
            }
            this.cb(callback, null, data, info);
        }).catch ((err) => {
            this.cb(callback, err);
        });
    } catch (err) {
        this.cb(callback, err);
    }
}

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
bkjs.send = function(options, onsuccess, onerror)
{
    if (this.isS(options)) options = { url: options };
    if (this.locationUrl && !/^https?:/.test(options.url)) options.url = this.locationUrl + options.url;
    if (!options.headers) options.headers = {};
    if (!options.type) options.type = 'POST';
    options.headers[this.htz] = (new Date()).getTimezoneOffset();
    for (const p in this.headers) if (this.isU(options.headers[p])) options.headers[p] = this.headers[p];
    for (const p in options.data) if (this.isU(options.data[p])) delete options.data[p];
    this.event("bkjs.loading", "show");

    this[options.xhr ? "xhr" : "fetch"](options, (err, data, info) => {
        this.event("bkjs.loading", "hide");

        var h = info?.headers[this.hcsrf] || "";
        switch (h) {
        case "":
            break;
        case "0":
            delete this.headers[this.hcsrf];
            break;
        default:
            this.headers[this.hcsrf] = h;
        }

        if (err) {
            if (!options.quiet) this.log('send:', err, options);
            if (options.alert) {
                var a = this.isS(options.alert) && options.alert;
                this.event("bkjs.alert", ["error", a || err, { safe: !a }]);
            }
            if (this.isF(onerror)) onerror.call(options.self || this, err, info);
            if (options.trigger) this.event(options.trigger, { url: options.url, query: options.data, err: err });
        } else {
            if (!data && options.dataType == 'json') data = {};
            if (options.info_msg || options.success_msg) {
                this.event("bkjs.alert", [options.info_msg ? "info" : "success", options.info_msg || options.success_msg]);
            }
            if (this.isF(onsuccess)) onsuccess.call(options.self || this, data, info);
            if (options.trigger) this.event(options.trigger, { url: options.url, query: options.data, data: data });
        }
    });
}

bkjs.asend = function(options)
{
    return new Promise((resolve, reject) => {
        bkjs.send(options, resolve, reject);
    });
}

bkjs.get = function(options, callback)
{
    this.sendRequest(this.objExtend(options, { type: "GET" }), callback);
}

// Make a request and use single callback with error as the first argument or null if no error
bkjs.sendRequest = function(options, callback)
{
    return this.send(options, (data, info) => {
        if (this.isF(callback)) callback.call(options.self || this, null, data, info);
    }, (err, info) => {
        if (this.isF(callback)) callback.call(options.self || this, err, {}, info);
    });
}

bkjs.asendRequest = function(options)
{
    return new Promise((resolve, reject) => {
        bkjs.sendRequest(options, (err, rc, info) => {
            if (err) reject(err, info); else resolve(rc, info);
        });
    });
}

// Send a file as multi-part upload, uses `options.name` or "data" for file namne. Additional files can be passed in the `options.files` object. Optional form inputs
// can be specified in the `options.data` object.
bkjs.sendFile = function(options, callback)
{
    var v, n = 0, form = new FormData(), files = {};
    if (options.file) files[options.name || "data"] = options.file;
    for (const p in options.files) files[p] = options.files[p];
    for (const p in files) {
        v = this.getFileInput(files[p]);
        if (!v) continue;
        form.append(p, v);
        n++;
    }
    if (!n) return callback && callback.call(options.self || this);

    const add = (k, v) => {
       form.append(k, this.isF(v) ? v() : v === null || v === true ? "" : v);
    }

    const build = (key, val) => {
        if (val === undefined) return;
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${typeof val[i] === "object" && val[i] != null ? i : ""}]`, val[i]);
        } else
        if (this.isObject(val)) {
            for (const n in val) build(`${key}[${n}]`, val[n]);
        } else {
            add(key, val);
        }
    }
    for (const p in options.data) build(p, options.data[p]);

    // Send within the session, multipart is not supported by signature
    var rc = { url: options.url, data: form };
    for (const p in options) if (this.isU(rc[p])) rc[p] = options[p];
    this.sendRequest(rc, callback);
}

bkjs.asendFile = function(options)
{
    return new Promise((resolve, reject) => {
        bkjs.sendFile(options, (err, rc, info) => {
            if (err) reject(err, info); else resolve(rc, info);
        });
    });
}

// Return a file object for the selector
bkjs.getFileInput = function(file)
{
    if (this.isS(file)) file = $(file);
    if (file instanceof jQuery && file.length) file = file[0];
    if (this.isO(file)) {
        if (file.files && file.files.length) return file.files[0];
        if (file.name && file.size && (file.type || file.lastModified)) return file;
    }
    return "";
}

bkjs.domainName = function(host)
{
    if (!this.isS(host) || !host) return "";
    var name = host.split('.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return value of the query parameter by name
bkjs.param = function(name, dflt, num)
{
    var d = location.search.match(new RegExp(name + "=(.*?)($|&)", "i"));
    d = d ? decodeURIComponent(d[1]) : (dflt || "");
    if (num) {
        d = parseInt(d);
        if (isNaN(d)) d = 0;
    }
    return d;
}

// Percent encode with special symbols in addition
bkjs.encode = function(str)
{
    if (this.isU(str)) return "";
    return encodeURIComponent(str).replace(/[!'()*]/g, (m) => (m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m));
}

// Return a cookie value by name
bkjs.cookie = function(name)
{
    if (!document.cookie) return "";
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
        var cookie = cookies[i].trim();
        if (cookie.substr(0, name.length) == name && cookie[name.length] == '=') {
            return decodeURIComponent(cookie.substr(name.length + 1));
        }
    }
    return "";
}

// Simple debugging function that outputs arguments in the error console each argument on a separate line
bkjs.log = function()
{
    if (console?.log) console.log.apply(console, arguments);
}

// Console output if debugging is enabled
bkjs.trace = function(...args)
{
    if (this.debug) this.log(...args);
}

$(function() {
    var h = $(`meta[name="${bkjs.hcsrf}"]`).attr('content');
    if (h) bkjs.headers[bkjs.hcsrf] = h;
});


