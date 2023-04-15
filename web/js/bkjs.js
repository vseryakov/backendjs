/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

var bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: 1,

    // Signature header name and version
    hver: 4,
    hsig: "bk-signature",
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
};

// Try to authenticate with the supplied credentials, it uses login and secret to sign the request, if not specified it uses
// already saved credentials. if url is passed then it sends data in POST request to the specified url without any signature.
bkjs.login = function(options, callback)
{
    if (bkjs.isF(options)) callback = options, options = {};
    options = this.objClone(options, "type", "POST");
    if (!options.data) options.data = {};
    if (!options.url) options.url = "/auth";
    options.data._session = this.session;

    this.send(options, (data) => {
        bkjs.loggedIn = true;
        for (const p in data) bkjs.account[p] = data[p];
        // Clear credentials from the memory if we use sessions
        if (bkjs.isF(callback)) callback.call(options.self || bkjs);
    }, (err, xhr) => {
        bkjs.loggedIn = false;
        for (const p in bkjs.account) delete bkjs.account[p];
        if (bkjs.isF(callback)) callback.call(options.self || bkjs, err, null, xhr);
    });
}

// Logout and clear all cookies and local credentials
bkjs.logout = function(options, callback)
{
    if (bkjs.isF(options)) callback = options, options = null;
    options = this.objClone("type", "POST");
    if (!options.url) options.url = "/logout";
    this.loggedIn = false;
    for (const p in bkjs.account) delete bkjs.account[p];
    this.sendRequest(options, callback);
}

bkjs.fetch = function(options, callback)
{
    try {
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

        window.fetch(options.url, opts).
        then(async (res) => {
            var err, data, ctype = res.headers.get("content-type");
            var info = { status: res.status, headers: {}, type: res.type, ctype: ctype };
            for (const h of res.headers) info.headers[h[0].toLowerCase()] = h[1];
            if (!res.ok) {
                if (/json/.test(ctype)) {
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
            case "script":
                data = await res.text();
                var script = document.createElement("script");
                script.text = data;
                document.head.appendChild(script).parentNode.removeChild(script);
                break;
            default:
                data = /json/.test(ctype) ? await res.json() : await res.text();
            }
            bkjs.isF(callback) && callback(null, data, info);
        }).catch((err) => {
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
    if (!options.dataType) options.dataType = 'json';
    options.headers[this.htz] = (new Date()).getTimezoneOffset();
    if (options.login && options.secret) options.headers[this.hsig] = this.createSignature(options);
    for (const p in this.headers) if (bkjs.isU(options.headers[p])) options.headers[p] = this.headers[p];
    for (const p in options.data) if (bkjs.isU(options.data[p])) delete options.data[p];
    bkjs.event("bkjs.loading", "show");

    this.fetch(options, (err, data, info) => {
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
    var url = (conf.protocol || window.location.protocol.replace("http", "ws")) + "//" +
              (conf.host || (conf.hostname ? conf.hostname + "." + this.domainName(window.location.hostname) : "") || window.location.hostname) + ":" +
              (conf.port || window.location.port) +
              conf.path +
              (conf.query ? "?" + jQuery.param(conf.query) : "");

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

// Create a signature for the request, the url can be an absolute url or just a path, query can be a form data, an object or a string with already
// encoded parameters, if not given the parameters in the url will be used.
bkjs.createSignature = function(options)
{
    var url = options.url || "", query = options.data;
    var host = window.location.hostname.toLowerCase();
    if (url.indexOf('://') > -1) {
        var u = url.split('/');
        host = (u[2] || "").split(":")[0].toLowerCase();
        url = '/' + u.slice(3).join('/');
    }
    var now = Date.now();
    var tag = options.tag || "";
    var checksum = options.checksum || "";
    var expires = options.expires || 0;
    if (!expires || !bkjs.isN(expires)) expires = now + 60000;
    if (expires < now) expires += now;
    var ctype = String(options.contentType || "").toLowerCase();
    if (!ctype && options.type == "POST") ctype = "application/x-www-form-urlencoded; charset=utf-8";
    var q = url.split("?");
    url = q[0];
    if (url[0] != "/") url = "/" + url;
    if (!query) query = q[1] || "";
    if (query instanceof FormData) query = "";
    if (typeof query == "object") query = jQuery.param(query);
    query = query.split("&").sort().filter((x) => (x != "")).join("&");
    var str = this.hver + "\n" + tag + "\n" + options.login + "\n" + options.type + "\n" + host + "\n" + url + "\n" + query + "\n" + expires + "\n" + ctype + "\n" + checksum + "\n";
    var hmac = this.crypto.hmacSha256(options.secret, str, "base64");
    if (this.debug) this.log('sign:', str);
    return this.hver + '|' + tag + '|' + options.login + '|' + hmac + '|' + expires + '|' + checksum + '|';
}

bkjs.event = function(name, data)
{
    $(bkjs).trigger(name, data);
}

bkjs.on = function(name, callback)
{
    $(bkjs).on(name, callback);
}

bkjs.off = function(name, callback)
{
    $(bkjs).off(name, callback);
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


