//
// Vlad Seryakov 2014
//

// Setup a cookie session
Backendjs.session = true;
// Redirect to this url on logout
Backendjs.koLogoutUrl = "";
// Status of the current account
Backendjs.koAuth = ko.observable(0);
Backendjs.koAdmin = ko.observable(0);

Backendjs.koLogin = function(data, event)
{
    Backendjs.showLogin(function(err) {
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type.split(",").indexOf("admin") > -1);
        $(Backendjs).trigger(Backendjs.loggedIn ? "login" : "nologin");
        if (err) return;
        Backendjs.hideLogin();
        if (Backendjs.koShow) Backendjs.koShow();
    });
}

Backendjs.koLogout = function(data, event)
{
    Backendjs.logout(function() {
        Backendjs.koAuth(0);
        Backendjs.koAdmin(0);
        $(Backendjs).trigger('logout');
        if (Backendjs.koLogoutUrl) window.location.href = Backendjs.koLogoutUrl;
    });
}

Backendjs.koInit = function()
{
    ko.applyBindings(Backendjs);
    Backendjs.login(function(err, data, xhr) {
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type.split(",").indexOf("admin") > -1);
        $(Backendjs).trigger(Backendjs.loggedIn ? "login" : "nologin");
        if (err) return;
        if (Backendjs.koShow) Backendjs.koShow();
    });
}
