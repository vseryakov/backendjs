//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// Bootstrap backend support

// Show/hide loading animation
bkjs.showLoading = function(op)
{
    var img = $(this.loadingElement || '.loading');
    if (!img.length) return;

    if (!this._loading) this._loading = { count: 0 };
    var state = this._loading;
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
}

bkjs.showAlert = function(obj, type, text, options)
{
    if (typeof obj == "string") options = text, text = type, type = obj, obj = $("body");
    if (!text) return;
    if (!options) options = {};
    if (!bkjs._alertNum) bkjs._alertNum = 0;
    if (type == "error") type = "danger";
    var aid = "alert-" + bkjs._alertNum++;
    var html = "<div id=" + aid + " class='alert alert-dismissible alert-" + type + "' role='alert'>";
    if (options.icon) html += '<i class="fa fa-fw ' + options.icon + '"></i>';
    html += String(typeof text == "string" ? text : text && text.message ? text.message : JSON.stringify(text)).replace(/\n/g, "<br>");
    html += '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
    html += "</div>";
    if (!$(obj).find(".alerts").length) obj = $("body");
    if (!options.append) $(obj).find(".alerts").empty();
    $(obj).find(".alerts").append(html);
    if (!options.dismiss) $(obj).find("#" + aid).hide().fadeIn(200).delay(5000 * (type == "danger" ? 5 : type == "warning" ? 3 : 1)).fadeOut(1000, function () { $(this).remove(); });
    if (options.scroll) $(obj).animate({ scrollTop: 0 }, "slow");
}

bkjs.hideAlert = function(obj)
{
    $(obj || "body").find(".alerts").empty();
}

bkjs.showConfirm = function(options, callback, cancelled)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-confirm-modal'), self = this;
    if (!modal.length) {
        var close = '<a class="close" data-dismiss="modal" >&times;</a>';
        var title = '<h3 class="modal-title">' + (options.title || "Prompt") +'</h3>';
        if (window.bootstrap) title = title + close; else title = close + title;
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">' + title + '</div>\
              <div class="modal-body">\
                <p>' + options.text.replace(/\n/g, "<br>") + '</p>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" id="bkjs-confirm-cancel-button" class="btn btn-default" data-dismiss="modal">' +
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
            if (typeof options.onShown == "function") options.onShown.call(self, modal);
        });
        modal.find('#bkjs-confirm-ok-button').click(function(event) {
            if (callback) callback.call(self);
            modal.modal('hide');
        });
        if (typeof cancelled == "function") {
            modal.find('#bkjs-confirm-cancel-button').click(function(event) {
                cancelled();
                modal.modal('hide');
            });
        }
    }
    modal.modal("show");
};

bkjs.showChoice = function(options, callback)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-choice-modal'), self = this;
    if (!modal.length) {
        var close = '<a class="close" data-dismiss="modal" >&times;</a>';
        var title = '<h3 class="modal-title">' + (options.title || "Prompt") +'</h3>';
        if (window.bootstrap) title = title + close; else title = close + title;
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">' + title + '</div>\
              <div class="modal-body">\
                <form role="form">\
                 <div class="form-group">\
                   <label>' + (options.text ? '<p>' + options.text.replace(/\n/g, "<br>") + '</p>' : "") + '</label>\
                   <select class="form-control ' + (options.css || "") + '"></select>\
                 </div>\
                </form>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" class="btn btn-default" data-dismiss="modal">' +
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
            if (typeof options.onShown == "function") options.onShown.call(self, modal);
        });
        modal.find('#bkjs-choice-ok-button').click(function(event) {
            if (callback) callback.call(self, select.val());
            modal.modal('hide');
        });
    }
    modal.modal("show");
};

