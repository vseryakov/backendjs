/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

// Secret policy for plain text passwords
bkjs.passwordPolicy = {
    '[a-z]+': 'requires at least one lower case letter',
    '[A-Z]+': 'requires at least one upper case letter',
    '[0-9]+': 'requires at least one digit',
    '.{9,}': 'requires at least 9 characters',
};

// Try to authenticate with the supplied login and secret
bkjs.login = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    options = options || {};
    if (!options.data) options.data = {};
    if (!options.url) options.url = "/auth";
    options.data._session = bkjs.session;

    bkjs.send(options, (data) => {
        bkjs.loggedIn = true;
        for (const p in data) bkjs.account[p] = data[p];
        bkjs.call(options.self || this, callback);
    }, (err, xhr) => {
        bkjs.loggedIn = false;
        for (const p in bkjs.account) delete bkjs.account[p];
        bkjs.call(options.self || this, callback, err, null, xhr);
    });
}

// Logout and clear all cookies and local credentials
bkjs.logout = function(options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    options = options || {};
    if (!options.url) options = { url: "/logout" };
    bkjs.loggedIn = false;
    for (const p in bkjs.account) delete bkjs.account[p];
    bkjs.sendRequest(options, callback);
}

// Verify account secret against the policy
bkjs.checkPassword = function(secret, policy, options)
{
    secret = secret || "";
    policy = policy || bkjs.passwordPolicy;
    for (var p in policy) {
        if (!secret.match(p)) {
            return {
                status: 400,
                message: bkjs.__(policy[p]),
                policy: Object.keys(policy).map((x) => (bkjs.__(policy[x]))),
            };
        }
    }
    return "";
}

// Retrieve current account record, call the callback with the object or error
bkjs.getAccount = function(query, callback)
{
    if (typeof query == "function") callback = query, query = null;
    bkjs.sendRequest({ url: "/account/get", data: query }, (err, data, xhr) => {
        for (const p in data) bkjs.account[p] = data[p];
        bkjs.call(callback, err, data, xhr);
    });
}

// Update current account
bkjs.updateAccount = function(obj, callback)
{
    delete obj.secret2;
    bkjs.sendRequest({ url: '/account/update', data: obj }, callback);
}

