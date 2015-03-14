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

Bkjs.koLogin = function(data, event)
{
    Bkjs.showLogin(function(err, data, xhr) {
        Bkjs.koAuth(Bkjs.loggedIn);
        Bkjs.koAdmin(Bkjs.loggedIn && (Bkjs.account.type || "").split(",").indexOf("admin") > -1);
        $(Bkjs).trigger(Bkjs.loggedIn ? "login" : "nologin", [err, xhr.status]);
        if (err) return;
        Bkjs.hideLogin();
        if (Bkjs.koShow) Bkjs.koShow();
    });
}

Bkjs.koLogout = function(data, event)
{
    Bkjs.logout(function() {
        Bkjs.koAuth(0);
        Bkjs.koAdmin(0);
        $(Bkjs).trigger('logout');
        if (Bkjs.koLogoutUrl) window.location.href = Bkjs.koLogoutUrl;
    });
}

Bkjs.koInit = function()
{
    ko.applyBindings(Bkjs);
    Bkjs.login(function(err, data, xhr) {
        Bkjs.koAuth(Bkjs.loggedIn);
        Bkjs.koAdmin(Bkjs.loggedIn && (Bkjs.account.type || "").split(",").indexOf("admin") > -1);
        $(Bkjs).trigger(Bkjs.loggedIn ? "login" : "nologin", [err, xhr.status]);
        if (err) return;
        if (Bkjs.koShow) Bkjs.koShow();
    });
}
