/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

var bkjs = {

    // True if current credentials are good
    loggedIn: false,

    // Support sessions by storing wildcard signature in the cookies
    session: 1,

    // HTTP headers to be sent with every request
    headers: {},

    // Current account record
    account: {},

    // App base
    appPath: "/app/",
    appLocation: window.location.origin + "/app/",

    // Component definitions
    components: {},
    templates: { none: "<span></span>" },

    // Short functions
    noop: () => {},
    log: (...args) => console.log(...args),
    trace: (...args) => (bkjs.debug && console.log(...args)),

    // Private fields
    _ready: [],
    _events: {},
    _plugins: [],

};

// EVENT EMITTER PROTOCOL
bkjs.on = function(event, callback)
{
    if (typeof event != "string" || typeof callback != "function") return;
    if (!bkjs._events[event]) bkjs._events[event] = [];
    bkjs._events[event].push(callback);
}

bkjs.off = function(event, callback)
{
    if (!bkjs._events[event] || typeof callback != "function") return;
    const i = bkjs._events[event].indexOf(callback);
    if (i > -1) return bkjs._events[event].splice(i, 1);
}

bkjs.emit = function(event, ...args)
{
    if (!bkjs._events[event]) return;
    for (const cb of bkjs._events[event]) cb(...args);
}

// READY CALLBACKS
bkjs.ready = function(callback)
{
    if (typeof callback == "function") bkjs._ready.push(callback);
    if (document.readyState == "loading") return;
    while (bkjs._ready.length) setTimeout(bkjs._ready.shift());
}

// ROUTER

// Save a path in the history
bkjs.pushLocation = function(path)
{
    if (!path || path == bkjs._appLocation) return;
    bkjs.trace("pushLocation:", path)
    window.history.pushState({}, "", bkjs.appLocation + path);
    bkjs._appLocation = path;
}

// Parse the path and return an object to show as component, path can be an URL with params
// /name/param/param2/param3 -> { name, params: { param, param2, params3... } }
bkjs.parseLocation = function(path, query)
{
    var rc = { name: path, params: {} };

    if (typeof path == "string") {
        const q = path.indexOf("?");
        if (q > 0) {
            query = path.substr(q + 1);
            rc.name = path = path.substr(0, q);
        }
        if (path.includes("/")) {
            path = path.split("/").slice(0, 5);
            rc.name = path.shift();
            for (let i = 0; i < path.length; i++) {
                if (!path[i]) continue;
                rc.params[`param${i ? i + 1 : ""}`] = path[i];
            }
        }
    }
    if (typeof query == "string") {
        query.split("&").forEach((x) => {
            x = x.split("=");
            rc.params[x[0]] = decodeURIComponent(x[1]);
        });
    }
    return rc;
}

// Parse given path againbst current location
bkjs.restoreLocation = function(path)
{
    var loc = window.location;
    if (path && !bkjs.appLocation.startsWith(loc.origin + path)) path = "";
    var location = loc.origin + (path || loc.pathname);
    var rc = bkjs.parseLocation(location.substr(bkjs.appLocation.length));
    bkjs.trace("restoreLocation:", location, rc);
    return rc;
}

// COMPONENTS

// Returns a template and component by name
bkjs.findComponent = function(name)
{
    if (!name) return;
    const rc = bkjs.parseLocation(name);

    rc.template = bkjs.templates[rc.name];
    if (!rc.template) {
        rc.template = document.getElementById(rc.name)?.innerHTML;
    }
    if (rc.template?.startsWith("#")) {
        rc.template = document.getElementById(rc.template.substr(1))?.innerHTML;
    } else
    if (rc.template?.startsWith("$")) {
        rc.template = bkjs.templates[rc.template.substr(1)];
    }
    if (!rc.template) return;
    rc.component = bkjs.components[rc.name];
    return rc;
}

