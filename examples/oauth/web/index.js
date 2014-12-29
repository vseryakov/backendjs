//
// Vlad Seryakov 20014
//

var self = Backendjs;
self.auth = ko.observable(0);

self.doShow = function()
{
    $("#account").html("<pre>" + self.formatJSON(self.account, " ") + "</pre>");
}

self.doLogin = function(data, event)
{
    self.showLogin(function(err) {
        if (err) {
            self.showAlert("danger", err);
        } else {
            self.hideLogin();
            self.auth(self.loggedIn);
            self.doShow();
        }
    });
}

self.doLogout = function()
{
    self.logout(function() {
        window.location.href = "/";
    });
}

$(function()
{
    ko.applyBindings(self);
    self.login(function() {
        self.auth(self.loggedIn);
        if (self.auth()) self.doShow();
    });
});

