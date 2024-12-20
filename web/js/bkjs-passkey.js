//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

// Passkey support

bkjs.passkeyInit = function(callback)
{
    if (bkjs.passkey.client) return;
    import("/js/webauthn.min.mjs").then((mod) => {
        bkjs.passkey.client = mod.client;
        bkjs.call(callback)
    }).catch((err) => {
        bkjs.call(callback, err);
    });
}

bkjs.passkeyRegisterStart = function(options, callback)
{
    bkjs.get({ url: "/passkey/register", data: options?.query }, callback);
}

bkjs.passkeyRegisterFinish = function(config, options, callback)
{
    bkjs.passkey.client.register(options?.name || bkjs.account?.name, config?.challenge, {
        attestation: true,
        userHandle: config?.id,
        domain: config?.domain,
    }).then((data) => {
        bkjs.sendRequest({ url: "/passkey/register", data: Object.assign(data || {}, options?.query) }, callback);
    }).catch((err) => {
        bkjs.call(callback, err);
    });
}

bkjs.passkeyRegister = function(options, callback)
{
    bkjs.passkey.registerStart(options, (err, config) => {
        if (err) return bkjs.call(callback, err);
        bkjs.passkey.registerFinish(config, options, callback);
    });
}

bkjs.passkeyLogin = function(options, callback)
{
    bkjs.get({ url: "/passkey/login" }, (err, config) => {
        if (err) return bkjs.call(callback, err);

        bkjs.passkey.client.authenticate(bkjs.strSplit(options?.ids), config.challenge, {
            domain: config.domain,
        }).then((data) => {
            bkjs.login({ url: "/passkey/login", data: Object.assign(data, options?.query) }, callback);
        }).catch((err) => {
            bkjs.call(callback, err);
        });
    });
}

