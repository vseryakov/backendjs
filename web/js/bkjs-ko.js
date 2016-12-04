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

Bkjs.checkLogin = function(err, status)
{
    Bkjs.koAuth(Bkjs.loggedIn);
    Bkjs.koName(Bkjs.account.name);
    Bkjs.koAdmin(Bkjs.loggedIn && Bkjs.checkAccountType(Bkjs.account, "admin"));
    $(Bkjs).trigger(Bkjs.loggedIn ? "login" : "nologin", [err, status]);
    if (!err && Bkjs.koShow) Bkjs.koShow();
}

Bkjs.koLogin = function(data, event)
{
    Bkjs.showLogin(function(err, data, xhr) {
        Bkjs.checkLogin(err, xhr.status);
        if (!err) Bkjs.hideLogin();
    });
}

Bkjs.koLogout = function(data, event)
{
    Bkjs.logout(function() {
        Bkjs.koAuth(0);
        Bkjs.koAdmin(0);
        Bkjs.koName("");
        $(Bkjs).trigger('logout');
        if (Bkjs.koLogoutUrl) window.location.href = Bkjs.koLogoutUrl;
    });
}

Bkjs.koInit = function()
{
    ko.applyBindings(Bkjs);
    Bkjs.login(function(err, data, xhr) {
        Bkjs.checkLogin(err, xhr.status);
    });
}
