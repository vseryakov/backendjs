/*!
 *  alpinejs-app client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Send a request using app.fetch, call the callback with error and result.
// - options can be a string with url or an object with options.url, options.body and options.method properties
// - POST is default
//
app.send = function(options, callback)
{
    if (app.isS(options)) options = { url: options };
    if (!options.headers) options.headers = {};
    for (const p in app.headers) {
        options.headers[p] ??= app.headers[p];
    }
    options.method ??= 'POST';
    app.emit("send:start");

    app.fetch(options, (err, data, info) => {
        app.emit("send:stop");

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
            if (options.alert) {
                var a = app.isS(options.alert);
                app.emit("alert", "error", a || err, { safe: !a });
            }
        } else {
            if (options.info_msg || options.success_msg) {
                app.emit("alert", options.info_msg ? "info" : "success", options.info_msg || options.success_msg);
            }
        }
        app.call(callback, err, data, info);
    });
}

// Send file(s) as multi-part upload in the `options.files` object. Optional form inputs
// can be specified in the `options.body` object.
app.sendFile = function(options, callback)
{
    var body = new FormData();
    for (const p in options.files) {
        const file = options.files[p];
        if (!file?.files?.length) continue;
        body.append(p, file.files[0]);
    }

    const add = (k, v) => {
       body.append(k, app.isF(v) ? v() : v === null || v === true ? "" : v);
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
    for (const p in options.body) {
        build(p, options.body[p]);
    }
    for (const p in options.json) {
        const blob = new Blob([JSON.stringify(options.json[p])], { type: "application/json" });
        body.append(p, blob);
    }

    var req = { url: options.url, body };
    for (const p in options) {
        req[p] ??= options[p];
    }
    app.send(req, callback);
}

})();