// For the given path or current location show a component or default one
bkjs.restoreComponent = function(path, dflt)
{
    var loc = bkjs.restoreLocation(path);
    dflt = dflt || bkjs.appIndex;
    if (dflt) Object.assign(loc.params, { $index: dflt });
    bkjs.showComponent(loc.name, loc.params);
}

// Store the given component in the history as /name/param/param2/param3/...
bkjs.saveComponent = function(name, options)
{
    if (!name || options?.$nohistory || options?.$target) return;
    var path = [name];
    for (let i = 0; i < 5; i++) path.push(options[`param${i ? i + 1 : ""}`] || "");
    while (!path.at(-1)) path.length--;
    bkjs.pushLocation(path.join("/"));
}

// PLUGINS
bkjs.plugin = function(callback)
{
    if (typeof callback != "function") return;
    bkjs._plugins.push(callback);
}

bkjs.applyPlugins = function(target)
{
    if (!target) return;
    for (const cb of bkjs._plugins) cb(target);
}

// DOM SHORTCUTS
bkjs.$ = function(selector)
{
    return document.querySelector(bkjs.$esc(selector));
}

bkjs.$all = function(selector)
{
    return document.querySelectorAll(bkjs.$esc(selector));
}

bkjs.$esc = function(selector)
{
    return typeof selector == "string" ? selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`) : "";
}

bkjs.$on = function(element, event, callback, ...arg)
{
    return typeof callback == "function" && element.addEventListener(event, callback, ...arg);
}

bkjs.$off = function(element, event, callback, ...arg)
{
    return typeof callback == "function" && element.removeEventListener(event, callback, ...arg);
}

bkjs.$attr = function(element, attr, value)
{
    if (!(element instanceof HTMLElement)) return;
    return value === undefined ? element.getAttribute(attr) :
           value === null ? element.removeAttribute(attr) :
           element.setAttribute(attr, value);
}

bkjs.$empty = function(element, callback)
{
    if (!(element instanceof HTMLElement)) return;
    while (element.firstChild) {
        const node = element.firstChild;
        node.remove();
        bkjs.call(callback, node);
    }
}

// Create a DOM elements with attributes, .name is style.name, :name is a property otherwise an attribute
bkjs.$create = function(name, ...arg)
{
    var el = document.createElement(name), key;
    for (let i = 0; i < arg.length - 1; i += 2) {
        key = arg[i];
        if (typeof key != "string") continue;
        if (typeof arg[i + 1] == "function") {
            bkjs.$on(el, key, arg[i + 1], false);
        } else
        if (key.startsWith(".")) {
            el.style[key.substr(1)] = arg[i + 1];
        } else
        if (key.startsWith("data-")) {
            el.dataset[key.substr(5)] = arg[i + 1];
        } else
        if (key.startsWith(":")) {
            el[key.substr(1)] = arg[i + 1];
        } else {
            el.setAttribute(key, arg[i + 1] ?? "");
        }
    }
    return el;
}

// UTILS

// Call a function safely with context:
// bkjs.call(func,..)
// bkjs.call(context, func, ...)
// bkjs.call(context, method, ...)
bkjs.call = function(obj, method, ...arg)
{
    if (typeof obj == "function") return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (typeof method == "function") return method.call(obj, ...arg);
    if (typeof obj[method] == "function") return obj[method].call(obj, ...arg);
}

// Return value of a query parameter by name
bkjs.param = function(name, dflt)
{
    var d = location.search.match(new RegExp(name + "=(.*?)($|&)", "i"));
    return d ? decodeURIComponent(d[1]) : dflt || "";
}

bkjs.$on(window, "DOMContentLoaded", () => {
    while (bkjs._ready.length) setTimeout(bkjs._ready.shift());
});

bkjs.ready(() => {

    bkjs.$on(window, "popstate", () => (bkjs.restoreComponent()));

    bkjs.on("component:created", (data) => {
        bkjs.trace("component:created", data);
        bkjs.applyPlugins(data?.element);
        bkjs.saveComponent(data?.name, data?.params);
    });

});

