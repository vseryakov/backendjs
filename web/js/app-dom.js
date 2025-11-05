/*
 *   app client
 *   Vlad Seryakov vseryakov@gmail.com 2018
 */

/* global document window */

(() => {
var app = window.app;

app.util = {

    // Inject CSS/Script resources into the current page, all urls are loaded at the same time by default.
    // - `options.series` - load urls one after another
    // - `options.async` if set then scripts executed as soon as loaded otherwise executing scripts will be in the order provided
    // - `options.callback` will be called with (el, opts) args for customizations after loading each url or on error
    // - `options.attrs` is an object with attributes to set like nonce, ...
    // - `options.timeout` - call the callback after timeout
    loadResources(urls, options, callback)
    {
        if (typeof options == "function") callback = options, options = null;
        if (typeof urls == "string") urls = [urls];
        app[`forEach${options?.series ? "Series" : ""}`](urls, (url, next) => {
            let el;
            const ev = () => { app.call(options?.callback, el, options); next() }
            if (/\.css/.test(url)) {
                el = app.$elem("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev)
            } else {
                el = app.$elem('script', "async", !!options?.async, "src", url, "load", ev, "error", ev)
            }
            for (const p in options?.attrs) app.$attr(el, p, options.attrs[p]);
            document.head.appendChild(el);
        }, options?.timeout > 0 ? () => { setTimeout(callback, options.timeout) } : callback);
    },

    // Return a random hex string
    random(size)
    {
        var s = "", u = new Uint8Array(size || 16), h = "0123456789abcdef";
        window.crypto.getRandomValues(u);
        for (let i = 0; i < u.length; i++) s += h.charAt(u[i] >> 4) + h.charAt(u[i] & 0x0F);
        return s;
    },
}

})();
