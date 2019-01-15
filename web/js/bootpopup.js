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


var INPUT_SHORTCUT_TYPES = [ "button", "text", "submit", "color", "url", "password",
    "hidden", "file", "number", "email", "reset", "date", "checkbox", "radio" ];


function bootpopup(options)
{
    // Create a new instance if this is not
    if (!(this instanceof bootpopup)) return new bootpopup(Array.prototype.slice.call(arguments));

    var self = this;
    // Create a global random ID for the form
    this.formid = "bootpopup-form" + String(Math.random()).substr(2);

    this.options = {
        title: document.title,
        show_close: true,
        show_header: true,
        size: "normal",
        size_labels: "col-sm-4",
        size_inputs: "col-sm-8",
        content: [],
        onsubmit: "close",
        buttons: ["close"],
        class_dialog: "modal-dialog",
        class_title: "modal-title",
        class_group: "form-group",
        class_header: "modal-header",
        class_x: "",
        class_form: "",
        class_label: "",
        class_ok: "btn btn-primary",
        class_yes: "btn btn-primary",
        class_no: "btn btn-primary",
        class_cancel: "btn btn-default",
        class_close: "btn btn-primary",
        text_ok: "OK",
        text_yes: "Yes",
        text_no: "No",
        text_cancel: "Cancel",
        text_close: "Close",
        centered: false,
        horizontal: true,

        before: function() {},
        dismiss: function() {},
        close: function() {},
        ok: function() {},
        cancel: function() {},
        yes: function() {},
        no: function() {},
        complete: function() {},
        submit: function(e) {
            self.callback(self.options.onsubmit, e);
            return false;    // Cancel form submision
        }
    }

    this.addOptions = function(options) {
        var buttons = [];
        if (Array.isArray(options)) {
            options = options.reduce(function(x, y) {
                for (var p in y) x[p] = y[p];
                return x;
            }, {});
        }
        for (var key in options) {
            if (key in this.options) this.options[key] = options[key];
            // If an event for a button is given, show the respective button
            if (["close", "ok", "cancel", "yes", "no"].indexOf(key) >= 0) buttons.push(key);
        }
        // Copy news buttons to this.options.buttons
        if (buttons.length > 0) {
            // Clear default buttons if new are not given
            if (!("buttons" in options)) this.options.buttons = [];
            buttons.forEach(function(item) {
                if (self.options.buttons.indexOf(item) < 0) self.options.buttons.push(item);
            });
        }
        // Determine what is the best action if none is given
        if (typeof options.onsubmit !== "string") {
            if (this.options.buttons.indexOf("close") > 0) this.options.onsubmit = "close";
            else if (this.options.buttons.indexOf("ok") > 0) this.options.onsubmit = "ok";
            else if (this.options.buttons.indexOf("yes") > 0) this.options.onsubmit = "yes";
        }
        return this.options;
    }

    this.create = function() {
        var bs4 = window.bootstrap;
        // Option for modal dialog size
        var class_dialog = this.options.class_dialog;
        if (this.options.size == "xlarge") class_dialog += " modal-xl";
        if (this.options.size == "large") class_dialog += " modal-lg";
        if (this.options.size == "small") class_dialog += " modal-sm";
        if (this.options.centered) class_dialog += " modal-dialog-centered";

        // Create HTML elements for modal dialog
        this.modal = $('<div class="modal fade" tabindex="-1" role="dialog" aria-labelledby="bootpopup-title" aria-hidden="true"></div>');
        this.dialog = $('<div></div>', { class: class_dialog, role: "document" });
        this.content = $('<div class="modal-content"></div>');
        this.dialog.append(this.content);
        this.modal.append(this.dialog);

        // Header
        if (this.options.show_header) {
            this.header = $('<div></div>', { class: this.options.class_header });
            var title = $('<h5></h5>', { class: this.options.class_title, id: "bootpopup-title" });
            title.append(this.options.title);
            this.header.append(title);

            if (this.options.show_close) {
                var close = $('<button type="button" class="close" data-dismiss="modal" aria-label="Close"></button>');
                $('<span></span>', { class: this.options.class_x, "aria-hidden": "true" }).append("&times;").appendTo(close);
                if (bs4) this.header.append(close); else close.insertBefore(title);
            }
            this.content.append(this.header);
        }

        // Body
        var class_form = this.options.class_form;
        if (!class_form && this.options.horizontal) class_form = "form-horizontal";
        this.body = $('<div class="modal-body"></div>');
        this.form = $("<form></form>", { id: this.formid, class: class_form, submit: function(e) { return self.options.submit(e); } });
        this.body.append(this.form);
        this.content.append(this.body);

        // Iterate over entries
        for (var i in this.options.content) {
            var entry = this.options.content[i];
            switch(typeof entry) {
                case "string":
                    // HTML string
                    this.form.append(entry);
                    break;

                case "object":
                    for (var type in entry) {
                        var opts = entry[type], children = [], attrs = {}, input, group;

                        if (typeof opts == "string") opts = { label: opts };
                        for (var p in opts) {
                            if (!/^(class|text)_/.test(p)) attrs[p] = opts[p];
                        }

                        // Convert functions to string to be used as callback
                        for (var attribute in attrs) {
                            if (typeof attrs[attribute] === "function") {
                                attrs[attribute] = "(" + attrs[attribute] + ")(this)";
                            }
                        }

                        // Check if type is a shortcut for input
                        if (INPUT_SHORTCUT_TYPES.indexOf(type) >= 0) {
                            attrs.type = type;  // Add attribute for type
                            type = "input";     // Continue to input
                        }

                        switch (type) {
                        case "input":
                        case "select":
                        case "textarea":
                            // Create a random id for the input if none provided
                            attrs.id = (typeof attrs.id === "undefined" ? "bootpopup-input" + String(Math.random()).substr(2) : attrs.id);
                            attrs.type = (typeof attrs.type === "undefined" ? "text" : attrs.type);

                            if (type == "select" && Array.isArray(attrs.options)) {
                                for (var i in attrs.options) {
                                    var option = {};
                                    if (typeof attrs.options[i] == "string") {
                                        if (attrs.value && attrs.value == attrs.options[i]) option.selected = true;
                                        children.push($("<option></option>", option).append(attrs.options[i]));
                                    } else
                                    if (attrs.options[i].name) {
                                        option.value = attrs.options[i].value || "";
                                        if (attrs.value && attrs.value == option.value) option.selected = true;
                                        children.push($("<option></option>", option).append(attrs.options[i].name));
                                    }
                                }
                                delete attrs.options;
                                delete attrs.value;
                            }

                            // Special case for checkbox
                            if (/radio|checkbox/.test(attrs.type)) {
                                if (bs4) {
                                    attrs.class = attrs.class || "form-check-input";
                                    var class_check = opts.class_check || "form-check";
                                    input = $('<div class="' + class_check + '"></div>').
                                            append($("<" + type + "/>", attrs)).
                                            append($('<label></label>', { class: "form-check-label", for: attrs.id }).append(attrs.label));

                                } else {
                                    attrs.class = attrs.class || "";
                                    input = $('<div class="' + attrs.type + '"></div>').
                                            append($('<label></label>').append($("<" + type + "/>", attrs)).
                                            append(attrs.label));
                                }
                                // Clear label to not add as header, it was added before
                                delete attrs.label;
                            } else {
                                attrs.class = attrs.class || "form-control";
                                input = $("<" + type + "/>", attrs);
                                if (type == "textarea") {
                                    if (attrs.value) {
                                        input.append(attrs.value);
                                    }
                                }
                            }
                            for (var i in children) input.append(children[i]);

                            var class_group = this.options.class_group + " " + (opts.class_group || "");
                            var class_label = this.options.class_label + " " + (opts.class_label || "") + " " + (attrs.value ? "active" : "");
                            if (bs4) {
                                if (this.options.horizontal) class_group += " row";
                                group = $('<div></div>', { class: class_group }).appendTo(this.form);
                                if (this.options.horizontal) {
                                    class_label += " col-form-label " + this.options.size_labels;
                                    group.append($("<label></label>", { for: attrs.id, class: class_label, text: attrs.label }));
                                    group.append($('<div></div>', { class: this.options.size_inputs }).append(input));
                                    if (opts.class_suffix) group.append($("<div></div>", { class: opts.class_suffix }).append(opts.text_suffix || ""));
                                } else {
                                    if (opts.class_prefix) group.append($("<span></span>", { class: opts.class_prefix }).append(opts.text_prefix || ""));
                                    group.append(input);
                                    group.append($("<label></label>", { for: attrs.id, class: class_label, text: attrs.label }));
                                    if (opts.class_suffix) group.append($("<span></span>", { class: opts.class_suffix }).append(opts.text_suffix || ""));
                                }
                            } else {
                                group = $('<div></div>', { class: class_group }).appendTo(this.form);
                                class_label += " control-label " + (this.options.horizontal ? this.options.size_labels : "");
                                group.append($("<label></label>", { for: attrs.id, class: class_label, text: attrs.label }));
                                group.append(this.options.horizontal ? $('<div></div>', { class: this.options.size_inputs }).append(input) : input);
                            }
                            break;

                        default:
                            this.form.append($("<" + type + "></" + type + ">", attrs));
                        }
                    }
                    break;
            }
        }

        // Footer
        this.footer = $('<div class="modal-footer"></div>');
        this.content.append(this.footer);

        for (var key in this.options.buttons) {
            var item = this.options.buttons[key];
            this["btn_" + item] = $("<button></button>", {
                type: "button",
                text: this.options["text_" + item],
                class: this.options["class_" + item],
                "data-callback": item,
                "data-form": this.formid,
                click: function(event) {
                    var name = $(event.target).data("callback");
                    self.callback(name, event);
                }
            }).appendTo(this.footer);
        }

        // Setup events for dismiss and complete
        this.modal.on('hide.bs.modal', this.options.dismiss);
        this.modal.on('hidden.bs.modal', function(e) {
            self.options.complete(e);
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

    this.data = function() {
        var keyval = {};
        var array = this.form.serializeArray();
        for (var i in array) {
            keyval[array[i].name] = array[i].value;
        }
        return keyval;
    };

    this.callback = function(name, event) {
        var func = this.options[name];        // Get function to call
        if (typeof func !== "function") return;

        // Perform callback
        var array = this.form.serializeArray();
        var ret = func(this.data(), array, event);
        // Hide window
        if (ret !== null) this.modal.modal("hide");
        return ret;
    }

    this.dismiss = function() { return this.callback("dismiss"); }
    this.submit = function() { return this.callback("submit"); }
    this.close = function() { return this.callback("close"); }
    this.ok = function() { return this.callback("ok"); }
    this.cancel = function() { return this.callback("cancel"); }
    this.yes = function() { return this.callback("yes"); }
    this.no = function() { return this.callback("no"); }

    this.addOptions(Array.isArray(options) ? options: Array.prototype.slice.call(arguments));
    this.create();
    this.show();
}


bootpopup.alert = function(message, title, callback)
{
    if (typeof title === "function") callback = title;
    if (typeof title !== "string") title = document.title;
    if (typeof callback !== "function") callback = function() {};

    return bootpopup({
        title: title,
        content: [{ p: { text: message } }],
        dismiss: function() { return callback(); }
    });
}

bootpopup.confirm = function(message, title, callback)
{
    if (typeof title === "function") callback = title;
    if (typeof title !== "string") title = document.title;
    if (typeof callback !== "function") callback = function() {};

    var answer = false;
    return bootpopup({
        title: title,
        show_close: false,
        content: [{ p: { text: message } }],
        buttons: ["no", "yes"],
        yes: function() { answer = true; },
        dismiss: function() { return callback(answer); }
    });
}

bootpopup.prompt = function(label, type, message, title, callback)
{
    // Callback can be in any position, except label
    var callback_function = function() {};
    if (typeof type === "function") callback_function = type;
    if (typeof message === "function") callback_function = message;
    if (typeof title === "function") callback_function = title;
    if (typeof callback === "function") callback_function = callback;

    // If a list of values is provided, then the parameters are shifted
    // because type should be ignored
    if (typeof label === "object") {
        title = message;
        message = type;
        type = null;
    }

    // Sanitize message and title
    if (typeof message !== "string") message = "";
    if (typeof title !== "string") title = document.title;

    // Add message to the window
    var content = [{ p: { text: message } }];

    // If label is a list of values to be asked to input
    if (typeof label === "object") {
        label.forEach(function(entry) {
            // Name in lower case and dashes instead spaces
            if (typeof entry.name !== "string") entry.name = entry.label.toLowerCase().replace(/\s+/g, "-");
            if (typeof entry.type !== "string") entry.type = "text";
            content.push({ input: entry });
        });
    }
    else {
        if (typeof type !== "string") type = "text";
        content.push({ input: { type: type, name: "value", label: label } });
        var callback_tmp = callback_function;   // Overload callback function to return "data.value"
        callback_function = function(data) { return callback_tmp(data.value); };
    }

    return bootpopup({
        title: title,
        content: content,
        buttons: ["cancel", "ok"],
        ok: function(data) {
            return callback_function(data);
        }
    });
}

if (typeof define === "function") {
    define(["jquery", "bootstrap"], function() {
        return bootpopup;
    });
}
