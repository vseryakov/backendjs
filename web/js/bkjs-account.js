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
bkjs.checkPassword = function(secret)
{
    secret = secret || "";
    for (var p in this.passwordPolicy) {
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
    var errors = 0;
    (function poll() {
        bkjs.send({ url: "/account/subscribe", complete: bkjs.unsubscribe ? null : poll }, function(data, xhr) {
            callback(data, xhr);
        }, function(err) {
            if (errors++ > 3) bkjs.unsubscribe = true;
        });
    })();
}

// Retrieve current account record, call the callback with the object or error
bkjs.getAccount = function(callback)
{
    this.sendRequest({ url: "/account/get", jsonType: "obj" }, function(err, data, xhr) {
        for (var p in data) bkjs.account[p] = data[p];
        if (typeof callback == "function") callback(err, data, xhr);
    });
}

// Register new account record, call the callback with the object or error
bkjs.addAccount = function(obj, callback)
{
    // Replace the actual credentials from the storage in case of scrambling in the client
    if (!obj._scramble) {
        var creds = this.checkCredentials(obj.login, obj.secret);
        obj.login = creds.login;
        obj.secret = creds.secret;
    }
    delete obj.secret2;
    this.sendRequest({ type: "POST", url: "/account/add", data: obj, jsonType: "obj", nosignature: 1 }, callback);
}

// Update current account
bkjs.updateAccount = function(obj, callback)
{
    // Scramble here if we did not ask the server to do it with _scramble option
    if (obj.secret && !obj._scramble) {
        var creds = this.checkCredentials(obj.login || this.account.login, obj.secret);
        obj.login = creds.login;
        obj.secret = creds.secret;
    }
    delete obj.secret2;
    this.sendRequest({ url: '/account/update', data: obj, type: "POST", jsonType: "obj" }, callback);
}

// Return true if the account contains the given type
bkjs.checkAccountType = function(account, type)
{
    if (!account || !account.type) return false;
    account._types = Array.isArray(account._types) ? account._types : String(account.type).split(",").map(function(x) { return x.trim() });
    if (Array.isArray(type)) return type.some(function(x) { return account._types.indexOf(x) > -1 });
    return account._types.indexOf(type) > -1;
}

