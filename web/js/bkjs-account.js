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
                message: this.__(policy[p]),
                policy: Object.keys(policy).map((x) => (bkjs.__(policy[x]))).join(", ")
            };
        }
    }
    return "";
}

// Retrieve current account record, call the callback with the object or error
bkjs.getAccount = function(query, callback)
{
    if (bkjs.isF(query)) callback = query, query = null;
    this.sendRequest({ url: "/account/get", data: query }, (err, data, xhr) => {
        for (const p in data) bkjs.account[p] = data[p];
        if (bkjs.isF(callback)) callback(err, data, xhr);
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
    if (Array.isArray(type)) return type.some((x) => (account.type.indexOf(x) > -1));
    return account.type.indexOf(type) > -1;
}

