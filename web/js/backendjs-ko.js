//
// Vlad Seryakov 2014
//

Backendjs.session = true;
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

Backendjs.koLogout = function(callback)
{
    Backendjs.logout(function() {
        if (typeof callback == "function") return callback();
    });
}

$(function()
{
    ko.applyBindings(Backendjs);
    Backendjs.login(function() {
        Backendjs.koAuth(Backendjs.loggedIn);
        Backendjs.koAdmin(Backendjs.loggedIn && Backendjs.account.type == "admin");
        if (Backendjs.koShow) Backendjs.koShow();
    });
});
