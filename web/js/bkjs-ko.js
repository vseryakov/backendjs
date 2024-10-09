//
// Vlad Seryakov 2014
//

// Status of the current account
bkjs.koAuth = ko.observable(0);

// Login/UI utils
bkjs.koInit = function()
{
    ko.applyBindings(bkjs);
    bkjs.login(bkjs.koCheckLogin);
}

bkjs.koCheckLogin = function(err, path)
{
    bkjs.koAuth(bkjs.loggedIn);
    bkjs.event(bkjs.loggedIn ? "bkjs.login" : "bkjs.nologin", [err, path]);
    if (!err && bkjs.isF(bkjs.koShow)) bkjs.koShow();
}

bkjs.koLogin = function(data, event)
{
    bkjs.showLogin(bkjs.koLoginOptions, (err) => {
        bkjs.koCheckLogin(err);
        if (!err) bkjs.hideLogin();
    });
}

bkjs.koLogout = function(data, event)
{
    bkjs.logout((err) => {
        if (err) return bkjs.showAlert("error", err);
        bkjs.koAuth(0);
        bkjs.event('bkjs.logout');
    });
}

// Apply KO to all bootpopups

bootpopupPlugins.push({
    before: function(self) {
        if (self.options.data) ko.applyBindings(self.options.data, self.modal.get(0));
    },
    complete: function(event, self) {
        if (self.options.data) ko.cleanNode(self.modal.get(0));
    },
    shown: function(event) {
        bkjs.applyPlugins(event.target);
    }
});

// Variable utils
bkjs.koVal = ko.unwrap;
bkjs.isKo = (v) => (ko.isObservable(v))
bkjs.isKa = (v) => (ko.isObservableArray(v))

bkjs.koGet = function(name, dflt)
{
    if (!bkjs.isS(name)) name = String(name);
    name = name.replace(/[^a-zA-z0-9_]/g, "_");
    var val = bkjs.koState[name];
    if (bkjs.isU(val)) {
        bkjs.koState[name] = val = Array.isArray(dflt) ? ko.observableArray(dflt) : ko.observable(dflt);
    }
    return val;
}

bkjs.koSet = function(name, val, quiet)
{
    if (!name) return;
    if (!Array.isArray(name)) name = [ name ];
    for (var i in name) {
        var key = name[i], old;
        if (!bkjs.isS(key)) continue;
        key = key.replace(/[^a-zA-z0-9_]/g, "_");
        if (ko.isComputed(bkjs.koState[key])) continue;
        if (bkjs.isKo(bkjs.koState[key])) {
            old = bkjs.koState[key]();
            bkjs.koState[key](val);
        } else {
            old = bkjs.koState[key];
            bkjs.koState[key] = Array.isArray(val) ? ko.observableArray(val) : ko.observable(val);
        }
        if (!quiet) bkjs.appEvent(key, { name: name, key: key, value: val, old: old });
    }
}

bkjs.koSetObject = function(obj, options)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    for (const p in obj) {
        if (!bkjs.isU(options[p])) continue;
        if (ko.isComputed(obj[p])) continue;
        if (bkjs.isKo(obj[p])) obj[p](undefined); else obj[p] = undefined;
    }
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (bkjs.isKo(obj[p])) obj[p](bkjs.koVal(options[p])); else obj[p] = bkjs.koVal(options[p]);
    }
    return obj;
}

bkjs.koUpdateObject = function(obj, options)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (bkjs.isKo(obj[p])) obj[p](bkjs.koVal(options[p])); else obj[p] = bkjs.koVal(options[p]);
    }
    return obj;
}

bkjs.koConvert = function(obj, name, val, dflt)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    if (!bkjs.isKo(obj[name])) {
        obj[name] = Array.isArray(val || dflt) ? ko.observableArray(obj[name]) : ko.observable(obj[name]);
    }
    if (!bkjs.isU(val)) obj[name](val);
    if (!bkjs.isU(dflt) && !obj[name]()) obj[name](dflt);
    return obj;
}

// View model templating and utils
bkjs.koState = {};
bkjs.koTemplates = { none: "<div></div>" };
bkjs.koModels = {};
bkjs.koAliases = { template: {}, model: {}, viewModel: {}, instance: {} };
bkjs.koViewModels = [];

