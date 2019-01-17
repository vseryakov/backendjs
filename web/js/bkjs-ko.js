//
// Vlad Seryakov 2014
//

// Setup a cookie session
Bkjs.session = true;
// Redirect to this url on logout
Bkjs.koLogoutUrl = "";
// Status of the current account
Bkjs.koAuth = ko.observable(0);
Bkjs.koAdmin = ko.observable(0);
Bkjs.koName = ko.observable();

Bkjs.checkLogin = function(err)
{
    Bkjs.koAuth(Bkjs.loggedIn);
    Bkjs.koName(Bkjs.account.name);
    Bkjs.koAdmin(Bkjs.loggedIn && Bkjs.checkAccountType(Bkjs.account, "admin"));
    $(Bkjs).trigger(Bkjs.loggedIn ? "bkjs.login" : "bkjs.nologin", err);
    if (!err && typeof Bkjs.koShow == "function") Bkjs.koShow();
}

Bkjs.koLogin = function(data, event)
{
    Bkjs.showLogin(Bkjs.koLoginOptions, function(err) {
        Bkjs.checkLogin(err);
        if (!err) Bkjs.hideLogin();
    });
}

Bkjs.koLogout = function(data, event)
{
    Bkjs.logout(function() {
        Bkjs.koAuth(0);
        Bkjs.koAdmin(0);
        Bkjs.koName("");
        $(Bkjs).trigger('bkjs.logout');
        if (Bkjs.koLogoutUrl) window.location.href = Bkjs.koLogoutUrl;
    });
}

Bkjs.koInit = function()
{
    ko.applyBindings(Bkjs);
    Bkjs.login(function(err) {
        Bkjs.checkLogin(err);
    });
}