bkjs.showPrompt = function(options, callback)
{
    if (typeof options == "string") options = { text: options };
    var modal = $('#bkjs-prompt-modal'), self = this;
    if (!modal.length) {
        var close = '<a class="close" data-dismiss="modal" >&times;</a>';
        var title = '<h3 class="modal-title">' + (options.title || "Prompt") +'</h3>';
        if (window.bootstrap) title = title + close; else title = close + title;
        modal = $(
        '<div class="modal fade">\
          <div class="modal-dialog">\
            <div class="modal-content">\
              <div class="modal-header">' + title + '</div>\
              <div class="modal-body">\
                <form role="form">\
                 <div class="form-group">\
                   <label>' + (options.text ? '<p>' + options.text.replace(/\n/g, "<br>") + '</p>' : "") + '</label>\
                   <input type="text" class="form-control ' + (options.css || "") + '">\
                 </div>\
                </form>\
              </div>\
              <div class="modal-footer">\
                <a href="#!" class="btn btn-default" data-dismiss="modal">' +
                  (options.cancel || "Cancel") +
                '</a>\
                <a href="#!" id="bkjs-prompt-ok-button" class="btn btn-primary">' +
                  (options.ok || "OK") +
                '</a> \
              </div>\
            </div>\
          </div>\
        </div>');
        var form = modal.find('form');
        var input = modal.find('input');
        if (options.value) input.val(options.value);
        modal.off().on('shown.bs.modal', function () {
            if (typeof options.onShown == "function") options.onShown.call(self, modal);
        });
        form.off().on("submit", function() {
            if (callback) callback.call(self, input.val());
            modal.modal('hide');
            return false;
        });
        modal.find('#bkjs-prompt-ok-button').click(function(event) {
            if (callback) callback.call(self, input.val());
            modal.modal('hide');
        });
    }
    modal.modal("show");
};

bkjs.showLogin = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var modal = $('#bkjs-login-modal'), self = this;
    if (!modal.length) {
        var close = '<button type="button" class="close" onclick="bkjs.hideLogin()"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>';
        var title = '<h4 class="modal-title" id="LoginLabel"><img src=@icon@ class="logo"> @title@</h4>';
        if (window.bootstrap) title = title + close; else title = close + title;
        var text =
        '<div id="bkjs-login-modal" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="LoginLabel" aria-hidden="true">\
          <div class="modal-dialog">\
           <div class="modal-content">\
            <form role="form">\
            <div class="modal-header">' + title + '</div>\
            <div class="modal-body">\
              <div class="alerts"></div>\
              <div class="form-group">\
               <label>@login@</label>\
               <input class="form-control" placeholder="@login@" type="text" autofocus>\
              </div>\
              <div class="form-group">\
               <label>Password</label>\
               <input class="form-control" placeholder="Password" type="password" value="">\
              </div>\
              @disclaimer@\
            </div>\
            <div class="modal-footer">\
             <button type="button" class="btn btn-default" onclick="bkjs.hideLogin()">Close</button>\
             <button type="submit" class="btn btn-primary">Login</button>\
            </div>\
            </form>\
           </div>\
          </div>\
        </div>';
        text = text.replace(/@login@/g, options.login || "Login");
        text = text.replace(/@icon@/g, options.icon || "/img/logo.png");
        text = text.replace(/@title@/g, options.title || "Please Sign In");
        text = text.replace(/@disclaimer@/g, options.disclaimer || "");
        modal = $(text).appendTo("body");
    }
    var form = modal.find('form');
    var login = form.find('input[type=text]');
    if (!login.length) login = form.find('input[type=email]');
    var secret = form.find('input[type=password]');
    modal.off().on('shown.bs.modal', function () {
        login.focus();
    });
    login.off().on("keyup", function(e) {
        if (e.which == 13) { secret.focus(); e.preventDefault(); }
    });
    secret.off().on("keyup", function(e) {
        if (e.which == 13) { form.trigger("submit"); e.preventDefault(); }
    }).val("");
    form.find('button[type=submit]').off().on("click", function(e) {
        form.trigger("submit"); e.preventDefault();
    });
    form.off().on("submit", function() {
        if (typeof options.onSubmit == "function" && !options.onSubmit(modal, form, login.val(), secret.val())) return false;
        bkjs.login({ login: login.val(), secret: secret.val() }, function(err) {
            if (err) bkjs.showAlert(modal, "danger", err);
            if (typeof callback == "function") callback.call(self, err);
        });
        return false;
    });
    modal.modal("show");
}

bkjs.hideLogin = function()
{
    $("#bkjs-login-modal").modal("hide");
}

$(function() {
    $(bkjs).on("bkjs.alert", function(ev, type, msg) {
        bkjs.showAlert(type, msg);
    });
    $(bkjs).on("bkjs.loading", function(ev, type) {
        bkjs.showLoading(type);
    });
});

