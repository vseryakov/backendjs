//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// jQuery-UI backend support

// Set or clear error message for the dialog
Bkjs.showAlert = function(obj, type, text)
{
    if (typeof obj == "string") text = type, type = obj, obj = $("body");
    if (text) $(obj).find('.ui-error').append("<span class='ui-state-" + type + "'>" + text + "</div>");
    $(obj).find('.ui-error span').hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function() { $(this).remove(); });
}

Bkjs.hideLogin = function()
{
    $("#bkjs-login-modal").dialog("close");
}

// Login UI control
Bkjs.showLogin = function(callback)
{
    var self = this;

    var modal = $('#bkjs-login-modal');
    if (!modal.length) modal = $(
        '<div id=bkjs-login-modal>\
           <p class="ui-title">Please provide your account login and password.</p>\
           <p class="ui-error"></p>\
           <form id=bkjs-login-form>\
           <fieldset style="padding:10px;border:0;margin-top:25px;">\
            <label for="bkjs-login" style="display:block">Login</label>\
            <input type="text" id="bkjs-login" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
            <label for="bkjs-secret" style="display:block">Password</label>\
            <input type="password" id="bkjs-secret" value="" class="text ui-widget-content ui-corner-all" style="display:block;margin-bottom:12px;width:95%;padding:.4em;" />\
           </fieldset>\
           </form>\
         </div>');

    function submit(cb) {
        self.login($('#bkjs-login').val(),  $('#bkjs-secret').val(), function(err, data, xhr) {
            if (err) self.showAlert(modal, "error", err);
            if (!cb) cb = modal.dialog("option", "callback");
            if (typeof cb == "function") cb(err, data, xhr);
        });
    }

    modal.dialog({
        autoOpen: false,
        modal: true,
        stack: true,
        width: "auto",
        height: "auto",
        title: "Please Sign In",
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
            $(this).find('form').submit(function() { submit(callback); return false; });
            $(this).find('#bkjs-login').keyup(function(e) { if (e.which == 13) { $(dialog).find('#bkjs-secret').focus(); e.preventDefault(); } });
            $(this).find('#bkjs-secret').keyup(function(e) { if (e.which == 13) { submit(); e.preventDefault(); } });
        },
        open: function() {
            $(this).find('.ui-error').text($(this).dialog('option','msg') || "").removeClass("ui-state-highlight");
            $('#bkjs-login').val("");
            $('#bkjs-secret').val("");
        },
    });

    modal.dialog("option", "callback", callback || null).dialog("option", "msg", "");
    return modal.dialog("open");
}

// Return dialog button by name
Bkjs.getButton = function(dialog, name)
{
    var self = this;
    var button = null;
    $(dialog).parent().find("button").each(function() {
        if ($(this).text() == name || $(this).parent().attr('id') == name) button = $(this);
    });
    return button;
}

// Enable or hide the button by name
Bkjs.enableButton = function(dialog, name, enable)
{
    var button = this.getButton(dialog, name);
    if (!button) return;
    if (enable) {
        button.show();
    } else {
        button.hide();
    }
}

// Show alert popup with optional timeout for autoclose
Bkjs.showPopup = function(msg, timeout)
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
Bkjs.showConfirm = function(msg, onok, oncancel)
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
}

// Show confirm dialog with optional select box
Bkjs.showChoices = function(msg, list, onok, oncancel)
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
