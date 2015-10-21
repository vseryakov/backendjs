//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// jQuery and crypto.js must be loaded before this class can be used.
//

// Backend.js client
var Bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: false,

    // Save credentials in the local storage, by default keep only in memory
    persistent: false,

    // Scramble the secret, use HMAC for the secret instead of the actual value, a user still
    // needs to enter the real values but the browser will never store them, only hashes.
    // The value is: 0 - no scramble, 1 - scramble secret as HMAC_SHA256(secret, login)
    scramble: 0,

    // Signature header name and version
    signatureVersion: 4,
    signatureName: "bk-signature",
    accessTokenName: "bk-access-token",

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

    // Try to authenticate with the supplied credentials, it uses login and secret to sign the reauest, if not specified it uses
    // already saved credentials
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

    // Logout and clear all cookies and local credentials
    logout: function(callback) {
        var self = this;
        self.loggedIn = false;
        self.account = {};
        self.sendRequest("/logout", function(err, data, xhr) {
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
        case 5:
            hmac = creds.secret;
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
                return { status: 400, message: this.passwordPolicy[p], policy: Object.keys(this.passwordPolicy).map(function(x) { return self.passwordPolicy[x] }).join(", ") };
            }
        }
        return "";
    },

    // Retrieve current account record, call the callback with the object or error
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
        // Replace the actual credentials from the storage in case of scrambling in the client
        if (!obj._scramble) {
            var creds = this.checkCredentials(obj.login, obj.secret);
            obj.login = creds.login;
            obj.secret = creds.secret;
        }
        delete obj.secret2;
        self.sendRequest({ type: "POST", url: "/account/add", data: obj, jsonType: "obj", nosignature: 1 }, callback);
    },

    // Update current account
    updateAccount: function(obj, callback) {
        var self = this;
        // Scramble here if we did not ask the sertver to do it with _scramble option
        if (obj.secret && !obj._scramble) {
            var creds = this.checkCredentials(obj.login || this.account.login, obj.secret);
            obj.login = creds.login;
            obj.secret = creds.secret;
        }
        delete obj.secret2;
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

    // Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response accordingly.
    // - options can be a string with url or an object with options.url, options.data and options.type properties,
    // - for POST set options.type to POST and provide options.data
    //
    // If options.nosignature is given the request is sent as is, no credentials and signature will be used.
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
            try { msg = JSON.parse(xhr.responseText).message; } catch(e) { msg = xhr.responseText; }
            self.log('send: error:', xhr.status, status, msg, error, options);
            if (typeof onerror == "function") onerror(msg || error || status, xhr, status, error);
        }
        if (!options.nosignature) {
            options.headers = this.createSignature(options.type, options.url, options.data, { expires: options.expires, checksum: options.checksum });
            // Optional timezone offset for ptoper datetime related operations
            options.headers["bk-tz"] = new Date().getTimezoneOffset();
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
        if (!options || !options.file || !options.file.files || !options.file.files.length) return typeof callback == "function" ? callback() : null;
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
    formatJSON: function(obj, options) {
        var self = this;
        if (typeof options == "string") options = { indent: options };
        if (!options) options = {};
        // Shortcut to parse and format json from the string
        if (typeof obj == "string" && obj != "") {
            if (obj[0] != "[" && obj[0] != "{") return obj;
            try { obj = JSON.parse(obj); } catch(e) { self.log(e) }
        }
        if (!options.level) options.level = 0;
        if (!options.indent) options.indent = "";
        var style = "    ";
        var type = this.typeName(obj);
        var count = 0;
        var text = type == "array" ? "[" : "{";
        // Insert newlines only until specified level deep
        var nline = !options.indentlevel || options.level < options.indentlevel;

        for (var p in obj) {
            var val = obj[p];
            if (count > 0) text += ",";
            if (type != "array") {
                text += ((nline ? "\n" + options.indent + style : " " ) + "\"" + p + "\"" + ": ");
            }
            switch (this.typeName(val)) {
            case "array":
            case "object":
                options.indent += style;
                options.level++;
                text += this.formatJSON(val, options);
                options.level--;
                options.indent = options.indent.substr(0, options.indent.length - style.length);
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
        text += type == "array" ? "]" : ((nline ? "\n" + options.indent : " ") + "}");
        return text;
    },

    // Format a Date object
    strftime: function(date, fmt, utc) {
        if (typeof date == "string") {
            if (date.match(/^[0-9]+$/)) date = parseInt(date);
            try { date = new Date(date); } catch(e) {}
        } else
        if (typeof date == "number") {
            try { date = new Date(date); } catch(e) {}
        }
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

    // Apply an iterator function to each item in an array serially. Execute a callback when all items
    // have been completed or immediately if there is is an error provided.
    forEachSeries: function(list, iterator, callback) {
        callback = typeof callback == "function" ? callback : this.noop;
        if (!list || !list.length) return callback();
        function iterate(i) {
            if (i >= list.length) return callback();
            iterator(list[i], function(err) {
                if (err) {
                    callback(err);
                    callback = function() {}
                } else {
                    iterate(++i);
                }
            });
        }
        iterate(0);
    },

    // Parse the input and convert into a Date object
    toDate: function(val, dflt) {
        if (isDate(val)) return val;
        var d = null;
        // String that looks like a number
        if (typeof val == "string" && /^[0-9\.]+$/.test(val)) val = toNumber(val);
        // Assume it is seconds which we use for most mtime columns, convert to milliseconds
        if (typeof val == "number" && val < 2147483647) val *= 1000;
        try { d = new Date(val); } catch(e) {}
        return !isNaN(d) ? d : new Date(dflt || 0);
    },

    // Returns a human representation of an age for the given timestamp in milliseconds
    toAge: function(mtime) {
        var str = "";
        mtime = typeof mtime == "number" ? mtime : parseInt(mtime, 10);
        if (mtime > 0) {
            var seconds = Math.floor((Date.now() - mtime)/1000);
            var d = Math.floor(seconds / 86400);
            var mm = Math.floor(d / 30);
            var w = Math.floor(d / 7);
            var h = Math.floor((seconds - d * 86400) / 3600);
            var m = Math.floor((seconds - d * 86400 - h * 3600) / 60);
            if (mm > 0) {
                str = mm + " month" + (mm > 1 ? "s" : "");
            } else
            if (w > 0) {
                str = w + " week" + (w > 1 ? "s" : "");
            } else
            if (d > 0) {
                str = d + " day" + (d > 1 ? "s" : "");
            } else
            if (h > 0) {
                str = h + " hour" + (h > 1 ? "s" : "");
            } else
            if (m > 0) {
                str = m + " minute" + (m > 1 ? "s" : "");
            } else {
                str = seconds + " second" + (seconds > 1 ? "s" : "");
            }
            if (str) str += " ago";
        }
        return str;
    },

    // Capitalize words
    toTitle: function(name) {
        return (name || "").replace(/_/g, " ").split(/[ ]+/).reduce(function(x,y) { return x + y.substr(0,1).toUpperCase() + y.substr(1) + " "; }, "").trim();
    },

    // Interpret the value as a boolean
    toBool:function(val, dflt) {
        if (typeof val == "boolean") return val;
        if (typeof val == "number") return !!val;
        if (typeof val == "undefined") val = dflt;
        return !val || String(val).trim().match(/^(false|off|f|0$)/i) ? false : true;
    },

    // Convert a string to a number, on invalid input returns 0
    toNumber: function(val, options) {
        var n = 0;
        if (typeof val == "number") {
            n = val;
        } else {
            if (typeof val != "string") {
                n = (options && options.dflt) || 0;
            } else {
                // Autodetect floating number
                var f = !options || typeof options.float == "undefined" || options.float == null ? /^[0-9-]+\.[0-9]+$/.test(val) : options.float;
                n = val[0] == 't' ? 1 : val[0] == 'f' ? 0 : val == "infinity" ? Infinity : (f ? parseFloat(val, 10) : parseInt(val, 10));
            }
        }
        n = isNaN(n) ? ((options && options.dflt) || 0) : n;
        if (options) {
            if (typeof options.min == "number" && n < options.min) n = options.min;
            if (typeof options.max == "number" && n > options.max) n = options.max;
        }
        return n;
    },

    // Return a test representation of a number according to the money formatting rules(US)
    toMoneyNumber: function(num) {
        var parts = String(typeof num != "number" || isNaN(num) ? 0 : num < 0 ? -num : num).split(".");
        var p1 = parts[0], i = p1.length, str = '';
        while (i--) {
            str = (i == 0 ? '' : ((p1.length - i) % 3 ? '' : ',')) + p1.charAt(i) + str;
        }
        return (num < 0 ? '-' : '') + str + (parts[1] ? '.' + parts[1] : '');
    },

    // Simple debugging function that outputs arguments in the error console
    log: function() {
        if (!console || !console.log) return;
        var args = "";
        for (var i in arguments) args += (typeof arguments[i] == "object" ? JSON.stringify(arguments[i]) : arguments[i]) + " ";
        console.log(args);
    },
};
