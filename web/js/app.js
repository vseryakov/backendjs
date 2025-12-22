(() => {
  // src/app.js
  /**
   * Global application object
   * @namespace
   */
  var app = {
    /**
     * @var {string} - Defines the root path for the application, must be framed with slashes.
     * @default
     */
    base: "/app/",
    /**
     * @var {object} - Central app HTML element for rendering main components.
     * @default
     */
    $target: "#app-main",
    /**
     * @var {string} - Specifies a fallback component for unrecognized paths on initial load, it is used by {@link app.restorePath}.
     * @default
     */
    index: "index",
    /**
     * @var {string} - Event name components listen
     * @default
     */
    event: "component:event",
    /**
     * @var {object} - HTML templates, this is the central registry of HTML templates to be rendered on demand,
     * this is an alternative to using **&lt;template&gt;** tags which are kept in the DOM all the time even if not used.
     * This object can be populated in the bundle or loaded later as JSON, this all depends on the application environment.
     */
    templates: {},
    /**
     * @var {string} - Component classes, this is the registry of all components logic to be used with corresponding templates.
     * Only classed derived from **app.AlpineComponent** will be used, internally they are registered with **Alpine.data()** to be reused by name.
     */
    components: {},
    isF: isFunction,
    isS: isString,
    isE: isElement,
    isO: isObj,
    isN: isNumber,
    toCamel
  };
  /**
   * Returns the num itself if it is a number
   * @param {any} num
   * @returns {number|undefined}
   * @func isN
   * @memberof app
   */
  function isNumber(num) {
    return typeof num == "number" ? num : void 0;
  }
  /**
   * Returns the str itself if it is not empty or ""
   * @param {any} str
   * @returns {string}
   * @func isS
   * @memberof app
   */
  function isString(str) {
    return typeof str == "string" && str;
  }
  /**
   * Returns the callback is it is a function
   * @param {any} callback
   * @returns {function|undefined}
   * @func isF
   * @memberof app
   */
  function isFunction(callback) {
    return typeof callback == "function" && callback;
  }
  /**
   * Returns the obj itself if it is a not null object
   * @param {any} obj
   * @returns {object|undefined}
   * @func isO
   * @memberof app
   */
  function isObj(obj) {
    return typeof obj == "object" && obj;
  }
  /**
   * Returns the element itself if it is a HTMLElement
   * @param {any} element
   * @returns {HTMLElement|undefined}
   * @func isE
   * @memberof app
   */
  function isElement(element) {
    return element instanceof HTMLElement && element;
  }
  /**
   * Convert a string into camelized format
   * @param {string} str
   * @returns {string}
   * @func toCamel
   * @memberof app
   */
  function toCamel(str) {
    return isString(str) ? str.toLowerCase().replace(/[.:_-](\w)/g, (_, c) => c.toUpperCase()) : "";
  }

  // src/util.js
  /**
   * Empty function
   */
  app.noop = () => {
  };
  /**
   * Alias to console.log
   */
  app.log = (...args) => console.log(...args);
  /**
   * if __app.debug__ is set then it will log arguments in the console otherwise it is no-op
   * @param {...any} args
   */
  app.trace = (...args) => {
    app.debug && app.log(...args);
  };
  /**
   * Call a function safely with context and arguments:
   * @param {object|function} obj
   * @param {string|function} [method]
   * @param {any} [...args]
   * @example
   * app.call(func,..)
   * app.call(obj, func, ...)
   * app.call(obj, method, ...)
   */
  app.call = (obj, method, ...args) => {
    if (isFunction(obj)) return obj(method, ...args);
    if (typeof obj != "object") return;
    if (isFunction(method)) return method.call(obj, ...args);
    if (obj && isFunction(obj[method])) return obj[method].call(obj, ...args);
  };
  var _events = {};
  /**
   * Listen on event, the callback is called synchronously, optional namespace allows deleting callbacks later easier by not providing
   * exact function by just namespace.
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  app.on = (event, callback, namespace) => {
    if (!isFunction(callback)) return;
    if (!_events[event]) _events[event] = [];
    _events[event].push([callback, isString(namespace)]);
  };
  /**
   * Listen on event, the callback is called only once
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  app.once = (event, callback, namespace) => {
    if (!isFunction(callback)) return;
    const cb = (...args) => {
      app.off(event, cb);
      callback(...args);
    };
    app.on(event, cb, namespace);
  };
  /**
   * Remove all current listeners for the given event, if a callback is given make it the **only** listener.
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  app.only = (event, callback, namespace) => {
    _events[event] = isFunction(callback) ? [callback, isString(namespace)] : [];
  };
  /**
   * Remove all event listeners for the event name and exact callback or namespace
   * @param {string} event|namespace
   * - event name if callback is not empty
   * - namespace if no callback
   * @param {function|string} [callback]
   * - function - exact callback to remove for the event
   * - string - namespace for the event
   * @example
   * app.on("component:*", (ev) => { ... }, "myapp")
   * ...
   * app.off("myapp")
   */
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
  /**
   * Send an event to all listeners at once, one by one.
   *
   * If the event ends with **_:*_** it means notify all listeners that match the beginning of the given pattern, for example:
   * @param {string} event
   * @param {...any} args
   * @example <caption>notify topic:event1, topic:event2, ...</caption>
   * app.emit("topic:*",....)
   */
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
  /**
   * Returns a query parameter value from the current document location
   * @param {string} name
   * @param {string} [dflt]
   * @return {string}
   */
  app.$param = (name, dflt) => new URLSearchParams(location.search).get(name) || dflt || "";
  var esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
  /**
   * An alias to **document.querySelector**, doc can be an Element, empty or non-string selectors will return null
   * @param {string} selector
   * @param {HTMLElement} [doc]
   * @returns {null|HTMLElement}
   * @example
   * var el = app.$("#div")
   */
  app.$ = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelector(esc(selector)) : null;
  /**
   * An alias for **document.querySelectorAll**
   * @param {string} selector
   * @param {HTMLElement} [doc]
   * @returns {null|HTMLElement[]}
   * @example
   * Array.from(app.$all("input")).find((el) => !(el.readOnly || el.disabled || el.type == "hidden"));
   */
  app.$all = (selector, doc) => isString(selector) ? (isElement(doc) || document).querySelectorAll(esc(selector)) : null;
  /**
   * Send a CustomEvent using DispatchEvent to the given element, true is set to composed, cancelable and bubbles properties.
   * @param {HTMLElement} element
   * @param {string} name
   * @param {object} [detail]
   */
  app.$event = (element, name, detail = {}) => element instanceof EventTarget && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
  /**
   * An alias for **element.addEventListener**
   * @param {HTMLElement} element
   * @param {string} event
   * @param {function} callback
   * @param {any} [...args] - additional params to addEventListener
   * @example
   * app.$on(window, "popstate", () => { ... })
   */
  app.$on = (element, event, callback, ...arg) => isFunction(callback) && element.addEventListener(event, callback, ...arg);
  /**
   * An alias for **element.removeEventListener**
   * @param {HTMLElement} element
   * @param {string} event
   * @param {function} callback
   * @param {any} [...args] - additional params to removeEventListener
   */
  app.$off = (element, event, callback, ...arg) => isFunction(callback) && element.removeEventListener(event, callback, ...arg);
  /**
   * Return or set attribute by name from the given element.
   * @param {HTMLElement|string} element
   * @param {string} attr
   * @param {any} [value]
   * - undefined - return the attribute value
   * - null - remove attribute
   * - any - assign new value
   * @returns {undefined|any}
   */
  app.$attr = (element, attr, value) => {
    if (isString(element)) element = app.$(element);
    if (!isElement(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  /**
   * Remove all nodes from the given element, call the cleanup callback for each node if given
   * @param {HTMLElement|string} element
   * @param {functions} [cleanup]
   * @returns {HTMLElement}
   */
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
  /**
   * Create a DOM element with attributes, **-name** means **style.name**, **.name** means a property **name**,
   * all other are attributes, functions are event listeners
   * @param {string} name
   * @param {any|object} [...args]
   * @param {object} [options]
   * @example
   * app.$elem("div", "id", "123", "-display", "none", "._x-prop", "value", "click", () => {})
   *
   * @example <caption>Similar to above but all properties and attributes are taken from an object, in this form options can be passed, at the moment only
   * options for addEventListener are supported.</caption>
   *
   * app.$elem("div", { id: "123", "-display": "none", "._x-prop": "value", click: () => {} }, { signal })
   */
  app.$elem = (name, ...args) => {
    var element = document.createElement(name), key, val, opts;
    if (isObj(args[0])) {
      args = Object.entries(args[0]).flatMap((x) => x);
      opts = args[1];
    }
    for (let i = 0; i < args.length - 1; i += 2) {
      key = args[i], val = args[i + 1];
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
  /**
   * A shortcut to DOMParser, default is to return the .body.
   * @param {string} html
   * @param {string} [format] - defines the result format:
   *  - list - the result will be an array with all body child nodes, i.e. simpler to feed it to Element.append()
   *  - doc - return the whole parsed document
   * @example
   * document.append(...app.$parse("<div>...</div>"), 'list'))
   */
  app.$parse = (html, format) => {
    html = new window.DOMParser().parseFromString(html || "", "text/html");
    return format === "doc" ? html : format === "list" ? Array.from(html.body.childNodes) : html.body;
  };
  /**
   * Append nodes from the template to the given element, call optional setup callback for each node.
   * @param {string|HTMLElement} element
   * @param {string|HTMLElement} template can be a string with HTML or a template element.
   * @param {function} [setup]
   * @example
   * app.$append(document, "<div>...</div>")
   */
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
  /**
   * Run callback once the document is loaded and ready, it uses setTimeout to schedule callbacks
   * @param {function} callback
   * @example
   * app.$ready(() => {
   *
   * })
   */
  app.$ready = (callback) => {
    _ready.push(callback);
    if (document.readyState == "loading") return;
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  };
  app.$on(window, "DOMContentLoaded", () => {
    while (_ready.length) setTimeout(app.call, 0, _ready.shift());
  });

  // src/router.js
  /**
   * Parses component path and returns an object with at least **{ name, params }** ready for rendering. External urls are ignored.
   *
   * Passing an object will retun a shallow copy of it with name and params properties possibly set if not provided.
   *
   * The path can be:
   * - component name
   * - relative path: name/param1/param2/param3/....
   * - absolute path: /app/name/param1/param2/...
   * - URL: https://host/app/name/param1/...
   *
   *  All parts from the path and query parameters will be placed in the **params** object.
   *
   * The **.html** extention will be stripped to support extrernal loading but other exts will be kept as is.
   *
   * @param {string|object} path
   * @returns {Object} in format { name, params }
   */
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
  /**
   * Saves the given component in the history as ** /name/param1/param2/param3/.. **
   *
   * It is called on every **component:create** event for main components as a microtask,
   * meaning immediate callbacks have a chance to modify the behaviour.
   * @param {Object} options
   *
   */
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
  /**
   * Show a component by path, it is called on **path:restore** event by default from {@link app.start} and is used
   * to show first component on initial page load. If the path is not recognized or no component is
   * found then the default {@link app.index} component is shown.
   * @param {string} path
   */
  app.restorePath = (path) => {
    app.trace("restorePath:", path, app.index);
    app.render(path, app.index);
  };
  /**
   * Setup default handlers:
   * - on **path:restore** event call {@link app.restorePath} to render a component from the history
   * - on **path:save** call {@link app.savePath} to save the current component in the history
   * - on page ready call {@link app.restorePath} to render the initial page
   *
   * **If not called then no browser history will not be handled, up to the app to do it some other way.**. One good
   * reason is to create your own handlers to build different path and then save/restore.
   */
  app.start = () => {
    app.on("path:save", app.savePath);
    app.on("path:restore", app.restorePath);
    app.$ready(app.restorePath.bind(app, window.location.href));
  };
  app.$on(window, "popstate", () => app.emit("path:restore", window.location.href));

  // src/render.js
  var _plugins = {};
  var _default_plugin;
  /**
   *   Register a render plugin, at least 2 functions must be defined in the options object:
   * @param {string} name
   * @param {object} options
   * @param {function} render - (element, options) to show a component, called by {@link app.render}
   * @param {function} cleanup - (element) - optional, run additional cleanups before destroying a component
   * @param {function} data - (element) - return the component class instance for the given element or the main
   * @param {boolean} [options.default] - if not empty make this plugin default
   * @param {class} [options.Component] - optional base component constructor, it will be registered as app.{Type}Component, like AlpineComponent, KoComponent,... to easy create custom components
   *
   * The reason for plugins is that while this is designed for Alpine.js, the idea originated by using Knockout.js with this system,
   * the plugin can be found at [app.ko.js](https://github.com/vseryakov/backendjs/blob/c97ca152dfd55a3841d07b54701e9d2b8620c516/web/js/app.ko.js).
   *
   * There is a simple plugin in examples/simple.js to show how to use it without any rendering engine with vanillla HTML, not very useful though.
   */
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
  /**
   * Return component data instance for the given element or the main component if omitted. This is for
   * debugging purposes or cases when calling some known method is required.
   * @param {string|HTMLElement} element
   * @param {number} [level] - if is not a number then the closest scope is returned otherwise only the requested scope at the level or undefined.
   * This is useful for components to make sure they use only the parent's scope for example.
   *
   * @returns {Proxy|undefined} to get the actual object pass it to **Alpine.raw(app.$data())**
   */
  app.$data = (element, level) => {
    if (isString(element)) element = app.$(element);
    for (const p in _plugins) {
      if (!_plugins[p].data) continue;
      const d = _plugins[p].data(element, level);
      if (d) return d;
    }
  };
  /**
   * Returns an object with **template** and **component** properties.
   *
   * Calls {@link app.parsePath} first to resolve component name and params.
   *
   * Passing an object with 'template' set will reuse it, for case when template is already resolved.
   *
   * The template property is set as:
   *  - try app.templates[.name]
   *  - try an element with ID name and use innerHTML
   *  - if not found and dflt is given try the same with it
   *  - if template texts starts with # it means it is a reference to another element's innerHTML,
   *     otemplate is set with the original template before replacing the template property
   *  - if template text starts with $ it means it is a reference to another template in **app.templates**,
   *     otemplate is set with the original template before replacing the template property
   *
   * The component property is set as:
   *  - try app.components[.name]
   *  - try app.components[dflt]
   *  - if resolved to a function return
   *  - if resolved to a string it refers to another component, try app.templates[component],
   *     ocomponent is set with the original component string before replacing the component property
   *
   * if the component property is empty then this component is HTML template.
   * @param {string} path
   * @param {string} [dflt]
   * @returns {object} in format { name, params, template, component }
   */
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
  /**
   * Show a component, options can be a string to be parsed by {@link app.parsePath} or an object with { name, params } properties.
   * if no **params.$target** provided a component will be shown inside the main element defined by {@link app.$target}.
   *
   * It returns the resolved component as described in {@link app.resolve} method after rendering or nothing if nothing was shown.
   *
   * When showing main app the current component is asked to be deleted first by sending an event __prepare:delete__,
   * a component that is not ready to be deleted yet must set the property __event.stop__ in the event
   * handler __onPrepareDelete(event)__ in order to prevent rendering new component.
   *
   * To explicitly disable history pass __options.$nohistory__ or __params.$nohistory__ otherwise main components are saved automatically by sending
   * the __path:save__ event.
   *
   * A component can globally disable history by creating a static property __$nohistory__ in the class definition.
   *
   * To disable history all together set `app.$nohistory = true`.
   *
   * @param {string|object} options
   * @param {string} [dflt]
   * @returns {object|undefined}
   */
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
  /**
   * Base class for components
   * @param {string} name - component name
   * @param {object} [params] - properties passed during creation
   * @class
   */
  var Component = class {
    params = {};
    constructor(name, params) {
      this.$name = name;
      Object.assign(this.params, params);
      this._handleEvent = handleEvent.bind(this);
      this._onCreate = this.onCreate || null;
      this._onDelete = this.onDelete || null;
    }
    /**
     * Called immediately after creation, after event handler setup it calls the class
     * method __onCreate__ to let custom class perform its own initialization
     * @param {object} params - properties passed
     */
    init(params) {
      app.trace("init:", this.$type, this.$name);
      Object.assign(this.params, params);
      app.emit("component:create", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      if (!this.params.$noevents) {
        app.on(app.event, this._handleEvent);
      }
      app.call(this._onCreate?.bind(this, this.params));
    }
    /**
     * Called when a component is about to be destroyed, calls __onDelete__ class method for custom cleanup
     */
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
  /**
   * Alpine.js component
   * @param {string} name - component name
   * @param {object} [params] - properties passed during creation
   * @class
   * @extends Component
   * @example <caption>Component code</caption>
   * app.components.items = class extends app.AlpineComponent {
   *   items = []
   *
   *   onCreate() {
   *       app.fetch("host/items", (err, items) => {
   *           this.items = items;
   *       })
   *   }
   *}
   * @example <caption>Component template</caption>
   * <div x-show="!list.length">
   *   Your basket is empty
   * </div>
   * <template x-for="item in items">
   *   ID: <div x-text="item.id"></div>
   * </template>
   */
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
  /**
   * Fetch remote content, wrapper around Fetch API
   *
   * @param {string|object} options - can be full URL or an object with `url:`
   * @param {string} [options.url] - URL to fetch
   * @param {string} [options.method] - GET, POST,...GET is default (also can be specified as post: 1)
   * @param {string|object|FormData} [options.body] - a body
   * @param {string} [options.dataType] - explicit return type: text, blob, default is auto detected between text or json
   * @param {object} [options.headers] - an object with additional headers to send
   * @param {object} [options.options] - properties to pass to fetch options according to `RequestInit`
   * @param {function} [callback] - callback as (err, data, info) where info is an object { status, headers, type }
   *
   * @example
   * app.fetch("http://api.host.com/user/123", (err, data, info) => {
   *    if (info.status == 200) console.log(data, info);
   * });
   * @memberof app
   */
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
  /**
   * Promisified {@link app.fetch} which returns a Promise, all exceptions are passed to the reject handler, no need to use try..catch
   * Return everything in an object `{ ok, status, err, data, info }`.
   * @example
   * const { err, data } = await app.afetch("https://localhost:8000")
   *
   * const { ok, err, status, data } = await app.afetch("https://localhost:8000")
   * if (!ok) console.log(status, err);
   *
   * @param {string|object} options
   * @memberof app
   * @async
   */
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

  // builds/cdn.js
  window.app = src_default;
})();
