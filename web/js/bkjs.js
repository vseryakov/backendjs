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

    // Websockets
    wsconf: {
        host: null,
        port: 0,
        path: "/",
        query: null,
        max_timeout: 30000,
        retry_timeout: 500,
        retry_mod: 2,
        max_retries: 100,
        retries: 0,
        pending: [],
    },

    // i18n locales by 2-letter code, uses account.lang to resolve the translation
    locales: {},

    isF: (x) => (typeof x === "function"),
    isS: (x) => (typeof x === "string"),
    isB: (x) => (typeof x === "boolean"),
    isO: (x) => (typeof x === "object"),
    isN: (x) => (typeof x === "number"),
    isU: (x) => (typeof x === "undefined"),
    isE: (x) => (x === null || typeof x === "undefined"),
};

bkjs.fetchOpts = function(options)
{
    var headers = options.headers || {};
    var opts = bkjs.objExtend({
        headers: headers,
        method: options.type || "POST",
        cache: "default",
    }, options.fetchOptions);

    if (opts.method == "GET" || opts.method == "HEAD") {
        if (bkjs.isO(options.data)) {
            options.url += "?" + this.toQuery(options.data);
        }
    } else
    if (bkjs.isS(options.data)) {
        opts.body = options.data;
        headers["content-type"] = options.contentType || 'application/x-www-form-urlencoded; charset=UTF-8';
    } else
    if (options.data instanceof FormData) {
        opts.body = options.data;
        delete headers["content-type"];
    } else
    if (bkjs.isO(options.data)) {
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
                return bkjs.isF(callback) && callback(err, data, info);
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
            bkjs.isF(callback) && callback(null, data, info);
        }).catch ((err) => {
            bkjs.isF(callback) && callback(err);
        });
    } catch (err) {
        bkjs.isF(callback) && callback(err);
    }
}

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
bkjs.send = function(options, onsuccess, onerror)
{
    if (bkjs.isS(options)) options = { url: options };
    if (this.locationUrl && !/^https?:/.test(options.url)) options.url = this.locationUrl + options.url;
    if (!options.headers) options.headers = {};
    if (!options.type) options.type = 'POST';
    options.headers[this.htz] = (new Date()).getTimezoneOffset();
    for (const p in this.headers) if (bkjs.isU(options.headers[p])) options.headers[p] = this.headers[p];
    for (const p in options.data) if (bkjs.isU(options.data[p])) delete options.data[p];
    bkjs.event("bkjs.loading", "show");

    bkjs[options.xhr ? "xhr" : "fetch"](options, (err, data, info) => {
        bkjs.event("bkjs.loading", "hide");

        var h = info?.headers[bkjs.hcsrf];
        if (h) bkjs.headers[bkjs.hcsrf] = h;

        if (err) {
            if (!options.quiet) bkjs.log('send:', err, options);
            if (options.alert) {
                var a = bkjs.isS(options.alert) && options.alert;
                bkjs.event("bkjs.alert", ["error", a || err, { safe: !a }]);
            }
            if (bkjs.isF(onerror)) onerror.call(options.self || bkjs, err, info);
            if (options.trigger) bkjs.event(options.trigger, { url: options.url, query: options.data, err: err });
        } else {
            if (!data && options.dataType == 'json') data = {};
            if (options.info_msg || options.success_msg) {
                bkjs.event("bkjs.alert", [options.info_msg ? "info" : "success", options.info_msg || options.success_msg]);
            }
            if (bkjs.isF(onsuccess)) onsuccess.call(options.self || bkjs, data, info);
            if (options.trigger) bkjs.event(options.trigger, { url: options.url, query: options.data, data: data });
        }
    });
}

bkjs.get = function(options, callback)
{
    bkjs.sendRequest(bkjs.objExtend(options, { type: "GET" }), callback);
}

// Make a request and use single callback with error as the first argument or null if no error
bkjs.sendRequest = function(options, callback)
{
    return bkjs.send(options, (data, info) => {
        if (bkjs.isF(callback)) callback.call(options.self || bkjs, null, data, info);
    }, (err, info) => {
        if (bkjs.isF(callback)) callback.call(options.self || bkjs, err, {}, info);
    });
}

