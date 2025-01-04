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
  function isFunc(callback) {
    return typeof callback == "function";
  }
  function isStr(str) {
    return typeof str == "string";
  }
  function isObj(obj) {
    return typeof obj == "object" && obj;
  }
  function isElement(element) {
    return element instanceof HTMLElement ? element : void 0;
  }
  function toCamel(key) {
    return key.toLowerCase().replace(/-(\w)/g, (_, c) => c.toUpperCase());
  }

  // src/util.js
  app.noop = () => {
  };
  app.log = (...args) => console.log(...args);
  app.trace = (...args) => {
    app.debug && app.log(...args);
  };
  app.call = (obj, method, ...arg) => {
    if (isFunc(obj)) return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (isFunc(method)) return method.call(obj, ...arg);
    if (obj && isFunc(obj[method])) return obj[method].call(obj, ...arg);
  };
  var _events = {};
  app.on = (event, callback) => {
    if (!isFunc(callback)) return;
    if (!_events[event]) _events[event] = [];
    _events[event].push(callback);
  };
  app.once = (event, callback) => {
    if (!isFunc(callback)) return;
    const cb = (...args) => {
      app.off(event, cb);
      callback(...args);
    };
    app.on(event, cb);
  };
  app.only = (event, callback) => {
    _events[event] = isFunc(callback) ? [callback] : [];
  };
  app.off = (event, callback) => {
    if (!_events[event] || !callback) return;
    const i = _events[event].indexOf(callback);
    if (i > -1) return _events[event].splice(i, 1);
  };
  app.emit = (event, ...args) => {
    app.trace("emit:", event, ...args);
    if (_events[event]) {
      for (const cb of _events[event]) cb(...args);
    } else if (isStr(event) && event.endsWith(":*")) {
      event = event.slice(0, -1);
      for (const p in _events) {
        if (p.startsWith(event)) {
          for (const cb of _events[p]) cb(...args);
        }
      }
    }
  };

  // src/dom.js
  app.$param = (name, dflt) => {
    return new URLSearchParams(location.search).get(name) || dflt || "";
  };
  var esc = (selector) => isStr(selector) ? selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`) : "";
  app.$ = (selector, doc) => (isElement(doc) || document).querySelector(esc(selector));
  app.$all = (selector, doc) => (isElement(doc) || document).querySelectorAll(esc(selector));
  app.$event = (element, name, detail = {}) => isElement(element) && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
  app.$on = (element, event, callback, ...arg) => {
    return isFunc(callback) && element.addEventListener(event, callback, ...arg);
  };
  app.$off = (element, event, callback, ...arg) => {
    return isFunc(callback) && element.removeEventListener(event, callback, ...arg);
  };
  app.$attr = (element, attr, value) => {
    if (isStr(element) && element) element = app.$(element);
    if (!isElement(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  app.$empty = (element, cleanup) => {
    if (!isElement(element)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
      app.call(cleanup, node);
    }
    return element;
  };
  app.$elem = (name, ...arg) => {
    var element = document.createElement(name), key, val;
    if (isObj(arg[0])) {
      arg = Object.entries(arg[0]).flatMap((x) => x);
    }
    for (let i = 0; i < arg.length - 1; i += 2) {
      key = arg[i], val = arg[i + 1];
      if (!isStr(key)) continue;
      if (isFunc(val)) {
        app.$on(element, key, val);
      } else if (key.startsWith(".")) {
        element.style[key.substr(1)] = val;
      } else if (key.startsWith(":")) {
        element[key.substr(1)] = val;
      } else if (key.startsWith("data-")) {
        element.dataset[toCamel(key.substr(5))] = val;
      } else if (key == "text") {
        element.textContent = val || "";
      } else {
        element.setAttribute(key, val ?? "");
      }
    }
    return element;
  };
  app.$parse = (html, list) => {
    html = new window.DOMParser().parseFromString(html || "", "text/html").body;
    return list ? Array.from(html.childNodes) : html;
  };
  var _ready = [];
  app.$ready = (callback) => {
    _ready.push(callback);
    if (document.readyState == "loading") return;
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  };
  app.$on(window, "DOMContentLoaded", () => {
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  });

  // src/router.js
  app.parsePath = (path) => {
    var rc = { name: "", params: {} }, query, loc = window.location;
    if (!isStr(path)) return rc;
    var base = app.base;
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
  app.savePath = (options) => {
    if (isStr(options)) options = { name: options };
    if (!options?.name) return;
    var path = [options.name];
    if (options?.params) {
      for (let i = 1; i < 5; i++) path.push(options.params[`param${i}`] || "");
    }
    while (!path.at(-1)) path.length--;
    path = path.join("/");
    app.trace("savePath:", path, options);
    if (!path) return;
    window.history.pushState(null, "", window.location.origin + app.base + path);
  };
  app.restorePath = (path) => {
    app.trace("restorePath:", path, app.index);
    app.render(path, app.index);
  };
  app.start = () => {
    app.on("path:save", app.savePath);
    app.on("path:restore", app.restorePath);
    app.$ready(app.restorePath.bind(app, window.location.href));
  };
  app.$on(window, "popstate", () => app.emit("path:restore", window.location.href));

  // src/render.js
  var _plugins = {};
  var _default_plugin;
  app.plugin = (name, options) => {
    if (!name || !isStr(name)) throw Error("type must be defined");
    if (options) {
      for (const p of ["render", "cleanup"]) {
        if (options[p] && !isFunc(options[p])) throw Error(p + " must be a function");
      }
      if (isFunc(options?.Component)) {
        app[`${name.substr(0, 1).toUpperCase() + name.substr(1).toLowerCase()}Component`] = options.Component;
      }
    }
    var plugin = _plugins[name] = _plugins[name] || {};
    if (options?.default) _default_plugin = plugin;
    return Object.assign(plugin, options);
  };
  app.resolve = (path, dflt) => {
    const rc = app.parsePath(path);
    app.trace("resolve:", path, dflt, rc);
    var name = rc.name, templates = app.templates, components = app.components;
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
    if (isStr(component)) component = components[component];
    rc.component = component;
    return rc;
  };
  app.render = (options, dflt) => {
    var tmpl = app.resolve(options?.name || options, dflt);
    if (!tmpl) return;
    var params = tmpl.params;
    Object.assign(params, options?.params);
    app.trace("render:", options, tmpl.name, tmpl.params);
    const element = app.$(params.$target || app.main);
    if (!element) return;
    var plugin = tmpl.component?.$type || options?.plugin || params.$plugin;
    plugin = _plugins[plugin] || _default_plugin;
    if (!plugin?.render) return;
    if (!params.$target || params.$target == app.main) {
      var ev = { name: tmpl.name, params };
      app.emit(app.event, "prepare:delete", ev);
      if (ev.stop) return;
      var plugins = Object.values(_plugins);
      for (const p of plugins.filter((x) => x.cleanup)) {
        app.call(p.cleanup, element);
      }
      if (!(options?.nohistory || params.$nohistory)) {
        queueMicrotask(() => {
          app.emit("path:save", tmpl);
        });
      }
    }
    app.emit("component:render", tmpl);
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
      app.trace("init:", this.$_id);
      Object.assign(this.params, this.$el._x_params);
      app.call(this.onCreate?.bind(this));
      if (!this.params.$noevents) {
        app.on(app.event, this._handleEvent);
      }
      app.emit("component:create", { type: _alpine, name: this.$name, component: this, element: this.$el, params: Alpine.raw(this.params) });
    }
    destroy() {
      app.trace("destroy:", this.$_id);
      app.off(app.event, this._handleEvent);
      app.emit("component:delete", { type: _alpine, name: this.$name, component: this, element: this.$el, params: Alpine.raw(this.params) });
      app.call(this.onDelete?.bind(this));
      this.params = {};
    }
    handleEvent(event, ...args) {
      app.trace("event:", this.$_id, ...args);
      app.call(this.onEvent?.bind(this.$data), event, ...args);
      if (!isStr(event)) return;
      var method = toCamel("on_" + event);
      app.call(this[method]?.bind(this.$data), ...args);
    }
  };
  var Element = class extends HTMLElement {
    connectedCallback() {
      render(this, this.getAttribute("template") || this.localName.substr(Alpine.prefixed().length));
    }
  };
  function render(element, options) {
    if (isStr(options)) {
      options = app.resolve(options);
      if (!options) return;
    }
    app.$empty(element);
    const body = app.$parse(options.template);
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
      const node = app.$elem("div", "x-data", options.name, ":_x_params", options.params);
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
  app.plugin(_alpine, { render, Component, default: 1 });
  app.on("alpine:init", () => {
    for (const [name, obj] of Object.entries(app.components)) {
      if (obj?.$type != _alpine || customElements.get(Alpine.prefixed(name))) continue;
      customElements.define(Alpine.prefixed(name), class extends Element {
      });
      Alpine.data(name, () => new obj(name));
    }
  });
  app.$on(document, "alpine:init", () => {
    app.emit("alpine:init");
    Alpine.magic("app", (el) => app);
    Alpine.directive("render", (el, { modifiers, expression }, { evaluate, cleanup }) => {
      const click = (e) => {
        e.preventDefault();
        app.render(evaluate(expression));
      };
      app.$on(el, "click", click);
      el.style.cursor = "pointer";
      cleanup(() => {
        app.$off(el, "click", click);
      });
    });
    Alpine.directive("template", (el, { expression }, { effect, cleanup }) => {
      const evaluate = Alpine.evaluateLater(el, expression || "template");
      const hide = () => {
        Alpine.mutateDom(() => {
          app.$empty(el, (node) => Alpine.destroyTree(node));
        });
      };
      effect(() => evaluate((value) => {
        value ? render(el, value) : hide();
      }));
      cleanup(hide);
    });
  });

  // src/fetch.js
  app.fetchOpts = function(options) {
    var headers = options.headers || {};
    var opts = Object.assign({
      headers,
      method: options.type || "POST",
      cache: "default"
    }, options.fetchOptions);
    var data = options.data;
    if (opts.method == "GET" || opts.method == "HEAD") {
      if (isObj(data)) {
        options.url += "?" + new URLSearchParams(data).toString();
      }
    } else if (isStr(data)) {
      opts.body = data;
      headers["content-type"] = options.contentType || "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (data instanceof FormData) {
      opts.body = data;
      delete headers["content-type"];
    } else if (isObj(data)) {
      opts.body = JSON.stringify(data);
      headers["content-type"] = "application/json; charset=UTF-8";
    } else if (data) {
      opts.body = data;
      headers["content-type"] = options.contentType || "application/octet-stream";
    }
    return opts;
  };
  app.fetch = function(options, callback) {
    try {
      const opts = app.fetchOpts(options);
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
          return app.call(callback, err, data, info);
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
        app.call(callback, null, data, info);
      }).catch((err) => {
        app.call(callback, err);
      });
    } catch (err) {
      app.call(callback, err);
    }
  };

  // src/index.js
  var src_default = app;

  // builds/cdn.js
  window.app = src_default;
})();
