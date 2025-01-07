/*!
 * Modified by vlad, more options, no jQuery
 *
 *
 * Popup dialog boxes for Bootstrap - https://github.com/rigon/bootpopup
 * Copyright (C) 2016  rigon<ricardompgoncalves@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

function bootpopup(...args)
{
    const app = window.app;

    const inputs = [
        "text", "color", "url", "password", "hidden", "file", "number",
        "email", "reset", "date", "time", "checkbox", "radio", "datetime-local",
        "week", "tel", "search", "range", "month", "image", "button"
    ];

    // Create a new instance if this is not
    if (!(this instanceof bootpopup)) return new bootpopup(...args);

    const self = this;

    // Create a global random ID for the form
    this.formid = "bpf" + String(Math.random()).substr(2);

    this.options = {
        id: "",
        self: self,
        title: document.title,
        debug: false,
        show_close: true,
        show_header: true,
        show_footer: true,
        size: "normal",
        size_label: "col-sm-4",
        size_input: "col-sm-8",
        content: [],
        footer: [],
        onsubmit: "close",
        buttons: ["close"],
        class_h: "",
        class_modal: "modal fade",
        class_dialog: "modal-dialog",
        class_title: "modal-title",
        class_content: "modal-content",
        class_body: "modal-body",
        class_header: "modal-header",
        class_footer: "modal-footer",
        class_footer_block: "modal-footer d-block text-end",
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
        class_submit: "btn-primary",
        class_ok: "btn-primary",
        class_yes: "btn-primary",
        class_no: "btn-secondary",
        class_help: "btn-outline-secondary",
        class_agree: "btn-primary",
        class_cancel: "text-muted",
        class_close: "text-muted",
        class_button1: "btn-outline-secondary",
        class_button2: "btn-outline-secondary",

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
        text_help: "Help",
        text_agree: "Agree",
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
        sanitizer: null,
        inputs: ["input", "textarea", "select"],

        before: function() {},
        dismiss: function() {},
        close: function() {},
        ok: function() {},
        cancel: function() {},
        yes: function() {},
        no: function() {},
        agree: function() {},
        help: function() {},
        button1: function() {},
        button2: function() {},
        show: function() {},
        shown: function() {},
        showtab: function() {},
        complete: function() {},
        submit: function(e) {
            self.callback(self.options.onsubmit, e);
            e.preventDefault();
        },
    }

    this.create = function() {
        // Option for modal dialog size
        var class_dialog = this.options.class_dialog;
        if (this.options.size == "xlarge") class_dialog += " modal-xl";
        if (this.options.size == "large") class_dialog += " modal-lg";
        if (this.options.size == "small") class_dialog += " modal-sm";
        if (this.options.center) class_dialog += " modal-dialog-centered";
        if (this.options.scroll) class_dialog += " modal-dialog-scrollable";

        // Create HTML elements for modal dialog
        var opts = { class: this.options.class_modal, id: this.options.id || "", tabindex: "-1", role: "dialog", "aria-labelledby": "bootpopup-title", "aria-hidden": true };
        if (this.options.backdrop !== true) opts["data-bs-backdrop"] = typeof this.options.backdrop == "string" ? this.options.backdrop : false;
        if (!this.options.keyboard) opts["data-bs-keyboard"] = false;
        this.modal = app.$elem('div', opts);
        this.dialog = app.$elem('div', { class: class_dialog, role: "document" });
        this.content = app.$elem('div', { class: this.options.class_content + " " + this.options.class_h });
        this.dialog.append(this.content);
        this.modal.append(this.dialog);

        // Header
        if (this.options.show_header && this.options.title) {
            this.header = app.$elem('div', { class: this.options.class_header });
            const title = app.$elem('h5', { class: this.options.class_title, id: "bootpopup-title" });
            title.append(...this.sanitize(this.options.title));
            this.header.append(title);

            if (this.options.show_close) {
                const close = app.$elem('button', { type: "button", class: "btn-close", "data-bs-dismiss": "modal", "aria-label": "Close" });
                this.header.append(close);
            }
            this.content.append(this.header);
        }

        // Body
        var class_form = this.options.class_form;
        if (!class_form && this.options.horizontal) class_form = "form-horizontal";
        this.body = app.$elem('div', { class: this.options.class_body });
        this.form = app.$elem("form", { id: this.formid, class: class_form, role: "form", submit: (e) => (self.options.submit(e)) });
        this.body.append(this.form);
        this.content.append(this.body);

        if (this.options.alert) {
            this.alert = app.$elem("div");
            this.form.append(this.alert);
        }
        if (this.options.info) {
            this.info = app.$elem("div");
            this.form.append(this.info);
        }

        var tabs = {}, toggle = /nav-pills/.test(this.options.class_tabs) ? "pill" : "tab";
        if (this.options.tabs) {
            this.tabs = app.$elem("div", { class: this.options.class_tabs, role: "tablist" });
            this.form.append(this.tabs);
            this.tabContent = app.$elem("div", { class: this.options.class_tabcontent });
            this.form.append(this.tabContent);

            for (const p in this.options.tabs) {
                // Skip tabs with no elements
                if (!this.options.content.some((o) => {
                    for (const k in o) {
                        for (const l in o[k]) {
                            if (l == "tab_id" && p == o[k][l]) return 1;
                        }
                    }
                    return 0
                })) continue;
                const active = this.options.tab ? this.options.tab == p : !Object.keys(tabs).length;
                const tid = this.formid + "-tab" + p;

                const a = app.$elem("a", {
                    class: this.options.class_tablink + (active ? " active" : ""),
                    "data-bs-toggle": toggle,
                    id: tid + "0",
                    href: "#" + tid,
                    role: "tab",
                    "aria-controls": tid,
                    "aria-selected": false,
                    "data-callback": p,
                    click: (event) => { self.options.showtab(event.target.dataset.callback, event) },
                    text: this.options.tabs[p],
                });
                this.tabs.append(a);

                tabs[p] = app.$elem("div", {
                    class: "tab-pane fade" + (active ? " show active": ""),
                    id: tid,
                    role: "tabpanel", "aria-labelledby":
                    tid + "0"
                });
                this.tabContent.append(tabs[p]);
            }
        }

        var parent = this.form, children, attrs, label, elem, group, html;

        const addElement = (type) => {
            if (!this.options.inputs.includes(type)) {
                this.options.inputs.push(type);
            }
            if (opts.class_append || opts.text_append) {
                const span = app.$elem("span", { class: opts.class_append, text: opts.text_append });
                elem.append(span);
            }
            if (opts.list_input_button || opts.list_input_tags) {
                if (attrs.value && opts.list_input_tags) {
                    app.$attr(elem, 'value', app.strSplit(attrs.value).join(', '));
                }
                const group = app.$elem('div', { class: `input-group ${opts.class_input_group || ""}` });
                group.append(elem);
                elem = group;

                const button = app.$elem('button', {
                    class: opts.class_list_button || this.options.class_list_button,
                    type: "button",
                    'data-bs-toggle': "dropdown",
                    'aria-haspopup': "true",
                    'aria-expanded': "false",
                    text: opts.text_input_button,
                });
                elem.append(button);

                var menu = app.$elem('div', {
                    class: opts.class_input_menu || this.options.class_input_menu,
                    ".overflowY": "auto",
                    ".maxHeight": opts.list_input_mh || this.options.list_input_mh
                });
                elem.append(menu);

                var list = opts.list_input_button || opts.list_input_tags || [];
                for (const l of list) {
                    let n = l, v = this.escape(n);
                    if (typeof n == "object") v = this.escape(n.value), n = this.escape(n.name);
                    if (n == "-") {
                        menu.appendTo(app.$elem('div', { class: "dropdown-divider" }));
                    } else
                    if (opts.list_input_tags) {
                        const a = app.$elem('a', {
                            class: "dropdown-item " + (opts.class_list_input_item || ""),
                            role: "button",
                            'data-attrid': '#' + attrs.id,
                            click: (ev) => {
                                var el = app.$(ev.target.dataset.attrid);
                                el.value = app.toFlags("add", app.strSplit(el.value), ev.target.textContent).join(', ')
                            },
                            text: n
                        });
                        menu.append(a);
                    } else {
                        const a = app.$elem('a', {
                            class: "dropdown-item " + (opts.class_list_input_item || ""),
                            role: "button",
                            'data-value': v || n,
                            'data-attrid': '#' + attrs.id,
                            click: (ev) => {
                                app.$(ev.target.dataset.attrid).value = ev.target.dataset.value
                            },
                            text: n
                        });
                        menu.append(a);
                    }
                }
            } else
            if (opts.text_input_button) {
                const group = app.$elem('div', { class: `input-group ${opts.class_input_group || ""}` });
                elem.append(group);
                elem = group;
                const bopts = { class: opts.class_input_button || this.options.class_input_button, type: "button", 'data-formid': '#'+this.formid, text: opts.text_input_button };
                for (const b in opts.attrs_input_button) bopts[b] = opts.attrs_input_button[b];
                const button = app.$elem('button', bopts);
                elem.append(button);
            }

            for (const k in children) elem.append(children[k]);
            var class_group = opts.class_group || this.options.class_group;
            var class_label = (opts.class_label || this.options.class_label) + " " + (attrs.value ? "active" : "");
            var gopts = { class: class_group, title: attrs.title };
            for (const p in opts.attrs_group) gopts[p] = opts.attrs_group[p];

            group = app.$elem('div', gopts)
            parent.append(group);

            if (opts.class_prefix || opts.text_prefix) {
                group.append(app.$elem("span", { class: opts.class_prefix || "", text: opts.text_prefix }));
            }
            if (opts.horizontal !== undefined ? opts.horizontal : this.options.horizontal) {
                group.classList.add("row");
                class_label = " col-form-label " + (opts.size_label || this.options.size_label) + " " + class_label;
                const lopts = { for: opts.for || attrs.id, class: class_label };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                const label = app.$elem("label", lopts);
                label.append(...this.sanitize(opts.label));

                const input = app.$elem('div', { class: opts.size_input || this.options.size_input });
                input.append(elem);
                group.append(label, input);
            } else {
                const lopts = { for: opts.for || attrs.id, class: "form-label " + class_label };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                const label = app.$elem("label", lopts);
                label.append(...this.sanitize(opts.label));

                if (opts.floating) {
                    if (!opts.placeholder) app.$attr(elem, "placeholder", "");
                    group.classList.add("form-floating");
                    group.append(elem);
                    if (opts.label) group.append(label);
                } else {
                    if (opts.label) group.append(label);
                    group.append(elem);
                }
            }
            if (opts.text_valid) {
                group.append(app.$eem("div", { class: "valid-feedback", text: opts.text_valid }));
            }
            if (opts.text_invalid) {
                group.append(app.$elem("div", { class: "invalid-feedback", text: opts.text_invalid }));
            }
            if (opts.class_suffix || opts.text_suffix) {
                group.append(app.$elem("div", { class: opts.class_suffix || this.options.class_suffix, text: opts.text_suffix }));
            }
            if (opts.autofocus) this.autofocus = elem;
        }

        const processEntry = (type, entry) => {
            opts = {}, children = [], attrs = {};
            label = elem = group = html = undefined;

            if (Array.isArray(entry)) {
                children = entry;
            } else
            if (typeof entry == "string") {
                opts.label = entry;
            } else {
                for (const p in entry) opts[p] = entry[p];
            }
            for (const p in opts) {
                if (p == "html") {
                    html = opts.nosanitize ? app.$parse(opts[p], 1) : this.sanitize(opts[p]);
                } else
                if (!/^(tab_|attrs_|click_|list_|class_|text_|icon_|size_|label|for)/.test(p)) {
                    attrs[p] = opts[p];
                }
            }

            // Create a random id for the input if none provided
            if (!attrs.id) attrs.id = "bpi" + String(Math.random()).substr(2);
            attrs["data-formid"] = "#" + this.formid;

            // Choose to the current tab content
            if (opts.tab_id && tabs[opts.tab_id]) {
                parent = tabs[opts.tab_id];
            }

            // Check if type is a shortcut for input
            if (inputs.includes(type)) {
                attrs.type = type;
                type = "input";
            }

            switch (type) {
            case "button":
            case "submit":
            case "input":
            case "textarea":
                attrs.type = (attrs.type === undefined ? "text" : attrs.type);
                if (attrs.type == "hidden") {
                    elem = app.$elem(type, attrs);
                    parent.append(elem);
                    break;
                }
                if (!attrs.class) attrs.class = this.options["class_" + attrs.type];

            case "select":
                if (type == "select" && Array.isArray(attrs.options)) {
                    for (const j in attrs.options) {
                        const option = {}, opt = attrs.options[j];
                        if (typeof opt == "string") {
                            if (attrs.value && attrs.value == opt) option.selected = true;
                            option.text = this.escape(opt);
                            children.push(app.$elem("option", option));
                        } else
                        if (opt?.name) {
                            option.value = attrs.options[j].value || "";
                            option.selected = typeof opt.selected == "boolean" ? opt.selected : attrs.value && attrs.value == option.value ? true : false;
                            if (opt.label) option.label = opt.label;
                            if (typeof opt.disabled == "boolean") option.disabled = opt.disabled;
                            option.text = this.escape(opt.name);
                            children.push(app.$elem("option", option));
                        }
                    }
                    delete attrs.options;
                    delete attrs.value;
                }

                // Special case for checkbox
                if (["radio", "checkbox"].includes(attrs.type) && !opts.raw) {
                    label = app.$elem('label', {
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
                    elem = app.$elem('div', { class: class_check });
                    elem.append(app.$elem(type, attrs), label);

                    if (opts.class_append || opts.text_append) {
                        label.append(app.$elem("span", { class: opts.class_append || "", text: opts.text_append }));
                    }
                    // Clear label to not add as header, it was added before
                    if (!opts.input_label) delete opts.label;
                } else {
                    if (["select", "range"].includes(attrs.type)) {
                        attrs.class = `form-${attrs.type} ${attrs.class || ""}`;
                    }
                    attrs.class = attrs.class || "form-control";
                    if (type == "textarea") {
                        delete attrs.value;
                        elem = app.$elem(type, attrs);
                        if (opts.value) elem.append(opts.value);
                    } else {
                        elem = app.$elem(type, attrs);
                    }
                }
                addElement(type);
                break;

            case "checkboxes":
                elem = app.$elem("div", { class: opts.class_container });
                for (const i in attrs.options) {
                    let o = attrs.options[i];
                    if (!o?.name) continue;
                    const title = o.title;
                    const label = app.$elem('label', { class: "form-check-label", for: attrs.id + "-" + i, text: o.label || o.name });
                    o = Object.assign(o, {
                        id: attrs.id + "-" + i,
                        class: `form-check-input ${o.class || ""}`,
                        role: opts.switch && "switch",
                        type: attrs.type || "checkbox",
                        label: undefined,
                        title: undefined,
                    });
                    let c = "form-check";
                    if (o.switch || opts.switch) c += " form-switch";
                    if (o.inline || opts.inline) c += " form-check-inline";
                    if (o.reverse || opts.reverse) c += " form-check-reverse";
                    if (o.class_check || opts.class_check) c += " " + (o.class_check || opts.class_check);
                    const div = app.$elem('div', { class: c, title: title });
                    div.append(app.$elem(`input`, o), label);
                    children.push(div);
                }
                for (const p of ["switch", "inline", "reverse", "options", "value", "type"]) delete attrs[p];
                addElement(type);
                break;

            case "alert":
            case "success":
                this[type] = elem = app.$elem("div", attrs);
                parent.append(elem);
                break;

            case "row":
                var row = app.$elem("div", { class: opts.class_row || this.options.class_row || "row" });
                parent.append(row);
                for (const subEntry of children) {
                    const col = app.$elem("div", { class: subEntry.class_col || this.options.class_col || "col-auto" });
                    row.append(col);
                    const oldParent = parent;
                    parent = col;
                    for (const type in subEntry) {
                        processEntry(type, subEntry[type]);
                    }
                    parent = oldParent;
                }
                break;

            default:
                elem = app.$elem(type, attrs);
                if (html) elem.append(...html);
                if (opts.class_append || opts.text_append) {
                    elem.append(app.$elem("span", { class: opts.class_append || "", text: opts.text_append }));
                }
                if (opts.name && opts.label) {
                    addElement(type);
                } else {
                    parent.append(elem);
                }
            }
        }

        // Iterate over entries
        for (const c in this.options.content) {
            const entry = this.options.content[c];
            switch (typeof entry) {
            case "string":
                // HTML string
                this.form.append(...this.sanitize(entry));
                break;

            case "object":
                for (const type in entry) {
                    processEntry(type, entry[type]);
                }
                break;
            }
        }

        // Footer
        this.footer = app.$elem('div', { class: this.options.class_footer });
        if (this.options.show_footer) this.content.append(this.footer);

        for (const i in this.options.footer) {
            const entry = this.options.footer[i];
            let div;
            switch (typeof entry) {
            case "string":
                this.footer.append(...this.sanitize(entry));
                break;

            case "object":
                div = app.$elem('div', { class: this.options.class_options });
                this.footer.append(div)
                for (const type in entry) {
                    const opts = typeof entry[type] == "string" ? { text: entry[type] } : entry[type], attrs = {};
                    for (const p in opts) {
                        if (!/^(type|[0-9]+)$|^(class|text|icon|size)_/.test(p)) attrs[p] = opts[p];
                    }
                    div.append(app.$elem(opts.type || type, attrs));
                }
                break;
            }
        }

        for (const i in this.options.buttons) {
            var name = this.options.buttons[i];
            if (!name) continue;
            const btn = app.$elem("button", {
                type: "button",
                class: `${this.options.class_buttons} ${this.options["class_" + name] || this.options.class_button}`,
                "data-callback": name,
                "data-formid": this.formid,
                click: (event) => { self.callback(event.target.dataset.callback, event) }
            });
            btn.append(...this.sanitize(this.options["text_" + name] || name));
            if (this.options["icon_" + name]) {
                btn.append(app.$elem("i", { class: this.options["icon_" + name] }));
            }
            this["btn_" + name] = btn;
            this.footer.append(btn);
        }

        // Setup events for dismiss and complete
        app.$on(this.modal, 'show.bs.modal', (e) => {
            self.options.show.call(self.options.self, e, self);
        });
        app.$on(this.modal, 'shown.bs.modal', (e) => {
            if (self.options.autofocus) {
                var focus = self.autofocus ||
                            Array.from(app.$all("input,select,textarea", this.form)).
                                  find(el => !(el.readOnly||el.disabled||el.type=='hidden'));
                if (focus) focus.focus();
            }
            self.options.shown.call(self.options.self, e, self);
        });
        app.$on(this.modal, 'hide.bs.modal', (e) => {
            e.bootpopupButton = self._callback;
            self.options.dismiss.call(self.options.self, e, self);
        });
        app.$on(this.modal, 'hidden.bs.modal', (e) => {
            e.bootpopupButton = self._callback;
            self.options.complete.call(self.options.self, e, self);
            bootstrap.Modal.getOrCreateInstance(self.modal).dispose();
        });

        // Add window to body
        document.body.append(this.modal);
    }

    this.show = function() {
        // Call before event
        this.options.before(this);

        // Fire the modal window
        bootstrap.Modal.getOrCreateInstance(this.modal).show();
    }

    this.showAlert = function(text, opts) {
        const type = opts?.type || "alert", element = this[type];
        if (!element) return;
        if (text?.message) text = text.message;
        if (typeof text != "string") return;
        if (!opts?.safe) text = app.textToEntity(text.replace(/<br>/g, "\n"));
        const alert = app.$elem(`div`, { class: this.options['class_' + type], role: "alert" });
        alert.append(...self.sanitize(text));
        if (opts?.dismiss) {
            alert.classList.add("alert-dismissibl");
            alert.append(app.$elem(`button`, { type: "button", class: "btn-close", 'data-bs-dismiss': "alert", 'aria-label': "Close" }));
        } else {
            setTimeout(() => { app.$empty(element) }, this.delay || 10000);
        }
        app.$empty(element).append(alert);
        if (this.options.scroll) element.scrollIntoView();
        return null;
    }

    this.validate = function() {
        this.form.classList.add('was-validated')
        return this.form.checkValidity();
    }

    this.sanitize = function(str) {
        return !str ? [] : this.options.sanitizer?.run(str, 1) || [str];
    }

    var _emap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' };
    this.escape = function(str) {
        if (typeof str != "string") return str;
        return str.replace(/([&<>'"`])/g, (_, n) => (_emap[n] || n));
    }

    this.data = function() {
        var d = { list: [], obj: {} }, e, n, v, l = app.$all(this.options.inputs.join(","), this.form);
        for (let i = 0; i < l.length; i++) {
            e = l[i];
            n = e.name;
            if (!n || e.disabled) continue;
            if (/radio|checkbox/i.test(e.type) && !e.checked) continue;
            v = e.value;
            if (v === undefined || v === "") {
                if (!this.options.empty) continue;
                v = "";
            }
            d.list.push({ name: n, value: v })
        }
        for (const v of d.list) d.obj[v.name] = v.value;
        return d;
    },

    this.callback = function(name, event) {
        if (this.options.debug) console.log("callback:", name, event);
        var func = this.options[name];        // Get function to call
        if (typeof func != "function") return;
        this._callback = name;
        // Perform callback
        var a = this.data();
        var ret = func.call(this.options.self, a.obj, a.list, event);
        // Hide window
        if (ret !== null) bootstrap.Modal.getOrCreateInstance(this.modal).hide();
        return ret;
    }

    this.addOptions = function(...args) {
        for (const opts of args) {
            for (const key in opts) {
                if (typeof opts[key] != "undefined") {
                    // Chaining all callbacks together, not replacing
                    if (typeof this.options[key] == "function") {
                        const _o = this.options[key], _n = opts[key];
                        this.options[key] = function(...args) {
                            if (typeof _o == "function") _o.apply(this, args);
                            return _n.apply(this, args);
                        }
                    } else {
                        this.options[key] = opts[key];
                    }
                }
            }
        }
        // Determine what is the best action if none is given
        if (this.options.onsubmit == "close") {
            if (this.options.buttons.includes("ok")) this.options.onsubmit = "ok"; else
            if (this.options.buttons.includes("yes")) this.options.onsubmit = "yes";
        }

        return this.options;
    }

    this.close = function() { return this.callback("close") }

    this.addOptions(...bootpopup.plugins, ...args);
    this.create();
    this.show();

    return this;
}
bootpopup.plugins = [];