// Send a file as multi-part upload, uses `options.name` or "data" for file namne. Additional files can be passed in the `options.files` object. Optional form inputs
// can be specified in the `options.data` object.
bkjs.sendFile = function(options, callback)
{
    var n = 0, form = new FormData(), files = {};
    if (options.file) files[options.name || "data"] = options.file;
    for (const p in options.files) files[p] = options.files[p];
    for (const p in files) {
        var f = this.getFileInput(files[p]);
        if (!f) continue;
        form.append(p, f);
        n++;
    }
    if (!n) return callback && callback.call(options.self || bkjs);

    for (const p in options.data) {
        switch (typeof options.data[p]) {
        case "undefined":
            break;
        case "object":
            for (const k in options.data[p]) {
                if (options.data[p][k] !== undefined) form.append(`${p}[${k}]`, options.data[p][k]);
            }
            break;
        default:
            form.append(p, options.data[p]);
        }
    }
    // Send within the session, multipart is not supported by signature
    var rc = { url: options.url, processData: false, data: form, contentType: false };
    for (const p in options) if (bkjs.isU(rc[p])) rc[p] = options[p];
    this.sendRequest(rc, callback);
}

// Return a file object for the selector
bkjs.getFileInput = function(file)
{
    if (bkjs.isS(file)) file = $(file);
    if (file instanceof jQuery && file.length) file = file[0];
    if (bkjs.isO(file)) {
        if (file.files && file.files.length) return file.files[0];
        if (file.name && file.size && (file.type || file.lastModified)) return file;
    }
    return "";
}

// WebSockets helper functions
bkjs.wsConnect = function(options)
{
    var conf = bkjs.wsconf;
    if (conf.timer) {
        clearTimeout(conf.timer);
        delete conf.timer;
    }
    if (conf.bye) return;

    for (const p in options) conf[p] = options[p];
    if (!conf.query) conf.query = {};
    for (const p in conf.headers) if (bkjs.isU(conf.query[p])) conf.query[p] = conf.headers[p];
    var url = (conf.protocol || window.location.protocol.replace("http", "ws")) + "//" +
              (conf.host || (conf.hostname ? conf.hostname + "." + this.domainName(window.location.hostname) : "") || window.location.hostname) + ":" +
              (conf.port || window.location.port) +
              conf.path + "?" + bkjs.toQuery(conf.query);

    this.ws = new WebSocket(url);
    this.ws.onopen = function() {
        if (conf.debug) bkjs.log("ws.open:", this.url);
        conf.ctime = Date.now();
        conf.timeout = bkjs.wsconf.retry_timeout;
        conf.retries = 0;
        while (conf.pending.length) {
            bkjs.wsSend(conf.pending.shift());
        }
        bkjs.event("bkjs.ws.opened");
    }
    this.ws.onerror = function(err) {
        if (conf.debug) bkjs.log('ws.error:', this.url, err);
    }
    this.ws.onclose = function() {
        if (conf.debug) bkjs.log("ws.closed:", this.url, bkjs.wsconf.timeout);
        bkjs.ws = null;
        if (!conf.bye && ++conf.retries < conf.max_retries) {
            conf.timer = setTimeout(bkjs.wsConnect.bind(bkjs), conf.timeout);
            conf.timeout *= conf.timeout == conf.max_timeout ? 0 : conf.retry_mod;
            conf.timeout = bkjs.toClamp(conf.timeout, conf.retry_timeout, conf.max_timeout);
        }
        bkjs.event("bkjs.ws.closed");
    }
    this.ws.onmessage = function(msg) {
        var data = msg.data;
        if (data === "bye") bkjs.wsClose(1);
        if (bkjs.isS(data) && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (bkjs.wsconf.debug) bkjs.log('ws.message:', data);
        bkjs.event("bkjs.ws.message", data);
    }
}

bkjs.wsClose = function(bye)
{
    this.wsconf.bye = 1;
    if (this.ws) this.ws.close();
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
bkjs.wsSend = function(data)
{
    if (this.ws?.readyState != WebSocket.OPEN) {
        this.wsconf.pending.push(data);
        return;
    }
    if (bkjs.isO(data) && data) {
        if (data.url && data.url[0] == "/") {
            data = data.url + (data.data ? "?" + bkjs.toQuery(data.data) : "");
        } else {
            data = JSON.stringified(data);
        }
    }
    this.ws.send(data);
}

bkjs.domainName = function(host)
{
    if (!bkjs.isS(host) || !host) return "";
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
    if (bkjs.isU(str)) return "";
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

$(function() {
    var h = $(`meta[name="${bkjs.hcsrf}"]`).attr('content');
    if (h) bkjs.headers[bkjs.hcsrf] = h;
});


