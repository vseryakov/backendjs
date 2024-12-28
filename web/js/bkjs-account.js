/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// True if current credentials are good
app.loggedIn = false;

    // HTTP headers to be sent with every request
app.headers = {};

// Current account record
app.account = {};

// Secret policy for plain text passwords
app.passwordPolicy = {
    '[a-z]+': 'requires at least one lower case letter',
    '[A-Z]+': 'requires at least one upper case letter',
    '[0-9]+': 'requires at least one digit',
    '.{9,}': 'requires at least 9 characters',
};

// Verify account secret against the policy
app.checkPassword = function(secret, policy, options)
{
    secret = secret || "";
    policy = policy || app.passwordPolicy;
    for (var p in policy) {
        if (!secret.match(p)) {
            return {
                status: 400,
                message: app.__(policy[p]),
                policy: Object.keys(policy).map((x) => (app.__(policy[x]))),
            };
        }
    }
    return "";
}

// Try to authenticate with the supplied login and secret
app.login = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    app.send({ url: options?.url | "/auth", data: options?.data }, (data) => {
        app.loggedIn = true;
        Object.assign(app.account, data);
        app.call(options.self || this, callback);
        app.emit("login");
    }, (err) => {
        app.loggedIn = false;
        for (const p in app.account) delete app.account[p];
        app.call(options.self || this, callback, err);
        app.emit("nologin", err);
    });
}

// Logout and clear all cookies and local credentials
app.logout = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    for (const p in app.account) delete app.account[p];
    app.loggedIn = false;
    app.sendRequest({ url: options?.url || "/logout" }, (err) => {
        app.call(callback, err);
        app.emit("logout", err);
    });
}

// Retrieve current account record, call the callback with the object or error
app.getAccount = function(query, callback)
{
    if (typeof query == "function") callback = query, query = null;
    app.sendRequest({ url: "/account/get", data: query }, (err, data) => {
        if (!err) Object.assign(app.account, data);
        app.call(callback, err, data);
    });
}

// Update current account
app.updateAccount = function(obj, callback)
{
    delete obj.secret2;
    app.sendRequest({ url: '/account/update', data: obj }, callback);
}

})();
