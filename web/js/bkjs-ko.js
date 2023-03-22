//
// Vlad Seryakov 2014
//

// Status of the current account
bkjs.koAuth = ko.observable(0);
bkjs.koAdmin = ko.observable(0);
bkjs.koName = ko.observable("");


// Login/UI utils
bkjs.koInit = function()
{
    ko.applyBindings(bkjs);
    bkjs.login(bkjs.koCheckLogin);
}

bkjs.koCheckLogin = function(err, path)
{
    bkjs.koName(bkjs.account.name || "");
    bkjs.koAuth(bkjs.loggedIn);
    bkjs.koAdmin(bkjs.loggedIn && bkjs.checkAccountType(bkjs.account, bkjs.adminType || "admin"));
    $(bkjs).trigger(bkjs.loggedIn ? "bkjs.login" : "bkjs.nologin", [err, path]);
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
    bkjs.logout(() => {
        bkjs.koAuth(0);
        bkjs.koAdmin(0);
        bkjs.koName("");
        $(bkjs).trigger('bkjs.logout');
    });
}

bkjs.koBootpopup = function(options, style)
{
    var _before = options.before;
    options.before = function(self) {
        if (bkjs.isF(_before)) _before(self);
        ko.applyBindings(self.options.data || bkjs, self.modal.get(0));
    }
    var _complete = options.complete;
    options.complete = function(event, self) {
        if (bkjs.isF(_complete)) _complete.call(this, event, self);
        ko.cleanNode(self.modal.get(0));
        options.before = _before;
        options.complete = _complete;
    }
    return bootpopup(options, style || bkjs.bootpopupStyle);
}

// Variable utils
bkjs.koVal = ko.utils.unwrapObservable;

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
        if (ko.isObservable(bkjs.koState[key])) {
            old = bkjs.koState[key]();
            bkjs.koState[key](val);
        } else {
            old = bkjs.koState[key];
            bkjs.koState[key] = Array.isArray(val) ? ko.observableArray(val) : ko.observable(val);
        }
        if (!quiet) bkjs.koEvent(key, { name: name, key: key, value: val, old: old });
    }
}

bkjs.koSetObject = function(obj, options)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    for (const p in obj) {
        if (!bkjs.isU(options[p])) continue;
        if (ko.isComputed(obj[p])) continue;
        if (ko.isObservable(obj[p])) obj[p](undefined); else obj[p] = undefined;
    }
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (ko.isObservable(obj[p])) obj[p](bkjs.koVal(options[p])); else obj[p] = bkjs.koVal(options[p]);
    }
    return obj;
}

bkjs.koUpdateObject = function(obj, options)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (ko.isObservable(obj[p])) obj[p](bkjs.koVal(options[p])); else obj[p] = bkjs.koVal(options[p]);
    }
    return obj;
}

bkjs.koConvert = function(obj, name, val, dflt)
{
    if (!obj || !bkjs.isO(obj)) obj = {};
    if (!ko.isObservable(obj[name])) {
        obj[name] = Array.isArray(val || dflt) ? ko.observableArray(obj[name]) : ko.observable(obj[name]);
    }
    if (!bkjs.isU(val)) obj[name](val);
    if (!bkjs.isU(dflt) && !obj[name]()) obj[name](dflt);
    return obj;
}

bkjs.koEvent = function(name, data)
{
    var event = bkjs.toCamel("on_" + name);
    $(bkjs).trigger("bkjs.event", [name, event, data]);
}

// View model templating and utils
bkjs.koState = {};
bkjs.koTemplates = { none: "<div></div>" };
bkjs.koModels = {};
bkjs.koAliases = { template: {}, model: {}, viewModel: {} };
bkjs.koViewModels = [];

bkjs.koViewModel = function(params, componentInfo)
{
    this.params = {};
    for (var p in params) this.params[p] = params[p];
    $(bkjs).on("bkjs.event." + this.koName, $.proxy(this._handleEvent, this));
}

bkjs.koViewModel.prototype._handleEvent = function(ev, name, event, data)
{
    if (bkjs.debug) console.log("handleEvent:", this.koName, name, event, data)
    if (bkjs.isF(this[event])) this[event](data);
    if (bkjs.isF(this.handleEvent)) this.handleEvent(name, data);
}

bkjs.koViewModel.prototype.dispose = function()
{
    if (bkjs.debug) console.log("dispose:", this.koName);
    bkjs.koEvent("model.disposed", { name: this.koName, params: this.params, vm: this });
    $(bkjs).off("bkjs.event." + this.koName, $.proxy(this._handleEvent, this));
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
    delete this.params;
    bkjs.koViewModels.splice(bkjs.koViewModels.indexOf(this));
}

bkjs.koGetModel = function(name)
{
    return bkjs.koModels[bkjs.koAliases.viewModel[name]] || bkjs.koModels[name];
}

