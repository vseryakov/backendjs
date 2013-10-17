//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var Backend = {
    
    // Current account record
    account: {},
    
    // Return current credentials
    getCredentials: function() {
        return { email: localStorage.backendEmail, secret: localStorage.backendSecret };
    },

    // Set new credentials
    setCredentials: function(email, secret) {
        localStorage.backendEmail = email ? String(email) : "";
        localStorage.backendSecret = secret ? b64_hmac_sha1(String(secret), String(email)) : "";
    },

    // Retrieve account record, call the callback with the object or error
    getAccount: function(callback) {
        var self = this;
        self.send("/account/get", function(rc) {
            self.account = rc;
            callback(null, rc);
        }, function(msg) {
            self.account = {};
            self.setCredentials();
            callback(msg)
        });               
    },

    // Sign request with key and secret
    sign: function(method, url, expires, checksum) {
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
        var str = String(method || "GET") + "\n" + String(host) + "\n" + String(path) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(checksum || "");
        return { 'v-signature': '2;;' +
                                creds.email + ';' + 
                                b64_hmac_sha1(creds.secret, str) + ';' + 
                                String(expires) + ';' + 
                                String(checksum || '') + ';;' };
    },

    // Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
    signUrl: function(url, expires) {
        var hdrs = signRequest("GET", url, expires);
        return url + (url.indexOf("?") == -1 ? "?" : "") + "&v-signature=" + encodeURIComponent(hdrs['v-signature']);
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
            if (onerror) onerror(msg, xhr, status, error);
        }
        options.headers = this.sign(options.type || "GET", options.url, 0, options.data && options.checksum ? b64_sha1(options.data) : "", options.profile);
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
    
    // Formatting of date
    strftime: function(date, fmt, utc) {
        if (typeof date == "string") try { date = new Date(date) } catch(e) {};
        if (!date || isNaN(date)) return "";
        function zeropad(n) { return n > 9 ? n : '0' + n; }
        var handlers = {
            a : function(t) { return [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ][utc ? t.getUTCDay() : t.getDay()] },
            A : function(t) { return [ 'Sunday', 'Monday', 'Tuedsay', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ][utc ? t.getUTCDay() : t.getDay()] },
            b : function(t) { return [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ][utc ? t.getUTCMonth() : t.getMonth()] },
            B : function(t) { return [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ][utc ? t.getUTCMonth() : t.getMonth()] },
            c : function(t) { return utc ? t.toUTCString() : t.toString() },
            d : function(t) { return zeropad(utc ? t.getUTCDate() : t.getDate()) },
            H : function(t) { return zeropad(utc ? t.getUTCHours() : t.getHours()) },
            I : function(t) { return zeropad(((utc ? t.getUTCHours() : t.getHours()) + 12) % 12) },
            m : function(t) { return zeropad((utc ? t.getUTCMonth() : t.getMonth()) + 1) }, // month-1
            M : function(t) { return zeropad(utc ? t.getUTCMinutes() : t.getMinutes()) },
            p : function(t) { return this.H(t) < 12 ? 'AM' : 'PM'; },
            S : function(t) { return zeropad(utc ? t.getUTCSeconds() : t.getSeconds()) },
            w : function(t) { return utc ? t.getUTCDay() : t.getDay() }, // 0..6 == sun..sat
            y : function(t) { return zeropad(this.Y(t) % 100); },
            Y : function(t) { return utc ? t.getUTCFullYear() : t.getFullYear() },
            t : function(t) { return t.getTime() },
            u : function(t) { return Math.floor(t.getTime()/1000) },
            '%' : function(t) { return '%' },
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

    // Verify if credentials are valid and if not raise popup dialog
    login: function(callback) {
        var self = this;
        this.getAccount(function(err, rc) {
            if (!err) {
                self.dialogLogin("close", callback);
                return callback ? callback(rc) : null;
            }
            self.dialogLogin("open", callback, err);
        });
    },
    
    // Logout and clear all local credentials
    logout: function() {
        this.setCredentials();
        this.dialogLogin("open");
    },
    
    // Login UI control
    dialogLogin: function(action, callback, errmsg) {
        var self = this;
        if (this.loginDialog) {
            this.loginDialog.dialog("option", "callback", callback || null).dialog("option", "msg", errmsg || "");
            return this.loginDialog.dialog(action);
        }
        
        this.loginDialog = $(
                '<div>\
                <p>Please provide your account email and password.</p>\
                <p class="ui-error"></p>\
                <form id=backend-login>\
                <fieldset style="padding:0;border:0;margin-top:25px;">\
                <label for="backend-email" style="display:block">Email</label>\
                <input type="text" id="backend-email" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
                <label for="backend-secret" style="display:block">Password</label>\
                <input type="password" id="backend-secret" value="" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
                </fieldset>\
                </form>\
                </div>');

        function submit(cb) {
            self.setCredentials($('#backend-email').val().toLowerCase(),  $('#backend-secret').val());
            $('#backend-secret').val('');
            self.loginDialog.dialog("close");
            self.login(cb);
        }

        this.loginDialog.dialog({
            autoOpen: false,
            modal: true,
            stack: true,
            title: "Enter Credentials",
            buttons: {
                Login: function() {
                    submit();
                },
                Cancel: function() {
                    $(this).dialog("close");
                }
            },
            create: function() {
                var dialog = this;
                var callback = $(this).dialog("option", "callback");
                $(this).find('form').submit(function() { submit(callback); return false; });
                $(this).find('#backend-email').keyup(function(e) { if (e.which == 13) { $(dialog).find('#backend-secret').focus(); e.preventDefault(); } });
                $(this).find('#backend-secret').keyup(function(e) { if (e.which == 13) { submit(callback); e.preventDefault(); } });
            },
            open: function() {
                var creds = self.getCredentials();
                if (creds.email) $('#backend-email').val(creds.email);
                $(this).find('.ui-error').text($(this).dialog('option','msg') || "").removeClass("ui-state-highlight");
            },
        });
        
        this.loginDialog.dialog("option", "callback", callback || null).dialog("option", "msg", errmsg || "");
        return this.loginDialog.dialog(action);
    },

    // Show alert popup with optional timeout for autoclose
    dialogAlert: function(msg, timeout) {
        var div = $('<div id="dialog-msg" title="Alert"><p class="ui-msg"/></div>');
        div.dialog({
            autoOpen: false,
            modal: false,
            stack: true,
            buttons: {
                Cancel: function() {
                    $(this).dialog("close");
                }
            },
            open: function() {
                var dialog = this;
                var timeout = $(this).dialog('option', 'timeout');
                $(this).find('.ui-msg').text($(this).dialog('option','message'));
                if (timeout) {
                    setTimeout(function() { $(dialog).dialog("close") }, timeout);
                }
            },
            close: function() {
                $(this).dialog('option','message', '');
                $(this).dialog('option','timeout', 0);
            }
        });
        div.dialog('option', 'message', msg);
        div.dialog('option', 'timeout', timeout || 0);
        div.dialog('open');
    },

    // Show confirm popup with a message and optional callbacks
    dialogConfirm: function(msg, onok, oncancel) {
        var div = $('<div id="dialog-confirm" title="Confirm"><p class="ui-msg"/></div>');
        div.dialog({
            autoOpen: false,
            modal: true,
            stack: true,
            buttons: {
                Ok: function() {
                    $(this).dialog("close");
                    var onok = $(this).dialog('option', 'onok');
                    if (onok) onok();
                },
                Cancel: function() {
                    $(this).dialog("close");
                    var oncancel = $(this).dialog('option', 'oncancel');
                    if (oncancel) oncancel();
                }
            },
            open: function() {
                $(this).find('.ui-msg').html($(this).dialog('option','message'));
            },
        });
        div.dialog('option', 'message', msg);
        div.dialog('option', 'onok', onok);
        div.dialog('option', 'oncancel', oncancel);
        div.dialog('open');
    },

    // Show confirm dialog with optional select box
    dialogChoices: function(msg, list, onok, oncancel) {
        var div = $('<div id="dialog-choice" title="Confirm"><p class="ui-msg"/><hr/><select/></div>');
        div.dialog({
            autoOpen: false,
            modal: true,
            stack: true,
            width: 'auto',
            buttons: {
                Ok: function() {
                    $(this).dialog("close");
                    var onok = $(this).dialog('option', 'onok');
                    var select = $(this).find('select').first();
                    if (onok) onok(parseInt(select.val()));
                },
                Cancel: function() {
                    $(this).dialog("close");
                    var oncancel = $(this).dialog('option', 'oncancel');
                    if (oncancel) oncancel();
                }
            },
            open: function(event, ui) {
                $(this).find('.ui-msg').html($(this).dialog('option','message'));
                var select = $(this).find('select').first();
                list.forEach(function(x, i) {
                    select.append($("<option>").attr('value',i).text(x));
                })
            },
        });
        div.dialog('option', 'list', list);
        div.dialog('option', 'message', msg);
        div.dialog('option', 'onok', onok);
        div.dialog('option', 'oncancel', oncancel);
        div.dialog('open');
    },
    
};