bkjs.koViewModel = function(params, componentInfo)
{
    this.element = componentInfo?.element;
    this.params = bkjs.objExtend({}, params);
    if (!bkjs.koModels[this.koName].noevents) {
        bkjs.on("bkjs.event." + this.koName, $.proxy(this._handleEvent, this));
    }
}

bkjs.koViewModel.prototype._handleEvent = function(ev, name, event, data)
{
    bkjs.trace("handleEvent:", this.koName, name, event, data)
    if (bkjs.isF(this[event])) this[event](data);
    if (bkjs.isF(this.handleEvent)) this.handleEvent(name, data);
}

bkjs.koViewModel.prototype.dispose = function()
{
    bkjs.trace("dispose:", this.koName);
    bkjs.appEvent("model.disposed", { name: this.koName, params: this.params, vm: this });
    bkjs.off("bkjs.event." + this.koName, $.proxy(this._handleEvent, this));
    if (bkjs.isF(this.onDispose)) this.onDispose();
    // Auto dispose all subscriptions
    for (const p in this) {
        if (this[p] && bkjs.isO(this[p]) &&
            bkjs.isF(this[p].dispose) &&
            bkjs.isF(this[p].disposeWhenNodeIsRemoved)) {
            this[p].dispose();
        } else
        if (ko.isComputed(this[p])) this[p].dispose();
    }
    delete this.element;
    delete this.params;
    bkjs.koViewModels = bkjs.koViewModels.filter((x) => (x !== this));
}

bkjs.koViewModel.prototype.subscribe = function(obj, extend, callback)
{
    if (!bkjs.isKo(obj)) return;
    if (!this.__subidx) this.__subidx = 0;
    if (typeof extend == "function") {
        this["__sub" + this.__subidx++] = obj.subscribe(extend);
    } else {
        if (typeof extend == "number") {
            extend = { rateLimit: { method: "notifyWhenChangesStop", timeout: extend } };
        }
        this["__sub" + this.__subidx++] = obj.extend(extend).subscribe(callback);
    }
}

bkjs.koGetModel = function(name)
{
    return bkjs.koModels[bkjs.koAliases.viewModel[name]] || bkjs.koModels[name];
}

bkjs.koGetTemplate = function(name)
{
    name = bkjs.toCamel(name);
    return bkjs.koTemplates[name] || bkjs.koTemplates[bkjs.koAliases.template[name]];
}

bkjs.koGetViewModel = function(options)
{
    if (typeof options == "string") {
        return bkjs.koViewModels.filter((x) => (x.koName === options)).shift();
    }
    if (options?.nodeType) {
        return bkjs.koViewModels.filter((x) => (x.element === options)).shift();
    }
    if (this.isObject(options)) {
        return bkjs.koViewModels.filter((x) => (Object.keys(options).every((y) => (x.params[y] === options[y])))).shift();
    }
}

bkjs.koCreateModel = function(name, options)
{
    if (!name) throw new Error("model name is required");
    var m = bkjs.koModels[name] = function(params, componentInfo) {
        this.koName = name;
        bkjs.koViewModel.call(this, params, componentInfo);
    };
    bkjs.inherits(m, bkjs.koViewModel);
    for (const p in options) {
        if (bkjs.isF(options[p])) m.prototype[p] = options[p]; else m[p] = options[p];
    }
    bkjs.appEvent("model.created", { name: name, vm: m });
    return m;
}

bkjs.koExtendModel = function(name, options)
{
    var m = bkjs.koModels[name];
    if (!m) throw new Error("model not found")
    for (const p in options) {
        if (bkjs.isF(options[p])) {
            switch (p) {
            case "onExtend":
                options[p].call(m);
                break;

            case "onCreate":
                if (!m.__onCreate) m.__onCreate = [];
                m.__onCreate.push(options[p]);
                break;

            default:
                m.prototype[p] = options[p];
            }
        } else {
            m[p] = options[p];
        }
    }
}

bkjs.koCreateModelAlias = function(type, name, alias)
{
    if (type && name && bkjs.isU(alias)) alias = name, name = type, type = "model";
    if (!bkjs.koAliases[type]) return;
    bkjs.koAliases[type][bkjs.toCamel(alias)] = bkjs.toCamel(name);
}

