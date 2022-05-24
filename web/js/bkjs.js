/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

var bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: 1,

    // Save credentials in the local storage, by default keep only in memory
    persistent: false,

    // Signature header name and version
    signatureVersion: 4,
    signatureName: "bk-signature",
    tzHeaderName: "bk-tz",
    langHeaderName: "bk-lang",
    appHeaderName: "bk-app",
    versionHeaderName: "bk-version",
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
        pending: [],
    },

    // i18n locales by 2-letter code, uses account.lang to resolve the translation
    locales: {},
};

var Bkjs = bkjs;

// Try to authenticate with the supplied credentials, it uses login and secret to sign the request, if not specified it uses
// already saved credentials. if url is passed then it sends data in POST request to the specified url without any signature.
bkjs.login = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    options = this.objClone(options, "jsonType", "obj", "type", "POST");
    if (!options.data) options.data = {};
    if (!options.url) options.url = "/auth";
    if (typeof options.login =="string" && typeof options.secret == "string") this.setCredentials(options);
    options.data._session = this.session;

    this.send(options, function(data) {
        bkjs.loggedIn = true;
        for (var p in data) bkjs.account[p] = data[p];
        // Clear credentials from the memory if we use sessions
        if (bkjs.session) bkjs.setCredentials();
        if (typeof callback == "function") callback.call(options.self || bkjs);
    }, function(err, xhr) {
        bkjs.loggedIn = false;
        for (var p in bkjs.account) delete bkjs.account[p];
        bkjs.setCredentials();
        if (typeof callback == "function") callback.call(options.self || bkjs, err, null, xhr);
    });
}

// Logout and clear all cookies and local credentials
bkjs.logout = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    options = this.objClone(options, "jsonType", "obj", "type", "POST");
    if (!options.url) options.url = "/logout";
    this.loggedIn = false;
    for (var p in bkjs.account) delete bkjs.account[p];
    this.sendRequest(options, function(err, data, xhr) {
        bkjs.setCredentials();
        if (typeof callback == "function") callback.call(options.self || bkjs, err, data, xhr);
    });
}

// Create a signature for the request, the url can be an absolute url or just a path, query can be a form data, an object or a string with already
// encoded parameters, if not given the parameters in the url will be used.
// Returns an object with HTTP headers to be sent to the server with the request.
bkjs.createSignature = function(method, url, query, options)
{
    var rc = {};
    var creds = this.getCredentials();
    if (!creds.login || !creds.secret) return rc;
    var now = Date.now(), str, hmac;
    var host = window.location.hostname.toLowerCase();
    if (url.indexOf('://') > -1) {
        var u = url.split('/');
        host = (u[2] || "").split(":")[0].toLowerCase();
        url = '/' + u.slice(3).join('/');
    }
    if (!options) options = {};
    if (!method) method = "GET";
    var tag = options.tag || "";
    var checksum = options.checksum || "";
    var expires = options.expires || 0;
    if (!expires || typeof expires != "number") expires = now + 60000;
    if (expires < now) expires += now;
    var ctype = String(options.contentType || "").toLowerCase();
    if (!ctype && method == "POST") ctype = "application/x-www-form-urlencoded; charset=utf-8";
    var q = String(url || "/").split("?");
    url = q[0];
    if (url[0] != "/") url = "/" + url;
    if (!query) query = q[1] || "";
    if (query instanceof FormData) query = "";
    if (typeof query == "object") query = jQuery.param(query);
    query = query.split("&").sort().filter(function(x) { return x != ""; }).join("&");
    switch (this.signatureVersion) {
    case 2:
    case 3:
        str = this.signatureVersion + '\n' + tag + '\n' + creds.login + "\n*\n" + this.domainName(host) + "\n/\n*\n" + expires + "\n*\n*\n";
        hmac = this.crypto.hmacSha256(creds.secret, str, "base64");
        break;
    default:
        str = this.signatureVersion + "\n" + tag + "\n" + creds.login + "\n" + method + "\n" + host + "\n" + url + "\n" + query + "\n" + expires + "\n" + ctype + "\n" + checksum + "\n";
        hmac = this.crypto.hmacSha256(creds.secret, str, "base64");
    }
    rc[this.signatureName] = this.signatureVersion + '|' + tag + '|' + creds.login + '|' + hmac + '|' + expires + '|' + checksum + '|';
    if (this.debug) this.log('sign:', creds, str);
    return rc;
}

// Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
bkjs.signUrl = function(url, expires)
{
    var hdrs = this.createSignature("GET", url, "", { expires: expires });
    if (!hdrs[this.signatureName]) return url;
    return url + (url.indexOf("?") == -1 ? "?" : "") + "&" + this.signatureName + "=" + encodeURIComponent(hdrs[this.signatureName]);
}

// Return current credentials
bkjs.getCredentials = function()
{
    var obj = this.persistent ? localStorage : this;
    return { login: obj.bkjsLogin || "", secret: obj.bkjsSecret || "" };
}

// Set new credentials, save in memory or local storage
bkjs.setCredentials = function(options)
{
    var obj = this.persistent ? localStorage : this;
    obj.bkjsLogin = options?.login;
    obj.bkjsSecret = options?.secret;
    if (this.debug) this.log('setCredentials:', options);
}

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
// - options can be a string with url or an object with options.url, options.data and options.type properties,
// - for POST set options.type to POST and provide options.data
//
// If options.nosignature is given the request is sent as is, no credentials and signature will be used.
bkjs.send = function(options, onsuccess, onerror)
{
    if (typeof options == "string") options = { url: options };

    if (!options.headers) options.headers = {};
    if (!options.dataType) options.dataType = 'json';
    if (this.locationUrl && !options.url.match(/^https?:/)) options.url = this.locationUrl + options.url;

    // Success callback but if it throws exception we call error handler instead
    options.success = function(json, statusText, xhr) {
        $(bkjs).trigger("bkjs.loading", "hide");
        // Make sure json is of type we requested
        switch (options.jsonType) {
        case 'list':
            if (!json || !Array.isArray(json)) json = [];
            break;

        case 'object':
            if (!json || typeof json != "object") json = {};
            break;
        }
        if (options.info_msg || options.success_msg) {
            $(bkjs).trigger("bkjs.alert", [options.info_msg ? "info" : "success", options.info_msg || options.success_msg]);
        }
        if (typeof onsuccess == "function") onsuccess.call(options.self || bkjs, json, xhr);
        if (options.trigger) bkjs.trigger(options.trigger, { url: options.url, query: options.data, data: json });
    }
    // Parse error message
    options.error = function(xhr, statusText, errorText) {
        $(bkjs).trigger("bkjs.loading", "hide");
        var err = xhr.responseText;
        try { err = JSON.parse(xhr.responseText) } catch (e) {}
        if (!options.quiet) bkjs.log('send:', xhr.status, err, statusText, errorText, options);
        if (options.alert) {
            $(bkjs).trigger("bkjs.alert", ["error", (typeof options.alert == "string" && options.alert) || err || errorText || statusText]);
        }
        if (typeof onerror == "function") onerror.call(options.self || bkjs, err || errorText || statusText, xhr, statusText, errorText);
        if (options.trigger) bkjs.trigger(options.trigger, { url: options.url, query: options.data, err: err });
    }
    if (!options.nosignature) {
        var hdrs = this.createSignature(options.type, options.url, options.data, { expires: options.expires, checksum: options.checksum });
        for (const p in hdrs) options.headers[p] = hdrs[p];
        // Optional timezone offset for proper datetime related operations
        options.headers[this.tzHeaderName] = (new Date()).getTimezoneOffset();
        if (this.language) options.headers[this.langHeaderName] = this.language;
    }
    for (const p in this.headers) if (typeof options.headers[p] == "undefined") options.headers[p] = this.headers[p];
    for (const p in options.data) if (typeof options.data[p] == "undefined") delete options.data[p];
    $(bkjs).trigger("bkjs.loading", "show");
    return $.ajax(options);
}

