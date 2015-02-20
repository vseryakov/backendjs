//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Core backend support
var Bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: false,

    // Save credentials in the local storage, by default keep only in memory
    persistent: false,

    // Scramble login, save HMAC for the secret instead of the actual value, a user still
    // need to enter the real values but the browser will never store them, only hashes.
    // The value is: 0 - no scramble, 1 - scramble secret as HMAC
    scramble: 0,

    // Signature header name and version
    signatureVersion: 4,
    signatureName: "bk-signature",

    // Current account record
    account: {},

    // Websockets
    wsconf: { host: null, port: 8000, errors: 0 },

    // Secret policy for plain text passwords
    passwordPolicy: {
        '[a-z]+': 'requires at least one lower case letter',
        '[A-Z]+': 'requires at least one upper case letter',
        '[0-9]+': 'requires at least one digit',
        '.{6,}': 'requires at least 6 characters',
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
        if (this.scramble && login && secret) secret = b64_hmac_sha256(login, secret);
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
                return { status: 400, message: this.passwordPolicy[p], policy: Object.keys(this.passwordPolicy).map(function(x) { return self.passwordPolicy[x] }).join(", ") };
            }
        }
        return "";
    },

    // Retrieve account record, call the callback with the object or error
    getAccount: function(callback) {
        var self = this;
        self.sendRequest({ url: "/account/get", jsonType: "obj" }, function(err, data, xhr) {
            for (var p in data) self.account[p] = data[p];
            if (typeof callback == "function") callback(err, data, xhr);
        });
    },

    // Register new account record, call the callback with the object or error
    addAccount: function(obj, callback) {
        var self = this;
        delete obj.secret2;
        var creds = this.checkCredentials(obj.login, obj.secret);
        // Replace the actual credentials from the storage in case of scrambling
        obj.login = creds.login;
        obj.secret = creds.secret;
        self.sendRequest({ type: "POST", url: "/account/add", data: obj, jsonType: "obj", nosignature: 1 }, callback);
    },

    // Update current account
    updateAccount: function(obj, callback) {
        var self = this;
        if (obj.secret) {
            delete obj.secret2;
            var creds = this.checkCredentials(obj.login || this.account.login, obj.secret);
            obj.secret = creds.secret;
        }
        self.sendRequest({ url: '/account/update', data: obj, type: "POST", jsonType: "obj" }, callback);
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

    // Logout and clear all local credentials
    logout: function(callback) {
        var self = this;
        self.loggedIn = false;
        self.account = {};
        self.sendRequest("/auth?_session=0&_accesstoken=0", function(err, data, xhr) {
            self.setCredentials();
            if (typeof callback == "function") callback(err, data, xhr);
        });
    },

    // Try to login with the supplied credentials
    login: function(login, secret, callback) {
        var self = this;
        if (typeof login == "function") callback = login, login = secret = null;
        if (typeof login =="string" && typeof secret == "string") this.setCredentials(login, secret);

        self.send({ url: "/auth?" + (this.session ? "_session=1" : "_session=0"), jsonType: "obj" }, function(data, xhr) {
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

    // Sign request with key and secret
    sign: function(method, url, query, options) {
        var rc = {};
        var creds = this.getCredentials();
        if (!creds.login || !creds.secret) return rc;
        var now = Date.now(), str, hmac;
        var host = window.location.hostname;
        if (url.indexOf('://') > -1) {
            var u = url.split('/');
            host = u[2].split(":")[0];
            url = '/' + u.slice(3).join('/');
        }
        if (!options) options = {};
        if (!method) method = "GET";
        var expires = options.expires || 0;
        if (!expires || typeof expires != "number") expires = now + 60000;
        if (expires < now) expires += now;
        var ctype = options.contentType || "";
        if (!ctype && method == "POST") ctype = "application/x-www-form-urlencoded; charset=UTF-8";
        var q = String(url || "/").split("?");
        url = q[0];
        if (url[0] != "/") url = "/" + url;
        if (!query) query = q[1] || "";
        if (query instanceof FormData) query = "";
        if (typeof query == "object") query = jQuery.param(query);
        query = query.split("&").sort().filter(function(x) { return x != ""; }).join("&");
        switch (this.signatureVersion) {
        case 1:
            str = String(method || "GET") + "\n" + String(host).toLowerCase() + "\n" + String(url) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(ctype).toLowerCase() + "\n" + (options.checksum || "") + "\n";
            hmac = b64_hmac_sha1(creds.secret, str);
            break;

        default:
            str = this.signatureVersion + "\n" + String(options.tag || "") + "\n" + creds.login + "\n" + String(method || "GET") + "\n" + String(host).toLowerCase() + "\n" + String(url) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(ctype).toLowerCase() + "\n" + (options.checksum || "") + "\n";
            hmac = b64_hmac_sha256(creds.secret, str);
        }
        rc[this.signatureName] = this.signatureVersion + '|' + String(options.tag || "") + '|' + creds.login + '|' + hmac + '|' + String(expires) + '|' + (options.checksum || "") + '|';
        if (this.debug) this.log('sign:', creds, str);
        return rc;
    },

    // Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
    signUrl: function(url, expires) {
        var hdrs = this.sign("GET", url, "", { expires: expires });
        if (!hdrs[this.signatureName]) return url;
        return url + (url.indexOf("?") == -1 ? "?" : "") + "&" + this.signatureName + "=" + encodeURIComponent(hdrs[this.signatureName]);
    },

    // Encode url query, provided full url with query parameters in human form, re-encode the query
    encodeUrl: function(url) {
        if (url && url.indexOf("?") > -1) {
            var url = url.split("?");
            var q = url[1].split("&");
            url = url[0] + "?";
            for (var i in q) {
                var v = q[i].split("=");
                var n = unescape(v[0]);
                if (v[1]) url += "&" + n + "=" + this.encode(v[1]);
            }
        }
        return url;
    },

    // Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response
    // url can be string with url or an object with .url, .data and .type properties, for POST set .type to POST and provide .data
    send: function(options, onsuccess, onerror) {
        var self = this;
        if (typeof options == "string") options = { url: options };

        if (!options.dataType) options.dataType = 'json';
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
            var msg = "";
            try { msg = JSON.parse(xhr.responseText).message; } catch(e) { msg = status; }
            self.log('send: error:', status, msg, error, options);
            if (typeof onerror == "function") onerror(msg || error, xhr, status, error);
        }
        if (!options.nosignature) {
            options.headers = this.sign(options.type, options.url, options.data, { expires: options.expires, checksum: options.checksum });
        }
        this.loading("show");
        $.ajax(options);
    },

    // Make a request and use single callback with error as the first argument or null if no error
    sendRequest: function(options, callback) {
        this.send(options, function(data, xhr) {
            if (typeof callback == "function") callback(null, data, xhr);
        }, function(err, xhr) {
            if (typeof callback == "function") callback(err, null, xhr);
        });
    },

    // Send a file as multi-part upload
    sendFile: function(options, callback) {
        if (!options || !options.file || !options.file.files.length) return callback ? callback() : null;
        var form = new FormData();
        for (var p in options.data) form.append(p, options.data[p])
        form.append("data", options.file.files[0]);
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
        this.ws.onerror = function(msg) {
            console.log('ws:', self.wsconf.errors++, msg);
            onerror && onerror(err);
        }
        this.ws.onclose = function() { self.ws = null; }
    },

    wsClose: function() {
        if (!this.ws) return;
        this.ws.close();
    },

    wsSend: function(url) {
        if (this.ws) this.ws.send(Backend.signUrl(url));
    },

    // Percent encode with special symbols in addition
    encode: function(str) {
        return encodeURIComponent(str).replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
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

    // Determine type of the object
    typeName: function(v) {
        var t = typeof(v);
        if (v === null) return "null";
        if (t !== "object") return t;
        if (Array.isArray(v)) return "array";
        if (v.constructor == (new Date).constructor) return "date";
        if (v.constructor == (new RegExp).constructor) return "regexp";
        return "object";
    },

    // Format an object into nice JSON formatted text
    formatJSON: function(obj, indent) {
        var self = this;
        // Shortcut to parse and format json from the string
        if (typeof obj == "string" && obj != "") {
            if (obj[0] != "[" && obj[0] != "{") return obj;
            try { obj = JSON.parse(obj); } catch(e) { self.log(e) }
        }
        if (!indent) indent = "";
        var style = "    ";
        var type = this.typeName(obj);
        var count = 0;
        var text = type == "array" ? "[" : "{";

        for (var p in obj) {
            var val = obj[p];
            if (count > 0) text += ",";
            if (type != "array") {
                text += ("\n" + indent + style + "\"" + p + "\"" + ": ");
            }
            switch (this.typeName(val)) {
            case "array":
            case "object":
                text += this.formatJSON(val, (indent + style));
                break;
            case "boolean":
            case "number":
                text += val.toString();
                break;
            case "null":
                text += "null";
                break;
            case "string":
                text += ("\"" + val + "\"");
                break;
            default:
                text += ("unknown: " + typeof(val));
            }
            count++;
        }
        text += type == "array" ? "]" : ("\n" + indent + "}");
        return text;
    },

    // Format a Date object
    strftime: function(date, fmt, utc) {
        if (typeof date == "string" || typeof date == "number") try { date = new Date(date); } catch(e) {}
        if (!date || isNaN(date)) return "";
        function zeropad(n) { return n > 9 ? n : '0' + n; }
        var handlers = {
            a: function(t) { return [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ][utc ? t.getUTCDay() : t.getDay()] },
            A: function(t) { return [ 'Sunday', 'Monday', 'Tuedsay', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ][utc ? t.getUTCDay() : t.getDay()] },
            b: function(t) { return [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ][utc ? t.getUTCMonth() : t.getMonth()] },
            B: function(t) { return [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ][utc ? t.getUTCMonth() : t.getMonth()] },
            c: function(t) { return utc ? t.toUTCString() : t.toString() },
            d: function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
            H: function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
            I: function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
            m: function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
            M: function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
            p: function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
            S: function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
            w: function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
            W: function(t) { var d = utc ? Date.UTC(utc ? t.getUTCFullYear() : t.getFullYear(), 0, 1) : new Date(t.getFullYear(), 0, 1); return Math.ceil((((t - d) / 86400000) + d.getDay() + 1) / 7); },
            y: function(t) { return zeropad(this.Y(t) % 100); },
            Y: function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
            t: function(t) { return t.getTime() },
            u: function(t) { return Math.floor(t.getTime()/1000) },
            '%': function(t) { return '%' },
        };
        for (var h in handlers) {
            fmt = fmt.replace('%' + h, handlers[h](date));
        }
        return fmt;
    },

    // Simple debugging function that outputs arguments in the error console
    log: function() {
        if (!console || !console.log) return;
        var args = "";
        for (var i in arguments) args += (typeof arguments[i] == "object" ? JSON.stringify(arguments[i]) : arguments[i]) + " ";
        console.log(args);
    },
};
