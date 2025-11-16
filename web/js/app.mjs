// src/app.js
var app = {
  base: "/app/",
  $target: "#app-main",
  index: "index",
  event: "component:event",
  templates: {},
  components: {},
  isF: isFunction,
  isS: isString,
  isE: isElement,
  isO: isObj,
  isN: isNumber,
  toCamel
};
function isNumber(num) {
  return typeof num == "number" ? num : void 0;
}
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
app.on = (event, callback, namespace) => {
  if (!isFunction(callback)) return;
  if (!_events[event]) _events[event] = [];
  _events[event].push([callback, isString(namespace)]);
};
app.once = (event, callback, namespace) => {
  if (!isFunction(callback)) return;
  const cb = (...args) => {
    app.off(event, cb);
    callback(...args);
  };
  app.on(event, cb, namespace);
};
app.only = (event, callback, namespace) => {
  _events[event] = isFunction(callback) ? [callback, isString(namespace)] : [];
};
app.off = (event, callback) => {
  if (event && callback) {
    if (!_events[event]) return;
    const i = isFunction(callback) ? 0 : isString(callback) ? 1 : -1;
    if (i >= 0) _events[event] = _events[event].filter((x) => x[i] !== callback);
  } else if (isString(event)) {
    for (const ev in _events) {
      _events[ev] = _events[ev].filter((x) => x[1] !== event);
    }
  }
};
app.emit = (event, ...args) => {
  app.trace("emit:", event, ...args, app.debug > 1 && _events[event]);
  if (_events[event]) {
    for (const cb of _events[event]) cb[0](...args);
  } else if (isString(event) && event.endsWith(":*")) {
    event = event.slice(0, -1);
    for (const p in _events) {
      if (p.startsWith(event)) {
        for (const cb of _events[p]) cb[0](...args);
      }
    }
  }
};

