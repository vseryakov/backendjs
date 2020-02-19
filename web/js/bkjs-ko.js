//
// Vlad Seryakov 2014
//

// Status of the current account
bkjs.koAuth = ko.observable(0);
bkjs.koAdmin = ko.observable(0);
bkjs.koName = ko.observable("");
bkjs.koState = {};
bkjs.koTemplates = {};
bkjs.koModels = {};
bkjs.koViewModels = [];

bkjs.koInit = function()
{
    ko.applyBindings(bkjs);
    bkjs.login(function(err) {
        bkjs.koCheckLogin(err);
    });
}

bkjs.koCheckLogin = function(err)
{
    bkjs.koName(bkjs.account.name || "");
    bkjs.koAuth(bkjs.loggedIn);
    bkjs.koAdmin(bkjs.loggedIn && bkjs.checkAccountType(bkjs.account, bkjs.adminType || "admin"));
    $(bkjs).trigger(bkjs.loggedIn ? "bkjs.login" : "bkjs.nologin", err);
    if (!err && typeof bkjs.koShow == "function") bkjs.koShow();
}

bkjs.koLogin = function(data, event)
{
    bkjs.showLogin(bkjs.koLoginOptions, function(err) {
        bkjs.koCheckLogin(err);
        if (!err) bkjs.hideLogin();
    });
}

bkjs.koLogout = function(data, event)
{
    bkjs.logout(function() {
        bkjs.koAuth(0);
        bkjs.koAdmin(0);
        bkjs.koName("");
        $(bkjs).trigger('bkjs.logout');
        if (bkjs.koLogoutUrl) window.location.href = bkjs.koLogoutUrl;
    });
}

bkjs.koVal = ko.utils.unwrapObservable;

bkjs.koGet = function(name, dflt)
{
    if (typeof name != "string") name = String(name);
    name = name.replace(/[^a-zA-z0-9_]/g, "_");
    var val = bkjs.koState[name];
    if (typeof val == "undefined") {
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
        if (typeof key != "string") continue;
        key = key.replace(/[^a-zA-z0-9_]/g, "_");
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
    if (!obj || typeof obj != "object") obj = {};
    for (var p in obj) {
        if (typeof options[p] != "undefined") continue;
        if (ko.isObservable(obj[p])) obj[p](undefined); else obj[p] = undefined;
    }
    for (var p in options) {
        if (ko.isObservable(obj[p])) obj[p](options[p]); else obj[p] = options[p];
    }
    return obj;
}

bkjs.koUpdateObject = function(obj, options)
{
    if (!obj || typeof obj != "object") obj = {};
    for (var p in options) {
        if (ko.isObservable(obj[p])) obj[p](options[p]); else obj[p] = options[p];
    }
    return obj;
}

bkjs.koEvent = function(name, data)
{
    var event = bkjs.toCamel(name);
    event = "on" + event.substr(0, 1).toUpperCase() + event.substr(1);
    $(bkjs).trigger("bkjs.event", [name, event, data]);
}

bkjs.koViewModel = function(params, componentInfo)
{
    this.params = {};
    for (var p in params) this.params[p] = params[p];
    $(bkjs).on("bkjs.event." + this.name, $.proxy(this._handleEvent, this));
}

bkjs.koViewModel.prototype._handleEvent = function(ev, name, event, data)
{
    if (bkjs.debug) console.log("handleEvent:", this.name, name, event, data)
    if (typeof this[event] == "function") this[event](data);
    if (typeof this.handleEvent == "function") this.handleEvent(name, data);
}

bkjs.koViewModel.prototype.dispose = function()
{
    if (bkjs.debug) console.log("dispose:", this.name);
    bkjs.koEvent("model.disposed", { name: this.name, params: this.params, vm: this });
    $(bkjs).off("bkjs.event." + this.name, $.proxy(this._handleEvent, this));
    if (typeof this.onDispose == "function") this.onDispose();
    delete this.params;
    bkjs.koViewModels.splice(bkjs.koViewModels.indexOf(this));
}

bkjs.koCreateModel = function(name)
{
    if (!name) throw "model name is required";
    bkjs.koModels[name] = function(params, componentInfo) {
        this.name = name;
        bkjs.koViewModel.call(this, params, componentInfo);
    };
    bkjs.inherits(bkjs.koModels[name], bkjs.koViewModel);
    bkjs.koEvent("model.created", { name: name, vm: bkjs.koModels[name] });
    return bkjs.koModels[name];
}

bkjs.koFindModel = function(name)
{
    name = bkjs.toCamel(name);
    var tmpl = bkjs.koTemplates[name];
    if (!tmpl) return null;
    return {
        template: tmpl,
        viewModel: {
            createViewModel: function(params, componentInfo) {
                var vm;
                if (typeof bkjs.koModels[name] == "function") {
                    vm = new bkjs.koModels[name](params, componentInfo);
                    if (typeof vm.onCreate == "function") vm.onCreate(params, componentInfo);
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

// Web bundle naming convention
ko.components.loaders.unshift({
    getConfig: function(name, callback) {
        callback(bkjs.koFindModel(name));
    }
});

