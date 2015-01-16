//
// Vlad Seryakov 2014
//

// Setup a cookie session
Backendjs.session = true;
// Redirect to this url on logout
Backendjs.logoutUrl = window.location.pathname;
// Status of the current account
Backendjs.koAuth = ko.observable(0);
Backendjs.koAdmin = ko.observable(0);

Backendjs.koLogin = function(data, event)
{
    Backendjs.showLogin(function(err) {
        if (err) return;
        Backendjs.hideLogin();
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type == "admin");
        if (Backendjs.koShow) Backendjs.koShow();
    });
}

Backendjs.koLogout = function(data, event)
{
    Backendjs.logout(function() {
        Backendjs.koAuth(0);
        Backendjs.koAdmin(0);
        if (Backendjs.logoutUrl) window.location.href = Backendjs.logoutUrl;
    });
}

Backendjs.koInit = function(callback)
{
    ko.applyBindings(Backendjs);
    Backendjs.login(function(err, data, xhr) {
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type == "admin");
        if (Backendjs.koShow) Backendjs.koShow();
        if (typeof callback == "function") callback(err, data, xhr);
    });
}
