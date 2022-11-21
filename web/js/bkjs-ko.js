//
// Vlad Seryakov 2014
//

// Status of the current account
bkjs.koAuth = ko.observable(0);
bkjs.koAdmin = ko.observable(0);
bkjs.koName = ko.observable("");

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
    var event = bkjs.toCamel(name);
    event = "on" + event.substr(0, 1).toUpperCase() + event.substr(1);
    $(bkjs).trigger("bkjs.event", [name, event, data]);
}

bkjs.koState = {};
bkjs.koTemplates = {};
bkjs.koTemplateAliases = {};
bkjs.koModels = {};
bkjs.koModelAliases = {};
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

bkjs.koCreateModel = function(name)
{
    if (!name) throw new Error("model name is required");
    bkjs.koModels[name] = function(params, componentInfo) {
        this.koName = name;
        bkjs.koViewModel.call(this, params, componentInfo);
    };
    bkjs.inherits(bkjs.koModels[name], bkjs.koViewModel);
    bkjs.koEvent("model.created", { name: name, vm: bkjs.koModels[name] });
    return bkjs.koModels[name];
}

bkjs.koCreateModelAlias = function(name, alias)
{
    bkjs.koModelAliases[bkjs.toCamel(alias)] = bkjs.toCamel(name);
}

bkjs.koCreateTemplateAlias = function(name, alias)
{
    bkjs.koTemplateAliases[bkjs.toCamel(alias)] = bkjs.toCamel(name);
}

bkjs.koFindModel = function(name)
{
    name = bkjs.toCamel(name);
    var tmpl = bkjs.koTemplates[name] || bkjs.koTemplates[bkjs.koTemplateAliases[name]];
    if (!tmpl) {
        name = bkjs.koModelAliases[name];
        if (name) tmpl = bkjs.koTemplates[name];
    }
    if (!tmpl) return null;
    if (tmpl[0] !== "<") {
        bkjs.koTemplates[name] = tmpl = bkjs.strDecompress(tmpl, "base64");
    }
    if (bkjs.debug) console.log("koFindModel:", name, tmpl.substr(0, 32));
    return {
        template: tmpl,
        viewModel: {
            createViewModel: function(params, componentInfo) {
                var vm;
                if (bkjs.isF(bkjs.koModels[name])) {
                    vm = new bkjs.koModels[name](params, componentInfo);
                    if (bkjs.isF(vm.onCreate)) vm.onCreate(vm.params, componentInfo);
                    bkjs.koViewModels.push(vm);
                }
                if (bkjs.debug) console.log("createViewModel:", name);
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

// Web bundle naming convention
ko.components.loaders.unshift({
    getConfig: function(name, callback) {
        callback(bkjs.koFindModel(name));
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

bkjs.koPlugins = [];

bkjs.koApplyPlugins = function(target)
{
    if (!target) return;
    for (const i in bkjs.koPlugins) {
        if (bkjs.isF(bkjs.koPlugins[i])) bkjs.koPlugins[i](target);
    }
}

// Main component view model
bkjs.koComponentName = ko.observable("none");
bkjs.koComponentParams = ko.observable();

ko.components.register("bkjs-component", {
    viewModel: function(params) {
        this.name = bkjs.koComponentName;
        this.params = bkjs.koComponentParams;
    },
    template: '<div data-bind="component: { name: $root.koComponentName, params: $root.koComponentParams }"></div>'
});

bkjs.koShowComponent = function(name, params, nosave)
{
    if (bkjs.debug) console.log("koShowComponent:", name, params);
    bkjs.koComponentParams(params || {});
    bkjs.koComponentName(name);
    if (!nosave) bkjs.koSaveComponent(name, params);
    bkjs.koEvent("component.shown", { name: name, params: params });
}

// Simple router support
bkjs.koAppPath = (window.location.pathname.replace(/(\/+[^/]+)$|\/+$/, "") + "/").replace(/\/app.+$/, "/") + "app/";
bkjs.koAppLocation = window.location.origin + bkjs.koAppPath;

window.onpopstate = function(event) {
    if (event.state && event.state.view) bkjs.koShowComponent(event.state.view, event.state.params);
};

bkjs.koSaveComponent = function(name, params)
{
    if (!name) return;
    var url = name;
    if (params && params.param) {
        url += "/" + params.param;
        if (params.value) url += "/" + params.value;
    }
    if (url == bkjs._appLocation) return;
    window.history.pushState({ view: name, params: params }, name, bkjs.koAppLocation + url);
    bkjs._appLocation = url;
}

bkjs.koRestoreComponent = function(path, dflt)
{
    if (path && path.indexOf(bkjs.koAppPath) != 0) path = "";
    var location = window.location.origin + (path || window.location.pathname);
    var params = location.substr(bkjs.koAppLocation.length).split("/");
    if (bkjs.debug) console.log("koRestoreComponent:", window.location.pathname, "path:", path, "dflt:", dflt, "params:", params);
    var model = bkjs.koFindModel(params[0]);
    bkjs.koShowComponent(model ? params[0] : dflt || "none", model ? { param: params[1], value: params[2] } : null);
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

$(function() {
    bkjs.koBreakpoint(bkjs.koGetBreakpoint());
    $(window).on("resize.bkjs", (event) => {
        clearTimeout(bkjs._resized);
        bkjs._resized = setTimeout(() => { bkjs.koBreakpoint(bkjs.koGetBreakpoint()) }, 500);
    });

    $(bkjs).on("bkjs.event", (ev, name, event, data) => {
        switch (name) {
        case "component.created":
            bkjs.koApplyPlugins(data.info.element);
            break;
        }
    });
});
