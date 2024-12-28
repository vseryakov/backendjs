//
// Vlad Seryakov 2014
//

(() => {
var app = window.app;

app.koAuth = ko.observable(0);
app.koMobile = ko.observable();

// Variable utils
app.koVal = ko.unwrap;
app.isKo = (v) => (ko.isObservable(v))
app.isKa = (v) => (ko.isObservableArray(v))
app.koRegister = (...args) => args.forEach(x => ko.components.register(x, {}))

app.koSetObject = function(obj, options)
{
    if (!obj || typeof obj != "object") obj = {};
    for (const p in obj) {
        if (options[p] !== undefined) continue;
        if (ko.isComputed(obj[p])) continue;
        if (app.isKo(obj[p])) obj[p](undefined); else obj[p] = undefined;
    }
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (app.isKo(obj[p])) obj[p](app.koVal(options[p])); else obj[p] = app.koVal(options[p]);
    }
    return obj;
}

app.koUpdateObject = function(obj, options)
{
    if (!obj || typeof obj != "object") obj = {};
    for (const p in options) {
        if (ko.isComputed(obj[p])) continue;
        if (app.isKo(obj[p])) obj[p](app.koVal(options[p])); else obj[p] = app.koVal(options[p]);
    }
    return obj;
}

app.koConvert = function(obj, name, val, dflt)
{
    if (!obj || typeof obj != "object") obj = {};
    if (!app.isKo(obj[name])) {
        obj[name] = Array.isArray(val || dflt) ? ko.observableArray(obj[name]) : ko.observable(obj[name]);
    }
    if (val !== undefined) obj[name](val);
    if (dflt !== undefined && !obj[name]()) obj[name](dflt);
    return obj;
}

app.koSetMobile = function()
{
    app.koMobile(/xs|sm|md/.test(app.getBreakpoint()))
}

// Useful bindings
ko.bindingHandlers.hidden = {
    update: function (element, valueAccessor) {
        var value = ko.utils.unwrapObservable(valueAccessor());
        var isCurrentlyHidden = !(element.style.display == "");
        if (value && !isCurrentlyHidden) element.style.display = "none"; else
        if ((!value) && isCurrentlyHidden) element.style.display = "";
    }
};

ko.bindingHandlers.html.update = function (element, valueAccessor) {
    ko.utils.setHtml(element, app.sanitizer.run(ko.utils.unwrapObservable(valueAccessor())));
};

// Apply KO to all bootpopups
bootpopup.plugins.push({
    before: function(self) {
        if (self.options.data) ko.applyBindings(self.options.data, self.modal.get(0));
    },
    complete: function(event, self) {
        if (self.options.data) ko.cleanNode(self.modal.get(0));
    },
});

app.$ready(() => {
    app.koSetMobile();
    app.$on(window, "resize", app.koSetMobile);
    app.on("login", () => { app.koAuth(app.loggedIn) });
    app.on("logout", () => { app.koAuth(app.loggedIn) });
});

})();
