/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
app.send = function(options, onsuccess, onerror)
{
    if (app.isS(options)) options = { url: options };
    if (!options.headers) options.headers = {};
    if (!options.type) options.type = 'POST';
    options.headers["bk-tz"] = (new Date()).getTimezoneOffset();
    for (const p in app.headers) if (options.headers[p] === undefined) options.headers[p] = app.headers[p];
    for (const p in options.data) if (options.data[p] === undefined) delete options.data[p];
    app.emit("loading", "show");

    this[options.xhr ? "xhr" : "fetch"](options, (err, data, info) => {
        app.emit("loading", "hide");

        var h = info?.headers["bk-csrf"] || "";
        switch (h) {
        case "":
            break;
        case "0":
            if (!app.headers) break;
            delete app.headers["bk-csrf"];
            break;
        default:
            if (!app.headers) app.headers = {};
            app.headers["bk-csrf"] = h;
        }

        if (err) {
            if (!options.quiet) app.log('send:', err, options);
            if (options.alert) {
                var a = app.isS(options.alert) && options.alert;
                app.emit("alert", "error", a || err, { safe: !a });
            }
            app.call(options.self || this, onerror, err, info);
            if (options.trigger) app.emit(options.trigger, { url: options.url, query: options.data, err: err });
        } else {
            if (!data && options.dataType == 'json') data = {};
            if (options.info_msg || options.success_msg) {
                app.emit("alert", options.info_msg ? "info" : "success", options.info_msg || options.success_msg);
            }
            app.call(options.self || this, onsuccess, data, info);
            if (options.trigger) app.emit(options.trigger, { url: options.url, query: options.data, data: data });
        }
    });
}

app.get = function(options, callback)
{
    app.sendRequest(Object.assign(options, { type: "GET" }), callback);
}

// Make a request and use single callback with error as the first argument or null if no error
app.sendRequest = function(options, callback)
{
    return app.send(options, (data, info) => {
        app.call(options.self || this, callback, null, data, info);
    }, (err, info) => {
        app.call(options.self || this, callback, err, {}, info);
    });
}

// Send a file as multi-part upload, uses `options.name` or "data" for file namne. Additional files can be passed in the `options.files` object. Optional form inputs
// can be specified in the `options.data` object.
app.sendFile = function(options, callback)
{
    var v, n = 0, form = new FormData(), files = {};
    if (options.file) files[options.name || "data"] = options.file;
    for (const p in options.files) files[p] = options.files[p];
    for (const p in files) {
        v = app.getFileInput(files[p]);
        if (!v) continue;
        form.append(p, v);
        n++;
    }
    if (!n) return app.call(options.self || this, callback);

    const add = (k, v) => {
       form.append(k, app.isF(v) ? v() : v === null || v === true ? "" : v);
    }

    const build = (key, val) => {
        if (val === undefined) return;
        if (Array.isArray(val)) {
            for (const i in val) build(`${key}[${app.isO(val[i]) ? i : ""}]`, val[i]);
        } else
        if (app.isObject(val)) {
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
    app.sendRequest(rc, callback);
}

// Make Ajax request, options are comptible with fetch
app.xhr = function(options, callback)
{
    const opts = app.fetchOpts(options);
    const r = new XMLHttpRequest();
    r.open(opts.method, options.url, options.sync ? false : true);
    if (options.dataType == "blob") r.responseType = "blob";
    for (const h in opts.headers) r.setRequestHeader(h, opts.headers[h]);
    r.onloadend = (ev) => {
        var info = { status: r.status, headers: {}, readyState: r.readyState };
        app.strSplit(r.getAllResponseHeaders(), /[\r\n]+/).forEach((line) => {
            line = line.split(': ');
            info.headers[line.shift()] = line.join(': ');
        });
        var data = r.response || "";
        if (/\/json/.test(info.headers["content-type"])) {
            try { data = JSON.parse(data) } catch (e) {}
        }
        if (r.status >= 200 && r.status < 300) {
            app.call(callback, null, data, info);
        } else {
            app.call(callback, { status: r.status, message: data.message || data || r.statusText }, data, info);
        }
    }
    try {
        r.send(opts.body || null);
    } catch (err) {
        app.call(callback, err);
    }
}

})();
