//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// Bootstrap backend support

bkjs.koPlugins.push(function(target) {
    $(target).find('.carousel').carousel();
    $(target).find('[data-toggle="popover"]').popover();
});

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
    var html = '<div id=' + aid + ' class="alert alert-dismissible alert-' + type + ' show ' + (options.css || "") + '" role="alert">';
    if (options.icon) html += '<i class="fa fa-fw ' + options.icon + '"></i>';
    html += String(typeof text == "string" ? text : text && text.message ? text.message : JSON.stringify(text)).replace(/\n/g, "<br>");
    html += '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>';
    html += "</div>";
    var element = options.element || ".alerts";
    if (!$(obj).find(element).length) obj = $("body");
    var alerts = $(obj).find(element);
    if (!alerts.length) return;
    if (options.hide || alerts.css("display") == "none") {
        alerts.attr("data-alert", "hide");
        alerts.show();
    }
    if (options.css) alerts.addClass(options.css);
    if (!options.append) alerts.empty();
    alerts.append(html);
    if (!options.dismiss) {
        $(obj).find("#" + aid).delay((options.delay || 3000) * (type == "danger" ? 3 : type == "warning" ? 3 : type == "info" ? 2 : 1)).fadeOut(1000, function () {
            $(this).alert('close');
        });
    }
    $(obj).find("#" + aid).on('closed.bs.alert', function() {
        bkjs.cleanupAlerts(alerts, options);
    });
    if (options.scroll) $(obj).animate({ scrollTop: 0 }, "slow");
}

bkjs.hideAlert = function(obj, options)
{
    if (!options) options = {};
    var alerts = $(obj || "body").find(options.element || ".alerts");
    if (!alerts.length) return;
    alerts.empty();
    bkjs.cleanupAlerts(alerts, options);
}

bkjs.cleanupAlerts = function(element, options)
{
    if (element.children().length) return;
    if (options.css) element.removeClass(options.css);
    if (options.hide || element.attr("data-alert") == "hide") element.hide();
    element.removeAttr("data-alert");
}

bkjs.showConfirm = function(options, callback, cancelled)
{
    if (typeof options == "string") options = { text: options };

    bootpopup({
        self: this,
        title: options.title || 'Confirm',
        show_header: options.title !== null,
        buttons: ["cancel", "ok"],
        text_ok: options.ok || "OK",
        text_cancel: options.cancel || "Cancel",
        class_ok: options.ok_class || 'btn btn-primary',
        class_cancel: options.cancel_class || 'btn btn-default',
        content: [{ div: { html: String(options.text || "").replace(/\n/g, "<br>"), class: options.css || "" } }],
        ok: function() {
            if (typeof callback == "function") callback.call(this);
        },
        cancel: function() {
            if (typeof cancelled == "function") cancelled.call(this);
        }
    });
}

bkjs.showPrompt = function(options, callback)
{
    if (typeof options == "string") options = { text: options };

    var value;
    bootpopup({
        self: this,
        title: options.title || 'Prompt',
        buttons: ["cancel", "ok"],
        content: [{ input: { name: "value", label: String(options.text || "").replace(/\n/g, "<br>"), class: `form-control ${options.css ||""}` } }],
        ok: function(d) {
            value = d.value;
        },
        dismiss: function() {
            if (typeof callback == "function") callback.call(this, value);
        }
    });
}

bkjs.showLogin = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var popup;
    popup = bootpopup({
        self: this,
        id: "bkjs-login-modal",
        show_header: false,
        buttons: ["cancel", "ok"],
        text_ok: options.login_button || "Login",
        content: [
            { h4: { html: `<img src="${options.logo || "/img/logo.png"}" style="max-height: 3rem;"> ${options.title || 'Please Sign In'}`, class: "text-center py-4" } },
            { input: { name: "login", label: options.login || "Login", placeholder: options.login, autofocus: true,
                       onkeyup: function(f,e) { if (e.which == 13) { $(f).closest("form").find('input[type="password"]').focus(); e.preventDefault() } }
            } },
            { password: { name: "secret", label: options.password || "Password", placeholder: "Password",
                          onkeyup: function(f,e) { if (e.which == 13) { $(f).closest("form").trigger("submit"); e.preventDefault() } }
            } },
            options.disclaimer ? { div: { html: options.disclaimer } } : null,
        ],
        ok: function(d) {
            if (typeof options.onSubmit == "function" && !options.onSubmit(popup, d)) return false;
            var q = { login: d.login, secret: d.secret };
            if (options.url) q = { url: options.url, data: q };
            bkjs.login(q, function(err) {
                if (err) popup.showAlert("danger", err);
                if (typeof callback == "function") callback.call(self, err);
            });
            return false;
        },
    });
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

