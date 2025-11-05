
//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

/* global document window HTMLElement bootstrap bootpopup */

(() => {
var app = window.app;

app.ui = {

    breakpoint()
    {
        var w = document.documentElement.clientWidth;
        return w < 576 ? 'xs' : w < 768 ? 'sm' : w < 992 ? 'md' : w < 1200 ? 'lg' : w < 1400 ? 'xl' : 'xxl';
    },

    setColorScheme()
    {
        document.documentElement.setAttribute("data-bs-theme", window.matchMedia('(prefers-color-scheme: dark)').matches ? "dark" : "light");
    },

    showAlert(obj, type, text, options)
    {
        if (obj?.jquery !== undefined) obj = obj[0];
        if (typeof obj == "string") options = text, text = type, type = obj, obj = document.body;
        if (!text) return;
        var o = Object.assign({}, options, { type });
        o.type = o.type == "error" ? "danger" : o.type || "info";

        var element = o.element || ".alerts";
        var alerts = app.$(element, app.isE(obj) || document.body);
        if (!alerts) return;

        var html = `
        <div class="alert alert-dismissible alert-${o.type} show fade" role="alert">
            ${o.icon ? `<i class="fa fa-fw ${o.icon}"></i>` : ""}
            ${alertText(text, o)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
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
        if (o.delay) {
            setTimeout(() => { instance.close() }, o.delay);
        }
        app.$on(alert, 'closed.bs.alert', (ev) => { cleanupAlerts(alerts, o) });
        if (o.scroll) alerts.scrollIntoView();
        return alert;
    },

    hideAlert(obj, options)
    {
        var alerts = app.$(options?.element || ".alerts", obj);
        if (!alerts) return;
        app.$empty(alerts);
        cleanupAlerts(alerts, options);
    },

    showLogin(options, callback)
    {
        if (typeof options == "function") callback = options, options = null;

        var opts = {
            self: options?.self,
            show_header: false,
            buttons: ["cancel", "Login"],
            alert: 1,
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
             Login: function(d) {
                if (typeof options?.onSubmit == "function" && !options.onSubmit(popup, d)) return null;
                app.send({ url: options.url || "/login", body: d }, (err, rc) => {
                    if (err) return popup.showAlert(err);
                    Object.assign(app.user, rc);
                    popup.close();
                    app.call(this, callback, err);
                    app.emit("user:login");
                });
                return null;
            },
        }
        for (const p in options) {
            if (/^(class|text|icon)_/.test(p)) opts[p] = options[p];
        }
        var popup = bootpopup(opts);
        return popup;
    },

    showToast(element, type, text, options)
    {
        if (typeof element == "string") options = text, text = type, type = element, element = null;
        if (!text) return;
        var o = Object.assign({
            type: type == "error" ? "danger" : typeof type == "string" && type || "info",
            now: Date.now(),
            delay: 5000,
            role: "alert"
        }, app.isO(options));

        var t = o.type[0];
        var delay = o.delay * (t == "d" || t == "w" ? 3 : t == "i" ? 2 : 1);
        var icon = o.icon || t == "s" ? "fa-check-circle" : t == "d" ? "fa-exclamation-circle" : t == "w" ? "fa-exclamation-triangle": "fa-info-circle";
        var fmt = Intl.DateTimeFormat({ timeStyle: "short" });
        var html = `
        <div class="toast fade show ${o.type} ${o.css || ""}" role="${o.role}" aria-live="polite" aria-atomic="true" data-bs-autohide="${!o.dismiss}" data-bs-delay="${delay}">
          <div class="toast-header ${o.css_header || ""}">
            <span class="fa fa-fw ${icon} me-2 text-${o.type}" aria-hidden="true"></span>
            <strong class="me-auto toast-title">${o.title || app.util.toTitle(type)}</strong>
            <small class="timer px-1" aria-hidden="true">${o.countdown ? Math.round(delay/1000)+"s" : !o.notimer ? "just now" : ""}</small>
            <small>(${fmt.format(o.now)})</small>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
          <div class="toast-body ${o.css_body || ""}">
            ${alertText(text, o)}
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
            app.$(".timer", toast).textContent = o.countdown ? app.util.toDuration(delay - (Date.now() - o.now)) : app.util.toAge(o.now) + " ago";
        }, o.countdown ? o.delay/2 : o.delay);
        app.$on(toast, "hidden.bs.toast", (ev) => { clearInterval(ev.target._timer); ev.target.remove() });
        return toast;
    },

    hideToast()
    {
        app.$empty(app.$(".toast-container"));
    },

    plugin(callback)
    {
        if (typeof callback == "function") _plugins.push(callback);
    },
};

var _plugins = [];

function applyPlugins(element)
{
    if (!(element instanceof HTMLElement)) return;
    app.$all(".carousel", element).forEach(el => (bootstrap.Carousel.getOrCreateInstance(el)));
    app.$all(`[data-bs-toggle="popover"]`, element).forEach(el => (bootstrap.Popover.getOrCreateInstance(el)));
    for (const cb of _plugins) cb(element);
}

function alertText(text, options)
{
    text = text?.message || text?.text || text?.msg || text;
    text = typeof text == "string" ? options?.safe ? text :
           app.util.escape(text.replaceAll("<br>", "\n")) :
           app.util.escape(JSON.stringify(text, null, " ").replace(/["{}[\]]/g, ""));
    return app.sanitizer.run(text).replace(/\n/g, "<br>");
}

function cleanupAlerts(alerts, options)
{
    if (alerts.firstElementChild) return;
    if (options?.css) alerts.classList.remove(options.css);
    if (options?.hide || alerts.dataset.alert == "hide") alerts.style.display = "none";
    delete alerts.dataset.alert;
}

function setBreakpoint()
{
    app.isMobile = /xs|sm|md/.test(app.ui.breakpoint());
    document.documentElement.style.setProperty('--height', (window.innerHeight * 0.01) + "px");
    app.emit("breakpoint");
}

var _sending = 0;

function sendStart()
{
    if (_sending++ > 0) return;
    app.$all('.loading').forEach(img => { img.style.visibility = "visible" })
}

function sendStop()
{
    if (--_sending > 0) return;
    _sending = 0;
    app.$all('.loading').forEach(img => { img.style.visibility = "hidden" })
}

var _resizing;

app.$ready(() => {
    setBreakpoint();

    app.$on(window, "resize", () => {
        clearTimeout(_resizing);
        _resizing = setTimeout(setBreakpoint, 250);
    });

    app.on("component:create", (data) => { applyPlugins(data?.element) });

    app.on("alert", app.ui.showAlert);
    app.on("send:start", sendStart);
    app.on("send:stop", sendStop);
});

})();
