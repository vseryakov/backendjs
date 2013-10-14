//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2012
//

// Return object with currrent credentials
function getCredentials()
{
    return { id: localStorage.accessKey || "", secret: localStorage.accessSecret || "" };
}

// Set global credentials to be used by getJSON
function setCredentials(key, secret)
{
    localStorage.accessKey = key || "";
    localStorage.accessSecret = secret || "";
}

// Percent encode with special symbols
function encode(str) {
    return encodeURIComponent(str).replace("!","%21","g").replace("*","%2A","g").replace("'","%27","g").replace("(","%28","g").replace(")","%29","g");
}

// Return value of the query parameter by name
function getQuery(name, dflt)
{
    var d = location.search.match(new RegExp(name + "=(.*?)($|\&)", "i"));
    return d ? decodeURIComponent(d[1]) : (dflt || "");
}

function getIntQuery(name, dflt)
{
    var v = parseInt(getQuery(name));
    return isNaN(v) ? (dflt || 0) : 0;
}

// Sign request with key and secret, return object which properties should go into HTTP headers
function signRequest(method, url, expires, checksum, profile)
{
    var creds = getCredentials();
    var now = (new Date()).getTime();
    var host = window.location.hostname;
    if (url.indexOf('://') > -1) {
        var u = url.split('/');
        host = u[2];
        url = '/' + u.slice(3).join('/');
    }
    if (!expires) expires = now + 30000;
    if (expires < now) expires += now;
    var q = String(url || "/").split("?");
    var path = q[0];
    var query = (q[1] || "").split("&").sort().filter(function(x) { return x != ""; }).join("&");
    var str = String(method || "GET") + "\n" + String(host) + "\n" + String(path) + "\n" + String(query) + "\n" + String(expires) + "\n" + String(checksum || "");
    var str2 = profile ? String(method) + "\n" + String(path) + "\n" + String(expires) + "\n" + String(profile.profile_id) + "\n" + String(profile.password) : "";
    return { accesskey: String(creds.id), 
             expires: expires, 
             checksum: String(checksum || ""), 
             signature: b64_hmac_sha1(String(creds.secret), str),
             password: profile? b64_hmac_sha1(String(creds.secret), str2) : "",
             str: str }
}

// Produce signed URL to be used in embeded cases or with expiration so the url can be passed and be valid for longer time.
function signUrl(url, expires)
{
    var hdrs = signRequest("GET", url, expires);
    return url + (url.indexOf("?") == -1 ? "?" : "") + "&AccessSignature=" + encodeURIComponent(hdrs.accesskey + ';' + hdrs.expires + ';' + hdrs.signature + ';');
}

// Send signed AJAX request using jQuery, call callbacks onsuccess or onerror on successful or error response
// url can be string with url or an object with .url, .data and .type properties, for POST set .type to POST and provide .data
function getJSON(options, onsuccess, onerror)
{
    if (typeof options == "string") options = { url: options };

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
        debug('getJSON: error:', status, msg, error, options);
        if (onerror) onerror(msg, xhr, status, error);
    }
    options.headers = signRequest(options.type || "GET", options.url, 0, options.data && options.checksum ? b64_sha1(options.data) : "", options.profile);
    $('#loading').show(), state.count++;
    $.ajax(options);
}

// Determine type of the object
function typeName(v) {
    var t = typeof(v);
    if (v === null) return "null";
    if (t !== "object") return t;
    if (Array.isArray(v)) return "array";
    if (v.constructor == (new Date).constructor) return "date";
    if (v.constructor == (new RegExp).constructor) return "regex";
    return "object";
}

// Format an object into nice JSON formatted text
function formatJSON(obj, indent)
{
    // Shortcut to parse and format json from the string
    if (typeof obj == "string" && obj != "") {
        try { obj = JSON.parse(obj); } catch(e) { debug(e) }
    }
    if (!indent) indent = "";
    var style = "    ";
    var type = typeName(obj);
    var count = 0;
    var text = type == "array" ? "[" : "{";

    for (var p in obj) {
        var val = obj[p];
        if (count > 0) text += ",";
        if (type != "array") {
            text += ("\n" + indent + style + "\"" + p + "\"" + ": ");
        }
        switch (typeName(val)) {
        case "array":
        case "object":
            text += formatJSON(val, (indent + style));
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
}

// Formatting of date
function strftime(date, fmt, utc)
{
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
}

// Simple debugging function that outputs arguments in the error console
function debug()
{
    if (!console || !console.log) return;
    var args = "";
    for (var i in arguments) args += JSON.stringify(arguments[i]) + " ";
    console.log(args);
}

// Show alert popup with optional timeout for autoclose
function showAlert(msg, timeout)
{
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
}

// Show confirm popup with a message and optional callbacks
function showConfirm(msg, onok, oncancel)
{
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
}

// Show confirm dialog with optional select box
function showChoices(msg, list, onok, oncancel)
{
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
}

// Login object with callback, reqires DIV with login dialog elements to be defined in the document body
function Login(callback) {
    var self = this;

    self.callback = callback || function() {};
    self.div = $('<div><p>Please provide your account email and password.</p><p class="ui-error"></p><form id=form-login><fieldset style="padding:0;border:0;margin-top:25px;">\
                  <label for="name" style="display:block">Email</label><input type="text" id="email" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
                  <label for="secret" style="display:block">Password</label><input type="password" id="secret" value="" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
                  </fieldset></form></div></div>');

    // Verify if credentials are valid and if not raise popup dialog
    self.login = function() {
        getJSON("/auth", function(rc) {
            $('#email').val('');
            $('#secret').val('');
            self.div.dialog("close");
            self.callback(true);
        }, function(msg) {
            setCredentials();
            self.callback(false);
            self.div.dialog("open");
            self.div.find('.ui-error').text(msg).addClass("ui-state-highlight");
        });
    }

    // Logout and clear all local credentials
    self.logout = function() {
        setCredentials();
        self.div.dialog("open");
    }

    self.submit = function() {
        if (!$('#email').val() || !$('#secret').val()) {
            showAlert('Please, enter email and password and try again', 30000);
            return;
        }
        setCredentials($('#email').val().toLowerCase(), b64_sha1($('#email').val().toLowerCase() + ':' + $('#secret').val()));
        self.login();
        return false;
    }

    // Define dialog logic
    self.div.dialog({
        autoOpen: false,
        modal: true,
        stack: true,
        title: "Enter Credentials",
        buttons: {
            "Login": function() {
                self.submit();
            },
            Cancel: function() {
                $(this).dialog("close");
            }
        },
        create: function() {
            $('#form-login').submit(function() { return self.submit(); });
            $('#form-login #email').keyup(function(e) { if (e.which == 13) { $('#form-login #secret').focus(); e.preventDefault(); } });
            $('#form-login #secret').keyup(function(e) { if (e.which == 13) { self.submit();e.preventDefault(); } });
        },
        open: function() {
            $(this).find('.ui-error').text('').removeClass("ui-state-highlight");
        }
    });
    return this;
}