bkjs.koCreateModel = function(name, options)
{
    if (!name) throw new Error("model name is required");
    var m = bkjs.koModels[name] = function(params, componentInfo) {
        this.koName = name;
        bkjs.koViewModel.call(this, params, componentInfo);
    };
    for (const p in options) m[p] = options[p];
    bkjs.inherits(m, bkjs.koViewModel);
    bkjs.koEvent("model.created", { name: name, vm: m });
    return m;
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
    var tmpl = bkjs.koTemplates[name] || bkjs.koTemplates[bkjs.koAliases.template[name]];
    if (!tmpl) {
        name = bkjs.koAliases.model[name];
        if (name) tmpl = bkjs.koTemplates[name];
    }
    if (!tmpl) {
        if (bkjs.debug) console.log("koFindComponent:", model, name);
        return null;
    }
    if (bkjs.debug) console.log("koFindComponent:", model, name, tmpl.substr(0, 64));
    return {
        name: name,
        template: tmpl,
        viewModel: {
            createViewModel: function(params, componentInfo) {
                var VM = bkjs.koGetModel(name);
                if (bkjs.isF(VM)) {
                    var vm = new VM(params, componentInfo);
                    if (bkjs.isF(vm.onCreate)) vm.onCreate(vm.params, componentInfo);
                    bkjs.koViewModels.push(vm);
                }
                if (bkjs.debug) console.log("koFindComponent:", model, name, !!vm);
                bkjs.koEvent("component.created", { name: name, params: params, model: vm, info: componentInfo });
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

// Bootstrap compatible breaking points
bkjs.koBreakpoint = ko.observable();
bkjs.koDesktop = ko.computed(() => (/lg|xl/.test(bkjs.koBreakpoint())));
bkjs.koMobile = ko.computed(() => (/xs|sm|md/.test(bkjs.koBreakpoint())));

bkjs.koGetBreakpoint = function()
{
    var w = $(document).innerWidth();
    return w < 576 ? 'xs' : w < 768 ? 'sm' : w < 992 ? 'md' : w < 1200 ? 'lg' : 'xl';
}

bkjs.koSetBreakpoint = function()
{
    bkjs.koBreakpoint(bkjs.koGetBreakpoint());
    document.documentElement.style.setProperty('--height', (window.innerHeight * 0.01) + "px");
}

bkjs.koResized = function(event)
{
    clearTimeout(bkjs._koResized);
    bkjs._koResized = setTimeout(bkjs.koSetBreakpoint, 500);
}

bkjs.koPlugins = [];

bkjs.koApplyPlugins = function(target)
{
    if (!target) return;
    for (const i in bkjs.koPlugins) {
        if (bkjs.isF(bkjs.koPlugins[i])) bkjs.koPlugins[i](target);
    }
}

// Main component view model
bkjs.koAppModel = ko.observable("none");
bkjs.koAppOptions = ko.observable();

bkjs.koShowComponent = function(name, options, nosave)
{
    if (bkjs.debug) console.log("koShowComponent:", name, options);
    var rc = bkjs.koRunMethod("beforeDispose", name, options);
    for (const p in rc) if (rc[p] === false) return false;
    bkjs.koAppOptions(options || {});
    bkjs.koAppModel(name);
    var m = bkjs.koGetModel(name);
    if (!nosave && !m?.nohistory) bkjs.koSaveLocation(name, options);
    bkjs.koEvent("component.shown", { name: name, options: options });
}

// Simple router support
bkjs.koAppPath = (window.location.pathname.replace(/(\/+[^/]+)$|\/+$/, "") + "/").replace(/\/app.+$/, "/") + "app/";
bkjs.koAppLocation = window.location.origin + bkjs.koAppPath;

window.onpopstate = function(event)
{
    if (event?.state?.name) bkjs.koShowComponent(event.state.name, event.state.options);
}

bkjs.koSaveLocation = function(name, options)
{
    var url = name && bkjs.koSaveModel(name, options);
    if (!url) return;
    if (url == bkjs._koAppLocation) return;
    window.history.pushState({ name: name, options: options }, name, bkjs.koAppLocation + url);
    bkjs._koAppLocation = url;
}

bkjs.koSaveModel = function(name, options)
{
    if (options?.param) name += "/" + options.param;
    if (options?.param2) name += "/" + options.param2;
    return name;
}

bkjs.koRestoreLocation = function(path, dflt)
{
    if (path && (window.location.origin + path).indexOf(bkjs.koAppLocation) != 0) path = "";
    var location = window.location.origin + (path || window.location.pathname);
    var params = location.substr(bkjs.koAppLocation.length).split("/");

    if (bkjs.debug) console.log("koRestoreLocation:", window.location.pathname, "path:", path, "dflt:", dflt, "params:", params);
    var model = bkjs.koFindComponent(params[0]);
    bkjs.koRestoreModel({ model: model, path: path, dflt: dflt, params: params });
}

bkjs.koRestoreModel = function(options)
{
    bkjs.koShowComponent(options.model?.name || options.dflt || "none", { param: options.params[1], param2: options.params[2] });
}

$(function() {
    bkjs.koSetBreakpoint();
    $(window).on("resize.bkjs", bkjs.koResized.bind(bkjs));

    $(bkjs).on("bkjs.event", (ev, name, event, data) => {
        switch (name) {
        case "component.created":
            bkjs.koApplyPlugins(data.info.element);
            break;
        }
    });
});
