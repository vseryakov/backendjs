//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// Bootstrap backend support

bkjs.isBS4 = !!window.bootstrap?.Util?.getUID;

bkjs.plugins.push(function(target) {
    $(target).find('.carousel').carousel();
    $(target).find(`[data-${bkjs.isBS4?"":"bs-"}toggle="popover"]`).popover();
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

bkjs.getAlertText = function(text, options)
{
    text = text?.message || text?.text || text?.msg || text;
    text = bkjs.isS(text) ? options?.safe ? text : bkjs.textToEntity(text) : bkjs.formatJSON(text, { preset: "compact" }).replace(/[<>]/g, "");
    return bkjs.sanitizer.run(text).replace(/\n/g, "<br>");
}

bkjs.showAlert = function(obj, type, text, options)
{
    if (!obj || !obj.length) obj = null;
    if (bkjs.isS(obj)) options = text, text = type, type = obj, obj = $("body");
    if (!text) return;
    var o = Object.assign({}, options);
    o.type = o.type == "error" ? "danger" : o.type || "info";

    var element = o.element || ".alerts";
    if (!$(obj).find(element).length) obj = $("body");
    var alerts = $(obj).find(element);
    if (!alerts.length) return;

    var html = `
    <div class="alert alert-dismissible alert-${o.type} show fade" role="alert">
        ${o.icon ? `<i class="fa fa-fw ${o.icon}"></i>` : ""}
        ${bkjs.getAlertText(text, o)}
        <button type="button" class="${!bkjs.isBS4 ? "btn-" : ""}close" data-dismiss="alert" aria-label="Close">
            ${bkjs.isBS4 ? '<span aria-hidden="true">&times;</span>' : ""}
        </button>
    </div>`;
    if (o.hide || alerts.css("display") == "none") {
        alerts.attr("data-alert", "hide");
        alerts.show();
    }
    if (o.css) alerts.addClass(o.css);
    if (o.clear) alerts.empty();
    var el = $(html);
    alerts.append(el);
    if (!o.dismiss) {
        o.delay = (o.delay || 3000) * (type == "danger" || type == "warning" ? 3 : type == "info" ? 2 : 1);
        setTimeout(() => { el.alert('close') }, o.delay);
    }
    el.on('closed.bs.alert', bkjs.cleanupAlerts.bind(bkjs, alerts, o));
    if (o.scroll) alerts[0].scrollIntoView();
    return el;
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

bkjs.showToast = function(obj, type, text, options)
{
    if (bkjs.isS(obj)) options = text, text = type, type = obj, obj = null;
    if (!text) return;
    var o = Object.assign({ type: type == "error" ? "danger" : bkjs.isS(type) && type || "info", now: Date.now(), delay: 5000, role: "alert" }, options || {});
    var t = o.type[0];
    var delay = o.delay * (t == "d" || t == "w" ? 3 : t == "i" ? 2 : 1);
    var icon = o.icon || t == "s" ? "fa-check-circle" : t == "d" ? "fa-exclamation-circle" : t == "w" ? "fa-exclamation-triangle": "fa-info-circle";
    var html = `
    <div class="toast fade show ${o.type} ${o.css || ""}" role="${o.role}" aria-live="polite" aria-atomic="true" data-bs-autohide="${!o.dismiss}" data-bs-delay="${delay}">
        <div class="toast-header ${o.css_header || ""}">
            <span class="fa fa-fw ${icon} me-2 text-${o.type}" aria-hidden="true"></span>
            <strong class="me-auto toast-title">${o.title || bkjs.toTitle(type)}</strong>
            <small class="timer" aria-hidden="true">${o.countdown ? Math.round(delay/1000)+"s" : !o.notimer ? "just now" : ""}</small>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body ${o.css_body || ""}">
            ${bkjs.getAlertText(text, o)}
        </div>
    </div>`;
    if (!obj) {
        obj = $("body").find(".toast-container");
        if (!obj.length) obj = $("<div></div>", { "aria-live": "polite" }).appendTo($("body"));
        var pos = o.pos == "tl" ? "top-0 start-0" :
                  o.pos == "tr" ? "top-0 end-0" :
                  o.pos == "ml" ? "top-50 start-0  translate-middle-y" :
                  o.pos == "mc" ? "top-50 start-50 translate-middle" :
                  o.pos == "mr" ? "top-50 end-0 translate-middle-y" :
                  o.pos == "bl" ? "bottom-0 start-0" :
                  o.pos == "bc" ? "bottom-0 start-50 translate-middle-x" :
                  o.pos == "br" ? "bottom-0 end-0" : "top-0 start-50 translate-middle-x";
        obj[0].className = `toast-container position-fixed ${pos} p-3`;
    }
    if (o.clear) obj.empty();
    var el = $(html);
    $(el).toast("show");
    obj.prepend(el);
    var timer = !o.notimer ? setInterval(() => {
        if (!$(el)[0].parentElement) return clearInterval(timer);
        $(el).find(".timer").text(o.countdown ? bkjs.toDuration(delay - (Date.now() - o.now)) : bkjs.toAge(o.now) + " ago");
    }, o.countdown ? o.delay/2 : o.delay) : "";
    el.on("hidden.bs.toast", () => { clearInterval(timer); el.remove() });
    return el;
}

$(function() {
    bkjs.on("bkjs.alert", (ev, type, msg, opts) => {
        bkjs.showAlert(type, msg, opts);
    });
    bkjs.on("bkjs.loading", (ev, type) => {
        bkjs.showLoading(type);
    });
});

