/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.fetchOpts = function(options)
{
    var headers = options.headers || {};
    var opts = Object.assign({
        headers: headers,
        method: options.type || "POST",
        cache: "default",
    }, options.fetchOptions);

    if (opts.method == "GET" || opts.method == "HEAD") {
        if (typeof options.data == "object") {
            options.url += "?" + bkjs.toQueryString(options.data);
        }
    } else
    if (typeof options.data == "string") {
        opts.body = options.data;
        headers["content-type"] = options.contentType || 'application/x-www-form-urlencoded; charset=UTF-8';
    } else
    if (options.data instanceof FormData) {
        opts.body = options.data;
        delete headers["content-type"];
    } else
    if (typeof options.data == "object") {
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
        const opts = bkjs.fetchOpts(options);
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
                return bkjs.call(callback, err, data, info);
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
            bkjs.call(callback, null, data, info);
        }).catch ((err) => {
            bkjs.call(callback, err);
        });
    } catch (err) {
        bkjs.call(callback, err);
    }
}

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
bkjs.send = function(options, onsuccess, onerror)
{
    if (typeof options == "string") options = { url: options };
    if (!options.headers) options.headers = {};
    if (!options.type) options.type = 'POST';
    options.headers["bk-tz"] = (new Date()).getTimezoneOffset();
    for (const p in bkjs.headers) if (options.headers[p] === undefined) options.headers[p] = bkjs.headers[p];
    for (const p in options.data) if (options.data[p] === undefined) delete options.data[p];
    bkjs.emit("loading", "show");

    this[options.xhr ? "xhr" : "fetch"](options, (err, data, info) => {
        bkjs.emit("loading", "hide");

        var h = info?.headers["bk-csrf"] || "";
        switch (h) {
        case "":
            break;
        case "0":
            delete bkjs.headers["bk-csrf"];
            break;
        default:
            bkjs.headers["bk-csrf"] = h;
        }

        if (err) {
            if (!options.quiet) bkjs.log('send:', err, options);
            if (options.alert) {
                var a = typeof options.alert == "string" && options.alert;
                bkjs.emit("alert", ["error", a || err, { safe: !a }]);
            }
            bkjs.call(options.self || this, onerror, err, info);
            if (options.trigger) bkjs.emit(options.trigger, { url: options.url, query: options.data, err: err });
        } else {
            if (!data && options.dataType == 'json') data = {};
            if (options.info_msg || options.success_msg) {
                bkjs.emit("alert", [options.info_msg ? "info" : "success", options.info_msg || options.success_msg]);
            }
            bkjs.call(options.self || this, onsuccess, data, info);
            if (options.trigger) bkjs.emit(options.trigger, { url: options.url, query: options.data, data: data });
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
    bkjs.sendRequest(Object.assign(options, { type: "GET" }), callback);
}

// Make a request and use single callback with error as the first argument or null if no error
bkjs.sendRequest = function(options, callback)
{
    return bkjs.send(options, (data, info) => {
        bkjs.call(options.self || this, callback, null, data, info);
    }, (err, info) => {
        bkjs.call(options.self || this, callback, err, {}, info);
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
        v = bkjs.getFileInput(files[p]);
        if (!v) continue;
        form.append(p, v);
        n++;
    }
    if (!n) return bkjs.call(options.self || this, callback);

    const add = (k, v) => {
       form.append(k, typeof v == "function" ? v() : v === null || v === true ? "" : v);
    }

    const build = (key, val) => {
        if (val === undefined) return;
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${typeof val[i] === "object" && val[i] != null ? i : ""}]`, val[i]);
        } else
        if (bkjs.isObject(val)) {
            for (const n in val) build(`${key}[${n}]`, val[n]);
        } else {
            add(key, val);
        }
    }
    for (const p in options.data) build(p, options.data[p]);
    for (const p in options.json) {
        const blob = new Blob([JSON.stringify(options.json[p])], { type: "application/json" });
        form.append(p, blob);
    }

    // Send within the session, multipart is not supported by signature
    var rc = { url: options.url, data: form };
    for (const p in options) if (rc[p] === undefined) rc[p] = options[p];
    bkjs.sendRequest(rc, callback);
}

bkjs.asendFile = function(options)
{
    return new Promise((resolve, reject) => {
        bkjs.sendFile(options, (err, rc, info) => {
            if (err) reject(err, info); else resolve(rc, info);
        });
    });
}

// Make Ajax request, options are comptible with fetch
bkjs.xhr = function(options, callback)
{
    const opts = bkjs.fetchOpts(options);
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
            bkjs.call(callback, null, data, info);
        } else {
            bkjs.call(callback, { status: r.status, message: data.message || data || r.statusText }, data, info);
        }
    }
    try {
        r.send(opts.body || null);
    } catch (err) {
        bkjs.call(callback, err);
    }
}
