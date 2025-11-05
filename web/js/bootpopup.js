(() => {
  // src/bootpopup.js
  var isO = (obj) => typeof obj == "object" && obj;
  var isS = (str) => typeof str == "string" && str;
  var isF = (callback) => typeof callback == "function" && callback;
  var isE = (element) => element instanceof HTMLElement && element;
  var toCamel = (key) => isS(key) ? key.toLowerCase().replace(/[.:_-](\w)/g, (_, c) => c.toUpperCase()) : "";
  var $esc = (selector) => selector.replace(/#([^\s"#']+)/g, (_, id) => `#${CSS.escape(id)}`);
  var $ = (selector, doc) => isS(selector) ? (isE(doc) || document).querySelector($esc(selector)) : null;
  var $all = (selector, doc) => isS(selector) ? (isE(doc) || document).querySelectorAll($esc(selector)) : null;
  var $on = (element, event, callback, ...arg) => isF(callback) && element.addEventListener(event, callback, ...arg);
  var $attr = (element, attr, value) => {
    if (isS(element)) element = $(element);
    if (!isE(element)) return;
    return value === void 0 ? element.getAttribute(attr) : value === null ? element.removeAttribute(attr) : element.setAttribute(attr, value);
  };
  var $empty = (element) => {
    if (isS(element)) element = $(element);
    if (!isE(element)) return;
    while (element.firstChild) {
      const node = element.firstChild;
      node.remove();
    }
    return element;
  };
  var $elem = (name, ...arg) => {
    var element = document.createElement(name), key, val, opts;
    if (isO(arg[0])) {
      arg = Object.entries(arg[0]).flatMap((x) => x);
      opts = arg[1];
    }
    for (let i = 0; i < arg.length - 1; i += 2) {
      key = arg[i], val = arg[i + 1];
      if (!isS(key)) continue;
      if (isF(val)) {
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
  };
  var $parse = (html) => {
    html = new window.DOMParser().parseFromString(html || "", "text/html");
    return Array.from(html.body.childNodes);
  };
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
              if (isS(j)) option.value = j;
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
          if (isS(o)) o = { label: o };
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
      sanitizer: (html) => $parse(html),
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
      var func = isF(this.options[name]);
      if (!func) return;
      this._callback = name;
      var a = this.data();
      var ret = func.call(this.options.self || this, a.obj, a.list, event);
      if (ret !== null) {
        bootstrap.Modal.getOrCreateInstance(this.modal).hide();
      }
      return ret;
    }
    addOptions(...args) {
      for (const opts of args) {
        for (const key in opts) {
          if (opts[key] !== void 0) {
            if (isF(this.options[key])) {
              const _old = this.options[key], _n = opts[key];
              this.options[key] = function(...args2) {
                if (isF(_old)) _old.apply(this, args2);
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
      yes: isF(callback) ? () => {
        callback(ok = true);
      } : null,
      dismiss: isF(callback) ? () => {
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
      ok: isF(callback) ? (d) => {
        callback(ok = d.value || "");
      } : null,
      dismiss: isF(callback) ? () => {
        if (ok === void 0) callback();
      } : null
    });
  };

  // builds/cdn.js
  window.bootpopup = bootpopup;
})();
