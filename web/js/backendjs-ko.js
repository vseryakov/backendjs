//
// Vlad Seryakov 2014
//

Backendjs.session = true;
Backendjs.koAuth = ko.observable(0);

Backendjs.koLogin = function(data, event)
{
    Backendjs.showLogin(function(err) {
        if (err) return;
        Backendjs.hideLogin();
        Backendjs.koAuth(Backendjs.loggedIn);
        if (Backendjs.koShow) Backendjs.koShow();
    });
}

Backendjs.koLogout = function(callback)
{
    Backendjs.logout(function() {
        if (typeof callback == "function") callback();
        window.location.href = "/";
    });
}

$(function()
{
    ko.applyBindings(Backendjs);
    Backendjs.login(function() {
        if (!Backendjs.loggedIn && window.location.pathname != "/") window.location.href = "/";
        Backendjs.koAuth(Backendjs.loggedIn);
        if (Backendjs.koShow) Backendjs.koShow();
    });
});
