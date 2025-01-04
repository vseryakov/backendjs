//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

// Bootstrap backend support

(() => {
var app = window.app;

app.getBreakpoint = function()
{
    var w = document.documentElement.clientWidth;
    return w < 576 ? 'xs' : w < 768 ? 'sm' : w < 992 ? 'md' : w < 1200 ? 'lg' : w < 1400 ? 'xl' : 'xxl';
}

app.setBreakpoint = function()
{
    app.isMobile = /xs|sm|md/.test(app.getBreakpoint());
    document.documentElement.style.setProperty('--height', (window.innerHeight * 0.01) + "px");
}

app.setColorScheme = function()
{
    document.documentElement.setAttribute("data-bs-theme", window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light");
}

// Show/hide loading animation, only first element
var loading = { count: 0 };

app.showLoading = function(op)
{
    var img = app.$('.loading');
    if (!img) return;

    switch (op) {
    case "hide":
        if (--loading.count > 0) break;
        loading.count = 0;
        if (loading.display == "none") img.style.display = 'none'; else img.style.visibility = "hidden";
        break;

    case "show":
        if (loading.count++ > 0) break;
        if (!loading.display) loading.display = img.style.display;
        if (loading.display == "none") img.style.display = 'inline-block'; else img.style.visibility = "visible";
        break;
    }
}

app.getAlertText = function(text, options)
{
    text = text?.message || text?.text || text?.msg || text;
    text = typeof text == "string" ? options?.safe ? text : app.textToEntity(text) : app.formatJSON(text, { preset: "compact" }).replace(/[<>]/g, "");
    return app.sanitizer.run(text).replace(/\n/g, "<br>");
}

app.showAlert = function(obj, type, text, options)
{
    if (obj?.jquery !== undefined) obj = obj[0];
    if (typeof obj == "string") options = text, text = type, type = obj, obj = document.body;
    if (!text) return;
    var o = Object.assign({}, options);
    o.type = o.type == "error" ? "danger" : o.type || "info";

    var element = o.element || ".alerts";
    if (!(obj instanceof HTMLElement) || !app.$(element, obj)) obj = document.body;
    var alerts = app.$(element, obj);
    if (!alerts) return;

    var html = `
    <div class="alert alert-dismissible alert-${o.type} show fade" role="alert">
        ${o.icon ? `<i class="fa fa-fw ${o.icon}"></i>` : ""}
        ${app.getAlertText(text, o)}
        <button type="button" class="btn-close" data-dismiss="alert" aria-label="Close"></button>
    </div>`;
    if (o.hide || alerts.style.display == "none") {
        alerts.dataset.alert = "hide";
        alerts.style.display = "block";
    }
    if (o.css) alerts.classList.add(o.css);
    if (o.clear) app.$empty(alerts);
    var alert = app.$parse(html).firstElementChild;
    var instance = bootstrap.Alert.getOrCreateInstance(alert);
    alerts.prepend(alert);
    if (!o.dismiss) {
        o.delay = (o.delay || 3000) * (type == "danger" || type == "warning" ? 3 : type == "info" ? 2 : 1);
        setTimeout(() => { instance.close() }, o.delay);
    }
    app.$on(alert, 'closed.bs.alert', (ev) => { cleanupAlerts(alerts, o) });
    if (o.scroll) alerts.scrollIntoView();
    return alert;
}

app.hideAlert = function(obj, options)
{
    var alerts = app.$(options?.element || ".alerts", obj);
    if (!alerts) return;
    app.$empty(alerts);
    cleanupAlerts(alerts, options);
}

const cleanupAlerts = (alerts, options) => {
    if (alerts.firstElementChild) return;
    if (options.css) alerts.classList.remove(options.css);
    if (options.hide || alerts.dataset.alert == "hide") alerts.style.display = "none";
    delete alerts.dataset.alert;
}

app.showConfirm = function(options, callback, cancelled)
{
    if (typeof options == "string") options = { text: options };

    var opts = {
        self: this,
        sanitizer: app.sanitizer,
        title: options.title || 'Confirm',
        show_header: options.title !== null,
        buttons: ["cancel", "ok"],
        content: [{ div: { html: String(options.text || "").replace(/\n/g, "<br>"), class: options.css || "" } }],
        ok: callback,
        cancel: cancelled
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

app.showPrompt = function(options, callback)
{
    if (typeof options == "string") options = { text: options };

    var value;
    var opts = {
        self: this,
        sanitizer: app.sanitizer,
        title: options.title || 'Prompt',
        buttons: ["cancel", "ok"],
        content: [{ input: { name: "value", label: String(options.text || "").replace(/\n/g, "<br>"), class: `form-control ${options.css ||""}`, value: options.value } }],
        ok: (d) => { value = d.value },
        dismiss: () => { app.call(callback, value) }
    };
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    bootpopup(opts);
}

app.showLogin = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var popup;
    var opts = {
        self: this,
        sanitizer: app.sanitizer,
        id: "app-login-modal",
        show_header: false,
        buttons: ["cancel", "ok"],
        text_ok: "Login",
        content: [
            { h4: {
                html: `<img src="${options?.logo || "/img/logo.png"}" style="max-height: 3rem;"> ${options?.title || 'Please Sign In'}`,
                class: "text-center py-4"
            } },
            { input: { name: "login", label: options?.login || "Login", placeholder: options?.login, autofocus: true,
                       keyup: (ev) => { if (ev.which == 13) { app.$('input[type="password"]', popup.form).focus(); ev.preventDefault() } }
            } },
            { password: { name: "secret", label: options?.password || "Password", placeholder: "Password",
                          keyup: (ev) => { if (ev.which == 13) { popup.form.submit(); ev.preventDefault() } }
            } },
            options?.disclaimer ? { div: { html: options.disclaimer } } : null,
        ],
        ok: function(d) {
            if (typeof options?.onSubmit == "function" && !options.onSubmit(popup, d)) return false;
            app.login({ url: options.url, data: d }, (err) => {
                if (err) popup.showAlert(err);
                app.call(callback, err);
            });
            return false;
        },
    }
    for (const p in options) {
        if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
    }
    popup = bootpopup(opts);
    return popup;
}

app.showToast = function(element, type, text, options)
{
    if (typeof element == "string") options = text, text = type, type = element, element = null;
    if (!text) return;
    var o = Object.assign({ type: type == "error" ? "danger" : typeof type == "string" && type || "info", now: Date.now(), delay: 5000, role: "alert" }, options || {});
    var t = o.type[0];
    var delay = o.delay * (t == "d" || t == "w" ? 3 : t == "i" ? 2 : 1);
    var icon = o.icon || t == "s" ? "fa-check-circle" : t == "d" ? "fa-exclamation-circle" : t == "w" ? "fa-exclamation-triangle": "fa-info-circle";
    var html = `
    <div class="toast fade show ${o.type} ${o.css || ""}" role="${o.role}" aria-live="polite" aria-atomic="true" data-bs-autohide="${!o.dismiss}" data-bs-delay="${delay}">
        <div class="toast-header ${o.css_header || ""}">
            <span class="fa fa-fw ${icon} me-2 text-${o.type}" aria-hidden="true"></span>
            <strong class="me-auto toast-title">${o.title || app.toTitle(type)}</strong>
            <small class="timer" aria-hidden="true">${o.countdown ? Math.round(delay/1000)+"s" : !o.notimer ? "just now" : ""}</small>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body ${o.css_body || ""}">
            ${app.getAlertText(text, o)}
        </div>
    </div>`;
    if (!element) {
        element = app.$(".toast-container");
        if (!element) {
            element = app.$elem("div", "aria-live", "polite");
            document.body.append(element);
        }
        var pos = o.pos == "tl" ? "top-0 start-0" :
                  o.pos == "tr" ? "top-0 end-0" :
                  o.pos == "ml" ? "top-50 start-0  translate-middle-y" :
                  o.pos == "mc" ? "top-50 start-50 translate-middle" :
                  o.pos == "mr" ? "top-50 end-0 translate-middle-y" :
                  o.pos == "bl" ? "bottom-0 start-0" :
                  o.pos == "bc" ? "bottom-0 start-50 translate-middle-x" :
                  o.pos == "br" ? "bottom-0 end-0" : "top-0 start-50 translate-middle-x";
        element.className = `toast-container position-fixed ${pos} p-3`;
    }
    if (o.clear) app.$empty(element);
    var toast = app.$parse(html).firstElementChild;
    bootstrap.Toast.getOrCreateInstance(toast).show();
    element.prepend(toast);
    toast._timer = o.notimer ? "" : setInterval(() => {
        if (!toast.parentElement) return clearInterval(toast._timer);
        app.$(".timer", toast).textContent = o.countdown ? app.toDuration(delay - (Date.now() - o.now)) : app.toAge(o.now) + " ago";
    }, o.countdown ? o.delay/2 : o.delay);
    app.$on(toast, "hidden.bs.toast", (ev) => { clearInterval(ev.target._timer); ev.target.remove() });
    return toast;
}

app.hideToast = function()
{
    app.$empty(app.$(".toast-container"));
}

var _plugins = [];
app.elementPlugin = function(callback)
{
    if (typeof callback == "function") _plugins.push(callback);
}
app.applyElementPlugins = function(element)
{
    if (!(element instanceof HTMLElement)) return;
    app.$all(".carousel", element).forEach(el => (bootstrap.Carousel.getOrCreateInstance(el)));
    app.$all(`[data-bs-toggle="popover"]`, element).forEach(el => (bootstrap.Popover.getOrCreateInstance(el)));
    for (const cb of _plugins) cb(element);
}

app.$ready(() => {
    app.setBreakpoint();

    app.$on(window, "resize", () => {
        clearTimeout(app._resized);
        app._resized = setTimeout(app.setBreakpoint, 250);
    });

    app.on("component:create", (data) => { app.applyElementPlugins(data?.element) });

    app.on("alert", app.showAlert);

    app.on("loading", app.showLoading);
});

})();
