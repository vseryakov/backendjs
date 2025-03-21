(() => {
  // src/app.js
  var app = {
    base: "/app/",
    main: "#app-main",
    index: "index",
    event: "component:event",
    templates: {},
    components: {},
    isF: isFunction,
    isS: isString,
    isE: isElement,
    isO: isObj,
    toCamel
  };
  function isString(str) {
    return typeof str == "string" && str;
  }
  function isFunction(callback) {
    return typeof callback == "function" && callback;
  }
  function isObj(obj) {
    return typeof obj == "object" && obj;
  }
  function isElement(element) {
    return element instanceof HTMLElement && element;
  }
  function toCamel(key) {
    return isString(key) ? key.toLowerCase().replace(/[.:_-](\w)/g, (_, c) => c.toUpperCase()) : "";
  }

  // src/util.js
  app.noop = () => {
  };
  app.log = (...args) => console.log(...args);
  app.trace = (...args) => {
    app.debug && app.log(...args);
  };
  app.call = (obj, method, ...arg) => {
    if (isFunction(obj)) return obj(method, ...arg);
    if (typeof obj != "object") return;
    if (isFunction(method)) return method.call(obj, ...arg);
    if (obj && isFunction(obj[method])) return obj[method].call(obj, ...arg);
  };
  var _events = {};
  app.on = (event, callback) => {
    if (!isFunction(callback)) return;
    if (!_events[event]) _events[event] = [];
    _events[event].push(callback);
  };
  app.once = (event, callback) => {
    if (!isFunction(callback)) return;
    const cb = (...args) => {
      app.off(event, cb);
      callback(...args);
    };
    app.on(event, cb);
  };
  app.only = (event, callback) => {
    _events[event] = isFunction(callback) ? [callback] : [];
  };
  app.off = (event, callback) => {
    if (!_events[event] || !callback) return;
    const i = _events[event].indexOf(callback);
    if (i > -1) return _events[event].splice(i, 1);
  };
  app.emit = (event, ...args) => {
    app.trace("emit:", event, ...args, app.debug > 1 && _events[event]);
    if (_events[event]) {
      for (const cb of _events[event]) cb(...args);
    } else if (isString(event) && event.endsWith(":*")) {
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
  var esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
  app.$ = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelector(esc(selector)) : null;
  app.$all = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelectorAll(esc(selector)) : null;
  app.$event = (element, name, detail = {}) => isElement(element) && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
  app.$on = (element, event, callback, ...arg) => {
    return isFunction(callback) && element.addEventListener(event, callback, ...arg);
  };
  app.$off = (element, event, callback, ...arg) => {
    return isFunction(callback) && element.removeEventListener(event, callback, ...arg);
  };
  app.$attr = (element, attr, value) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  app.$empty = (element, cleanup) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
      app.call(cleanup, node);
    }
    return element;
  };
  app.$elem = (name, ...arg) => {
    var element = document.createElement(name), key, val, opts;
    if (isObj(arg[0])) {
      arg = Object.entries(arg[0]).flatMap((x) => x);
      opts = arg[1];
    }
    for (let i = 0; i < arg.length - 1; i += 2) {
      key = arg[i], val = arg[i + 1];
      if (!isString(key)) continue;
      if (isFunction(val)) {
        app.$on(element, key, val, { capture: opts?.capture, passive: opts?.passive, once: opts?.once, signal: opts?.signal });
      } else if (key.startsWith("-")) {
        element.style[key.substr(1)] = val;
      } else if (key.startsWith(".")) {
        element[key.substr(1)] = val;
      } else if (key.startsWith("data-")) {
        element.dataset[toCamel(key.substr(5))] = val;
      } else if (key == "text") {
        element.textContent = val || "";
      } else if (val !== null) {
        element.setAttribute(key, val ?? "");
      }
    }
    return element;
  };
  app.$parse = (html, format) => {
    html = new window.DOMParser().parseFromString(html || "", "text/html");
    return format === "doc" ? html : format === "list" ? Array.from(html.body.childNodes) : html.body;
  };
  app.$append = (element, template, setup) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    let doc;
    if (isString(template)) doc = app.$parse(template, "doc");
    else if (template?.content?.nodeType == 11) doc = { body: template.content.cloneNode(true) };
    else
      return element;
    let node;
    while (node = doc.head?.firstChild) {
      element.appendChild(node);
    }
    while (node = doc.body.firstChild) {
      element.appendChild(node);
      if (setup && node.nodeType == 1) app.call(setup, node);
    }
    return element;
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
    if (!isString(path)) return rc;
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
    if (isString(options)) options = { name: options };
    if (!options?.name) return;
    var path = [options.name];
    if (options?.params) {
      for (let i = 1; i < 5; i++) path.push(options.params[`param${i}`] || "");
    }
    while (!path.at(-1)) path.length--;
    path = path.join("/");
    app.trace("savePath:", path, options);
    if (!path) return;
    app.emit("path:push", window.location.origin + app.base + path);
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
    if (!name || !isString(name)) throw Error("type must be defined");
    if (options) {
      for (const p of ["render", "cleanup", "data"]) {
        if (options[p] && !isFunction(options[p])) throw Error(p + " must be a function");
      }
      if (isFunction(options?.Component)) {
        app[`${name.substr(0, 1).toUpperCase() + name.substr(1).toLowerCase()}Component`] = options.Component;
      }
    }
    var plugin = _plugins[name] = _plugins[name] || {};
    if (options?.default) _default_plugin = plugin;
    return Object.assign(plugin, options);
  };
  app.$data = (element, level) => {
    if (isString(element)) element = app.$(element);
    for (const p in _plugins) {
      if (!_plugins[p].data) continue;
      const d = _plugins[p].data(element, level);
      if (d) return d;
    }
  };
  app.resolve = (path, dflt) => {
    const rc = app.parsePath(path);
    app.trace("resolve:", path, dflt, rc);
    var name = rc.name, templates = app.templates, components = app.components;
    var template = templates[name] || document.getElementById(name);
    if (!template && dflt) {
      template = templates[dflt] || document.getElementById(dflt);
      if (template) rc.name = dflt;
    }
    if (isString(template) && template.startsWith("#")) {
      template = document.getElementById(template.substr(1));
    } else if (isString(template) && template.startsWith("$")) {
      template = templates[template.substr(1)];
    }
    if (!template) return;
    rc.template = template;
    var component = components[name] || components[rc.name];
    if (isString(component)) component = components[component];
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
      if (!(options?.nohistory || params.$nohistory || tmpl.component?.$nohistory)) {
        queueMicrotask(() => {
          app.emit("path:save", tmpl);
        });
      }
    }
    app.emit("component:render", tmpl);
    plugin.render(element, tmpl);
    return tmpl;
  };
  app.on("alpine:init", () => {
    for (const p in _plugins) {
      app.call(_plugins[p], "init");
    }
  });

  // src/component.js
  var Component = class {
    params = {};
    constructor(name, params) {
      this.$name = name;
      Object.assign(this.params, params);
      this._handleEvent = handleEvent.bind(this);
      this._onCreate = this.onCreate || null;
      this._onDelete = this.onDelete || null;
    }
    init(params) {
      app.trace("init:", this.$type, this.$name);
      Object.assign(this.params, params);
      if (!this.params.$noevents) {
        app.on(app.event, this._handleEvent);
      }
      app.call(this._onCreate?.bind(this, this.params));
      app.emit("component:create", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
    }
    destroy() {
      app.trace("destroy:", this.$type, this.$name);
      app.off(app.event, this._handleEvent);
      app.emit("component:delete", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      app.call(this._onDelete?.bind(this));
      this.params = {};
      delete this.$root;
    }
  };
  function handleEvent(event, ...args) {
    if (this.onEvent) {
      app.trace("event:", this.$type, this.$name, event, ...args);
      app.call(this.onEvent?.bind(this.$data || this), event, ...args);
    }
    if (!isString(event)) return;
    var method = toCamel("on_" + event);
    if (!this[method]) return;
    app.trace("event:", this.$type, this.$name, method, ...args);
    app.call(this[method]?.bind(this.$data || this), ...args);
  }
  var component_default = Component;

  // src/alpine.js
  var _alpine = "alpine";
  var AlpineComponent = class extends component_default {
    static $type = _alpine;
    constructor(name, params) {
      super(name, params);
      this.$type = _alpine;
    }
    init() {
      super.init(this.$root._x_params);
    }
  };
  var Element = class extends HTMLElement {
    connectedCallback() {
      queueMicrotask(() => {
        render(this, this.localName.substr(4));
      });
    }
  };
  function render(element, options) {
    if (isString(options)) {
      options = app.resolve(options);
      if (!options) return;
    }
    app.$empty(element);
    if (!options.component) {
      Alpine.mutateDom(() => {
        app.$append(element, options.template, Alpine.initTree);
      });
    } else {
      Alpine.data(options.name, () => new options.component(options.name));
      const node = app.$elem("div", "x-data", options.name, "._x_params", options.params);
      app.$append(node, options.template);
      Alpine.mutateDom(() => {
        element.appendChild(node);
        Alpine.initTree(node);
        delete node._x_params;
      });
    }
    return options;
  }
  function data(element, level) {
    if (!isElement(element)) element = app.$(app.main + " div");
    if (!element) return;
    if (typeof level == "number") return element._x_dataStack?.at(level);
    return Alpine.closestDataStack(element)[0];
  }
  function init() {
    for (const [name, obj] of Object.entries(app.components)) {
      const tag = `app-${obj?.$tag || name}`;
      if (obj?.$type != _alpine || customElements.get(tag)) continue;
      customElements.define(tag, class extends Element {
      });
      Alpine.data(name, () => new obj(name));
    }
  }
  app.plugin(_alpine, { render, Component: AlpineComponent, data, init, default: 1 });
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
    Alpine.directive("template", (el, { modifiers, expression }, { effect, cleanup }) => {
      const evaluate = Alpine.evaluateLater(el, expression);
      var template;
      const empty = () => {
        template = null;
        Alpine.mutateDom(() => {
          app.$empty(el, (node) => Alpine.destroyTree(node));
          if (modifiers.includes("show")) {
            el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
          }
        });
      };
      effect(() => evaluate((value) => {
        if (!value) return empty();
        if (value !== template) {
          if (render(el, value)) {
            if (modifiers.includes("show")) {
              if (modifiers.includes("nonempty") && !el.firstChild) {
                el.style.setProperty("display", "none", modifiers.includes("important") ? "important" : void 0);
              } else {
                el.style.setProperty(
                  "display",
                  modifiers.includes("flex") ? "flex" : modifiers.includes("inline") ? "inline-block" : "block",
                  modifiers.includes("important") ? "important" : void 0
                );
              }
            }
          }
        }
        template = value;
      }));
      cleanup(empty);
    });
    Alpine.directive("scope-level", (el, { expression }, { evaluate }) => {
      const scope = Alpine.closestDataStack(el);
      el._x_dataStack = scope.slice(0, parseInt(evaluate(expression)) || 0);
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
    var data2 = options.data;
    if (opts.method == "GET" || opts.method == "HEAD") {
      if (isObj(data2)) {
        options.url += "?" + new URLSearchParams(data2).toString();
      }
    } else if (isString(data2)) {
      opts.body = data2;
      headers["content-type"] = options.contentType || "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (data2 instanceof FormData) {
      opts.body = data2;
      delete headers["content-type"];
    } else if (isObj(data2)) {
      opts.body = JSON.stringify(data2);
      headers["content-type"] = "application/json; charset=UTF-8";
    } else if (data2) {
      opts.body = data2;
      headers["content-type"] = options.contentType || "application/octet-stream";
    }
    return opts;
  };
  app.fetch = function(options, callback) {
    try {
      const opts = app.fetchOpts(options);
      window.fetch(options.url, opts).then(async (res) => {
        var err, data2;
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
          return app.call(callback, err, data2, info);
        }
        switch (options.dataType) {
          case "text":
            data2 = await res.text();
            break;
          case "blob":
            data2 = await res.blob();
            break;
          default:
            data2 = /\/json/.test(info.headers["content-type"]) ? await res.json() : await res.text();
        }
        app.call(callback, null, data2, info);
      }).catch((err) => {
        app.call(callback, err);
      });
    } catch (err) {
      app.call(callback, err);
    }
  };

  // src/index.js
  app.Component = component_default;
  var src_default = app;

  // builds/cdn.js
  window.app = src_default;
})();
