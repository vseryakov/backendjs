//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Bootstrap backend support

Bkjs.showAlert = function(obj, type, text, options)
{
    if (typeof obj == "string") options = text, text = type, type = obj, obj = $("body");
    if (!options) options = {};
    text = "<div class='alert alert-dissmisible alert-" + type + "' role='alert'>" + (typeof text == "string" ? text : JSON.stringify(text))
    if (options.dismiss) text += '<button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>';
    text += "</div>";
    if (!$(obj).find(".alerts").length) obj = $("body");
    $(obj).find(".alerts").empty().append(text);
    if (!options.dismiss) $(obj).find(".alerts div").hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function () { $(this).remove(); });
    if (options.scroll) $(obj).animate({ scrollTop: 0 }, "slow");
}

// Login UI control
Bkjs.hideLogin = function()
{
    $("#bkjs-login-modal").modal("hide");
}

Bkjs.showConfirm = function(options, callback)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-confirm-modal');
    if (!modal.length) {
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">\
                <a class="close" data-dismiss="modal" >&times;</a>\
                <h3>' + (options.title || "Confirm") +'</h3>\
              </div>\
              <div class="modal-body">\
                <p>' + options.text.replace(/\n/g, "<br>") + '</p>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" class="btn" data-dismiss="modal">' +
                  (options.cancel || "Cancel") +
                '</a>\
                <a href="#!" id="bkjs-confirm-ok-button" class="btn btn-primary">' +
                  (options.ok || "OK") +
                '</a> \
              </div>\
            </div>\
          </div>\
        </div>');
        modal.off().on('shown.bs.modal', function () {
            if (typeof options.onShown == "function") options.onShown(modal);
        });
        modal.find('#bkjs-confirm-ok-button').click(function(event) {
            if (callback) callback();
            modal.modal('hide');
        });
    }
    modal.modal("show");
};

Bkjs.showChoice = function(options, callback)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-choice-modal');
    if (!modal.length) {
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">\
                <a class="close" data-dismiss="modal" >&times;</a>\
                <h3>' + (options.title || "Choose") +'</h3>\
              </div>\
              <div class="modal-body">\
                <form role="form">\
                 <div class="form-group">\
                   <label>' + (options.text ? '<p>' + options.text.replace(/\n/g, "<br>") + '</p>' : "") + '</label>\
                   <select class="form-control ' + (options.css || "") + '"></select>\
                 </div>\
                </form>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" class="btn" data-dismiss="modal">' +
                  (options.cancel || "Cancel") +
                '</a>\
                <a href="#!" id="bkjs-choice-ok-button" class="btn btn-primary">' +
                  (options.ok || "OK") +
                '</a> \
              </div>\
            </div>\
          </div>\
        </div>');
        var select = modal.find('select');
        if (Array.isArray(options.values)) {
            options.values.forEach(function(x) {
                select.append($("<option>").attr('value', typeof x == "object" ? x.value : x).text(typeof x == "object" ? x.text : x));
            });
        }
        if (options.value) select.val(options.value);
        modal.off().on('shown.bs.modal', function () {
            if (typeof options.onShown == "function") options.onShown(modal);
        });
        modal.find('#bkjs-choice-ok-button').click(function(event) {
            if (callback) callback(select.val());
            modal.modal('hide');
        });
    }
    modal.modal("show");
};

Bkjs.showPrompt = function(options, callback)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-prompt-modal');
    if (!modal.length) {
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">\
                <a class="close" data-dismiss="modal" >&times;</a>\
                <h3>' + (options.title || "Prompt") +'</h3>\
              </div>\
              <div class="modal-body">\
                <form role="form">\
                 <div class="form-group">\
                   <label>' + (options.text ? '<p>' + options.text.replace(/\n/g, "<br>") + '</p>' : "") + '</label>\
                   <input type="text" class="form-control ' + (options.css || "") + '">\
                 </div>\
                </form>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" class="btn" data-dismiss="modal">' +
                  (options.cancel || "Cancel") +
                '</a>\
                <a href="#!" id="bkjs-prompt-ok-button" class="btn btn-primary">' +
                  (options.ok || "OK") +
                '</a> \
              </div>\
            </div>\
          </div>\
        </div>');
        var input = modal.find('input');
        if (options.value) input.val(options.value);
        modal.off().on('shown.bs.modal', function () {
            if (typeof options.onShown == "function") options.onShown(modal);
        });
        modal.find('#bkjs-prompt-ok-button').click(function(event) {
            if (callback) callback(input.val());
            modal.modal('hide');
        });
    }
    modal.modal("show");
};

Bkjs.showLogin = function(callback)
{
    var modal = $('#bkjs-login-modal');
    if (!modal.length) {
        modal = $(
        '<div id="bkjs-login-modal" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="LoginLabel" aria-hidden="true">\
          <div class="modal-dialog">\
           <div class="modal-content">\
            <form role="form">\
            <div class="modal-header">\
             <button type="button" class="close" onclick="Bkjs.hideLogin()"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>\
             <h4 class="modal-title" id="LoginLabel">Please Sign In</h4>\
            </div>\
            <div class="modal-body">\
              <div class="alerts"></div>\
              <div class="form-group">\
               <label>Login</label>\
               <input class="form-control" placeholder="Login" type="text" autofocus>\
              </div>\
              <div class="form-group">\
               <label>Password</label>\
               <input class="form-control" placeholder="Password" type="password" value="">\
              </div>\
            </div>\
            <div class="modal-footer">\
             <button type="button" class="btn btn-default" onclick="Bkjs.hideLogin()">Close</button>\
             <button type="submit" class="btn btn-primary">Login</button>\
            </div>\
            </form>\
           </div>\
          </div>\
        </div>').
        appendTo("body");
    }
    var form = modal.find('form');
    var login = form.find('input[type=text]');
    var secret = form.find('input[type=password]');
    modal.off().on('shown.bs.modal', function () {
        $(this).find('input:text:visible:first').focus();
    });
    login.off().on("keyup", function(e) {
        if (e.which == 13) { secret.focus(); e.preventDefault(); }
    });
    secret.off().on("keyup", function(e) {
        if (e.which == 13) { form.trigger("submit"); e.preventDefault(); }
    });
    form.find('button[type=submit]').off().on("click", function(e) {
        form.trigger("submit"); e.preventDefault();
    });
    form.off().on("submit", function() {
        Bkjs.login(login.val(), secret.val(), function(err, data, xhr) {
            if (err) Bkjs.showAlert(modal, "danger", err);
            if (typeof callback == "function") callback(err, data, xhr);
        });
        return false;
    });
    modal.modal("show");
}