// src/dom.js
app.$param = (name, dflt) => new URLSearchParams(location.search).get(name) || dflt || "";
var esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
app.$ = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelector(esc(selector)) : null;
app.$all = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelectorAll(esc(selector)) : null;
app.$event = (element, name, detail = {}) => element instanceof EventTarget && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
app.$on = (element, event, callback, ...arg) => isFunction(callback) && element.addEventListener(event, callback, ...arg);
app.$off = (element, event, callback, ...arg) => isFunction(callback) && element.removeEventListener(event, callback, ...arg);
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
  if (isString(template)) {
    doc = app.$parse(template, "doc");
  } else if (template?.content?.nodeType == 11) {
    doc = { body: template.content.cloneNode(true) };
  } else {
    return element;
  }
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
  if (isObj(path)) return Object.assign(rc, path);
  if (!isString(path)) return rc;
  var base = app.base;
  if (path.startsWith(loc.origin)) path = path.substr(loc.origin.length);
  if (path.includes("://")) path = path.replace(/^(.*:\/\/[^/]*)/, "");
  if (path.startsWith(base)) path = path.substr(base.length);
  if (path.startsWith("/")) path = path.substr(1);
  if (path == base.slice(1, -1)) path = "";
  const q = path.indexOf("?");
  if (q > 0) {
    query = path.substr(q + 1, 1024);
    rc.name = path = path.substr(0, q);
  }
  if (path.endsWith(".html")) {
    path = path.slice(0, -5);
  }
  if (path.includes("/")) {
    path = path.split("/").slice(0, 7);
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
    for (let i = 1; i < 7; i++) path.push(options.params[`param${i}`] || "");
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
  const tmpl = app.parsePath(path);
  app.trace("resolve:", path, dflt, tmpl);
  var name = tmpl?.name, templates = app.templates, components = app.components;
  var template = tmpl.template || templates[name] || document.getElementById(name);
  if (!template && dflt) {
    template = templates[dflt] || document.getElementById(dflt);
    if (template) tmpl.name = dflt;
  }
  if (isString(template) && template.startsWith("#")) {
    template = document.getElementById(tmpl.otemplate = template.substr(1));
  } else if (isString(template) && template.startsWith("$")) {
    template = templates[tmpl.otemplate = template.substr(1)];
  }
  if (!template) return;
  tmpl.template = template;
  var component = components[name] || components[tmpl.name];
  if (isString(component)) {
    component = components[tmpl.ocomponent = component];
  }
  tmpl.component = component;
  return tmpl;
};
app.render = (options, dflt) => {
  var tmpl = app.resolve(options, dflt);
  if (!tmpl) return;
  var params = tmpl.params = Object.assign(tmpl.params || {}, options?.params);
  params.$target = options.$target || params.$target || app.$target;
  app.trace("render:", options, tmpl.name, tmpl.params);
  const element = isElement(params.$target) || app.$(params.$target);
  if (!element) return;
  var plugin = tmpl.component?.$type || options?.plugin || params.$plugin;
  plugin = _plugins[plugin] || _default_plugin;
  if (!plugin?.render) return;
  if (params.$target == app.$target) {
    var ev = { name: tmpl.name, params };
    app.emit(app.event, "prepare:delete", ev);
    if (ev.stop) return;
    var plugins = Object.values(_plugins);
    for (const p of plugins.filter((x) => x.cleanup)) {
      app.call(p.cleanup, element);
    }
    if (!(options?.$nohistory || params.$nohistory || tmpl.component?.$nohistory || app.$nohistory)) {
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
    app.emit("component:create", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
    if (!this.params.$noevents) {
      app.on(app.event, this._handleEvent);
    }
    app.call(this._onCreate?.bind(this, this.params));
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
    super.init(this.$root.parentElement._x_params);
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
  element._x_params = Object.assign({}, options.params);
  Alpine.onElRemoved(element, () => {
    delete element._x_params;
  });
  if (!options.component) {
    Alpine.mutateDom(() => {
      app.$append(element, options.template, Alpine.initTree);
    });
  } else {
    Alpine.data(options.name, () => new options.component(options.name));
    const node = app.$elem("div", "x-data", options.name);
    app.$append(node, options.template);
    Alpine.mutateDom(() => {
      element.appendChild(node);
      Alpine.initTree(node);
    });
  }
  return options;
}
function data(element, level) {
  if (!isElement(element)) element = app.$(app.$target + " div");
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
function $render(el, value, modifiers, callback) {
  const cache = modifiers.includes("cache");
  const opts = { url: value, post: modifiers.includes("post") };
  if (!value.url && !(!cache && /^(https?:\/\/|\/|.+\.html(\?|$)).+/.test(value))) {
    if (callback(el, value)) return;
  }
  app.fetch(opts, (err, text, info) => {
    if (err || !isString(text)) {
      return console.warn("$render: Text expected from", value, "got", err, text);
    }
    const tmpl = isString(value) ? app.parsePath(value) : value;
    tmpl.template = text;
    tmpl.name = tmpl.params?.$name || tmpl.name;
    if (cache) {
      app.templates[tmpl.name] = text;
    }
    callback(el, tmpl);
  });
}
function $template(el, value, modifiers) {
  const mods = {};
  const toMods = (tmpl) => {
    for (let i = 0; i < modifiers.length; i++) {
      const mod = modifiers[i];
      switch (mod) {
        case "params":
          var scope = Alpine.$data(el);
          if (!isObj(scope[modifiers[i + 1]])) break;
          tmpl.params = Object.assign(scope[modifiers[i + 1]], tmpl.params);
          break;
        case "inline":
          mods.inline = "inline-block";
          break;
        default:
          mods[mod] = mod;
      }
    }
    return tmpl;
  };
  $render(el, value, modifiers, (el2, tmpl) => {
    tmpl = app.resolve(tmpl);
    if (!tmpl) return;
    if (!render(el2, toMods(tmpl))) return;
    if (mods.show) {
      if (mods.nonempty && !el2.firstChild) {
        el2.style.setProperty("display", "none", mods.important);
      } else {
        el2.style.setProperty("display", mods.flex || mods.inline || "block", mods.important);
      }
    }
    return true;
  });
}
app.plugin(_alpine, { render, Component: AlpineComponent, data, init, default: 1 });
app.$on(document, "alpine:init", () => {
  app.emit("alpine:init");
  Alpine.magic("app", (el) => app);
  Alpine.magic("params", (el) => {
    while (el) {
      if (el._x_params) return el._x_params;
      el = el.parentElement;
    }
  });
  Alpine.magic("component", (el) => Alpine.closestDataStack(el).find((x) => x.$type == _alpine && x.$name));
  Alpine.magic("parent", (el) => Alpine.closestDataStack(el).filter((x) => x.$type == _alpine && x.$name)[1]);
  Alpine.directive("render", (el, { modifiers, expression }, { evaluate, cleanup }) => {
    const click = (e) => {
      const value = evaluate(expression);
      if (!value) return;
      e.preventDefault();
      if (modifiers.includes("stop")) {
        e.stopPropagation();
      }
      $render(el, value, modifiers, (el2, tmpl) => app.render(tmpl));
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
        $template(el, value, modifiers);
      }
      template = value;
    }));
    cleanup(empty);
  });
  Alpine.directive("scope-level", (el, { expression }, { evaluate }) => {
    const scope = Alpine.closestDataStack(el);
    el._x_dataStack = scope.slice(0, parseInt(evaluate(expression || "")) || 0);
  });
});

// src/fetch.js
function parseOptions(options) {
  var url = isString(options) ? options : options?.url || "";
  var headers = options?.headers || {};
  var opts = Object.assign({
    headers,
    method: options?.method || options?.post && "POST" || "GET",
    cache: "default"
  }, options?.options);
  var body = options?.body;
  if (opts.method == "GET" || opts.method == "HEAD") {
    if (isObj(body)) {
      url += "?" + new URLSearchParams(body).toString();
    }
  } else if (isString(body)) {
    opts.body = body;
    headers["content-type"] ??= "application/x-www-form-urlencoded; charset=UTF-8";
  } else if (body instanceof FormData) {
    opts.body = body;
    delete headers["content-type"];
  } else if (isObj(body)) {
    opts.body = JSON.stringify(body);
    headers["content-type"] = "application/json; charset=UTF-8";
  } else if (body) {
    opts.body = body;
    headers["content-type"] ??= "application/octet-stream";
  }
  return [url, opts];
}
app.fetch = function(options, callback) {
  try {
    const [url, opts] = parseOptions(options);
    app.trace("fetch:", url, opts, options);
    window.fetch(url, opts).then(async (res) => {
      var err, data2;
      var info = { status: res.status, headers: {}, type: res.type, url: res.url, redirected: res.redirected };
      for (const h of res.headers) {
        info.headers[h[0].toLowerCase()] = h[1];
      }
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
      switch (options?.dataType) {
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
app.afetch = function(options) {
  return new Promise((resolve, reject) => {
    app.fetch(options, (err, data2, info) => {
      resolve({ ok: !!err, status: info.status, err, data: data2, info });
    });
  });
};

// src/index.js
app.Component = component_default;
var src_default = app;

// builds/module.js
var module_default = src_default;
export {
  module_default as default
};