bkjs.koFindComponent = function(model)
{
    var name = bkjs.toCamel(model);
    var tmpl = bkjs.koGetTemplate(name);
    if (!tmpl) {
        name = bkjs.koAliases.model[name];
        if (name) tmpl = bkjs.koTemplates[name];
    }
    if (!tmpl) {
        bkjs.trace("koFindComponent:", model, name);
        return null;
    }
    bkjs.trace("koFindComponent:", model, name, tmpl.substr(0, 64));

    return {
        name: name,
        template: tmpl,
        viewModel: {
            createViewModel: function(params, componentInfo) {
                var vm;
                if (bkjs.koAliases.instance[name]) {
                    vm = bkjs.koGetViewModel(bkjs.koAliases.instance[name]);
                } else {
                    var VM = bkjs.koGetModel(name);
                    if (bkjs.isF(VM)) {
                        vm = new VM(params, componentInfo);
                        if (bkjs.isF(vm.onCreate)) vm.onCreate(vm.params, componentInfo);
                        for (const i in VM.__onCreate) VM.__onCreate[i].call(vm, vm.params, componentInfo);
                        bkjs.koViewModels.push(vm);
                    }
                }
                bkjs.trace("koFindComponent:", model, name, !!vm);
                bkjs.appEvent("component.created", { name: name, params: params, model: vm, info: componentInfo });
                return vm;
            }
        },
    };
}

// Run a method in all active view models, returns result from each in an object
bkjs.koRunMethod = function(method)
{
    var rc = {};
    var args = Array.prototype.slice.apply(arguments).slice(1);
    for (var i in bkjs.koViewModels) {
        var m = bkjs.koViewModels[i];
        if (bkjs.isF(m[method])) rc[m.name] = m[method].apply(m, args);
    }
    return rc;
}

ko.bindingHandlers.hidden = {
    update: function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor());
        var isCurrentlyHidden = !(element.style.display == "");
        if (value && !isCurrentlyHidden) element.style.display = "none"; else
        if ((!value) && isCurrentlyHidden) element.style.display = "";
    }
};

ko.bindingHandlers.html.update = function (element, valueAccessor) {
    ko.utils.setHtml(element, bkjs.sanitizer.run(ko.utils.unwrapObservable(valueAccessor())));
};

// Web bundle naming convention
ko.components.loaders.unshift({
    getConfig: function(name, callback) {
        callback(bkjs.koFindComponent(name));
    }
});
ko.components.register("none", { template: "<div></div>" });

ko.templateEngine.prototype.makeTemplateSource = function(template, doc) {
    if (typeof template == "string") {
        var elem = (doc || document).getElementById(template);
        if (!elem && bkjs.koTemplates[template]) {
            elem = ko.utils.parseHtmlFragment(`<template id="${template}">` + bkjs.koTemplates[template] + "</template>", doc)[0];
        }
        if (!elem) throw new Error("Cannot find template with ID " + template);
        return new ko.templateSources.domElement(elem);
    } else
    if ((template.nodeType == 1) || (template.nodeType == 8)) {
        return new ko.templateSources.anonymousTemplate(template);
    } else
        throw new Error("Unknown template type: " + template);
}

// Main component view model
bkjs.koAppModel = ko.observable("none");
bkjs.koAppOptions = ko.observable();

bkjs.koShowComponent = function(name, options, nosave)
{
    bkjs.trace("koShowComponent:", name, options);
    var rc = bkjs.koRunMethod("beforeDispose", name, options);
    for (const p in rc) if (rc[p] === false) return false;
    bkjs.koAppOptions(options || {});
    bkjs.koAppModel(name);
    var m = bkjs.koGetModel(name);
    if (!nosave && !m?.nohistory) bkjs.koSaveComponent(name, options);
    bkjs.appEvent("component.shown", { name: name, options: options });
}

bkjs.koSaveComponent = function(name, options)
{
    var path = [name || "", options?.param || "", options?.param2 || ""].filter((x) => (x)).join("/");
    bkjs.pushLocation(path, name, options);
}

bkjs.koMobile = ko.observable();

bkjs.koSetMobile = function()
{
    bkjs.koMobile(/xs|sm|md/.test(bkjs.getBreakpoint()))
}

$(function() {
    bkjs.koSetMobile();
    window.addEventListener("resize", bkjs.koSetMobile);
    bkjs.on("bkjs.event", (ev, name, event, data) => {
        switch (name) {
        case "component.created":
            bkjs.trigger("component.created." + data.name, data);
            bkjs.applyPlugins(data.info.element);
            break;
        }
    });
});
