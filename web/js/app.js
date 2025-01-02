(() => {
  // src/app.js
  var app = {
    base: "/app/",
    main: "#app-main",
    index: "index",
    event: "component:event",
    templates: {},
    components: {}
  };
  var app_default = app;

  // src/util.js
  app_default.noop = () => {
  };
  app_default.log = (...args) => console.log(...args);
  app_default.trace = (...args) => {
    app_default.debug && console.log(...args);
  };
  app_default.call = (obj, method, ...arg) => {
    if (typeof obj == "function") return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (typeof method == "function") return method.call(obj, ...arg);
    if (obj && typeof obj[method] == "function") return obj[method].call(obj, ...arg);
  };
  var _events = {};
  app_default.on = (event, callback) => {
    if (typeof callback != "function") return;
    if (!_events[event]) _events[event] = [];
    _events[event].push(callback);
  };
  app_default.once = (event, callback) => {
    if (typeof callback != "function") return;
    app_default.on(event, (...args) => {
      app_default.off(event, callback);
      callback(...args);
    });
  };
  app_default.only = (event, callback) => {
    _events[event] = typeof callback == "function" ? [callback] : [];
  };
  app_default.off = (event, callback) => {
    if (!_events[event] || !callback) return;
    const i = _events[event].indexOf(callback);
    if (i > -1) return _events[event].splice(i, 1);
  };
  app_default.emit = (event, ...args) => {
    app_default.trace("emit:", event, ...args);
    if (_events[event]) {
      for (const cb of _events[event]) cb(...args);
    } else if (typeof event == "string" && event.endsWith(":*")) {
      event = event.slice(0, -1);
      for (const p in _events) {
        if (p.startsWith(event)) {
          for (const cb of _events[p]) cb(...args);
        }
      }
    }
  };

  // src/dom.js
  var esc = (selector) => typeof selector == "string" ? selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`) : "";
  app_default.$ = (selector, doc) => (doc || document).querySelector(esc(selector));
  app_default.$all = (selector, doc) => (doc || document).querySelectorAll(esc(selector));
  app_default.$on = (element, event, callback, ...arg) => {
    return typeof callback == "function" && element.addEventListener(event, callback, ...arg);
  };
  app_default.$off = (element, event, callback, ...arg) => {
    return typeof callback == "function" && element.removeEventListener(event, callback, ...arg);
  };
  app_default.$attr = (element, attr, value) => {
    if (!(element instanceof HTMLElement)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  app_default.$empty = (element, cleanup) => {
    if (!(element instanceof HTMLElement)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
      app_default.call(cleanup, node);
    }
  };
  app_default.$param = (name, dflt) => {
    return new URLSearchParams(location.search).get(name) || dflt || "";
  };
  app_default.$elem = (name, ...arg) => {
    var el = document.createElement(name), key;
    for (let i = 0; i < arg.length - 1; i += 2) {
      key = arg[i];
      if (typeof key != "string") continue;
      if (typeof arg[i + 1] == "function") {
        app_default.$on(el, key, arg[i + 1], false);
      } else if (key.startsWith(".")) {
        el.style[key.substr(1)] = arg[i + 1];
      } else if (key.startsWith("data-")) {
        el.dataset[key.substr(5)] = arg[i + 1];
      } else if (key.startsWith(":")) {
        el[key.substr(1)] = arg[i + 1];
      } else {
        el.setAttribute(key, arg[i + 1] ?? "");
      }
    }
    return el;
  };
  var _ready = [];
  app_default.$ready = (callback) => {
    _ready.push(callback);
    if (document.readyState == "loading") return;
    while (_ready.length) setTimeout(app_default.call, 0, _ready.shift());
  };
  app_default.$on(window, "DOMContentLoaded", () => {
    while (_ready.length) setTimeout(app_default.call, 0, _ready.shift());
  });

  // src/router.js
  app_default.parsePath = (path) => {
    var rc = { name: "", params: {} }, query, loc = window.location;
    if (typeof path != "string") return rc;
    var base = app_default.base;
    if (path.startsWith(loc.origin)) path = path.substr(loc.origin.length);
    if (path.includes("://")) path = path.replace(/^(.*:\/\/[^\/]*)/, "");
    if (path.startsWith(base)) path = path.substr(base.length);
    if (path.startsWith("/")) path = path.substr(1);
    if (path == base.slice(1, -1)) path = "";
    const q = path.indexOf("?");
    if (q > 0) {
      query = path.substr(q + 1, 1024);
      rc.name = path = path.substr(0, q);
    }
    if (path.includes("/")) {
      path = path.split("/").slice(0, 5);
      rc.name = path.shift();
      for (let i = 0; i < path.length; i++) {
        if (!path[i]) continue;
        rc.params[`param${i + 1}`] = path[i];
      }
    } else {
      rc.name = path || "";
    }
    if (query) {
      for (const [key, value] of new URLSearchParams(query).entries()) {
        rc.params[key] = value;
      }
    }
    return rc;
  };
  app_default.savePath = (options) => {
    if (typeof options == "string") options = { name: options };
    if (!options?.name) return;
    var path = [options.name];
    if (options?.params) {
      for (let i = 1; i < 5; i++) path.push(options.params[`param${i}`] || "");
    }
    while (!path.at(-1)) path.length--;
    path = path.join("/");
    app_default.trace("savePath:", path, options);
    if (!path) return;
    window.history.pushState(null, "", window.location.origin + app_default.base + path);
  };
  app_default.restorePath = (path) => {
    app_default.trace("restorePath:", path, app_default.index);
    app_default.render(path, app_default.index);
  };
  app_default.start = () => {
    app_default.on("path:save", app_default.savePath);
    app_default.on("path:restore", app_default.restorePath);
    app_default.$ready(app_default.restorePath.bind(app_default, window.location.href));
  };
  app_default.$on(window, "popstate", () => app_default.emit("path:restore", window.location.href));

  // src/render.js
  var _plugins = {};
  var _default_plugin;
  app_default.plugin = (name, options) => {
    if (!name || typeof name != "string") throw Error("type must be defined");
    if (options) {
      for (const p of ["render", "cleanup"]) {
        if (options[p] && typeof options[p] != "function") throw Error(p + " must be a function");
      }
      if (typeof options?.Component == "function") {
        app_default[`${name.substr(0, 1).toUpperCase() + name.substr(1).toLowerCase()}Component`] = options.Component;
      }
    }
    var plugin = _plugins[name] = _plugins[name] || {};
    if (options?.default) _default_plugin = plugin;
    return Object.assign(plugin, options);
  };
  app_default.resolve = (path, dflt) => {
    const rc = app_default.parsePath(path);
    app_default.trace("resolve:", path, dflt, rc);
    var name = rc.name, templates = app_default.templates, components = app_default.components;
    var template = templates[name] || document.getElementById(name)?.innerHTML;
    if (!template && dflt) {
      template = templates[dflt] || document.getElementById(dflt)?.innerHTML;
      if (template) rc.name = dflt;
    }
    if (template?.startsWith("#")) {
      template = document.getElementById(template.substr(1))?.innerHTML;
    } else if (template?.startsWith("$")) {
      template = templates[template.substr(1)];
    }
    if (!template) return;
    rc.template = template;
    var component = components[name] || components[rc.name];
    if (typeof component == "string") component = components[component];
    rc.component = component;
    return rc;
  };
  app_default.render = (options, dflt) => {
    var tmpl = app_default.resolve(options?.name || options, dflt);
    if (!tmpl) return;
    var params = tmpl.params;
    Object.assign(params, options?.params);
    app_default.trace("render:", options, tmpl.name, tmpl.params);
    const element = app_default.$(params.$target || app_default.main);
    if (!element) return;
    var plugin = tmpl.component?.$type || options?.plugin || params.$plugin;
    plugin = _plugins[plugin] || _default_plugin;
    if (!plugin?.render) return;
    if (!params.$target || params.$target == app_default.main) {
      var ev = { name: tmpl.name, params };
      app_default.emit(app_default.event, "prepare:delete", ev);
      if (ev.stop) return;
      var plugins = Object.values(_plugins);
      for (const p of plugins.filter((x) => x.cleanup)) {
        app_default.call(p.cleanup, element);
      }
      if (!(options?.nohistory || params.$nohistory)) {
        queueMicrotask(() => {
          app_default.emit("path:save", tmpl);
        });
      }
    }
    app_default.emit("component:render", tmpl);
    plugin.render(element, tmpl);
    return tmpl;
  };

  // src/alpine.js
  var _alpine = "alpine";
  var Component = class _Component {
    // x-template dynamic rendering
    template = "";
    // Render options
    params = {};
    static $type = _alpine;
    static _id = 0;
    constructor(name, params) {
      this.$name = name;
      this.$_id = `${name}:${_alpine}:${_Component._id++}`;
      Object.assign(this.params, params);
      this._handleEvent = this.handleEvent.bind(this);
    }
    init() {
      app_default.trace("init:", this.$_id);
      Object.assign(this.params, this.$el._x_params);
      app_default.call(this.onCreate?.bind(this));
      if (!this.params.$noevents) {
        app_default.on(app_default.event, this._handleEvent);
      }
      app_default.emit("component:create", { type: _alpine, name: this.$name, component: this, element: this.$el, params: Alpine.raw(this.params) });
    }
    destroy() {
      app_default.trace("destroy:", this.$_id);
      app_default.off(app_default.event, this._handleEvent);
      app_default.emit("component:delete", { type: _alpine, name: this.$name, component: this, element: this.$el, params: Alpine.raw(this.params) });
      app_default.call(this.onDelete?.bind(this));
      this.params = {};
    }
    handleEvent(event, ...args) {
      app_default.trace("event:", this.$_id, ...args);
      app_default.call(this.onEvent?.bind(this.$data), event, ...args);
      if (typeof event != "string") return;
      var method = ("on_" + event).toLowerCase().replace(/[.:_-](\w)/g, (_, char) => char.toUpperCase());
      app_default.call(this[method]?.bind(this.$data), ...args);
    }
  };
  var Element = class extends HTMLElement {
    connectedCallback() {
      render(this, this.getAttribute("template") || this.localName.substr(Alpine.prefixed().length));
    }
  };
  function render(element, options) {
    if (typeof options == "string") {
      options = app_default.resolve(options);
      if (!options) return;
    }
    app_default.$empty(element);
    const body = new DOMParser().parseFromString(options.template, "text/html").body;
    if (!options.component) {
      Alpine.mutateDom(() => {
        while (body.firstChild) {
          const node = body.firstChild;
          element.appendChild(node);
          if (node.nodeType != 1) continue;
          Alpine.addScopeToNode(node, {}, element);
          Alpine.initTree(node);
        }
      });
    } else {
      Alpine.data(options.name, () => new options.component(options.name));
      const node = app_default.$elem("div", "x-data", options.name, ":_x_params", options.params);
      while (body.firstChild) {
        node.appendChild(body.firstChild);
      }
      Alpine.mutateDom(() => {
        element.appendChild(node);
        Alpine.initTree(node);
        delete node._x_params;
      });
    }
  }
  app_default.plugin(_alpine, { render, Component, default: 1 });
  app_default.on("alpine:init", () => {
    for (const [name, obj] of Object.entries(app_default.components)) {
      if (obj?.$type != _alpine || customElements.get(Alpine.prefixed(name))) continue;
      customElements.define(Alpine.prefixed(name), class extends Element {
      });
      Alpine.data(name, () => new obj(name));
    }
  });
  app_default.$on(document, "alpine:init", () => {
    app_default.emit("alpine:init");
    Alpine.magic("app", (el) => app_default);
    Alpine.directive("render", (el, { modifiers, expression }, { evaluate, cleanup }) => {
      const click = (e) => {
        e.preventDefault();
        app_default.render(evaluate(expression));
      };
      app_default.$on(el, "click", click);
      el.style.cursor = "pointer";
      cleanup(() => {
        app_default.$off(el, "click", click);
      });
    });
    Alpine.directive("template", (el, { expression }, { effect, cleanup }) => {
      const evaluate = Alpine.evaluateLater(el, expression || "template");
      const hide = () => {
        Alpine.mutateDom(() => {
          app_default.$empty(el, (node) => Alpine.destroyTree(node));
        });
      };
      effect(() => evaluate((value) => {
        value ? render(el, value) : hide();
      }));
      cleanup(hide);
    });
  });

  // src/fetch.js
  app_default.fetchOpts = function(options) {
    var headers = options.headers || {};
    var opts = Object.assign({
      headers,
      method: options.type || "POST",
      cache: "default"
    }, options.fetchOptions);
    var data = options.data;
    if (opts.method == "GET" || opts.method == "HEAD") {
      if (typeof data == "object" && data) {
        options.url += "?" + new URLSearchParams(data).toString();
      }
    } else if (typeof data == "string") {
      opts.body = data;
      headers["content-type"] = options.contentType || "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (data instanceof FormData) {
      opts.body = data;
      delete headers["content-type"];
    } else if (typeof data == "object") {
      opts.body = JSON.stringify(data);
      headers["content-type"] = "application/json; charset=UTF-8";
    } else if (data) {
      opts.body = data;
      headers["content-type"] = options.contentType || "application/octet-stream";
    }
    return opts;
  };
  app_default.fetch = function(options, callback) {
    try {
      const opts = app_default.fetchOpts(options);
      window.fetch(options.url, opts).then(async (res) => {
        var err, data;
        var info = { status: res.status, headers: {}, type: res.type };
        for (const h of res.headers) info.headers[h[0].toLowerCase()] = h[1];
        if (!res.ok) {
          if (/\/json/.test(info.headers["content-type"])) {
            const d = await res.json();
            err = { status: res.status };
            for (const p in d) err[p] = d[p];
          } else {
            err = { message: await res.text(), status: res.status };
          }
          return app_default.call(callback, err, data, info);
        }
        switch (options.dataType) {
          case "text":
            data = await res.text();
            break;
          case "blob":
            data = await res.blob();
            break;
          default:
            data = /\/json/.test(info.headers["content-type"]) ? await res.json() : await res.text();
        }
        app_default.call(callback, null, data, info);
      }).catch((err) => {
        app_default.call(callback, err);
      });
    } catch (err) {
      app_default.call(callback, err);
    }
  };

  // src/index.js
  var src_default = app_default;

  // builds/cdn.js
  window.app = src_default;
})();
