/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

// Secret policy for plain text passwords
bkjs.passwordPolicy = {
    '[a-z]+': 'requires at least one lower case letter',
    '[A-Z]+': 'requires at least one upper case letter',
    '[0-9]+': 'requires at least one digit',
    '.{8,}': 'requires at least 8 characters',
};

// Try to authenticate with the supplied login and secret
bkjs.login = function(options, callback)
{
    if (this.isF(options)) callback = options, options = {};
    options = options || {};
    if (!options.data) options.data = {};
    if (!options.url) options.url = "/auth";
    options.data._session = this.session;

    this.send(options, (data) => {
        this.loggedIn = true;
        for (const p in data) this.account[p] = data[p];
        if (this.isF(callback)) callback.call(options.self || this);
    }, (err, xhr) => {
        this.loggedIn = false;
        for (const p in this.account) delete this.account[p];
        if (this.isF(callback)) callback.call(options.self || this, err, null, xhr);
    });
}

// Logout and clear all cookies and local credentials
bkjs.logout = function(options, callback)
{
    if (this.isF(options)) callback = options, options = {};
    options = options || {};
    if (!options.url) options = { url: "/logout" };
    this.loggedIn = false;
    for (const p in this.account) delete this.account[p];
    this.sendRequest(options, callback);
}

// Verify account secret against the policy
bkjs.checkPassword = function(secret, policy)
{
    secret = secret || "";
    policy = policy || this.passwordPolicy;
    for (var p in policy) {
        if (!secret.match(p)) {
            return {
                status: 400,
                message: this.__(policy[p]),
                policy: Object.keys(policy).map((x) => (this.__(policy[x]))).join(", ")
            };
        }
    }
    return "";
}

// Retrieve current account record, call the callback with the object or error
bkjs.getAccount = function(query, callback)
{
    if (this.isF(query)) callback = query, query = null;
    this.sendRequest({ url: "/account/get", data: query }, (err, data, xhr) => {
        for (const p in data) this.account[p] = data[p];
        if (this.isF(callback)) callback(err, data, xhr);
    });
}

// Update current account
bkjs.updateAccount = function(obj, callback)
{
    delete obj.secret2;
    this.sendRequest({ url: '/account/update', data: obj }, callback);
}

// Return true if the account contains the given type
bkjs.checkAccountType = function(account, type)
{
    if (!account || !account.type) return false;
    if (!Array.isArray(account.type)) account.type = String(account.type).split(",").map((x) => (x.trim()));
    if (Array.isArray(type)) return type.some((x) => (account.type.includes(x)));
    return account.type.includes(type);
}

