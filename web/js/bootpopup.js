/*!
 * Modified by vlad
 *
 * Popup dialog boxes for Bootstrap - http://www.bootpopup.tk
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
    var inputs = [ "text", "color", "url", "password", "hidden", "file", "number",
       "email", "reset", "date", "time", "checkbox", "radio", "datetime-local",
       "week", "tel", "search", "range", "reset", "month", "image", "button" ];

    // Create a new instance if this is not
    if (!(this instanceof bootpopup)) return new bootpopup(...args);

    var self = this;
    // Create a global random ID for the form
    this.formid = "bpf" + String(Math.random()).substr(2);

    this.options = {
        id: "",
        self: self,
        title: document.title,
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
        class_modal: "modal fade",
        class_dialog: "modal-dialog",
        class_title: "modal-title",
        class_content: "modal-content",
        class_body: "modal-body",
        class_header: "modal-header",
        class_footer: "modal-footer",
        class_group: "form-group",
        class_options: "options text-center text-md-right",
        class_alert: "alert alert-danger collapse fade",
        class_info: "alert alert-info collapse fade",
        class_x: "",
        class_form: "",
        class_label: "",
        class_ok: "btn btn-primary",
        class_yes: "btn btn-primary",
        class_no: "btn btn-primary",
        class_agree: "btn btn-primary",
        class_cancel: "btn btn-default btn-secondary",
        class_close: "btn btn-primary",
        class_button1: "btn btn-primary",
        class_button2: "btn btn-primary",
        class_tabs: "nav nav-tabs mb-4",
        class_tablink: "nav-link",
        class_tabcontent: "tab-content",
        text_ok: "OK",
        text_yes: "Yes",
        text_no: "No",
        text_agree: "Agree",
        text_cancel: "Cancel",
        text_close: "Close",
        text_button1: "",
        text_button2: "",
        icon_ok: "",
        icon_yes: "",
        icon_no: "",
        icon_cancel: "",
        icon_close: "",
        icon_agree: "",
        icon_button1: "",
        icon_button2: "",
        center: false,
        scroll: false,
        horizontal: true,
        alert: false,
        info: false,
        backdrop: true,
        keyboard: true,
        autofocus: true,
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
        button1: function() {},
        button2: function() {},
        show: function() {},
        shown: function() {},
        complete: function() {},
        submit: function(e) {
            self.callback(self.options.onsubmit, e);
            return false;    // Cancel form submision
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
        if (this.options.backdrop !== true) opts["data-backdrop"] = typeof this.options.backdrop == "string" ? this.options.backdrop : false;
        if (!this.options.keyboard) opts["data-keyboard"] = false;
        this.modal = $('<div></div>', opts);
        this.dialog = $('<div></div>', { class: class_dialog, role: "document" });
        this.content = $('<div></div>', { class: this.options.class_content });
        this.dialog.append(this.content);
        this.modal.append(this.dialog);

        // Header
        if (this.options.show_header && this.options.title) {
            this.header = $('<div></div>', { class: this.options.class_header });
            const title = $('<h5></h5>', { class: this.options.class_title, id: "bootpopup-title" });
            title.append(this.sanitize(this.options.title));
            this.header.append(title);

            if (this.options.show_close) {
                const close = $('<button type="button" class="close" data-dismiss="modal" aria-label="Close"></button>');
                $('<span></span>', { class: this.options.class_x, "aria-hidden": "true" }).append("&times;").appendTo(close);
                this.header.append(close);
            }
            this.content.append(this.header);
        }

        // Body
        var class_form = this.options.class_form;
        if (!class_form && this.options.horizontal) class_form = "form-horizontal";
        this.body = $('<div></div>', { class: this.options.class_body });
        this.form = $("<form></form>", { id: this.formid, class: class_form, role: "form", submit: function(e) { return self.options.submit(e); } });
        this.body.append(this.form);
        this.content.append(this.body);

        if (this.options.data) {
            this.form.data("form-data", this.options.data);
        }
        if (this.options.alert) {
            this.alert = $("<div></div>", { class: this.options.class_alert }).appendTo(this.form);
        }
        if (this.options.info) {
            this.info = $("<div></div>", { class: this.options.class_info }).appendTo(this.form);
        }

        var tabs = {}, form = this.form, toggle = /nav-pills/.test(this.options.class_tabs) ? "pill" : "tab";
        if (this.options.tabs) {
            this.tabs = $("<div></div>", { class: this.options.class_tabs, role: "tablist" }).appendTo(this.form);
            this.tabContent = $("<div></div>", { class: this.options.class_tabcontent }).appendTo(this.form);
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
                $("<a></a>", { class: this.options.class_tablink + (active ? " active" : ""), "data-toggle": toggle, id: tid + "0", href: "#" + tid, role: "tab", "aria-controls": tid, "aria-selected": false }).
                  append(this.options.tabs[p]).appendTo(this.tabs);
                tabs[p] = $("<div></div", { class: "tab-pane fade" + (active ? " show active": ""), id: tid, role: "tabpanel", "aria-labelledby": tid + "0" }).
                            appendTo(this.tabContent);
            }
        }

        var children, attrs, label, elem, group;

        const addElement = (type) => {
            if (!this.options.inputs.includes(type)) {
                this.options.inputs.push(type);
            }
            if (opts.class_append || opts.text_append) {
                elem.append($("<span></span>", { class: opts.class_append || "" }).append(opts.text_append));
            }
            if (opts.text_input_button) {
                elem = $('<div></div>', { class: 'input-group ' + (opts.class_input_group || "") }).append(elem);
                const append = $('<div></div>"', { class: "input-group-append" }).appendTo(elem);
                if (opts.list_input_button) {
                    $('<button></button>', {
                        class: "btn dropdown-toggle " + (opts.class_input_button || ""),
                        type: "button",
                        'data-toggle': "dropdown",
                        'aria-haspopup': "true",
                        'aria-expanded': "false"
                    }).append(opts.text_input_button).appendTo(append);

                    var menu = $('<div></div>', { class: "dropdown-menu " + (opts.class_input_menu || "") }).appendTo(append);
                    for (const l in opts.list_input_button) {
                        let n = opts.list_input_button[l], v = this.escape(n);
                        if (typeof n == "object") v = this.escape(n.value), n = this.escape(n.name);
                        if (n == "-") {
                            $('<div></div>', { class: "dropdown-divider" }).appendTo(menu);
                        } else {
                            $('<a></a>', {
                                class: "dropdown-item " + (opts.class_list_input_item || ""),
                                role: "button",
                                'data-value': v || n,
                                'data-form': this.formid,
                                onclick: opts.click_input_button ? "(" + opts.click_input_button + ")(this,arguments[0])" :
                                `$('#${attrs.id}').val(('${v || n}'))`,
                            }).append(n).appendTo(menu);
                        }
                    }
                } else {
                    const bopts = { class: "btn " + (opts.class_input_button || ""), type: "button", 'data-form': this.formid };
                    if (opts.click_input_button) bopts.onclick = "(" + opts.click_input_button + ")(this,arguments[0])";
                    for (const b in opts.attrs_input_button) bopts[b] = opts.attrs_input_button[b];
                    $('<button></button>', bopts).append(opts.text_input_button).appendTo(append);
                }
            }

            for (const k in children) elem.append(children[k]);
            var class_group = opts.class_group || this.options.class_group;
            var class_label = (opts.class_label || this.options.class_label) + " " + (attrs.value ? "active" : "");
            var gopts = { class: class_group, title: attrs.title };
            for (const p in opts.attrs_group) gopts[p] = opts.attrs_group[p];

            group = $('<div></div>', gopts).appendTo(form);
            if (opts.class_prefix || opts.text_prefix) {
                group.append($("<span></span>", { class: opts.class_prefix || "" }).append(opts.text_prefix || ""));
            }
            if (this.options.horizontal) {
                group.addClass("row");
                class_label += " col-form-label " + (opts.size_label || this.options.size_label);
                const lopts = { for: opts.for || attrs.id, class: class_label, html: this.sanitize(opts.label) };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                group.append($("<label></label>", lopts));
                group.append($('<div></div>', { class: opts.size_input || this.options.size_input }).append(elem));
            } else {
                const lopts = { for: opts.for || attrs.id, class: class_label, html: this.sanitize(opts.label) };
                for (const p in opts.attrs_label) lopts[p] = opts.attrs_label[p];
                if (opts.label) group.append($("<label></label>", lopts));
                group.append(elem);
            }
            if (opts.class_suffix || opts.text_suffix) {
                group.append($("<div></div>", { class: opts.class_suffix || "" }).append(opts.text_suffix));
            }
            if (opts.autofocus) this.autofocus = elem;
        }

        // Iterate over entries
        for (const c in this.options.content) {
            const entry = this.options.content[c];
            switch (typeof entry) {
            case "string":
                // HTML string
                form.append(this.sanitize(entry));
                break;

            case "object":
                for (let type in entry) {
                    opts = {}, children = [], attrs = {};
                    label = elem = group = undefined;

                    if (typeof entry[type] == "string") {
                        opts.label = entry[type];
                    } else {
                        for (const p in entry[type]) opts[p] = entry[type][p];
                    }
                    for (const p in opts) {
                        if (p == "html" && !opts.nosanitize) attrs[p] = this.sanitize(opts[p]); else
                        if (!/^(tab_|attrs_|click_|list_|class_|text_|icon_|size_|label|for)/.test(p)) attrs[p] = opts[p];
                    }

                    // Convert functions to string to be used as callback
                    for (const a in attrs) {
                        if (typeof attrs[a] === "function") {
                            attrs[a] = "return (" + attrs[a] + ")(this,arguments[0])";
                        }
                    }

                    // Create a random id for the input if none provided
                    if (!attrs.id) attrs.id = "bpi" + String(Math.random()).substr(2);

                    // Choose to the current tab content
                    if (opts.tab_id && tabs[opts.tab_id]) {
                        form = tabs[opts.tab_id];
                    }

                    // Check if type is a shortcut for input
                    if (inputs.includes(type)) {
                        attrs.type = type;
                        type = "input";
                    }

                    switch (type) {
                    case "input":
                    case "textarea":
                    case "button":
                    case "submit":
                        attrs.type = (typeof attrs.type === "undefined" ? "text" : attrs.type);
                        if (attrs.type == "hidden") {
                            elem = $("<" + type + "></" + type + ">", attrs).appendTo(form);
                            break;
                        }

                    case "select":
                        if (type == "select" && Array.isArray(attrs.options)) {
                            for (const j in attrs.options) {
                                const option = {}, opt = attrs.options[j];
                                if (typeof opt == "string") {
                                    if (attrs.value && attrs.value == opt) option.selected = true;
                                    children.push($("<option></option>", option).append(this.escape(opt)));
                                } else
                                if (opt.name) {
                                    option.value = attrs.options[j].value || "";
                                    option.selected = typeof opt.selected == "boolean" ? opt.selected : attrs.value && attrs.value == option.value ? true : false;
                                    if (opt.label) option.label = opt.label;
                                    if (typeof opt.disabled == "boolean") option.disabled = opt.disabled;
                                    children.push($("<option></option>", option).append(this.escape(opt.name)));
                                }
                            }
                            delete attrs.options;
                            delete attrs.value;
                        }

                        // Special case for checkbox
                        if (/radio|checkbox/.test(attrs.type) && !opts.raw) {
                            attrs.class = attrs.class || (opts.custom || opts.switch ? "custom-control-input": "form-check-input");
                            label = $('<label></label>', { class: opts.class_input_label || (opts.custom || opts.switch ? "custom-control-label" : "form-check-label"), for: opts.for || attrs.id }).
                                    append(opts.input_label || opts.label);
                            elem = $('<div></div>', { class: opts.class_check || (opts.custom || opts.switch ? `custom-control custom-${opts.switch ? "switch" : attrs.type}` : "form-check") }).
                                   append($("<" + type + "/>", attrs)).
                                   append(label);
                            if (opts.class_append || opts.text_append) {
                                label.append($("<span></span>", { class: opts.class_append || "" }).append(opts.text_append || ""));
                            }
                            // Clear label to not add as header, it was added before
                            if (!opts.input_label) delete opts.label;
                        } else
                        if (attrs.type == "file" && !opts.raw) {
                            attrs.class = attrs.class || "custom-file-input";
                            label = $('<label></label>', { class: opts.class_input_label || "custom-file-label", for: opts.for || attrs.id }).
                                    append(opts.input_label || opts.label);
                            elem = $('<div></div>', { class: opts.class_check || "custom-file" }).
                                   append($("<" + type + "/>", attrs)).
                                   append(this.escape(label));
                            if (opts.class_append || opts.text_append) {
                                label.append($("<span></span>", { class: opts.class_append || "" }).append(opts.text_append || ""));
                            }
                            // Clear label to not add as header, it was added before
                            if (!opts.input_label) delete opts.label;
                        } else {
                            attrs.class = attrs.class || "form-control";
                            if (type == "textarea") {
                                delete attrs.value;
                                elem = $("<" + type + "/>", attrs);
                                if (opts.value) elem.append(opts.value);
                            } else {
                                elem = $("<" + type + "/>", attrs);
                            }
                        }
                        addElement(type);
                        break;

                    case "alert":
                    case "success":
                        this[type] = elem = $("<div></div>", attrs).appendTo(form);
                        break;

                    default:
                        elem = $("<" + type + "></" + type + ">", attrs);
                        if (opts.name && opts.label) {
                            addElement(type);
                        } else {
                            elem.appendTo(form);
                            if (opts.class_append || opts.text_append) {
                                elem.append($("<span></span>", { class: opts.class_append || "" }).append(opts.text_append));
                            }
                        }
                    }
                }
                break;
            }
        }

        // Footer
        this.footer = $('<div></div>', { class: this.options.class_footer });
        if (this.options.show_footer) this.content.append(this.footer);

        for (const i in this.options.footer) {
            const entry = this.options.footer[i];
            let div;
            switch (typeof entry) {
            case "string":
                this.footer.append(this.sanitize(entry));
                break;

            case "object":
                div = $('<div></div>', { class: this.options.class_options }).appendTo(this.footer);
                for (let type in entry) {
                    const opts = typeof entry[type] == "string" ? { text: entry[type] } : entry[type], attrs = {};
                    for (const p in opts) {
                        if (!/^(type|[0-9]+)$|^(class|text|icon|size)_/.test(p)) attrs[p] = opts[p];
                    }
                    for (const attribute in attrs) {
                        if (typeof attrs[attribute] === "function") {
                            attrs[attribute] = "(" + attrs[attribute] + ")(this)";
                        }
                    }
                    type = opts.type || type;
                    div.append($("<" + type + "></" + type + ">", attrs));
                }
                break;
            }
        }

        for (const i in this.options.buttons) {
            var item = this.options.buttons[i];
            if (!item) continue;
            this["btn_" + item] = $("<button></button>", {
                type: "button",
                html: this.sanitize(this.options["text_" + item]),
                class: this.options["class_" + item],
                "data-callback": item,
                "data-form": this.formid,
                click: function(event) { self.callback($(event.target).data("callback"), event) }
            }).appendTo(this.footer);
            if (this.options["icon_" + item]) {
                this["btn_" + item].append($("<i></i>", { class: this.options["icon_" + item] }));
            }
        }

        // Setup events for dismiss and complete
        this.modal.on('show.bs.modal', function(e) {
            self.options.show.call(self.options.self, e, self);
        });
        this.modal.on('shown.bs.modal', function(e) {
            if (self.options.autofocus) {
                var focus = self.autofocus || self.form.find("input,select,textarea").filter(":not([readonly='readonly']):not([disabled='disabled']):not([type='hidden'])").first();
                if (focus) focus.focus();
            }
            self.options.shown.call(self.options.self, e, self);
        });
        this.modal.on('hide.bs.modal', function(e) {
            e.bootpopupButton = self._callback;
            self.options.dismiss.call(self.options.self, e, self);
        });
        this.modal.on('hidden.bs.modal', function(e) {
            e.bootpopupButton = self._callback;
            self.options.complete.call(self.options.self, e, self);
            self.modal.remove();    // Delete window after complete
        });

        // Add window to body
        $(document.body).append(this.modal);
    }

    this.show = function() {
        // Call before event
        this.options.before(this);

        // Fire the modal window
        this.modal.modal();
    }

    this.showAlert = function(text, opts) {
        if (!this[opts?.type || "alert"]) return;
        if (text?.message) text = text.message;
        if (typeof text != "string") return;
        if (!opts?.safe) text = bkjs.textToEntity(text.replace(/<br>/g, "\n"));
        text = self.sanitize(text).replace(/\n/g, "<br>");
        $(this[opts?.type || "alert"]).empty().append(`<p>${text}</p>`).show();
        setTimeout(() => { $(this[opts?.type || "alert"]).hide() }, this.delay || 10000);
        return null;
    }

    this.sanitize = function(str) {
        return this.options.sanitizer ? this.options.sanitizer.run(str) : str;
    }

    var _emap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;' };
    this.escape = function(str) {
        if (typeof str != "string") return str;
        return str.replace(/([&<>'"`])/g, (_, n) => (_emap[n] || n));
    }

    this.data = function() {
        var d = [], e, n, v, l = this.form.find(this.options.inputs.join(","));
        for (let i = 0; i < l.length; i++) {
            e = l[i];
            n = e.name || $(e).attr("name");
            if (!n || e.disabled) continue;
            if (/radio|checkbox/i.test(e.type) && !e.checked) continue;
            v = $(e).val();
            if (v === undefined || v === "") continue;
            if (Array.isArray(v)) {
                for (const a of v) d.push({ name: n, value: a })
            } else {
                d.push({ name: n, value: v })
            }
        }
        return d;
    },

    this.callback = function(name, event) {
        var func = this.options[name];        // Get function to call
        if (typeof func !== "function") return;
        this._callback = name;
        // Perform callback
        var a = this.data(), d = {};
        for (const v of a) d[v.name] = v.value;
        var ret = func.call(this.options.self, d, a, event);
        // Hide window
        if (ret !== null) this.modal.modal("hide");
        return ret;
    }

    this.addOptions = function(...args) {
        for (const opts of args) {
            for (const key in opts) {
                if (key in this.options && typeof opts[key] != "undefined") this.options[key] = opts[key];
            }
        }
        // Determine what is the best action if none is given
        if (this.options.buttons.includes("ok")) this.options.onsubmit = "ok"; else
        if (this.options.buttons.includes("yes")) this.options.onsubmit = "yes";

        return this.options;
    }

    this.shown = function() { return this.callback("shown"); }
    this.dismiss = function() { return this.callback("dismiss"); }
    this.submit = function() { return this.callback("submit"); }
    this.close = function() { return this.callback("close"); }
    this.ok = function() { return this.callback("ok"); }
    this.cancel = function() { return this.callback("cancel"); }
    this.yes = function() { return this.callback("yes"); }
    this.no = function() { return this.callback("no"); }
    this.agree = function() { return this.callback("agree"); }
    this.button1 = function() { return this.callback("button1"); }
    this.button2 = function() { return this.callback("button2"); }

    this.addOptions(...args, window.bootpopupOptions);
    this.create();
    this.show();
}

