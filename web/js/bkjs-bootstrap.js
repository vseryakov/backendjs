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
    if (bkjs.isS(obj)) options = text, text = type, type = obj, obj = $("body");
    if (!text) return;
    if (!options) options = {};
    if (!bkjs._alertNum) bkjs._alertNum = 0;
    if (type == "error") type = "danger";
    var aid = "alert-" + bkjs._alertNum++;
    var html = '<div id=' + aid + ' class="alert alert-dismissible alert-' + type + ' show ' + (options.css || "") + '" role="alert">';
    if (options.icon) html += '<i class="fa fa-fw ' + options.icon + '"></i>';
    html += bkjs.sanitizer.run(bkjs.isS(text) ? options.safe ? text : bkjs.textToEntity(text) :
                               text?.message ? options.safe ? text.message : bkjs.textToEntity(text.message) :
                               JSON.stringify(text).replace(/[<>]/g, "")).replace(/\n/g, "<br>");
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
    $(obj).find("#" + aid).on('closed.bs.alert', bkjs.cleanupAlerts.bind(bkjs, alerts, options));
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
    if (bkjs.isS(options)) options = { text: options };

    var opts = {
        self: this,
        sanitizer: bkjs.sanitizer,
        title: options.title || 'Confirm',
        show_header: options.title !== null,
        buttons: ["cancel", "ok"],
        content: [{ div: { html: String(options.text || "").replace(/\n/g, "<br>"), class: options.css || "" } }],
        ok: function() {
            if (bkjs.isF(callback)) callback.call(this);
        },
        cancel: function() {
            if (bkjs.isF(cancelled)) cancelled.call(this);
        }
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

bkjs.showPrompt = function(options, callback)
{
    if (bkjs.isS(options)) options = { text: options };

    var value;
    var opts = {
        self: this,
        sanitizer: bkjs.sanitizer,
        title: options.title || 'Prompt',
        buttons: ["cancel", "ok"],
        content: [{ input: { name: "value", label: String(options.text || "").replace(/\n/g, "<br>"), class: `form-control ${options.css ||""}`, value: options.value } }],
        ok: function(d) {
            value = d.value;
        },
        dismiss: function() {
            if (bkjs.isF(callback)) callback.call(this, value);
        }
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

bkjs.showLogin = function(options, callback)
{
    if (bkjs.isF(options)) callback = options, options = null;
    if (!options) options = {};

    var popup;
    var opts = {
        self: this,
        sanitizer: bkjs.sanitizer,
        id: "bkjs-login-modal",
        show_header: false,
        buttons: ["cancel", "ok"],
        text_ok: "Login",
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
            if (bkjs.isF(options.onSubmit) && !options.onSubmit(popup, d)) return false;
            var q = { login: d.login, secret: d.secret };
            if (options.url) q = { url: options.url, data: q };
            bkjs.login(q, function(err) {
                if (err) popup.showAlert(err);
                if (bkjs.isF(callback)) callback.call(self, err);
            });
            return false;
        },
    }
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    popup = bootpopup(opts);
}

bkjs.hideLogin = function()
{
    $("#bkjs-login-modal").modal("hide");
}

$(function() {
    bkjs.on("bkjs.alert", function(ev, type, msg, opts) {
        bkjs.showAlert(type, msg, opts);
    });
    bkjs.on("bkjs.loading", function(ev, type) {
        bkjs.showLoading(type);
    });
});

