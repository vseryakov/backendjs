//
// Vlad Seryakov 2014
//

// Setup a cookie session
Backendjs.session = true;
// Redirect to this url on logout
Backendjs.logoutUrl = "";
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
        if (Backendjs.logoutUrl) window.location.href = Backendjs.logoutUrl;
    });
}

$(function()
{
    ko.applyBindings(Backendjs);
    Backendjs.login(function() {
        if (Backendjs.logoutUrl && !window.location.pathname.match("^" + Backendjs.logoutUrl)) window.location.href = Backendjs.logoutUrl;
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type == "admin");
        if (Backendjs.koShow) Backendjs.koShow();
    });
});
