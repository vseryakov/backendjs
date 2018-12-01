/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

var Bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: 1,

    // Save credentials in the local storage, by default keep only in memory
    persistent: false,

    // Scramble the secret, use HMAC for the secret instead of the actual value, a user still
    // needs to enter the real values but the browser will never store them, only hashes.
    // The value is: 0 - no scramble, 1 - scramble secret as HMAC_SHA256(secret, login)
    scramble: 1,

    // Signature header name and version
    signatureVersion: 4,
    signatureName: "bk-signature",
    accessTokenName: "bk-access-token",
    tzName: "bk-tz",
    langName: "bk-lang",
    // HTTP headers to be sent with every request
    headers: {},

    // For urls without host this will be used to make a full absolute URL, can be used for CORS
    locationUrl: "",

    // Current account record
    account: {},

    // Websockets
    wsconf: { host: null, port: 8000, errors: 0 },

    // Secret policy for plain text passwords
    passwordPolicy: {
        '[a-z]+': 'requires at least one lower case letter',
        '[A-Z]+': 'requires at least one upper case letter',
        '[0-9]+': 'requires at least one digit',
        '.{8,}': 'requires at least 8 characters',
    },
    // Trim these symbols from login/secret, all whitespace is default
    trimCredentials: " \"\r\n\t\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u008D\u009F\u0080\u0090\u009B\u0010\u0009\u0000\u0003\u0004\u0017\u0019\u0011\u0012\u0013\u0014\u2028\u2029\u2060\u202C",

    // i18n locales by 2-letter code, uses account.lang to resolve the translation
    locales: {},

    // Try to authenticate with the supplied credentials, it uses login and secret to sign the reauest, if not specified it uses
    // already saved credentials
    login: function(login, secret, callback) {
        var self = this;
        if (typeof login == "function") callback = login, login = secret = null;
        if (typeof login =="string" && typeof secret == "string") this.setCredentials(login, secret);

        this.send({ url: "/auth?_session=" + this.session, jsonType: "obj" }, function(data, xhr) {
            self.loggedIn = true;
            self.account = data;
            // Clear credentials from the memory if we use sessions
            if (self.session) self.setCredentials();
            if (typeof callback == "function") callback(null, data, xhr);
        }, function(err, xhr) {
            self.loggedIn = false;
            self.account = {};
            self.setCredentials();
            if (typeof callback == "function") callback(err, null, xhr);
        });
    },

    // Logout and clear all cookies and local credentials
    logout: function(callback) {
        var self = this;
        this.loggedIn = false;
        this.account = {};
        this.sendRequest("/logout", function(err, data, xhr) {
            self.setCredentials();
            if (typeof callback == "function") callback(err, data, xhr);
        });
    },

    // Create a signature for the request, the url can be an absolute url or just a path, query can be a form data, an object or a string with already
    // encoded parameters, if not given the parameters in the url will be used.
    // Returns an object with HTTP headers to be sent to the server with the request.
    createSignature: function(method, url, query, options) {
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
        case 1:
            str = method + "\n" + host + "\n" + url + "\n" + query + "\n" + expires + "\n" + ctype + "\n" + checksum + "\n";
            hmac = b64_hmac_sha1(creds.secret, str);
            break;
        case 2:
        case 3:
            str = this.signatureVersion + '\n' + tag + '\n' + creds.login + "\n*\n" + this.domainName(host) + "\n/\n*\n" + expires + "\n*\n*\n";
            hmac = b64_hmac_sha1(creds.secret, str);
            break;
        default:
            str = this.signatureVersion + "\n" + tag + "\n" + creds.login + "\n" + method + "\n" + host + "\n" + url + "\n" + query + "\n" + expires + "\n" + ctype + "\n" + checksum + "\n";
            hmac = b64_hmac_sha256(creds.secret, str);
        }
        rc[this.signatureName] = this.signatureVersion + '|' + tag  + '|' + creds.login + '|' + hmac + '|' + expires + '|' + checksum + '|';
        if (this.debug) this.log('sign:', creds, str);
        return rc;
    },

    // Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
    signUrl: function(url, expires) {
        var hdrs = this.createSignature("GET", url, "", { expires: expires });
        if (!hdrs[this.signatureName]) return url;
        return url + (url.indexOf("?") == -1 ? "?" : "") + "&" + this.signatureName + "=" + encodeURIComponent(hdrs[this.signatureName]);
    },

    // Return current credentials
    getCredentials: function() {
        var obj = this.persistent ? localStorage : this;
        return { login: obj.backendjsLogin || "", secret: obj.backendjsSecret || "" };
    },

    // Possibly scramble credentials and return as an object
    checkCredentials: function(login, secret) {
        login = login ? String(login) : "";
        secret = secret ? String(secret) : "";
        if (this.trimCredentials) {
            if (!this._trimC) this._trimC = new RegExp("(^[" + this.trimCredentials + "]+)|([" + this.trimCredentials + "]+$)", "gi");
            login = login.replace(this._trimC, "");
            secret = secret.replace(this._trimC, "");
        }
        if (this.scramble && login && secret) secret = b64_hmac_sha256(secret, login);
        return { login: login, secret: secret };
    },

    // Set new credentials, save in memory or local storage
    setCredentials: function(login, secret) {
        var obj = this.persistent ? localStorage : this;
        var creds = this.checkCredentials(login, secret);
        obj.backendjsLogin = creds.login;
        obj.backendjsSecret = creds.secret;
        if (this.debug) this.log('setCredentials:', creds);
    },

    // Verify account secret against the policy
    checkPassword: function(secret) {
        var self = this;
        secret = secret || "";
        for (var p in this.passwordPolicy) {
            if (!secret.match(p)) {
                return {
                    status: 400,
                    message: this.__(this.passwordPolicy[p]),
                    policy: Object.keys(this.passwordPolicy).map(function(x) {
                        return self.__(self.passwordPolicy[x])
                    }).join(", ")
                };
            }
        }
        return "";
    },

    // Retrieve current account record, call the callback with the object or error
    getAccount: function(callback) {
        var self = this;
        this.sendRequest({ url: "/account/get", jsonType: "obj" }, function(err, data, xhr) {
            for (var p in data) self.account[p] = data[p];
            if (typeof callback == "function") callback(err, data, xhr);
        });
    },

    // Register new account record, call the callback with the object or error
    addAccount: function(obj, callback) {
        // Replace the actual credentials from the storage in case of scrambling in the client
        if (!obj._scramble) {
            var creds = this.checkCredentials(obj.login, obj.secret);
            obj.login = creds.login;
            obj.secret = creds.secret;
        }
        delete obj.secret2;
        this.sendRequest({ type: "POST", url: "/account/add", data: obj, jsonType: "obj", nosignature: 1 }, callback);
    },

    // Update current account
    updateAccount: function(obj, callback) {
        // Scramble here if we did not ask the server to do it with _scramble option
        if (obj.secret && !obj._scramble) {
            var creds = this.checkCredentials(obj.login || this.account.login, obj.secret);
            obj.login = creds.login;
            obj.secret = creds.secret;
        }
        delete obj.secret2;
        this.sendRequest({ url: '/account/update', data: obj, type: "POST", jsonType: "obj" }, callback);
    },

    // Return true if the account contains the given type
    checkAccountType: function(account, type) {
        if (!account || !account.type) return false;
        account._types = Array.isArray(account._types) ? account._types : String(account.type).split(",").map(function(x) { return x.trim() });
        if (Array.isArray(type)) return type.some(function(x) { return account._types.indexOf(x) > -1 });
        return account._types.indexOf(type) > -1;
    },

    // Wait for events and call the callback, this runs until Backend.unsubscribe is set to true
    subscribeAccount: function(callback) {
        var self = this;
        var errors = 0;
        (function poll() {
            self.send({ url: "/account/subscribe", complete: self.unsubscribe ? null : poll }, function(data, xhr) {
                callback(data, xhr);
            }, function(err) {
                if (errors++ > 3) self.unsubscribe = true;
            });
        })();
    },

    // Return or build the message from the error response object or text
    parseError: function(err) {
        if (typeof err == "string") return err;
        return err && err.message;
    },

    // Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
    // - options can be a string with url or an object with options.url, options.data and options.type properties,
    // - for POST set options.type to POST and provide options.data
    //
    // If options.nosignature is given the request is sent as is, no credentials and signature will be used.
    send: function(options, onsuccess, onerror) {
        var self = this;
        if (typeof options == "string") options = { url: options };

        if (!options.dataType) options.dataType = 'json';
        if (this.locationUrl && !options.url.match(/^https?:/)) options.url = this.locationUrl + options.url;

        // Success callback but if it throws exception we call error handler instead
        options.success = function(json, status, xhr) {
            self.loading("hide");
            // Make sure json is of type we requested
            switch (options.jsonType) {
            case 'list':
                if (!json || !Array.isArray(json)) json = [];
                break;

            case 'object':
                if (!json || typeof json != "object") json = {};
                break;
            }
            if (typeof onsuccess == "function") onsuccess(json, xhr);
        }
        // Parse error message
        options.error = function(xhr, status, error) {
            self.loading("hide");
            var msg = xhr.responseText;
            try { msg = JSON.parse(xhr.responseText) } catch(e) {}
            self.log('send:', xhr.status, status, msg, error, options);
            if (!options.rawError) msg = self.parseError(msg);
            if (typeof onerror == "function") onerror(msg || error || status, xhr, status, error);
        }
        if (!options.nosignature) {
            options.headers = this.createSignature(options.type, options.url, options.data, { expires: options.expires, checksum: options.checksum });
            // Optional timezone offset for ptoper datetime related operations
            options.headers[this.tzName] = (new Date()).getTimezoneOffset();
            if (this.language) options.headers[this.langName] = this.language;
        }
        if (!options.headers) options.headers = {};
        for (var h in this.headers) options.headers[h] = this.headers[h];
        for (var p in options.data) if (typeof options.data[p] == "undefined") delete options.data[p];
        this.loading("show");
        $.ajax(options);
    },

    // Make a request and use single callback with error as the first argument or null if no error
    sendRequest: function(options, callback) {
        this.send(options, function(data, xhr) {
            if (typeof callback == "function") callback(null, data, xhr);
        }, function(err, xhr) {
            var data = options.jsonType == "list" ? [] : options.jsonType == "obj" ? {} : null;
            if (typeof callback == "function") callback(err, data, xhr);
        });
    },

    // Send a file as multi-part upload, additional files can be passed in the `files` object.
    sendFile: function(options, callback) {
        if (!options || !options.file || !options.file.files || !options.file.files.length) return typeof callback == "function" ? callback() : null;
        var form = new FormData();
        for (var p in options.data) {
            if (typeof options.data[p] != "undefined") form.append(p, options.data[p])
        }
        form.append(options.name || "data", options.file.files[0]);
        for (var i in options.files) form.append(p, options.files[i].files[0])
        // Send within the session, multipart is not supported by signature
        var rc = { url: options.url, type: "POST", processData: false, data: form, contentType: false, nosignature: true };
        this.send(rc, function(data, xhr) {
            if (typeof callback == "function") callback(null, data, xhr);
        }, function(err, xhr) {
            if (typeof callback == "function") callback(err, null, xhr);
        });
    },

    // WebSockets helper functions
    wsConnect: function(url, options, onmessage, onerror) {
        var self = this;
        if (typeof options == "function") onmessage = options, onerror = onmessage, options = {};
        if (!url) url = "ws://" + (this.wsconf.host || window.location.hostname) + ":" + this.wsconf.port;
        this.wsconf.errors = 0;
        this.ws = new WebSocket(url);
        this.ws.onopen = function() {
            self.ws.onmessage = function(msg) { if (onmessage) return onmessage(msg.data); console.log('ws:', msg) };
        }
        this.ws.onerror = function(err) {
            console.log('ws:', self.wsconf.errors++, err);
            if (typeof onerror == "function") onerror(err);
        }
        this.ws.onclose = function() { self.ws = null; }
    },

    wsClose: function() {
        if (!this.ws) return;
        this.ws.close();
    },

    wsSend: function(url) {
        if (this.ws) this.ws.send(this.signUrl(url));
    },

    // Percent encode with special symbols in addition
    encode: function(str) {
        if (typeof str == "undefined") return "";
        return encodeURIComponent(str).replace(/[!'()*]/g, function(m) {
            return m == '!' ? '%21' : m == "'" ? '%27' : m == '(' ? '%28' : m == ')' ? '%29' : m == '*' ? '%2A' : m;
        });
    },

    // Show/hide loading animation
    loading: function(op) {
        var img = $('.loading');
        if (!img.length) return;

        if (!window.bkjsLoading) window.bkjsLoading = { count: 0 };
        var state = window.bkjsLoading;
        switch (op) {
        case "hide":
            if (--state.count > 0) break;
            state.count = 0;
            if (state.display == "none") img.hide(); else img.css("visibility", "hidden");
            break;

        case "show":
            if (state.count++ > 0) break;
            if (!state.display) state.display = img.css("display");
            if (state.display == "none") img.show(); else img.css("visibility", "visible");
            break;
        }
    },

    // Return value of the query parameter by name
    param: function(name, dflt, num) {
        var d = location.search.match(new RegExp(name + "=(.*?)($|\&)", "i"));
        d = d ? decodeURIComponent(d[1]) : (dflt || "");
        if (num) {
            d = parseInt(d);
            if (isNaN(d)) d = 0;
        }
        return d;
    },

    // Return a cookie value by name
    cookie: function(name) {
        if (!document.cookie) return "";
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = jQuery.trim(cookies[i]);
            if (cookie.substring(0, name.length + 1) == (name + '=')) {
                return decodeURIComponent(cookie.substring(name.length + 1));
            }
        }
        return "";
    },

    // Simple debugging function that outputs arguments in the error console each argument on a separate line
    log: function() {
        if (!console || !console.log) return;
        console.log.apply(console, arguments);
    },

};

