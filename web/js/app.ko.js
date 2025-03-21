//
// Knockout plugin for Alpinejs app
// Vlad Seryakov 2024
//

(() => {
const app = window.app;
const _type = "ko";

class Component {
    params = {};

    static $type = _type;
    static _id = 0;

    constructor(name, params, componentInfo) {
        this.$name = name;
        this.$_id = `${name}:${_type}:${Component._id++}`;
        this.element = componentInfo?.element;
        Object.assign(this.params, params);
        if (!this.params.$noevents) {
            app.on(app.event, this._handleEvent = this.handleEvent.bind(this));
        }
    }

    handleEvent(event, ...args) {
        if (this.onEvent) {
            app.trace("event:", this.$name, event, ...args);
            app.call(this, "onEvent", event, ...args);
        }
        if (!app.isS(event)) return;
        var method = app.toCamel("on_" + event);
        if (!this[method]) return;
        app.trace("event:", this.$name, method, ...args);
        app.call(this, method, ...args);
    }

    dispose() {
        app.trace("dispose:", this.$_id);
        app.off(app.event, this._handleEvent);
        app.emit("component:delete", { type: _type, name: this.$name, params: this.params, component: this, element: this.element });
        app.call(this, "onDelete");

        // Auto dispose all subscriptions
        for (const p in this) {
            if (this[p] && typeof this[p] == "object" &&
                typeof this[p].dispose == "function" &&
                typeof this[p].disposeWhenNodeIsRemoved == "function") {
                this[p].dispose();
                delete this[p];
            } else
            if (ko.isComputed(this[p])) {
                this[p].dispose();
                delete this[p];
            }
        }
        for (const i in this.__sub) this.__sub[i].dispose();
        delete this.__sub;
        delete this.element;
        delete this.params;
    }

    subscribe(obj, extend, callback) {
        if (!ko.isObservable(obj)) return;
        if (!this.__sub) this.__sub = [];
        if (typeof extend == "function") {
            var sub = obj.subscribe(extend);
        } else {
            if (typeof extend == "number") {
                extend = { rateLimit: { method: "notifyWhenChangesStop", timeout: extend } };
            }
            sub = obj.extend(extend).subscribe(callback);
        }
        this.__sub.push(sub);
        return sub;
    }
}

function create(name)
{
    var tmpl = app.resolve(name);
    if (!tmpl) return null;

    return {
        name: name,
        template: tmpl.template,
        viewModel: {
            createViewModel: function(params, componentInfo) {
                if (typeof tmpl.component != "function") return;
                params = componentInfo.element?._x_params || params || {};
                delete componentInfo.element?._x_params;

                if (tmpl.component.$noevents) params.$noevents = 1;
                const component = new tmpl.component(name, params, componentInfo);
                params = component.params;

                app.call(component, "onCreate", params, componentInfo);
                app.emit("component:create", { type: _type, name, component, element: componentInfo.element, params });
                return component;
            }
        },
    };
}

function cleanup(element)
{
    app.$empty(element, (el => ko.cleanNode(el)));
    ko.cleanNode(element);
    app.$attr(element, "data-bind", null);
    delete element._x_params;
}

function dataFor(element)
{
    var data;
    while (element) {
        if ((data = ko.dataFor(element))) return data;
        element = element.parentElement;
    }
}

function data(element)
{
    if (!app.isE(element)) element = app.$(app.main)?.firstElementChild;
    return ko.dataFor(element);
}

function render(element, options)
{
    cleanup(element);

    app.$attr(element, "data-bind", `component: '${options.name}'`);
    element._x_params = options.params;
    ko.applyBindings(dataFor(element), element);
}

ko.components.loaders.unshift({
    getConfig: (name, callback) => (callback(create(name)))
});

ko.templateEngine.prototype.makeTemplateSource = function(template, doc) {
    if (typeof template == "string") {
        var elem = (doc || document).getElementById(template);
        if (!elem && app.templates[template]) {
            elem = ko.utils.parseHtmlFragment(`<template id="${template}">` + app.templates[template] + "</template>", doc)[0];
        }
        if (!elem) throw new Error("Cannot find template with ID " + template);
        return new ko.templateSources.domElement(elem);
    } else
    if ((template.nodeType == 1) || (template.nodeType == 8)) {
        return new ko.templateSources.anonymousTemplate(template);
    }
    throw new Error("Unknown template type: " + template);
}

app.plugin(_type, { render, cleanup, data, Component });

})();