// Make a request and use single callback with error as the first argument or null if no error
bkjs.sendRequest = function(options, callback)
{
    return this.send(options, function(data, xhr) {
        if (typeof callback == "function") callback.call(options.self || bkjs, null, data, xhr);
    }, function(err, xhr) {
        var data = options.jsonType == "list" ? [] : options.jsonType == "obj" ? {} : null;
        if (typeof callback == "function") callback.call(options.self || bkjs, err, data, xhr);
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
    var rc = { url: options.url, type: "POST", processData: false, data: form, contentType: false, nosignature: true };
    for (const p in options) if (typeof rc[p] == "undefined") rc[p] = options[p];
    this.sendRequest(rc, callback);
}

// Return a file object for the selector
bkjs.getFileInput = function(file)
{
    if (typeof file == "string") file = $(file);
    if (file instanceof jQuery && file.length) file = file[0];
    if (typeof file == "object") {
        if (file.files && file.files.length) return file.files[0];
        if (file.name && file.size && (file.type || file.lastModified)) return file;
    }
    return "";
}

// WebSockets helper functions
bkjs.wsConnect = function(options)
{
    if (this.wsconf.timer) {
        clearTimeout(this.wsconf.timer);
        delete this.wsconf.timer;
    }

    for (const p in options) this.wsconf[p] = options[p];
    var url = (this.wsconf.protocol || window.location.protocol.replace("http", "ws")) + "//" +
              (this.wsconf.host || (this.wsconf.hostname ? this.wsconf.hostname + "." + this.domainName(window.location.hostname) : "") || window.location.hostname) + ":" +
              (this.wsconf.port || window.location.port) +
              this.wsconf.path +
              (this.wsconf.query ? "?" + jQuery.param(this.wsconf.query) : "");

    this.ws = new WebSocket(url);
    this.ws.onopen = function() {
        if (bkjs.wsconf.debug) bkjs.log("ws.open:", this.url);
        bkjs.wsconf.ctime = Date.now();
        bkjs.wsconf.timeout = bkjs.wsconf.retry_timeout;
        while (bkjs.wsconf.pending.length) {
            bkjs.wsSend(bkjs.wsconf.pending.shift());
        }
        $(bkjs).trigger("bkjs.ws.opened");
    }
    this.ws.onerror = function(err) {
        if (bkjs.wsconf.debug) bkjs.log('ws.error:', this.url, err);
    }
    this.ws.onclose = function() {
        if (bkjs.wsconf.debug) bkjs.log("ws.closed:", this.url, bkjs.wsconf.timeout);
        bkjs.ws = null;
        bkjs.wsconf.timer = setTimeout(bkjs.wsConnect.bind(bkjs), bkjs.wsconf.timeout);
        bkjs.wsconf.timeout *= bkjs.wsconf.timeout == bkjs.wsconf.max_timeout ? 0 : bkjs.wsconf.retry_mod;
        bkjs.wsconf.timeout = bkjs.toClamp(bkjs.wsconf.timeout, bkjs.wsconf.retry_timeout, bkjs.wsconf.max_timeout);
        $(bkjs).trigger("bkjs.ws.closed");
    }
    this.ws.onmessage = function(msg) {
        var data = msg.data;
        if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (bkjs.wsconf.debug) bkjs.log('ws.message:', data);
        $(bkjs).trigger("bkjs.ws.message", data);
    }
}

bkjs.wsClose = function()
{
    if (this.ws) this.ws.close();
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
bkjs.wsSend = function(data)
{
    if (!this.ws || this.ws.readyState != WebSocket.OPEN) {
        this.wsconf.pending.push(data);
        return;
    }
    if (typeof data == "object" && data) {
        if (data.url && data.url[0] == "/") {
            data = data.url + (data.data ? "?" + $.param(data.data) : "");
        } else {
            data = JSON.stringified(data);
        }
    }
    this.ws.send(data);
}

bkjs.domainName = function(host)
{
    if (typeof host != "string" || !host) return "";
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
    if (typeof str == "undefined") return "";
    return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
        return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
    });
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
    if (!console || !console.log) return;
    console.log.apply(console, arguments);
}
