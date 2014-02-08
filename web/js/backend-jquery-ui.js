//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// jQuery-UI backend support

// Return dialog button by name
Backend.getButton = function(dialog, name)
{
    var self = this;
    var button = null;
    $(dialog).parent().find("button").each(function() {
        if ($(this).text() == name || $(this).parent().attr('id') == name) button = $(this);
    });
    return button;
},

// Enable or hide the button by name
Backend.enableButton = function(dialog, name, enable)
{
    var button = this.getButton(dialog, name);
    if (!button) return;
    if (enable) {
        button.show();
    } else {
        button.hide();
    }
},

// Set or clear error message for the dialog
Backend.setError = function(dialog, msg)
{
    if (msg) {
        $(dialog).find('.ui-error').text(msg).addClass("ui-state-highlight");
    } else {
        $(dialog).find('.ui-error').text("").removeClass("ui-state-highlight");
    }
},

// Verify if credentials are valid and if not raise popup dialog
Backend.login = function(callback)
{
    var self = this;
    this.getAccount(function(err, data) {
        if (!err) {
            self.dialogLogin("close", callback);
            return callback ? callback(null, data) : null;
        }
        // Restart login if no callback or callback returned true
        if (!callback || callback(err)) {
            self.dialogLogin("open", callback, err);
        }
    });
},

// Login UI control
Backend.dialogLogin = function(action, callback, errmsg)
{
    var self = this;

    var div= $(
            '<div>\
            <p class="ui-title">Please provide your account login and password.</p>\
            <p class="ui-error"></p>\
            <form id=backend-login-form>\
            <fieldset style="padding:0;border:0;margin-top:25px;">\
            <label for="backend-login" style="display:block">Login</label>\
            <input type="text" id="backend-login" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
            <label for="backend-secret" style="display:block">Password</label>\
            <input type="password" id="backend-secret" value="" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
            </fieldset>\
            </form>\
            </div>');

    function submit(cb) {
        self.setCredentials($('#backend-login').val(),  $('#backend-secret').val());
        $('#backend-secret').val('');
        div.dialog("close");
        self.login(cb || div.dialog("option", "callback"));
    }

    div.dialog({
        autoOpen: false,
        modal: true,
        stack: true,
        width: "auto",
        height: "auto",
        title: "Enter Credentials",
        buttons: {
            Login: function() {
                submit();
            },
            Register: function() {
                $(this).dialog("close");
                $('#dialog-register').dialog('open');
            },
            Cancel: function() {
                $(this).dialog("close");
            }
        },
        create: function() {
            var dialog = this;
            $(this).find('form').submit(function() { submit(callback); return false; });
            $(this).find('#backend-login').keyup(function(e) { if (e.which == 13) { $(dialog).find('#backend-secret').focus(); e.preventDefault(); } });
            $(this).find('#backend-secret').keyup(function(e) { if (e.which == 13) { submit(); e.preventDefault(); } });
        },
        open: function() {
            $(this).find('.ui-error').text($(this).dialog('option','msg') || "").removeClass("ui-state-highlight");
            var reg = $('#dialog-register').length;
            if (reg) $(this).find('.ui-title').html("Please provide your account email and password.<br/>If you dont have an account, please use Register button below.");
            self.enableButton(this, 'Register', reg);
        },
    });

    div.dialog("option", "callback", callback || null).dialog("option", "msg", errmsg || "");
    return div.dialog(action);
},

// Show alert popup with optional timeout for autoclose
Backend.dialogAlert = function(msg, timeout)
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
    return div.dialog('open');
},

// Show confirm popup with a message and optional callbacks
Backend.dialogConfirm = function(msg, onok, oncancel)
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
    return div.dialog('open');
},

// Show confirm dialog with optional select box
Backend.dialogChoices = function(msg, list, onok, oncancel)
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
    return div.dialog('open');
}
