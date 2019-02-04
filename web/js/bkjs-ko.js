//
// Vlad Seryakov 2014
//

// Status of the current account
bkjs.koAuth = ko.observable(0);
bkjs.koAdmin = ko.observable(0);
bkjs.koName = ko.observable();

bkjs.checkLogin = function(err)
{
    bkjs.koAuth(bkjs.loggedIn);
    bkjs.koName(bkjs.account.name);
    bkjs.koAdmin(bkjs.loggedIn && bkjs.checkAccountType(bkjs.account, "admin"));
    $(bkjs).trigger(bkjs.loggedIn ? "bkjs.login" : "bkjs.nologin", err);
    if (!err && typeof bkjs.koShow == "function") bkjs.koShow();
}

bkjs.koLogin = function(data, event)
{
    bkjs.showLogin(bkjs.koLoginOptions, function(err) {
        bkjs.checkLogin(err);
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

bkjs.koInit = function()
{
    ko.applyBindings(bkjs);
    bkjs.login(function(err) {
        bkjs.checkLogin(err);
    });
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
        name = bkjs.toCamel(name);
        if (!window[name + "Template"]) return callback(null);
        callback({ template: window[name + "Template"], viewModel: Bkjs[name + "Model"] });
    }
});

