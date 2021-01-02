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

// Verify account secret against the policy
bkjs.checkPassword = function(secret, policy)
{
    secret = secret || "";
    policy = policy || this.passwordPolicy;
    for (var p in policy) {
        if (!secret.match(p)) {
            return {
                status: 400,
                message: this.__(this.passwordPolicy[p]),
                policy: Object.keys(this.passwordPolicy).map(function(x) {
                    return bkjs.__(bkjs.passwordPolicy[x])
                }).join(", ")
            };
        }
    }
    return "";
}

// Wait for events and call the callback, this runs until Backend.unsubscribe is set to true
bkjs.subscribeAccount = function(callback)
{
    var errors = bkjs.unsubscribe = 0;
    (function poll() {
        bkjs.send({ url: "/account/subscribe", complete: bkjs.unsubscribe ? null : poll }, function(data, xhr) {
            callback(data, xhr);
        }, function(err) {
            if (errors++ > 5) bkjs.unsubscribe = true;
        });
    })();
}

// Retrieve current account record, call the callback with the object or error
bkjs.getAccount = function(query, callback)
{
    if (typeof query == "function") callback = query, query = null;
    this.sendRequest({ url: "/account/get", data: query, jsonType: "obj" }, function(err, data, xhr) {
        for (const p in data) bkjs.account[p] = data[p];
        if (typeof callback == "function") callback(err, data, xhr);
    });
}

// Update current account
bkjs.updateAccount = function(obj, callback)
{
    if (!obj.login) obj.login = this.account.login;
    // Scramble here if we did not ask the server to do it with _scramble option
    if (obj.secret && !obj._scramble) {
        var creds = this.checkCredentials(obj);
        obj.login = creds.login;
        obj.secret = creds.secret;
        obj.scramble = creds.scramble;
    }
    delete obj.secret2;
    this.sendRequest({ url: '/account/update', data: obj, type: "POST", jsonType: "obj" }, callback);
}

// Return true if the account contains the given type
bkjs.checkAccountType = function(account, type)
{
    if (!account || !account.type) return false;
    if (!Array.isArray(account.type)) account.type = String(account.type).split(",").map(function(x) { return x.trim() });
    if (Array.isArray(type)) return type.some(function(x) { return account.type.indexOf(x) > -1 });
    return account.type.indexOf(type) > -1;
}

