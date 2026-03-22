(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/index.js
  var src_exports = {};
  __export(src_exports, {
    $: () => $,
    $all: () => $all,
    $append: () => $append,
    $attr: () => $attr,
    $data: () => $data,
    $elem: () => $elem,
    $empty: () => $empty,
    $event: () => $event,
    $off: () => $off,
    $on: () => $on,
    $param: () => $param,
    $parse: () => $parse,
    $ready: () => $ready,
    AlpineComponent: () => AlpineComponent,
    AlpinePlugin: () => AlpinePlugin,
    Component: () => component_default,
    __: () => __,
    app: () => app,
    call: () => call,
    default: () => src_default,
    emit: () => emit,
    escape: () => escape,
    fetch: () => fetch,
    fetchOptions: () => fetchOptions,
    isArray: () => isArray,
    isElement: () => isElement,
    isFunction: () => isFunction,
    isNumber: () => isNumber,
    isObject: () => isObject,
    isString: () => isString,
    log: () => log,
    noop: () => noop,
    off: () => off,
    on: () => on,
    once: () => once,
    only: () => only,
    parsePath: () => parsePath,
    register: () => register,
    render: () => render,
    resolve: () => resolve,
    restorePath: () => restorePath,
    savePath: () => savePath,
    start: () => start,
    stylePlugin: () => stylePlugin,
    toCamel: () => toCamel,
    toNumber: () => toNumber,
    trace: () => trace
  });

  // src/app.js
  /**
   * Global application object
   * @namespace app
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
     * @var {string} - Specifies a fallback component for unrecognized paths on initial load, it is used by {@link restorePath}.
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
    /** @var {function}  - see {@link isFunction} */
    isF: isFunction,
    /** @var {function}  - see {@link isString} */
    isS: isString,
    /** @var {function}  - see {@link isElement} */
    isE: isElement,
    /** @var {function}  - see {@link isObject} */
    isO: isObject,
    /** @var {function}  - see {@link isNumber} */
    isN: isNumber,
    /** @var {function}  - see {@link isArray} */
    isA: isArray,
    toCamel,
    toNumber,
    call,
    escape,
    noop,
    log,
    trace,
    __
  };
  /**
   * Empty function
   */
  function noop() {
  }
  /**
     * if __app.debug__ is set then it will log arguments in the console otherwise it is no-op
     * @param {...any} args
     */
  function trace(...args) {
    app.debug && app.log(...args);
  }
  /**
   * Alias to console.log
   */
  function log(...args) {
    console.log(...args);
  }
  /**
   * Empty locale translator
   * @param {...any} args
   * @returns {string}
   */
  function __(...args) {
    return args.join("");
  }
  /**
   * Returns the array if the value is non empty array or dflt value if given or undefined
   * @param {any} val
   * @returns {any|any[]}
   */
  function isArray(val, dflt) {
    return Array.isArray(val) && val.length ? val : dflt;
  }
  /**
   * Returns the num itself if it is a number
   * @param {any} num
   * @returns {number|undefined}
   */
  function isNumber(num) {
    return typeof num == "number" ? num : void 0;
  }
  /**
   * Returns the str itself if it is not empty or ""
   * @param {any} str
   * @returns {string}
   */
  function isString(str) {
    return typeof str == "string" && str;
  }
  /**
   * Returns the callback is it is a function
   * @param {any} callback
   * @returns {function|undefined}
   */
  function isFunction(callback) {
    return typeof callback == "function" && callback;
  }
  /**
   * Returns the obj itself if it is a not null object
   * @param {any} obj
   * @returns {object|undefined}
   */
  function isObject(obj) {
    return typeof obj == "object" && obj;
  }
  /**
   * Returns the element itself if it is a HTMLElement
   * @param {any} element
   * @returns {HTMLElement|undefined}
   */
  function isElement(element) {
    return element instanceof HTMLElement && element;
  }
  /**
   * Convert a string into camelized format
   * @param {string} str
   * @returns {string}
   */
  function toCamel(str) {
    return isString(str) ? str.toLowerCase().replace(/[.:_-](\w)/g, (_, c) => c.toUpperCase()) : "";
  }
  /**
   * Safe convertion to a number, no expections, uses 0 instead of NaN, handle booleans, if float specified, returns as float.
   * @param {any} val - to be converted to a number
   * @param {object} [options]
   * @param {int} [options.dflt] - default value
   * @param {int} [options.float] - treat as floating number
   * @param {int} [options.min] - minimal value, clip
   * @param {int} [options.max] - maximum value, clip
   * @param {int} [options.incr] - a number to add before checking for other conditions
   * @param {int} [options.mult] - a number to multiply before checking for other conditions
   * @param {int} [options.novalue] - replace this number with default
   * @param {int} [options.zero] - replace with this number if result is 0
   * @param {int} [options.digits] - how many digits to keep after the floating point
   * @param {int} [options.bigint] - return BigInt if not a safe integer
   * @param {int} [options.base=10] - base of the input, 2, 10, 16, ...
   * @return {number}
   * @example
   * toNumber("123")
   * 123
   * toNumber("1.23", { float: 1, dflt: 0, min: 0, max: 2 })
   * 1.23
   */
  function toNumber(val, options) {
    var n = 0;
    if (typeof val == "number") {
      n = val;
    } else if (typeof val == "boolean") {
      n = val ? 1 : 0;
    } else {
      if (typeof val != "string") {
        n = options?.dflt || 0;
      } else {
        var f = typeof options?.float == "undefined" || options?.float == null ? /^(-|\+)?([0-9]+)?\.[0-9]+$/.test(val) : options?.float;
        n = val[0] == "t" ? 1 : val[0] == "f" ? 0 : val == "infinity" ? Infinity : f ? parseFloat(val, options?.base || 10) : parseInt(val, options?.base || 10);
      }
    }
    n = isNaN(n) ? options?.dflt || 0 : n;
    if (options) {
      if (typeof options.novalue == "number" && n === options.novalue) n = options.dflt || 0;
      if (typeof options.incr == "number") n += options.incr;
      if (typeof options.mult == "number") n *= options.mult;
      if (isNaN(n)) n = options.dflt || 0;
      if (typeof options.min == "number" && n < options.min) n = options.min;
      if (typeof options.max == "number" && n > options.max) n = options.max;
      if (typeof options.float != "undefined" && !options.float) n = Math.round(n);
      if (typeof options.zero == "number" && !n) n = options.zero;
      if (typeof options.digits == "number") n = parseFloat(n.toFixed(options.digits));
      if (options.bigint && typeof n == "number" && !Number.isSafeInteger(n)) n = BigInt(n);
    }
    return n;
  }
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
  function call(obj, method, ...args) {
    if (isFunction(obj)) return obj(method, ...args);
    if (typeof obj != "object") return;
    if (isFunction(method)) return method.call(obj, ...args);
    if (obj && isFunction(obj[method])) return obj[method].call(obj, ...args);
  }
  var _entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
  /**
   * Convert common special symbols into xml entities
   * @param {string} str
   * @returns {string}
   */
  function escape(str) {
    if (typeof str != "string") return "";
    return str.replace(/([&<>'":])/g, (_, x) => _entities[x] || x);
  }

  // src/events.js
  var _events = {};
  /**
   * Listen on event, the callback is called synchronously, optional namespace allows deleting callbacks later easier by not providing
   * exact function by just namespace.
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  function on(event, callback, namespace) {
    if (!isFunction(callback)) return;
    if (!_events[event]) _events[event] = [];
    _events[event].push([callback, isString(namespace)]);
  }
  /**
   * Listen on event, the callback is called only once
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  function once(event, callback, namespace) {
    if (!isFunction(callback)) return;
    const cb = (...args) => {
      off(event, cb);
      callback(...args);
    };
    on(event, cb, namespace);
  }
  /**
   * Remove all current listeners for the given event, if a callback is given make it the **only** listener.
   * @param {string} event
   * @param {function} callback
   * @param {string} [namespace]
   */
  function only(event, callback, namespace) {
    _events[event] = isFunction(callback) ? [callback, isString(namespace)] : [];
  }
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
  function off(event, callback) {
    if (event && callback) {
      if (!_events[event]) return;
      const i = isFunction(callback) ? 0 : isString(callback) ? 1 : -1;
      if (i >= 0) _events[event] = _events[event].filter((x) => x[i] !== callback);
    } else if (isString(event)) {
      for (const ev in _events) {
        _events[ev] = _events[ev].filter((x) => x[1] !== event);
      }
    }
  }
  /**
   * Send an event to all listeners at once, one by one.
   *
   * If the event ends with **_:*_** it means notify all listeners that match the beginning of the given pattern, for example:
   * @param {string} event
   * @param {...any} args
   * @example <caption>notify topic:event1, topic:event2, ...</caption>
   * app.emit("topic:*",....)
   */
  function emit(event, ...args) {
    trace("emit:", event, ...args, app.debug > 1 && _events[event]);
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
  }

  // src/dom.js
  /**
   * Returns a query parameter value from the current document location
   * @param {string} name
   * @param {string} [dflt]
   * @return {string}
   */
  function $param(name, dflt) {
    return new URLSearchParams(location.search).get(name) || dflt || "";
  }
  var esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
  /**
   * An alias to **document.querySelector**, doc can be an Element, empty or non-string selectors will return null
   * @param {string} selector
   * @param {HTMLElement} [doc]
   * @returns {null|HTMLElement}
   * @example
   * var el = app.$("#div")
   */
  function $(selector, doc) {
    return isString(selector) ? (isElement(doc) || document).querySelector(esc(selector)) : null;
  }
  /**
   * An alias for **document.querySelectorAll**
   * @param {string} selector
   * @param {HTMLElement} [doc]
   * @returns {null|HTMLElement[]}
   * @example
   * Array.from(app.$all("input")).find((el) => !(el.readOnly || el.disabled || el.type == "hidden"));
   */
  function $all(selector, doc) {
    return isString(selector) ? (isElement(doc) || document).querySelectorAll(esc(selector)) : null;
  }
  /**
   * Send a CustomEvent using DispatchEvent to the given element, true is set to composed, cancelable and bubbles properties.
   * @param {HTMLElement} element
   * @param {string} name
   * @param {object} [detail]
   */
  function $event(element, name, detail = {}) {
    return element instanceof EventTarget && element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable: true }));
  }
  /**
   * An alias for **element.addEventListener**
   * @param {HTMLElement} element
   * @param {string} event
   * @param {function} callback
   * @param {any} [...args] - additional params to addEventListener
   * @example
   * app.$on(window, "popstate", () => { ... })
   */
  function $on(element, event, callback, ...arg) {
    return isFunction(callback) && element.addEventListener(event, callback, ...arg);
  }
  /**
   * An alias for **element.removeEventListener**
   * @param {HTMLElement} element
   * @param {string} event
   * @param {function} callback
   * @param {any} [...args] - additional params to removeEventListener
   */
  function $off(element, event, callback, ...arg) {
    return isFunction(callback) && element.removeEventListener(event, callback, ...arg);
  }
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
  function $attr(element, attr, value) {
    if (isString(element)) element = $(element);
    if (!isElement(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  }
  /**
   * Remove all nodes from the given element, call the cleanup callback for each node if given
   * @param {HTMLElement|string} element
   * @param {functions} [cleanup]
   * @returns {HTMLElement}
   */
  function $empty(element, cleanup) {
    if (isString(element)) element = $(element);
    if (!isElement(element)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
      call(cleanup, node);
    }
    return element;
  }
  /**
   * Create a DOM element with attributes, **-name** means **style.name**, **.name** means a property **name**,
   * all other are attributes, functions are event listeners
   * @param {string} name
   * @param {any|object} [...args]
   * @param {object} [options]
   * @example
   * $elem("div", "id", "123", "-display", "none", "._x-prop", "value", "click", () => {})
   *
   * @example <caption>Similar to above but all properties and attributes are taken from an object, in this form options can be passed, at the moment only
   * options for addEventListener are supported.</caption>
   *
   * $elem("div", { id: "123", "-display": "none", "._x-prop": "value", click: () => {} }, { signal })
   */
  function $elem(name, ...args) {
    var element = document.createElement(name), key, val, opts;
    if (isObject(args[0])) {
      args = Object.entries(args[0]).flatMap((x) => x);
      opts = args[1];
    }
    for (let i = 0; i < args.length - 1; i += 2) {
      key = args[i], val = args[i + 1];
      if (!isString(key)) continue;
      if (isFunction(val)) {
        $on(element, key, val, { capture: opts?.capture, passive: opts?.passive, once: opts?.once, signal: opts?.signal });
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
  }
  /**
   * A shortcut to DOMParser, default is to return the .body.
   * @param {string} html
   * @param {string} [format] - defines the result format:
   *  - list - the result will be an array with all body child nodes, i.e. simpler to feed it to Element.append()
   *  - doc - return the whole parsed document
   * @example
   * document.append(...$parse("<div>...</div>"), 'list'))
   */
  function $parse(html, format) {
    html = new window.DOMParser().parseFromString(html || "", "text/html");
    return format === "doc" ? html : format === "list" ? Array.from(html.body.childNodes) : html.body;
  }
  /**
   * Append nodes from the template to the given element, call optional setup callback for each node.
   * @param {string|HTMLElement} element
   * @param {string|HTMLElement} template can be a string with HTML or a template element.
   * @param {function} [setup]
   * @example
   * app.$append(document, "<div>...</div>")
   */
  function $append(element, template, setup) {
    if (isString(element)) element = $(element);
    if (!isElement(element)) return;
    let doc;
    if (isString(template)) {
      doc = $parse(template, "doc");
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
      if (setup && node.nodeType == 1) call(setup, node);
    }
    return element;
  }
  var _ready = [];
  /**
   * Run callback once the document is loaded and ready, it uses setTimeout to schedule callbacks
   * @param {function} callback
   * @example
   * app.$ready(() => {
   *
   * })
   */
  function $ready(callback) {
    _ready.push(callback);
    if (document.readyState == "loading") return;
    while (_ready.length) setTimeout(call, 0, _ready.shift());
  }
  $on(window, "DOMContentLoaded", () => {
    while (_ready.length) setTimeout(call, 0, _ready.shift());
  });
  function domChanged() {
    var w = document.documentElement.clientWidth;
    emit("dom:changed", {
      breakPoint: w < 576 ? "xs" : w < 768 ? "sm" : w < 992 ? "md" : w < 1200 ? "lg" : w < 1400 ? "xl" : "xxl",
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    });
  }
  $ready(() => {
    domChanged();
    $on(window.matchMedia("(prefers-color-scheme: dark)"), "change", domChanged);
    var _resize;
    $on(window, "resize", () => {
      clearTimeout(_resize);
      _resize = setTimeout(domChanged, 250);
    });
  });

  // src/render.js
  var _plugins = {};
  var _default_plugin;
  /**
   * Register a render plugin, at least 2 functions must be defined in the options object:
   * @param {string} name
   * @param {object} options
   * @param {function} render - (element, options) to show a component, called by {@link render}
   * @param {function} cleanup - (element) - optional, run additional cleanups before destroying a component
   * @param {function} data - (element) - return the component class instance for the given element or the main
   * @param {boolean} [options.default] - if not empty make this plugin default
   * @param {class} [options.Component] - optional base component constructor, it will be registered as
   * app.{Type}Component, like AlpineComponent, KoComponent,... to easy create custom components in CDN mode
   *
   * The reason for plugins is that while this is designed for Alpine.js, the idea originated by using Knockout.js with this system,
   * the plugin can be found at [app.ko.js](https://github.com/vseryakov/backendjs/blob/c97ca152dfd55a3841d07b54701e9d2b8620c516/web/js/app.ko.js).
   *
   * There is a simple plugin in examples/simple.js to show how to use it without any rendering engine with vanillla HTML, not very useful though.
   */
  function register(name, options) {
    if (!name || !isString(name)) throw Error("type must be defined");
    if (options) {
      for (const p of ["render", "cleanup", "data"]) {
        if (options[p] && !isFunction(options[p])) throw Error(p + " must be a function");
      }
      if (isFunction(options?.Component)) {
        app[toCamel(`_${name}_component`)] = options.Component;
      }
    }
    var plugin = _plugins[name] = _plugins[name] || {};
    if (options?.default) _default_plugin = plugin;
    return Object.assign(plugin, options);
  }
  /**
   * Return component data instance for the given element or the main component if omitted. This is for
   * debugging purposes or cases when calling some known method is required.
   * @param {string|HTMLElement} element
   * @param {number} [level] - if is not a number then the closest scope is returned otherwise only the requested scope at the level or undefined.
   * This is useful for components to make sure they use only the parent's scope for example.
   *
   * @returns {Proxy|undefined} to get the actual object pass it to **Alpine.raw(app.$data())**
   */
  function $data(element, level) {
    if (isString(element)) element = $(element);
    for (const p in _plugins) {
      if (!_plugins[p].data) continue;
      const d = _plugins[p].data(element, level);
      if (d) return d;
    }
  }
  /**
   * Returns an object with **template** and **component** properties.
   *
   * Calls {@link parsePath} first to resolve component name and params.
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
  function resolve(path, dflt) {
    const tmpl = parsePath(path);
    trace("resolve:", path, dflt, tmpl);
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
  }
  /**
   * Show a component, options can be a string to be parsed by {@link parsePath} or an object with { name, params } properties.
   * if no **params.$target** provided a component will be shown inside the main element defined by {@link $target}.
   *
   * It returns the resolved component as described in {@link resolve} method after rendering or nothing if nothing was shown.
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
  function render(options, dflt) {
    var tmpl = resolve(options, dflt);
    if (!tmpl) return;
    var params = tmpl.params = Object.assign(tmpl.params || {}, options?.params);
    params.$target = options.$target || params.$target || app.$target;
    trace("render:", options, tmpl.name, tmpl.params);
    const element = isElement(params.$target) || $(params.$target);
    if (!element) return;
    var plugin = tmpl.component?.$type || options?.plugin || params.$plugin;
    plugin = _plugins[plugin] || _default_plugin;
    if (!plugin?.render) return;
    if (params.$target == app.$target) {
      var ev = { name: tmpl.name, params };
      emit(app.event, "prepare:delete", ev);
      if (ev.stop) return;
      var plugins = Object.values(_plugins);
      for (const p of plugins.filter((x) => x.cleanup)) {
        call(p.cleanup, element);
      }
      if (!(options?.$nohistory || params.$nohistory || tmpl.component?.$nohistory || app.$nohistory)) {
        queueMicrotask(() => {
          emit("path:save", tmpl);
        });
      }
    }
    emit("component:render", tmpl);
    plugin.render(element, tmpl);
    return tmpl;
  }
  /**
   * Add a callback to process classes for new components, all registered callbacks will be called on component:create
   * event with top HTMLElement as parameter. This is for UI frameworks intergation to apply logic to added elements
   * @param {function} callback
   * @example
   * app.stylePlugin((el) => {
   *     app.$all(".carousel", element).forEach(el => (bootstrap.Carousel.getOrCreateInstance(el)));
   * })
   */
  function stylePlugin(callback) {
    if (isFunction(callback)) _stylePlugins.push(callback);
  }
  var _stylePlugins = [];
  function applyStylePlugins(element) {
    if (!(element instanceof HTMLElement)) return;
    for (const cb of _stylePlugins) cb(element);
  }
  on("alpine:init", () => {
    for (const p in _plugins) {
      call(_plugins[p], "init");
    }
    on("component:create", (ev) => {
      if (isElement(ev?.element)) applyStylePlugins(ev.element);
    });
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
  function parsePath(path) {
    var rc = { name: "", params: {} }, query, loc = window.location;
    if (isObject(path)) return Object.assign(rc, path);
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
  }
  /**
   * Saves the given component in the history as ** /name/param1/param2/param3/.. **
   *
   * It is called on every **component:create** event for main components as a microtask,
   * meaning immediate callbacks have a chance to modify the behaviour.
   * @param {Object} options
   *
   */
  function savePath(options) {
    if (isString(options)) options = { name: options };
    if (!options?.name) return;
    var path = [options.name];
    if (options?.params) {
      for (let i = 1; i < 7; i++) path.push(options.params[`param${i}`] || "");
    }
    while (!path.at(-1)) path.length--;
    path = path.join("/");
    trace("savePath:", path, options);
    if (!path) return;
    emit("path:push", window.location.origin + app.base + path);
    window.history.pushState(null, "", window.location.origin + app.base + path);
  }
  /**
   * Show a component by path, it is called on **path:restore** event by default from {@link start} and is used
   * to show first component on initial page load. If the path is not recognized or no component is
   * found then the default {@link index} component is shown.
   * @param {string} path
   */
  function restorePath(path) {
    trace("restorePath:", path, app.index);
    render(path, app.index);
  }
  /**
   * Setup default handlers:
   * - on **path:restore** event call {@link restorePath} to render a component from the history
   * - on **path:save** call {@link savePath} to save the current component in the history
   * - on page ready call {@link restorePath} to render the initial page
   *
   * **If not called then no browser history will not be handled, up to the app to do it some other way.**. One good
   * reason is to create your own handlers to build different path and then save/restore.
   */
  function start() {
    on("path:save", savePath);
    on("path:restore", restorePath);
    $ready(restorePath.bind(app, window.location.href));
  }
  $on(window, "popstate", () => emit("path:restore", window.location.href));

  // src/fetch.js
  /**
   * Global object to customize {@link fetch}
   * @example <caption>make POST default method</caption>
   * fetchOptions.method = "POST"
   * await fetch("url.com")
   */
  var fetchOptions = {
    method: "GET",
    cache: "default",
    headers: {}
  };
  function parseOptions(url, options) {
    const headers = options?.headers || {};
    const opts = Object.assign({
      headers,
      method: options?.method || options?.post && "POST" || void 0
    }, options?.request);
    for (const p in fetchOptions.headers) {
      headers[p] ??= fetchOptions.headers[p];
    }
    for (const p of ["method", "cache", "credentials", "duplex", "integrity", "keepalive", "mode", "priority", "redirect", "referrer", "referrerPolicy", "signal"]) {
      if (fetchOptions[p] !== void 0) {
        opts[p] ??= fetchOptions[p];
      }
    }
    var body = options?.body;
    if (opts.method == "GET" || opts.method == "HEAD") {
      if (isObject(body)) {
        url += "?" + new URLSearchParams(body).toString();
      }
    } else if (isString(body)) {
      opts.body = body;
      headers["content-type"] ??= "application/x-www-form-urlencoded; charset=UTF-8";
    } else if (body instanceof FormData) {
      opts.body = body;
      delete headers["content-type"];
    } else if (isObject(body)) {
      opts.body = JSON.stringify(body);
      headers["content-type"] = "application/json; charset=UTF-8";
    } else if (body) {
      opts.body = body;
      headers["content-type"] ??= "application/octet-stream";
    }
    return [url, opts];
  }
  function parseResponse(res) {
    const info = { status: res.status, headers: {}, type: res.type, url: res.url, redirected: res.redirected };
    for (const h of res.headers) {
      info.headers[h[0].toLowerCase()] = h[1];
    }
    const h_csrf = fetchOptions.csrfHeader || "x-csrf-token";
    const v_csrf = info?.headers[h_csrf];
    if (v_csrf) {
      if (v_csrf <= 0) {
        delete fetchOptions.headers[h_csrf];
      } else {
        fetchOptions.headers[h_csrf] = v_csrf;
      }
    }
    return info;
  }
  /**
   * Fetch remote content, wrapper around Fetch API
   *
   * __NOTE: Saves X-CSRF-Token header and sends it back with subsequent requests__
   * @param {string} url - URL to fetch
   * @param {object} [options]
   * @param {string} [options.method] - GET, POST,...GET is default or from app.fetchOptions.method
   * @param {boolean} [options.post] - set method to POST
   * @param {string|object|FormData} [options.body] - a body accepted by window.fetch
   * @param {string} [options.dataType] - explicit return type: text, blob, default is auto detected between text or json
   * @param {object} [options.headers] - an object with additional headers to send, all global headers from app.fetchOptions.headers also are merged
   * @param {object} [options.request] - properties to pass to fetch options according to Web API `RequestInit`
   * @param {function} [callback] - callback as (err, data, info) where info is an object { status, headers, type }
   * @async
   * @example
   * fetch("http://api.host.com/user/123", (err, data, info) => {
   *    if (info.status == 200) console.log(data, info);
   * });
   *
   * const { err, data } = await fetch("https://localhost:8000")
   *
   * const { ok, err, status, data } = await fetch("https://localhost:8000")
   * if (!ok) console.log(status, err);
   */
  async function fetch(url, options, callback) {
    if (isFunction(options)) callback = options, options = null;
    try {
      const [uri, opts] = parseOptions(url, options);
      trace("fetch:", uri, opts, options);
      var data2, info;
      const res = await window.fetch(uri, opts);
      info = parseResponse(res);
      var ctype = info.headers["content-type"];
      if (!res.ok) {
        let err;
        if (/\/json/.test(ctype)) {
          const d = await res.json();
          err = { status: res.status };
          for (const p in d) err[p] = d[p];
        } else {
          err = { message: await res.text(), status: res.status };
        }
        throw err;
      }
      switch (options?.dataType) {
        case "text":
          data2 = await res.text();
          break;
        case "blob":
          data2 = await res.blob();
          break;
        default:
          data2 = /\/json/.test(ctype) ? await res.json() : /image|video|audio|pdf|zip|binary|octet/.test(ctype) ? await res.blob() : await res.text();
      }
      call(callback, null, data2, info);
      return { ok: true, status: info?.status, data: data2, info };
    } catch (err) {
      call(callback, err);
      return { ok: false, status: info?.status, err, data: data2, info };
    }
  }

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
      trace("init:", this.$type, this.$name);
      Object.assign(this.params, params);
      emit("component:create", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      if (!this.params.$noevents) {
        on(app.event, this._handleEvent);
      }
      call(this._onCreate?.bind(this, this.params));
    }
    /**
     * Called when a component is about to be destroyed, calls __onDelete__ class method for custom cleanup
     */
    destroy() {
      trace("destroy:", this.$type, this.$name);
      off(app.event, this._handleEvent);
      emit("component:delete", { type: this.$type, name: this.$name, component: this, element: this.$el, params: this.params });
      call(this._onDelete?.bind(this));
      this.params = {};
      delete this.$root;
    }
  };
  function handleEvent(event, ...args) {
    if (this.onEvent) {
      trace("event:", this.$type, this.$name, event, ...args);
      call(this.onEvent?.bind(this.$data || this), event, ...args);
    }
    if (!isString(event)) return;
    var method = toCamel("on_" + event);
    if (!this[method]) return;
    trace("event:", this.$type, this.$name, method, ...args);
    call(this[method]?.bind(this.$data || this), ...args);
  }
  var component_default = Component;

  // src/alpine.js
  var _alpine = "alpine";
  var _Alpine;
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
        _render(this, this.localName.substr(4));
      });
    }
  };
  function _render(element, options) {
    if (isString(options)) {
      options = resolve(options);
      if (!options) return;
    }
    $empty(element);
    element._x_params = Object.assign({}, options.params);
    _Alpine.onElRemoved(element, () => {
      delete element._x_params;
    });
    if (!options.component) {
      _Alpine.mutateDom(() => {
        $append(element, options.template, _Alpine.initTree);
      });
    } else {
      _Alpine.data(options.name, () => new options.component(options.name));
      const node = $elem("div", "x-data", options.name);
      $append(node, options.template);
      _Alpine.mutateDom(() => {
        element.appendChild(node);
        _Alpine.initTree(node);
      });
    }
    return options;
  }
  function data(element, level) {
    if (!isElement(element)) element = $(app.$target + " div");
    if (!element) return;
    if (typeof level == "number") return element._x_dataStack?.at(level);
    return _Alpine.closestDataStack(element)[0];
  }
  function init() {
    for (const [name, obj] of Object.entries(app.components)) {
      const tag = `app-${obj?.$tag || name}`;
      if (obj?.$type != _alpine || customElements.get(tag)) continue;
      customElements.define(tag, class extends Element {
      });
      _Alpine.data(name, () => new obj(name));
    }
  }
  function $render(el, value, modifiers, callback) {
    const cache = modifiers.includes("cache");
    const opts = { post: modifiers.includes("post") };
    if (!value.url && !(!cache && /^(https?:\/\/|\/|.+\.html(\?|$)).+/.test(value))) {
      if (callback(el, value)) return;
    }
    fetch(value, opts, (err, text, info) => {
      if (err || !isString(text)) {
        return console.warn("$render: Text expected from", value, "got", err, text);
      }
      const tmpl = isString(value) ? parsePath(value) : value;
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
            var scope = _Alpine.$data(el);
            if (!isObject(scope[modifiers[i + 1]])) break;
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
      tmpl = resolve(tmpl);
      if (!tmpl) return;
      if (!_render(el2, toMods(tmpl))) return;
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
  register(_alpine, { render: _render, Component: AlpineComponent, data, init, default: 1 });
  function AlpinePlugin(Alpine2) {
    _Alpine = Alpine2;
    emit("alpine:init");
    Alpine2.magic("app", (el) => app);
    Alpine2.magic("params", (el) => {
      while (el) {
        if (el._x_params) return el._x_params;
        el = el.parentElement;
      }
    });
    Alpine2.magic("component", (el) => Alpine2.closestDataStack(el).find((x) => x.$type == _alpine && x.$name));
    Alpine2.magic("parent", (el) => Alpine2.closestDataStack(el).filter((x) => x.$type == _alpine && x.$name)[1]);
    Alpine2.directive("render", (el, { modifiers, expression }, { evaluate, cleanup }) => {
      const click = (e) => {
        const value = evaluate(expression);
        if (!value) return;
        e.preventDefault();
        if (modifiers.includes("stop")) {
          e.stopPropagation();
        }
        $render(el, value, modifiers, (el2, tmpl) => render(tmpl));
      };
      $on(el, "click", click);
      el.style.cursor = "pointer";
      cleanup(() => {
        $off(el, "click", click);
      });
    });
    Alpine2.directive("template", (el, { modifiers, expression }, { effect, cleanup }) => {
      const evaluate = Alpine2.evaluateLater(el, expression);
      var template;
      const empty = () => {
        template = null;
        Alpine2.mutateDom(() => {
          $empty(el, (node) => Alpine2.destroyTree(node));
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
    Alpine2.directive("scope-level", (el, { expression }, { evaluate }) => {
      const scope = Alpine2.closestDataStack(el);
      el._x_dataStack = scope.slice(0, parseInt(evaluate(expression || "")) || 0);
    });
    Alpine2.directive("file-drop", (el, { expression }, { evaluate, cleanup }) => {
      const target = evaluate(expression);
      var current = null;
      $on(el, "click", click);
      $on(el, "drop", drop);
      $on(el, "dragdrop", drop);
      $on(el, "dragenter", dragenter);
      $on(el, "dragover", dragenter);
      $on(el, "dragleave", dragleave);
      cleanup(() => {
        $off(el, "click", click);
        $off(el, "drop", drop);
        $off(el, "dragdrop", drop);
        $off(el, "dragenter", dragenter);
        $off(el, "dragover", dragenter);
        $off(el, "dragleave", dragleave);
      });
      function click(event) {
        $('[type="file"]', el).click();
      }
      function drop(event) {
        event.preventDefault();
        var file = event.dataTransfer.files?.[0];
        $event(el, "file:dropped", { file, event });
        emit(app.event, "file:dropped", { file, event, target, element: el });
        target._dragging = false;
        current = null;
      }
      function dragenter(event) {
        event.preventDefault();
        current = event.target;
        target._dragging = true;
      }
      function dragleave(event) {
        event.preventDefault();
        if (event.target === current) {
          target._dragging = false;
        }
      }
    });
    Alpine2.directive("draggable", (el, { expression }, { evaluate, cleanup }) => {
      const target = evaluate(expression);
      var current = null;
      $on(el, "drop", drop);
      $on(el, "dragdrop", drop);
      $on(el, "dragstart", dragstart);
      $on(el, "dragend", dragend);
      $on(el, "dragenter", dragenter);
      $on(el, "dragover", dragenter);
      $on(el, "dragleave", dragleave);
      cleanup(() => {
        $off(el, "drop", drop);
        $off(el, "dragdrop", drop);
        $off(el, "dragstart", dragstart);
        $off(el, "dragend", dragend);
        $off(el, "dragenter", dragenter);
        $off(el, "dragover", dragenter);
        $off(el, "dragleave", dragleave);
      });
      function dragenter(event) {
        event.preventDefault();
        if (el === current) return;
        target._dragging = true;
      }
      function dragleave(event) {
        event.preventDefault();
        if (el === current) return;
        target._dragging = false;
      }
      function dragstart(event) {
        current = el;
        event.dataTransfer.effectAllowed = "move";
      }
      function dragend() {
        target._dragging = false;
        current = null;
      }
      function drop(event) {
        event.preventDefault();
        target._dragging = false;
        if (el === current || !current) return;
        current = null;
        $event(el, "item:dropped", { item: current });
        emit(app.event, "item:dropped", { event, item: current, element: el });
      }
    });
  }

  // src/index.js
  app.Component = component_default;
  var src_default = app;

  // builds/cdn.js
  Object.assign(app, src_exports);
  window.app = app;
  $on(document, "alpine:init", () => {
    AlpinePlugin(Alpine);
  });

  // src/lib.js
  var lib_exports = {};
  __export(lib_exports, {
    forEach: () => forEach,
    forEachSeries: () => forEachSeries,
    isFlag: () => isFlag,
    loadResources: () => loadResources,
    parallel: () => parallel,
    sanitizer: () => sanitizer,
    sendFile: () => sendFile,
    series: () => series,
    split: () => split,
    toDate: () => toDate,
    toDuration: () => toDuration,
    toPrice: () => toPrice,
    toSize: () => toSize,
    toTitle: () => toTitle
  });
  /**
   * @param {any[]} list
   * @param {any|any[]} item
   * @return {boolean} true if `item` exists in the array `list`, search is case sensitive. if `item` is an array it will return true if
   * any element in the array exists in the `list`.
   */
  function isFlag(list, item) {
    return Array.isArray(list) && (Array.isArray(item) ? item.some((x) => list.includes(x)) : list.includes(item));
  }
  /**
   * Apply an iterator function to each item in an array serially. Execute a callback when all items
   * have been completed or immediately if there is is an error provided.
   * @param {any[]} list
   * @param {function} iterator
   * @param {function} [callback]
   * @param {boolean} [direct=true]
   * @example
   * forEachSeries([ 1, 2, 3 ], function (i, next, data) {
   *    console.log(i, data);
   *    next(null, data);
   * }, (err, data) => {
   *    console.log('done', data);
   * });
   */
  function forEachSeries(list, iterator, callback, direct = true) {
    callback = isFunction(callback) || noop;
    if (!Array.isArray(list) || !list.length) return callback();
    function iterate(i, ...args) {
      if (i >= list.length) return direct ? callback(null, ...args) : setTimeout(callback, 0, null, ...args);
      iterator(list[i], (...args2) => {
        if (args2[0]) {
          if (direct) callback(...args2);
          else setTimeout(callback, 0, ...args2);
          callback = noop;
        } else {
          iterate(++i, ...args2.slice(1));
        }
      }, ...args);
    }
    iterate(0);
  }
  /**
   * Execute a list of functions serially and execute a callback upon completion or occurance of an error. Each function will be passed
   * a callback to signal completion. The callback accepts either an error for the first argument in which case the flow will be aborted
   * and the final callback will be called immediately or some optional data to be passed to thr next iterator function as a second argument.
   *
   * The iterator and callback will be called via setImmediate function to allow the main loop to process I/O unless the `direct` argument is true
   * @param {function[]} tasks
   * @param {function} [callback]
   * @param {boolean} [direct]
   * @example
   * series([
   *    function(next) {
   *        next(null, "data");
   *    },
   *    function(next, data) {
   *       setTimeout(function () { next(null, data); }, 100);
   *    },
   * ], (err, data) => {
   *    console.log(err, data);
   * });
   */
  function series(tasks, callback, direct = true) {
    forEachSeries(tasks, (task, next, ...args) => {
      if (direct) task(next, ...args);
      else setTimeout(task, 0, next, ...args);
    }, callback, direct);
  }
  /**
   * Apply an iterator function to each item in an array in parallel. Execute a callback when all items
   * have been completed or immediately if there is an error provided.
   * @param {any[]} list
   * @param {function} iterator
   * @param {function} callback
   * @param {boolean} direct - controls how the final callback is called, if true it is called directly otherwisde via setImmediate
   * @example
   * forEach([ 1, 2, 3 ], function (i, next) {
   *   console.log(i);
   *   next();
   * }, (err) => {
   *   console.log('done');
   * });
   */
  function forEach(list, iterator, callback, direct = true) {
    callback = isFunction(callback) || noop;
    if (!Array.isArray(list) || !list.length) return callback();
    var count = list.length;
    for (let i = 0; i < list.length; i++) {
      iterator(list[i], (err) => {
        if (err) {
          if (direct) callback(err);
          else setTimeout(callback, 0, err);
          callback = noop;
          i = list.length + 1;
        } else if (--count == 0) {
          if (direct) callback();
          else setTimeout(callback, 0);
          callback = noop;
        }
      });
    }
  }
  /**
   * Execute a list of functions in parallel and execute a callback upon completion or occurance of an error. Each function will be passed
   * a callback to signal completion. The callback accepts an error for the first argument. The iterator and callback will be
   * called via setImmediate function to allow the main loop to process I/O unless the `direct` argument is true
   * @param {function[]} tasks
   * @param {function} [callback]
   * @param {boolean} [direct=true]
   */
  function parallel(tasks, callback, direct = true) {
    forEach(tasks, (task, next) => {
      task(next);
    }, callback, direct);
  }
  /**
   * Return Date object for given text or numeric date representation, for invalid date returns 1969 unless `invalid` parameter is given,
   * in this case invalid date returned as null. If `dflt` is NaN, null or 0 returns null as well.
   * @param {string|Date|number} val
   * @param {any} [dflt]
   * @param {boolean} [invalid]
   * @return {Date}
   */
  function toDate(val, dflt, invalid) {
    if (isFunction(val?.getTime)) return val;
    var d = NaN;
    if (isString(val)) {
      val = /^[0-9.]+$/.test(val) ? toNumber(val) : val.replace(/([0-9])(AM|PM)/i, "$1 $2");
    }
    if (isNumber(val)) {
      if (val > 2147485547e3) val = Math.round(val / 1e3);
      if (val < 2147483647) val *= 1e3;
    }
    if (!isString(val) && !isNumber(val)) val = d;
    if (val) try {
      d = new Date(val);
    } catch (e) {
    }
    return !isNaN(d) ? d : invalid || dflt !== void 0 && isNaN(dflt) || dflt === null || dflt === 0 ? null : new Date(dflt || 0);
  }
  /**
   * Return duration in human format, mtime is msecs
   * @param {number} mtime
   * @param {boolean} [age] - if true duration from now, as age
   * @return {string}
   */
  function toDuration(mtime, age) {
    var str = "";
    mtime = isNumber(mtime) ?? toNumber(mtime);
    if (mtime > 0) {
      if (age) mtime = Date.now() - mtime;
      var secs = Math.floor(mtime / 1e3);
      var d = Math.floor(secs / 86400);
      var mm = Math.floor(d / 30);
      var w = Math.floor(d / 7);
      var h = Math.floor((secs - d * 86400) / 3600);
      var m = Math.floor((secs - d * 86400 - h * 3600) / 60);
      var s = Math.floor(secs - d * 86400 - h * 3600 - m * 60);
      if (mm > 0) {
        str = mm > 1 ? __(mm, " months") : __("1 month");
        if (d > 0) str += " " + (d > 1 ? __(d, " days") : __("1 day"));
        if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
      } else if (w > 0) {
        str = w > 1 ? __(w, " weeks") : __("1 week");
        if (d > 0) str += " " + (d > 1 ? __(d, " days") : __("1 day"));
        if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
      } else if (d > 0) {
        str = d > 1 ? __(d, " days") : __("1 day");
        if (h > 0) str += " " + (h > 1 ? __(h, " hours") : __("1 hour"));
        if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
      } else if (h > 0) {
        str = h > 1 ? __(h, " hours") : __("1 hour");
        if (m > 0) str += " " + (m > 1 ? __(m, " minutes") : __("1 minute"));
      } else if (m > 0) {
        str = m > 1 ? __(m, " minutes") : __("1 minute");
        if (s > 0) str += " " + (s > 1 ? __(s, " seconds") : __("1 second"));
      } else {
        str = secs > 1 ? __(secs, " seconds") : __("1 second");
      }
    }
    return str;
  }
  /**
   * Return size human readable format
   * @param {number} size
   * @param {boolean} [decimals=2]
   */
  function toSize(size, decimals = 2) {
    var i = size > 0 ? Math.floor(Math.log(size) / Math.log(1024)) : 0;
    return (size / Math.pow(1024, i)).toFixed(isNumber(decimals) ?? 2) * 1 + " " + [__("Bytes"), __("KBytes"), __("MBytes"), __("GBytes"), __("TBytes")][i];
  }
  /**
   * Convert text into capitalized words, if it is less or equal than minlen leave it as is
   * @param {string} name
   * @param {int} [minlen]
   * @return {string}
   */
  function toTitle(name, minlen) {
    return isString(name) ? minlen > 0 && name.length <= minlen ? name : name.replace(/_/g, " ").split(/[ ]+/).reduce((x, y) => x + y.substr(0, 1).toUpperCase() + y.substr(1) + " ", "").trim() : "";
  }
  /**
   * Return a test representation of a number according to the money formatting rules,
   * @param {number} num
   * @param {object} [options]
   * @param {string} [options.locale=en-US]
   * @param {string} [options.currency=USD]
   * @param {string} [options.display=symbol]
   * @param {string} [options.sign=standard]
   * @param {int} [options.min=2]
   * @param {int} [options.max=3]
   * @method toPrice
   */
  function toPrice(num, options) {
    try {
      return toNumber(num).toLocaleString(options?.locale || "en-US", {
        style: "currency",
        currency: options?.currency || "USD",
        currencyDisplay: options?.display || "symbol",
        currencySign: options?.sign || "standard",
        minimumFractionDigits: options?.min || 2,
        maximumFractionDigits: options?.max || 5
      });
    } catch (e) {
      console.error("toPrice:", e, num, options);
      return "";
    }
  }
  /**
   * Split string into array, ignore empty items by default
   * @param {string} str
   * If str is an array and type is not specified then all non-string items will be returned as is.
   * @param {RegExp|string} [sep=,|] - separator
   * @param {object} [options]
   * @param {boolean} [options.keepempty] - will preserve empty items, by default empty strings are ignored
   * @param {boolean} [options.notrim] - will skip trimming strings, trim is the default
   * @param {int} [options.max] - will skip strings over the specificed size if no `trunc`
   * @param {boolean} [options.trunc] - will truncate strings longer than `max`
   * @param {regexp} [options.regexp] - will skip string if not matching
   * @param {regexp} [options.noregexp] - will skip string if matching
   * @param {boolean} [options.number] - convert into a number
   * @param {boolean} [options.cap] - capitalize
   * @param {boolean} [options.camel] - camelize
   * @param {boolean} [options.lower] - lowercase
   * @param {boolean} [options.upper] - uppercase
   * @param {string|regexp} [options.strip] - remove occurences
   * @param {object} [options.replace] - an object map which characters to replace with new values
   * @param {boolean} [options.range] - will parse numeric ranges in the format `NUM-NUM` and add all numbers in between, invalid ranges are skipped
   * @param {boolean} [options.unique] - remove duplicate entries
   * @return {string[]}
   */
  function split(str, sep, options) {
    if (!str) return [];
    var list = Array.isArray(str) ? str : (isString(str) ? str : String(str)).split(sep || /[,|]/), len = list.length;
    if (!len) return list;
    var rc = [], keys = isObject(options) ? Object.reys(options) : [], v;
    for (let i = 0; i < len; ++i) {
      v = list[i];
      if (v === "" && !options?.keepempty) continue;
      if (!isString(v)) {
        rc.push(v);
        continue;
      }
      if (!options?.notrim) v = v.trim();
      for (let k = 0; k < keys.length; ++k) {
        switch (keys[k]) {
          case "range":
            var dash = v.indexOf("-", 1);
            if (dash == -1) break;
            var s = toNumber(v.substr(0, dash));
            var e = toNumber(v.substr(dash + 1));
            for (; s <= e; s++) rc.push(s.toString());
            v = "";
            break;
          case "max":
            if (v.length > options.max) {
              v = options.trunc ? v.substr(0, options.max) : "";
            }
            break;
          case "regexp":
            if (!options.regexp.test(v)) v = "";
            break;
          case "noregexp":
            if (options.regexp.test(v)) v = "";
            break;
          case "lower":
            v = v.toLowerCase();
            break;
          case "upper":
            v = v.toUpperCase();
            break;
          case "strip":
            v = v.replace(options.strip, "");
            break;
          case "replace":
            for (const p in options.replace) {
              v = v.replaceAll(p, options.replace[p]);
            }
            break;
          case "camel":
            v = toCamel(v, options);
            break;
          case "cap":
            v = toTitle(v, options.cap);
            break;
          case "number":
            v = toNumber(v, options);
            break;
        }
      }
      if (!v.length && !options?.keepempty) continue;
      rc.push(v);
    }
    if (options?.unique) {
      rc = Array.from(new Set(rc));
    }
    return rc;
  }
  /**
   * Inject CSS/Script resources into the current page, all urls are loaded at the same time by default.
   * @param {string[]|string} urls - list of urls to load
   * @param {object} [options]
   * @param {boolean} [options.series] - load urls one after another
   * @paarm {boolean} [options.async] if set then scripts executed as soon as loaded otherwise executing scripts will be in the order provided
   * @param {function} [options.callback] will be called with (el, opts) args for customizations after loading each url or on error
   * @param {object} [options.attrs] is an object with attributes to set like nonce, ...
   * @param {int} [options.timeout] - call the callback after timeout
   */
  function loadResources(urls, options, callback) {
    if (typeof options == "function") callback = options, options = null;
    if (typeof urls == "string") urls = [urls];
    const func = options?.series ? forEachSeries : forEach;
    func(urls, (url, next) => {
      let el;
      const ev = () => {
        call(options?.callback, el, options);
        next();
      };
      if (/\.css/.test(url)) {
        el = $elem("link", "rel", "stylesheet", "type", "text/css", "href", url, "load", ev, "error", ev);
      } else {
        el = $elem("script", "async", !!options?.async, "src", url, "load", ev, "error", ev);
      }
      for (const p in options?.attrs) {
        $attr(el, p, options.attrs[p]);
      }
      document.head.appendChild(el);
    }, options?.timeout > 0 ? () => {
      setTimeout(callback, options.timeout);
    } : callback);
  }
  /**
   * Send file(s) and forms, a wrapper around fetch
   * @param {string} url
   * @param {object} options
   * @param {object} [options.files] - name/File pairs to be sent as multi-part
   * @param {object} [options.body] - simple form properties
   * @param {object} [options.json] - send as JSON blobs
   * @param {function} [callback]
   * @async
   */
  async function sendFile(url, options, callback) {
    const add = (k, v) => {
      body.append(k, isFunction(v) ? v() : v === null || v === true ? "" : v);
    };
    const build = (key, val) => {
      if (val === void 0) return;
      if (Array.isArray(val)) {
        for (const i in val) build(`${key}[${isObject(val[i]) ? i : ""}]`, val[i]);
      } else if (isObject(val)) {
        for (const n in val) build(`${key}[${n}]`, val[n]);
      } else {
        add(key, val);
      }
    };
    var body = new FormData();
    for (const p in options.body) {
      build(p, options.body[p]);
    }
    for (const p in options.files) {
      const file = options.files[p];
      if (!file?.files?.length) continue;
      body.append(p, file.files[0]);
    }
    for (const p in options.json) {
      const blob = new Blob([JSON.stringify(options.json[p])], { type: "application/json" });
      body.append(p, blob);
    }
    var req = {
      body,
      method: options.method || "POST"
    };
    for (const p in options) {
      if (p == "json" || p == "files" || p == "body") continue;
      req[p] ??= options[p];
    }
    return fetch(url, req, callback);
  }
  function isattr(attr, list) {
    const name = attr.nodeName.toLowerCase();
    if (list.includes(name)) {
      if (sanitizer._attrs.has(name)) {
        return sanitizer._urls.test(attr.nodeValue) || sanitizer._data.test(attr.nodeValue);
      }
      return true;
    }
    return list.some((x) => x instanceof RegExp && x.test(name));
  }
  /**
   * HTML sanitizer, based on Bootstrap internal sanitizer
   * @param {strings} html
   * @param {boolean} list - if true return a list of Nodes
   * @return {Node[]|string}
   */
  function sanitizer(html, list) {
    if (!isString(html)) return list ? [] : html;
    const body = $parse(html);
    const elements = [...body.querySelectorAll("*")];
    for (const el of elements) {
      const name = el.nodeName.toLowerCase();
      if (sanitizer._tags[name]) {
        const allow = [...sanitizer._tags["*"], ...sanitizer._tags[name] || []];
        for (const attr of [...el.attributes]) {
          if (!isattr(attr, allow)) el.removeAttribute(attr.nodeName);
        }
      } else {
        el.remove();
      }
    }
    return list ? Array.from(body.childNodes) : body.innerHTML;
  }
  sanitizer._attrs = /* @__PURE__ */ new Set(["background", "cite", "href", "itemtype", "longdesc", "poster", "src", "xlink:href"]);
  sanitizer._urls = /^(?:(?:https?|mailto|ftp|tel|file|sms):|[^#&/:?]*(?:[#/?]|$))/i;
  sanitizer._data = /^data:(?:image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp)|video\/(?:mpeg|mp4|ogg|webm)|audio\/(?:mp3|oga|ogg|opus));base64,[\d+/a-z]+=*$/i;
  sanitizer._tags = {
    "*": [
      "class",
      "dir",
      "id",
      "lang",
      "role",
      /^aria-[\w-]*$/i,
      "data-bs-toggle",
      "data-bs-target",
      "data-bs-dismiss",
      "data-bs-parent"
    ],
    a: ["target", "href", "title", "rel"],
    area: [],
    b: [],
    blockquote: [],
    br: [],
    button: [],
    col: [],
    code: [],
    div: [],
    em: [],
    hr: [],
    img: ["src", "srcset", "alt", "title", "width", "height", "style"],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    i: [],
    li: [],
    ol: [],
    p: [],
    pre: [],
    s: [],
    small: [],
    span: [],
    sub: [],
    sup: [],
    strong: [],
    table: [],
    thead: [],
    tbody: [],
    th: [],
    tr: [],
    td: [],
    u: [],
    ul: []
  };

  // src/ws.js
  var ws_exports = {};
  __export(ws_exports, {
    WS: () => WS,
    default: () => ws_default
  });
  var WS = class {
    path = "/";
    query = null;
    retry_timeout = 500;
    retry_factor = 2;
    max_timeout = 3e4;
    max_retries = Infinity;
    max_pending = 10;
    ping_interval = 3e5;
    _retries = 0;
    _pending = [];
    constructor(options) {
      for (const p in options) {
        if (p[0] != "_" && this[p] !== void 0) this[p] = options[p];
      }
      $on(window, "online", this.online.bind(this));
    }
    // Open a new websocket connection
    connect() {
      if (this._timer) {
        clearTimeout(this._timer);
        delete this._timer;
      }
      if (this.disabled) return;
      var host = this.host || window.location.hostname;
      if (navigator.onLine === false && !/^(localhost|127.0.0.1)$/.test(host)) {
        return this.timer(0);
      }
      if (!this.query) this.query = {};
      for (const p in this.headers) {
        if (this.query[p] === void 0) this.query[p] = this.headers[p];
      }
      var port = this.port || window.location.port;
      var proto = this.protocol || window.location.protocol.replace("http", "ws");
      var url = `${proto}//${host}:${port}${this.path}?${this.query ? new URLSearchParams(this.query).toString() : ""}`;
      var ws = this.ws = new WebSocket(url);
      ws.onopen = () => {
        trace("ws.open:", url);
        emit("ws:open", url);
        this._ctime = Date.now();
        this._timeout = toNumber(this.retry_timeout);
        this._retries = 0;
        while (this._pending.length) {
          this.send(this.pending.shift());
        }
        this.ping();
      };
      ws.onclose = () => {
        trace("ws.closed:", url, this._timeout, this._retries);
        this.ws = null;
        emit("ws:close", url);
        if (++this._retries < this.max_retries) this.timer();
      };
      ws.onmessage = (msg) => {
        var data2 = msg.data;
        if (data2 === "bye") return this.close(1);
        if (typeof data2 == "string" && (data2[0] == "{" || data2[0] == "[")) data2 = JSON.parse(data2);
        trace("ws.message:", data2);
        emit("ws:message", data2);
        if (data2.event) {
          emit(app.event, data2.event, data2);
        }
      };
      ws.onerror = (err) => {
        trace("ws.error:", url, err);
      };
    }
    // Restart websocket reconnect timer, increase timeout according to reconnect policy (retry_factor, max_timeout)
    timer(timeout) {
      clearTimeout(this._timer);
      if (this.disabled) return;
      if (typeof timeout == "number") this._timeout = timeout;
      this._timer = setTimeout(this.connect.bind(this), this._timeout);
      this._timeout *= this._timeout == this.max_timeout ? 0 : toNumber(this.retry_factor);
      this._timeout = toNumber(this._timeout, { min: this.retry_timeout, max: this.max_timeout });
    }
    // Send a ping and shcedule next one
    ping() {
      clearTimeout(this._ping);
      if (this.disabled || !this.ping_interval) return;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(this.ping_path || "/ping");
      }
      this._ping = setTimeout(this.ping.bind(this), this.ping_interval);
    }
    // Closes and possibly disables WS connection, to reconnect again must delete .disabled property
    close(disable) {
      this.disabled = disable;
      if (!this.ws) return;
      this.ws.close();
      delete this.ws;
    }
    // Send a string data or an object
    send(data2) {
      if (this.ws?.readyState != WebSocket.OPEN) {
        if (!this.max_pending || this._pending.length < this.max_pending) {
          this._pending.push(data2);
        }
        return;
      }
      if (isObject(data2)) {
        if (data2.url && data2.url[0] == "/") {
          data2 = data2.url;
          if (isObject(data2.data)) {
            data2 += "?" + new URLSearchParams(data2.data).toString();
          }
        } else {
          data2 = JSON.stringified(data2);
        }
      }
      this.ws.send(data2);
    }
    // Check the status of websocket connection, reconnect if needed
    online() {
      trace("ws.online:", navigator.onLine, this.ws?.readyState, this.path, this._ctime);
      if (this.ws?.readyState !== WebSocket.OPEN && this._ctime) {
        this.connect();
      }
    }
  };
  var ws_default = WS;

  // builds/cdn-lib.js
  Object.assign(window.app, lib_exports);
  Object.assign(window.app, ws_exports);

  // src/bootstrap.js
  var bootstrap_exports = {};
  __export(bootstrap_exports, {
    hideAlert: () => hideAlert,
    hideToast: () => hideToast,
    showAlert: () => showAlert,
    showToast: () => showToast
  });
  /**
   * Show Bootstrap alert
   * @param {HTMLElement} [container] - show inside container or document.body
   * @param {string} type - type of alert: error, danger, warning, info, success, primary
   * @param {string} text - text to show
   * @param {Object} [options]
   */
  function showAlert(container, type, text, options) {
    if (typeof container == "string") options = text, text = type, type = container, container = document.body;
    if (!text) return;
    var o = Object.assign({}, options, { type });
    o.type = o.type == "error" ? "danger" : o.type || "info";
    var element = o.element || ".alerts";
    var alerts = $(element, isElement(container) || document.body);
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
    if (o.clear) $empty(alerts);
    var alert = $parse(html).firstElementChild;
    var instance = bootstrap.Alert.getOrCreateInstance(alert);
    alerts.prepend(alert);
    if (o.delay) {
      setTimeout(() => {
        instance.close();
      }, o.delay);
    }
    $on(alert, "closed.bs.alert", (ev) => {
      cleanupAlerts(alerts, o);
    });
    if (o.scroll) alerts.scrollIntoView();
    return alert;
  }
  /**
   * Hide active Bootstrap alert
   * @param {HTMLElement} container
   * @param {Object} [options]
   */
  function hideAlert(container, options) {
    var alerts = $(options?.element || ".alerts", container);
    if (!alerts) return;
    $empty(alerts);
    cleanupAlerts(alerts, options);
  }
  /**
   * @param {HTMLElement} [container] - show inside container or document.body
   * @param {string} type - type of alert: error, danger, warning, info, success, primary
   * @param {string} text - text to show
   * @param {Object} [options]
   */
  function showToast(container, type, text, options) {
    if (typeof container == "string") options = text, text = type, type = container, container = null;
    if (!text) return;
    var o = Object.assign({
      type: type == "error" ? "danger" : typeof type == "string" && type || "info",
      now: Date.now(),
      delay: 5e3,
      role: "alert"
    }, isObject(options));
    var t = o.type[0];
    var delay = o.delay * (t == "d" || t == "w" ? 3 : t == "i" ? 2 : 1);
    var icon = o.icon || t == "s" ? "fa-check-circle" : t == "d" ? "fa-exclamation-circle" : t == "w" ? "fa-exclamation-triangle" : "fa-info-circle";
    var fmt = Intl.DateTimeFormat({ timeStyle: "short" });
    var html = `
    <div class="toast fade show ${o.type} ${o.css || ""}" role="${o.role}" aria-live="polite" aria-atomic="true" data-bs-autohide="${!o.dismiss}" data-bs-delay="${delay}">
      <div class="toast-header ${o.css_header || ""}">
        <span class="fa fa-fw ${icon} me-2 text-${o.type}" aria-hidden="true"></span>
        <strong class="me-auto toast-title">${o.title || toTitle(type)}</strong>
        <small class="timer px-1" aria-hidden="true">${o.countdown ? Math.round(delay / 1e3) + "s" : !o.notimer ? "just now" : ""}</small>
        <small>(${fmt.format(o.now)})</small>
        <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
      <div class="toast-body ${o.css_body || ""}">
        ${alertText(text, o)}
      </div>
    </div>`;
    if (!container) {
      container = $(".toast-container");
      if (!container) {
        container = $elem("div", "aria-live", "polite");
        document.body.append(container);
      }
      var pos = o.pos == "tl" ? "top-0 start-0" : o.pos == "tr" ? "top-0 end-0" : o.pos == "ml" ? "top-50 start-0  translate-middle-y" : o.pos == "mc" ? "top-50 start-50 translate-middle" : o.pos == "mr" ? "top-50 end-0 translate-middle-y" : o.pos == "bl" ? "bottom-0 start-0" : o.pos == "bc" ? "bottom-0 start-50 translate-middle-x" : o.pos == "br" ? "bottom-0 end-0" : "top-0 start-50 translate-middle-x";
      container.className = `toast-container position-fixed ${pos} p-3`;
    }
    if (o.clear) $empty(container);
    var toast = $parse(html).firstElementChild;
    bootstrap.Toast.getOrCreateInstance(toast).show();
    container.prepend(toast);
    toast._timer = o.notimer ? "" : setInterval(() => {
      if (!toast.parentElement) return clearInterval(toast._timer);
      $(".timer", toast).textContent = o.countdown ? toDuration(delay - (Date.now() - o.now)) : toDuration(o.now, 1) + " ago";
    }, o.countdown ? o.delay / 2 : o.delay);
    $on(toast, "hidden.bs.toast", (ev) => {
      clearInterval(ev.target._timer);
      ev.target.remove();
    });
    return toast;
  }
  /**
   * Hide active toasts inside first .toast-container
   */
  function hideToast() {
    $empty($(".toast-container"));
  }
  function alertText(text, options) {
    text = text?.message || text?.text || text?.msg || text;
    text = typeof text == "string" ? options?.safe ? text : escape(text.replaceAll("<br>", "\n")) : escape(JSON.stringify(text, null, " ").replace(/["{}[\]]/g, ""));
    return sanitizer(text).replace(/\n/g, "<br>");
  }
  function cleanupAlerts(alerts, options) {
    if (alerts.firstElementChild) return;
    if (options?.css) alerts.classList.remove(options.css);
    if (options?.hide || alerts.dataset.alert == "hide") alerts.style.display = "none";
    delete alerts.dataset.alert;
  }
  function applyPlugins(element) {
    $all(".carousel", element).forEach((el) => bootstrap.Carousel.getOrCreateInstance(el));
    $all(`[data-bs-toggle="popover"]`, element).forEach((el) => bootstrap.Popover.getOrCreateInstance(el));
  }
  $ready(() => {
    stylePlugin(applyPlugins);
    on("dom:changed", (ev) => {
      document.documentElement.setAttribute("data-bs-theme", ev.colorScheme);
    });
    on("alert", showAlert);
  });

  // src/bootpopup.js
  var bootpopup_exports = {};
  __export(bootpopup_exports, {
    bootpopup: () => bootpopup
  });
  var inputs = [
    "text",
    "color",
    "url",
    "password",
    "hidden",
    "file",
    "number",
    "email",
    "reset",
    "date",
    "time",
    "checkbox",
    "radio",
    "datetime-local",
    "week",
    "tel",
    "search",
    "range",
    "month",
    "image",
    "button"
  ];
  var escapeMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;", "`": "&#x60;" };
  function addElement(self, entry) {
    var { type, attrs, opts, parent, children, elem, group } = entry;
    if (!self.options.inputs.includes(type)) {
      self.options.inputs.push(type);
    }
    if (opts.class_append || opts.text_append) {
      const span = $elem("span", { class: opts.class_append, text: opts.text_append });
      elem.append(span);
    }
    if (opts.list_input_button || opts.list_input_tags) {
      if (attrs.value && opts.list_input_tags) {
        $attr(elem, "value", attrs.value.split(/[,|]/).map((x) => x.trim()).filter((x) => x).join(", "));
      }
      group = $elem("div", { class: `input-group ${opts.class_input_group || ""}` });
      group.append(elem);
      elem = group;
      const button = $elem("button", {
        class: opts.class_list_button || self.options.class_list_button,
        type: "button",
        "data-bs-toggle": "dropdown",
        "aria-haspopup": "true",
        "aria-expanded": "false",
        text: opts.text_input_button
      });
      elem.append(button);
      var menu = $elem("div", {
        class: opts.class_input_menu || self.options.class_input_menu,
        "-overflowY": "auto",
        "-maxHeight": opts.list_input_mh || self.options.list_input_mh
      });
      elem.append(menu);
      var list = opts.list_input_button || opts.list_input_tags || [];
      for (const l of list) {
        let n = l, v = self.escape(n);
        if (typeof n == "object") v = self.escape(n.value), n = self.escape(n.name);
        if (n == "-") {
          menu.appendTo($elem("div", { class: "dropdown-divider" }));
        } else if (opts.list_input_tags) {
          const a = $elem("a", {
            class: "dropdown-item " + (opts.class_list_input_item || ""),
            role: "button",
            "data-attrid": "#" + attrs.id,
            text: n,
            click: (ev) => {
              var el = $(ev.target.dataset.attrid);
              var v2 = ev.target.textContent;
              if (!el.value) {
                el.value = v2;
              } else {
                var l2 = el.value.split(/[,|]/).map((x) => x.trim()).filter((x) => x);
                if (!l2.includes(v2)) l2.push(v2);
                el.value = l2.join(", ");
              }
            }
          }, self.eventOptions);
          menu.append(a);
        } else {
          const a = $elem("a", {
            class: "dropdown-item " + (opts.class_list_input_item || ""),
            role: "button",
            "data-value": v || n,
            "data-attrid": "#" + attrs.id,
            text: n,
            click: (ev) => {
              $(ev.target.dataset.attrid).value = ev.target.dataset.value;
            }
          }, self.eventOptions);
          menu.append(a);
        }
      }
    } else if (opts.text_input_button) {
      group = $elem("div", { class: `input-group ${opts.class_input_group || ""}` });
      group.append(elem);
      elem = group;
      const bopts = {
        class: opts.class_input_button || self.options.class_input_button,
        type: "button",
        "data-formid": "#" + self.formid,
        "data-inputid": "#" + attrs.id,
        text: opts.text_input_button
      };
      for (const b in opts.attrs_input_button) bopts[b] = opts.attrs_input_button[b];
      const button = $elem("button", bopts);
      elem.append(button);
    }
    for (const k in children) elem.append(children[k]);
    var class_group = opts.class_group || self.options.class_group;
    var class_label = (opts.class_label || self.options.class_label) + " " + (attrs.value ? "active" : "");
    var gopts = { class: class_group, title: attrs.title };
    for (const p in opts.attrs_group) gopts[p] = opts.attrs_group[p];
    group = $elem("div", gopts);
    parent.append(group);
    if (opts.class_prefix || opts.text_prefix) {
      const div = $elem("span", { class: opts.class_prefix || "" });
      if (opts.text_prefix) div.append(...self.sanitize(opts.text_prefix));
      group.append(div);
    }
    if (opts.horizontal !== void 0 ? opts.horizontal : self.options.horizontal) {
      group.classList.add("row");
      class_label = " col-form-label " + (opts.size_label || self.options.size_label) + " " + class_label;
      const lopts = { for: opts.for || attrs.id, class: class_label };
      for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
      const label = $elem("label", lopts);
      label.append(...self.sanitize(opts.label));
      const input = $elem("div", { class: opts.size_input || self.options.size_input });
      input.append(elem);
      group.append(label, input);
    } else {
      const lopts = { for: opts.for || attrs.id, class: "form-label " + class_label };
      for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
      const label = $elem("label", lopts);
      label.append(...self.sanitize(opts.label));
      if (opts.floating) {
        if (!opts.placeholder) $attr(elem, "placeholder", "");
        group.classList.add("form-floating");
        group.append(elem);
        if (opts.label) group.append(label);
      } else {
        if (opts.label) group.append(label);
        group.append(elem);
      }
    }
    if (opts.text_valid) {
      group.append($elem("div", { class: "valid-feedback", text: opts.text_valid }));
    }
    if (opts.text_invalid) {
      group.append($elem("div", { class: "invalid-feedback", text: opts.text_invalid }));
    }
    if (opts.class_suffix || opts.text_suffix) {
      const div = $elem("div", { class: opts.class_suffix || self.options.class_suffix });
      if (opts.text_suffix) div.append(...self.sanitize(opts.text_suffix));
      group.append(div);
    }
    if (opts.autofocus) self.autofocus = elem;
  }
  function processEntry(self, type, entry) {
    var parent = self.form, opts = {}, children = [], attrs = {}, label, elem, html;
    if (Array.isArray(entry)) {
      children = entry;
    } else if (typeof entry == "string") {
      opts.label = entry;
    } else {
      for (const p in entry) opts[p] = entry[p];
    }
    for (const p in opts) {
      if (p == "html") {
        html = opts.nosanitize ? $parse(opts[p]) : self.sanitize(opts[p]);
      } else if (!/^(tab_|attrs_|click_|list_|class_|text_|icon_|size_|label|for)/.test(p)) {
        attrs[p] = opts[p];
      }
    }
    if (!attrs.id) attrs.id = "bpi" + String(Math.random()).substr(2);
    attrs["data-formid"] = "#" + self.formid;
    if (opts.tab_id && self.tabs) {
      parent = self.tabPanels[opts.tab_id] || parent;
    }
    if (inputs.includes(type)) {
      attrs.type = type;
      type = "input";
    }
    switch (type) {
      case "button":
      case "submit":
      case "input":
      case "textarea":
        attrs.type = attrs.type === void 0 ? "text" : attrs.type;
        if (attrs.type == "hidden") {
          elem = $elem(type, attrs, self.eventOptions);
          parent.append(elem);
          break;
        }
        if (!attrs.class) attrs.class = self.options["class_" + attrs.type];
      case "select":
        if (type == "select" && attrs.options) {
          if (attrs.caption) {
            children.push($elem("option", { text: attrs.caption, value: "" }));
          }
          for (const j in attrs.options) {
            const option = {}, opt = attrs.options[j];
            if (typeof opt == "string") {
              if (attrs.value === opt) option.selected = true;
              option.text = self.escape(opt);
              if (isString(j)) option.value = j;
              children.push($elem("option", option));
            } else if (opt?.name) {
              option.value = opt.value || "";
              if (opt.selected || attrs.value === option.value) option.selected = true;
              if (opt.label) option.label = opt.label;
              if (typeof opt.disabled == "boolean") option.disabled = opt.disabled;
              option.text = self.escape(opt.name);
              children.push($elem("option", option));
            }
          }
          delete attrs.options;
          delete attrs.value;
        }
        if (["radio", "checkbox"].includes(attrs.type) && !opts.raw) {
          if (attrs.checked === false || attrs.checked == 0) delete attrs.checked;
          label = $elem("label", {
            class: opts.class_input_btn || opts.class_input_label || "form-check-label",
            for: opts.for || attrs.id,
            text: opts.input_label || opts.label
          });
          let class_check = "form-check";
          if (opts.switch) class_check += " form-switch", attrs.role = "switch";
          if (opts.inline) class_check += " form-check-inline";
          if (opts.reverse) class_check += " form-check-reverse";
          if (opts.class_check) class_check += " " + opts.class_check;
          attrs.class = (opts.class_input_btn ? "btn-check " : "form-check-input ") + (attrs.class || "");
          elem = $elem("div", { class: class_check });
          elem.append($elem(type, attrs, self.eventOptions), label);
          if (opts.class_append || opts.text_append) {
            label.append($elem("span", { class: opts.class_append || "", text: opts.text_append }));
          }
          if (!opts.input_label) delete opts.label;
        } else {
          if (["select", "range"].includes(attrs.type)) {
            attrs.class = `form-${attrs.type} ${attrs.class || ""}`;
          }
          attrs.class = attrs.class || "form-control";
          if (type == "textarea") {
            delete attrs.value;
            elem = $elem(type, attrs, self.eventOptions);
            if (opts.value) elem.append(opts.value);
          } else {
            elem = $elem(type, attrs, self.eventOptions);
          }
        }
        addElement(self, { type, attrs, opts, parent, children, elem });
        break;
      case "radios":
      case "checkboxes":
        elem = $elem("div", { class: opts.class_container });
        for (const i in attrs.options) {
          let o = attrs.options[i];
          if (!o) continue;
          if (isString(o)) o = { label: o };
          if (!o.value && type[0] == "r") o.value = i;
          if (o.checked === false || o.checked == 0) delete o.checked;
          const title = o.title;
          const label2 = $elem("label", { class: "form-check-label", for: attrs.id + "-" + i, text: o.label || o.name });
          o = Object.assign(o, {
            id: attrs.id + "-" + i,
            name: o.name || opts.name,
            class: `form-check-input ${o.class || ""}`,
            role: opts.switch && "switch",
            type: attrs.type || type[0] == "r" ? "radio" : "checkbox",
            label: void 0,
            title: void 0
          });
          let c = "form-check";
          if (o.switch || opts.switch) c += " form-switch";
          if (o.inline || opts.inline) c += " form-check-inline";
          if (o.reverse || opts.reverse) c += " form-check-reverse";
          if (o.class_check || opts.class_check) c += " " + (o.class_check || opts.class_check);
          const div = $elem("div", { class: c, title });
          div.append($elem(`input`, o, self.eventOptions), label2);
          children.push(div);
        }
        for (const p of ["switch", "inline", "reverse", "options", "value", "type"]) delete attrs[p];
        addElement(self, { type, attrs, opts, parent, children, elem });
        break;
      case "alert":
      case "success":
        self[type] = elem = $elem("div", attrs, self.eventOptions);
        parent.append(elem);
        break;
      case "row":
        var row = $elem("div", { class: opts.class_row || self.options.class_row || "row" });
        parent.append(row);
        for (const subEntry of children) {
          const col = $elem("div", { class: subEntry.class_col || self.options.class_col || "col-auto" });
          row.append(col);
          const oldParent = parent;
          parent = col;
          for (const type2 in subEntry) {
            processEntry(self, type2, subEntry[type2]);
          }
          parent = oldParent;
        }
        break;
      default:
        elem = $elem(type, attrs, self.eventOptions);
        if (html) {
          elem.append(...html);
        }
        if (opts.class_append || opts.text_append) {
          elem.append($elem("span", { class: opts.class_append || "", text: opts.text_append }));
        }
        if (opts.name && opts.label) {
          addElement(self, { type, attrs, opts, parent, children, elem });
        } else {
          parent.append(elem);
        }
    }
  }
  function bootpopup(...args) {
    return new Bootpopup(...args);
  }
  var Bootpopup = class {
    formid = "bpf" + String(Math.random()).substr(2);
    controller = new AbortController();
    options = {
      self: null,
      id: "",
      title: document.title,
      debug: false,
      show_close: true,
      show_header: true,
      show_footer: true,
      size: "",
      size_label: "col-sm-4",
      size_input: "col-sm-8",
      content: [],
      footer: [],
      onsubmit: "close",
      buttons: ["close"],
      attrs_modal: null,
      class_h: "",
      class_modal: "modal fade",
      class_dialog: "modal-dialog",
      class_title: "modal-title",
      class_content: "modal-content",
      class_body: "modal-body",
      class_header: "modal-header",
      class_footer: "modal-footer",
      class_group: "mb-3",
      class_options: "options flex-grow-1 text-start",
      class_alert: "alert alert-danger fade show",
      class_info: "alert alert-info fade show",
      class_form: "",
      class_label: "",
      class_row: "",
      class_col: "",
      class_suffix: "form-text text-muted text-end",
      class_buttons: "btn",
      class_button: "btn-outline-secondary",
      class_ok: "btn-primary",
      class_yes: "btn-primary",
      class_no: "btn-secondary",
      class_cancel: "btn-outline-secondary",
      class_close: "btn-outline-secondary",
      class_tabs: "nav nav-tabs mb-4",
      class_tablink: "nav-link",
      class_tabcontent: "tab-content",
      class_input_button: "btn btn-outline-secondary",
      class_list_button: "btn btn-outline-secondary dropdown-toggle",
      class_input_menu: "dropdown-menu bg-light",
      list_input_mh: "25vh",
      text_ok: "OK",
      text_yes: "Yes",
      text_no: "No",
      text_cancel: "Cancel",
      text_close: "Close",
      center: false,
      scroll: false,
      horizontal: true,
      alert: false,
      info: false,
      backdrop: true,
      keyboard: true,
      autofocus: true,
      empty: false,
      data: "",
      tabs: "",
      tab: "",
      inputs: ["input", "textarea", "select"],
      sanitizer: (html) => sanitizer(html, true),
      before: function() {
      },
      dismiss: function() {
      },
      close: function() {
      },
      ok: function() {
      },
      cancel: function() {
      },
      yes: function() {
      },
      no: function() {
      },
      show: function() {
      },
      shown: function() {
      },
      showtab: function() {
      },
      complete: function() {
      },
      submit: function(e) {
        this.callback(this.options.onsubmit, e);
        e.preventDefault();
      }
    };
    constructor(...args) {
      this.addOptions(...bootpopup.plugins, ...args);
      this.create();
      this.show();
    }
    create() {
      this.eventOptions = { signal: this.controller.signal };
      var class_dialog = this.options.class_dialog;
      if (["sm", "lg", "xl", "fullscreen"].includes(this.options.size)) class_dialog += " modal-" + this.options.size;
      if (this.options.center) class_dialog += " modal-dialog-centered";
      if (this.options.scroll) class_dialog += " modal-dialog-scrollable";
      var modalOpts = { class: this.options.class_modal, id: this.options.id || "", tabindex: "-1", "aria-labelledby": "a" + this.formid, "aria-hidden": true };
      if (this.options.backdrop !== true) modalOpts["data-bs-backdrop"] = typeof this.options.backdrop == "string" ? this.options.backdrop : false;
      if (!this.options.keyboard) modalOpts["data-bs-keyboard"] = false;
      for (const p in this.options.attrs_modal) modalOpts[p] = this.options.attrs_modal[p];
      this.modal = $elem("div", modalOpts, this.eventOptions);
      this.dialog = $elem("div", { class: class_dialog, role: "document" });
      this.content = $elem("div", { class: this.options.class_content + " " + this.options.class_h });
      this.dialog.append(this.content);
      this.modal.append(this.dialog);
      if (this.options.show_header && this.options.title) {
        this.header = $elem("div", { class: this.options.class_header });
        const title = $elem("h5", { class: this.options.class_title, id: "a" + this.formid });
        title.append(...this.sanitize(this.options.title));
        this.header.append(title);
        if (this.options.show_close) {
          const close = $elem("button", { type: "button", class: "btn-close", "data-bs-dismiss": "modal", "aria-label": "Close" });
          this.header.append(close);
        }
        this.content.append(this.header);
      }
      var class_form = this.options.class_form;
      if (!class_form && this.options.horizontal) class_form = "form-horizontal";
      this.body = $elem("div", { class: this.options.class_body });
      this.form = $elem("form", { id: this.formid, class: class_form, role: "form", submit: (e) => this.options.submit(e) });
      this.body.append(this.form);
      this.content.append(this.body);
      if (this.options.alert) {
        this.alert = $elem("div");
        this.form.append(this.alert);
      }
      if (this.options.info) {
        this.info = $elem("div");
        this.form.append(this.info);
      }
      if (this.options.tabs) {
        const toggle = /nav-pills/.test(this.options.class_tabs) ? "pill" : "tab";
        this.tabs = $elem("div", { class: this.options.class_tabs, role: "tablist" });
        this.form.append(this.tabs);
        this.tabContent = $elem("div", { class: this.options.class_tabcontent });
        this.form.append(this.tabContent);
        this.tabPanels = {};
        for (const p in this.options.tabs) {
          if (!this.options.content.some((o) => {
            for (const k in o) {
              for (const l in o[k]) {
                if (l == "tab_id" && p == o[k][l]) return 1;
              }
            }
            return 0;
          })) continue;
          const active = this.options.tab ? this.options.tab == p : !Object.keys(this.tabPanels).length;
          const tid = this.formid + "-tab" + p;
          const a = $elem("a", {
            class: this.options.class_tablink + (active ? " active" : ""),
            "data-bs-toggle": toggle,
            id: tid + "0",
            href: "#" + tid,
            role: "tab",
            "aria-controls": tid,
            "aria-selected": false,
            "data-callback": p,
            click: (event) => {
              this.options.showtab(event.target.dataset.callback, event);
            },
            text: this.options.tabs[p]
          }, this.eventOptions);
          this.tabs.append(a);
          this.tabPanels[p] = $elem("div", {
            class: "tab-pane fade" + (active ? " show active" : ""),
            id: tid,
            role: "tabpanel",
            "aria-labelledby": tid + "0"
          });
          this.tabContent.append(this.tabPanels[p]);
        }
      }
      for (const c in this.options.content) {
        const entry = this.options.content[c];
        switch (typeof entry) {
          case "string":
            this.form.append(...this.sanitize(entry));
            break;
          case "object":
            for (const type in entry) {
              processEntry(this, type, entry[type]);
            }
            break;
        }
      }
      this.footer = $elem("div", { class: this.options.class_footer });
      if (this.options.show_footer) {
        this.content.append(this.footer);
      }
      for (const i in this.options.footer) {
        const entry = this.options.footer[i];
        let div, html, elem;
        switch (typeof entry) {
          case "string":
            this.footer.append(...this.sanitize(entry));
            break;
          case "object":
            div = $elem("div", { class: this.options.class_options });
            this.footer.append(div);
            for (const type in entry) {
              const opts = typeof entry[type] == "string" ? { text: entry[type] } : entry[type], attrs = {};
              for (const p in opts) {
                if (p == "html") {
                  html = opts.nosanitize ? $parse(opts[p]) : this.sanitize(opts[p]);
                } else if (!/^(type|[0-9]+)$|^(class|text|icon|size)_/.test(p)) {
                  attrs[p] = opts[p];
                }
              }
              elem = $elem(opts.type || type, attrs, this.eventOptions);
              if (html) elem.append(...html);
              div.append(elem);
            }
            break;
        }
      }
      for (const i in this.options.buttons) {
        var name = this.options.buttons[i];
        if (!name) continue;
        const btn = $elem("button", {
          type: "button",
          class: `${this.options.class_buttons} ${this.options["class_" + name] || this.options.class_button}`,
          "data-callback": name,
          "data-formid": "#" + this.formid,
          click: (event) => {
            this.callback(event.target.dataset.callback, event);
          }
        }, this.eventOptions);
        btn.append(...this.sanitize(this.options["text_" + name] || name));
        if (this.options["icon_" + name]) {
          btn.append($elem("i", { class: this.options["icon_" + name] }));
        }
        this["btn_" + name] = btn;
        this.footer.append(btn);
      }
      $on(this.modal, "show.bs.modal", (e) => {
        this.options.show.call(this.options.self, e, this);
      }, this.eventOptions);
      $on(this.modal, "shown.bs.modal", (e) => {
        if (this.options.autofocus) {
          var focus = this.autofocus || Array.from($all("input,select,textarea", this.form)).find((el) => !(el.readOnly || el.disabled || el.type == "hidden"));
          if (focus) focus.focus();
        }
        this.options.shown.call(this.options.self || this, e, this);
      }, this.eventOptions);
      $on(this.modal, "hide.bs.modal", (e) => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        e.bootpopupButton = this._callback;
        this.options.dismiss.call(this.options.self, e, this);
      }, this.eventOptions);
      $on(this.modal, "hidden.bs.modal", (e) => {
        e.bootpopupButton = this._callback;
        this.options.complete.call(this.options.self, e, this);
        this.modal.remove();
        bootstrap.Modal.getInstance(this.modal)?.dispose();
        delete this.options.data;
        this.controller.abort();
      }, this.eventOptions);
    }
    show() {
      document.body.append(this.modal);
      this.options.before(this);
      bootstrap.Modal.getOrCreateInstance(this.modal).show();
    }
    showAlert(text, opts) {
      const type = opts?.type || "alert", element = this[type];
      if (!element) return;
      if (text?.message) text = text.message;
      if (typeof text != "string") return;
      const alert = $elem(`div`, { class: this.options["class_" + type], role: "alert", text });
      if (opts?.dismiss) {
        alert.classList.add("alert-dismissible");
        alert.append($elem(`button`, { type: "button", class: "btn-close", "data-bs-dismiss": "alert", "aria-label": "Close" }));
      } else {
        setTimeout(() => {
          $empty(element);
        }, opts?.delay || this.delay || 1e4);
      }
      $empty(element).append(alert);
      if (this.options.scroll) {
        element.scrollIntoView();
      }
      return null;
    }
    validate() {
      this.form.classList.add("was-validated");
      return this.form.checkValidity();
    }
    sanitize(str) {
      return !str ? [] : this.options.sanitizer(str);
    }
    escape(str) {
      if (typeof str != "string") return str;
      return str.replace(/([&<>'"`])/g, (_, n) => escapeMap[n] || n);
    }
    data() {
      var inputs2 = [...this.options.inputs, ...bootpopup.inputs];
      var d = { list: [], obj: {} }, e, n, v, l = $all(inputs2.join(","), this.form);
      for (let i = 0; i < l.length; i++) {
        e = l[i];
        n = e.name || $attr(e, "name") || e.id || $attr("id");
        v = e.value;
        if (this.options.debug) console.log("bootpopup:", n, e.type, e.checked, v, e);
        if (!n || e.disabled) continue;
        if (/radio|checkbox/i.test(e.type) && !e.checked) v = void 0;
        if (v === void 0 || v === "") {
          if (!this.options.empty) continue;
          v = "";
        }
        d.list.push({ name: n, value: v });
      }
      for (const v2 of d.list) d.obj[v2.name] = v2.value;
      if (this.options.debug) console.log("bootpopup:", this.options.inputs, d);
      return d;
    }
    callback(name, event) {
      if (this.options.debug) console.log("bootpopup:", name, event);
      var func = isFunction(this.options[name]);
      if (!func) return;
      this._callback = name;
      var a = this.data();
      var result = func.call(this.options.self || this, a.obj, a.list, event);
      if (result instanceof Promise) {
        result.then((resolved) => {
          if (resolved !== null) {
            bootstrap.Modal.getOrCreateInstance(this.modal).hide();
          }
        });
      } else {
        if (result !== null) {
          bootstrap.Modal.getOrCreateInstance(this.modal).hide();
        }
        return result;
      }
    }
    addOptions(...args) {
      for (const opts of args) {
        for (const key in opts) {
          if (opts[key] !== void 0) {
            if (isFunction(this.options[key])) {
              const _old = this.options[key], _n = opts[key];
              this.options[key] = function(...args2) {
                if (isFunction(_old)) _old.apply(this, args2);
                return _n.apply(this, args2);
              };
            } else {
              this.options[key] = opts[key];
            }
          }
        }
      }
      if (this.options.onsubmit == "close") {
        if (this.options.buttons.includes("ok")) this.options.onsubmit = "ok";
        else if (this.options.buttons.includes("yes")) this.options.onsubmit = "yes";
      }
      return this.options;
    }
    close() {
      return this.callback("close");
    }
  };
  bootpopup.plugins = [];
  bootpopup.inputs = [];
  bootpopup.alert = function(text, callback) {
    return new Bootpopup({
      show_header: false,
      content: [{ div: { text } }],
      class_footer: "modal-footer justify-content-center",
      dismiss: callback
    });
  };
  bootpopup.confirm = function(text, callback) {
    var ok;
    return new Bootpopup({
      show_header: false,
      content: [{ div: { text } }],
      buttons: ["yes", "no"],
      class_footer: "modal-footer justify-content-center",
      yes: isFunction(callback) ? () => {
        callback(ok = true);
      } : null,
      dismiss: isFunction(callback) ? () => {
        if (!ok) callback(false);
      } : null
    });
  };
  bootpopup.prompt = function(label, callback) {
    var ok;
    return new Bootpopup({
      show_header: false,
      content: [{ input: { name: "value", label } }],
      buttons: ["ok", "cancel"],
      ok: isFunction(callback) ? (d) => {
        callback(ok = d.value || "");
      } : null,
      dismiss: isFunction(callback) ? () => {
        if (ok === void 0) callback();
      } : null
    });
  };

  // builds/cdn-bootstrap.js
  Object.assign(window.app, bootstrap_exports, bootpopup_exports);
})();
