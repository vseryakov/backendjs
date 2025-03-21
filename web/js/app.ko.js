//
// Knockout plugin for Alpinejs app
// Vlad Seryakov 2024
//

(() => {
const app = window.app;
const _type = "ko";

class Component extends app.Component {
    static $type = _type;

    constructor(name, params, componentInfo) {
        super(name, params);
        this.$type = _type;
        this.element = this.$el = componentInfo.element;
    }

    dispose() {
        super.destroy();

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
                app.call(component, "init");
                return component;
            }
        },
    };
}

function cleanup(element)
{
    app.$empty(element, ko.cleanNode);
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
