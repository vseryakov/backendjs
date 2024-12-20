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
    bkjs.emit(bkjs.loggedIn ? "login" : "nologin", [err, path]);
    if (!err && typeof bkjs.koShow == "function") bkjs.koShow();
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
        bkjs.emit('logout');
    });
}

// Variable utils
bkjs.koVal = ko.unwrap;
bkjs.isKo = (v) => (ko.isObservable(v))
bkjs.isKa = (v) => (ko.isObservableArray(v))

bkjs.koSetObject = function(obj, options)
{
    if (!obj || typeof obj != "object") obj = {};
    for (const p in obj) {
        if (options[p] !== undefined) continue;
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
    if (!obj || typeof obj != "object") obj = {};
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (bkjs.isKo(obj[p])) obj[p](bkjs.koVal(options[p])); else obj[p] = bkjs.koVal(options[p]);
    }
    return obj;
}

bkjs.koConvert = function(obj, name, val, dflt)
{
    if (!obj || typeof obj != "object") obj = {};
    if (!bkjs.isKo(obj[name])) {
        obj[name] = Array.isArray(val || dflt) ? ko.observableArray(obj[name]) : ko.observable(obj[name]);
    }
    if (val !== undefined) obj[name](val);
    if (dflt !== undefined && !obj[name]()) obj[name](dflt);
    return obj;
}

// View model templating and utils
bkjs.koModels = {};
bkjs.koAliases = { template: {}, model: {}, viewModel: {}, instance: {} };
bkjs.koViewModels = [];

bkjs.koViewModel = function(params, componentInfo)
{
    this.element = componentInfo?.element;
    this.params = Object.assign({}, params);
    bkjs.on("component:event", this._handleEvent = this.handleEvent.bind(this));
}

bkjs.koViewModel.prototype.handleEvent = function(name, data)
{
    if (this.params.noEvents) return;
    bkjs.trace("handleEvent:", this.koName, name, data)
    bkjs.call(this, bkjs.toCamel("on_" + name), data);
    bkjs.call(this, "onEvent", name, data);
}

bkjs.koViewModel.prototype.dispose = function()
{
    bkjs.trace("dispose:", this.koName);
    bkjs.off("component:event", this._handleEvent);
    bkjs.emit("component:destroyed", { type: "ko", name: this.koName, params: this.params, vm: this });
    bkjs.call(this, "onDispose");
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
    bkjs.koViewModels = bkjs.koViewModels.filter((x) => (x !== this));
}

bkjs.koViewModel.prototype.subscribe = function(obj, extend, callback)
{
    if (!bkjs.isKo(obj)) return;
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

bkjs.koGetModel = function(name)
{
    return bkjs.koModels[bkjs.koAliases.viewModel[name]] || bkjs.koModels[name];
}

bkjs.koGetTemplate = function(name)
{
    name = bkjs.toCamel(name);
    return bkjs.templates[name] || bkjs.templates[bkjs.koAliases.template[name]];
}

bkjs.koGetViewModel = function(options)
{
    if (typeof options == "string") {
        return bkjs.koViewModels.filter((x) => (x.koName === options)).shift();
    }
    if (options?.nodeType) {
        return bkjs.koViewModels.filter((x) => (x.element === options)).shift();
    }
    if (bkjs.isObject(options)) {
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
    bkjs.inherits(m, bkjs.koViewModel, options);
    return m;
}

bkjs.koExtendModel = function(name, options)
{
    var m = bkjs.koModels[name];
    if (!m) throw new Error("model not found")
    for (const p in options) {
        if (typeof options[p] == "function") {
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
    if (type && name && alias === undefined) alias = name, name = type, type = "model";
    if (!bkjs.koAliases[type]) return;
    bkjs.koAliases[type][bkjs.toCamel(alias)] = bkjs.toCamel(name);
}

bkjs.koFindComponent = function(model)
{
    if (!model) return null;
    var name = bkjs.toCamel(model);
    var tmpl = bkjs.koGetTemplate(name);
    if (!tmpl) {
        name = bkjs.koAliases.model[name];
        if (name) tmpl = bkjs.templates[name];
    }
    if (!tmpl) {
        bkjs.trace("koFindComponent:", model, name);
        return null;
    }
    if (typeof tmpl == "string" && tmpl.startsWith("#")) tmpl = { element: tmpl.substr(1) };

    bkjs.trace("koFindComponent:", model, name, typeof tmpl == "string" && tmpl.substr(0, 64) || tmpl);

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
                    if (typeof VM == "function") {
                        vm = new VM(params, componentInfo);
                        if (typeof vm.onCreate == "function") vm.onCreate(vm.params, componentInfo);
                        for (const i in VM.__onCreate) VM.__onCreate[i].call(vm, vm.params, componentInfo);
                        bkjs.koViewModels.push(vm);
                    }
                }
                bkjs.trace("koFindComponent:", model, name, !!vm);
                bkjs.emit("component:created", { type: "ko", name: name, component: vm, element: componentInfo.element, params: params });
                return vm;
            }
        },
    };
}

// Run a method in all active view models, returns result from each in an object
bkjs.koRunMethod = function(method, ...args)
{
    var rc = {};
    for (var i in bkjs.koViewModels) {
        var m = bkjs.koViewModels[i];
        if (typeof m[method] == "function") rc[m.name] = m[method].apply(m, args);
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
    getConfig: (name, callback) => (callback(bkjs.koFindComponent(name)))
});
ko.components.register("none", { template: "<div></div>" });

ko.templateEngine.prototype.makeTemplateSource = function(template, doc) {
    if (typeof template == "string") {
        var elem = (doc || document).getElementById(template);
        if (!elem && bkjs.templates[template]) {
            elem = ko.utils.parseHtmlFragment(`<template id="${template}">` + bkjs.templates[template] + "</template>", doc)[0];
        }
        if (!elem) throw new Error("Cannot find template with ID " + template);
        return new ko.templateSources.domElement(elem);
    } else
    if ((template.nodeType == 1) || (template.nodeType == 8)) {
        return new ko.templateSources.anonymousTemplate(template);
    }
    throw new Error("Unknown template type: " + template);
}

// Main component view model
bkjs.koAppModel = ko.observable("none");
bkjs.koAppOptions = ko.observable();

bkjs.koShowComponent = function(name, options)
{
    bkjs.trace("koShowComponent:", name, options);
    var rc = bkjs.koRunMethod("beforeDispose", name, options);
    for (const p in rc) if (rc[p] === false) return false;

    var m = bkjs.koFindComponent(name);
    if (!m) name = options?.$index || "none";

    bkjs.koAppOptions(options || {});
    bkjs.koAppModel(name);
}

bkjs.koMobile = ko.observable();

bkjs.koSetMobile = function()
{
    bkjs.koMobile(/xs|sm|md/.test(bkjs.getBreakpoint()))
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

bkjs.ready(() => {
    bkjs.koSetMobile();
    bkjs.$on(window, "resize", bkjs.koSetMobile);
    for (const [key,val] in Object.entries(bkjs.templates)) {
        if (typeof val == "string" && val.includes("data-bind=")) {
            ko.components.register(key, {});
        }
    }
});
