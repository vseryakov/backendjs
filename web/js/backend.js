//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Core backend support
var Backend = {

    // Support sessions
    session: false,

    // Return current credentials
    getCredentials: function() {
        return { login: localStorage.backendLogin || "",
                 secret: localStorage.backendSecret || "",
                 sigversion: localStorage.backendSigVersion || 1 };
    },

    // Set new credentials, encrypt email for signature version 3, keep the secret encrypted
    setCredentials: function(login, secret, version) {
        localStorage.backendLogin = login ? String(login) : "";
        localStorage.backendSecret = secret ? String(secret) : "";
        localStorage.backendSigVersion = (version || this.sigversion || 1);
    },

    // Retrieve account record, call the callback with the object or error
    getAccount: function(callback) {
        var self = this;
        self.send("/account/get?" + (this.session ? "_session=1" : ""), function(data) {
            if (callback) callback(null, data);
        }, function(err) {
            self.setCredentials();
            if (callback) callback(err);
        });
    },

    // Register new account record, call the callback with the object or error
    addAccount: function(obj, callback) {
        var self = this;
        delete obj.secret2;
        this.setCredentials(obj.login, obj.secret);
        self.send({ type: "POST", url: "/account/add?" + jQuery.param(obj), nosignature: 1 }, function(data) {
            if (callback) callback(null, data);
        }, function(err) {
            if (callback) callback(err);
        });
    },

    // Logout and clear all local credentials
    logout: function() {
        this.setCredentials();
    },

    // Sign request with key and secret
    sign: function(method, url, expires) {
        var creds = this.getCredentials();
        var now = (new Date()).getTime();
        var host = window.location.hostname;
        if (url.indexOf('://') > -1) {
            var u = url.split('/');
            host = u[2];
            url = '/' + u.slice(3).join('/');
        }
        if (!expires || typeof expires != "number") expires = now + 30000;
        if (expires < now) expires += now;
        var q = String(url || "/").split("?");
        var path = q[0];
        var query = (q[1] || "").split("&").sort().filter(function(x) { return x != ""; }).join("&");
        var str = String(method || "GET") + "\n" + String(host) + "\n" + String(path) + "\n" + String(query) + "\n" + String(expires);
        this.debug('sign:', creds, str)
        return { 'bk-signature': creds.sigversion + '||' + creds.login + '|' + b64_hmac_sha1(creds.secret, str) + '|' + String(expires) + '||' };
    },

    // Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
    signUrl: function(url, expires) {
        var hdrs = signRequest("GET", url, expires);
        return url + (url.indexOf("?") == -1 ? "?" : "") + "&bk-signature=" + encodeURIComponent(hdrs['bk-signature']);
    },

    // Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response
    // url can be string with url or an object with .url, .data and .type properties, for POST set .type to POST and provide .data
    send: function(options, onsuccess, onerror) {
        var self = this;
        if (typeof options == "string") options = { url: options };

        // Global progress indicator
        if (!window.loadingState) window.loadingState = { count: 0 };
        var state = window.loadingState;

        options.dataType = 'json';
        // Success callback but if it throws exception we call error handler instead
        options.success = function(json, status, xhr) {
            if (--state.count <= 0) $('#loading').hide(), state.count = 0;
            // Make sure json is of type we requested
            switch (options.jsonType) {
            case 'list':
                if (!json || !Array.isArray(json)) json = [];
                break;

            case 'object':
                if (!json || typeof json != "object") json = {};
                break;
            }
            if (onsuccess) onsuccess(json);
        }
        // Parse error message
        options.error = function(xhr, status, error) {
            if (--state.count <= 0) $('#loading').hide(), state.count = 0;
            var msg = "";
            try { msg = JSON.parse(xhr.responseText).message; } catch(e) { msg = status; }
            self.debug('send: error:', status, msg, error, options);
            if (onerror) onerror(msg || error, xhr, status, error);
        }
        if (!options.nosignature) {
            options.headers = this.sign(options.type || "GET", options.url, 0);
        }
        $('#loading').show(), state.count++;
        $.ajax(options);
    },


    // Percent encode with special symbols in addition
    encode: function(str) {
        return encodeURIComponent(str).replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
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

    // Determine type of the object
    typeName: function(v) {
        var t = typeof(v);
        if (v === null) return "null";
        if (t !== "object") return t;
        if (Array.isArray(v)) return "array";
        if (v.constructor == (new Date).constructor) return "date";
        if (v.constructor == (new RegExp).constructor) return "regex";
        return "object";
    },

    // Format an object into nice JSON formatted text
    formatJSON: function(obj, indent) {
        var self = this;
        // Shortcut to parse and format json from the string
        if (typeof obj == "string" && obj != "") {
            try { obj = JSON.parse(obj); } catch(e) { self.debug(e) }
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
    debug: function() {
        if (!console || !console.log) return;
        var args = "";
        for (var i in arguments) args += JSON.stringify(arguments[i]) + " ";
        console.log(args);
    },
};
