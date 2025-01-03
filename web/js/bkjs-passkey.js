//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

// Passkey support

(() => {
var app = window.app;

app.passkeyInit = function(callback)
{
    if (app.passkeyClient) return;
    import("/js/webauthn.min.mjs").then((mod) => {
        app.passkeyClient = mod.client;
        app.call(callback)
    }).catch((err) => {
        app.call(callback, err);
    });
}

app.passkeyRegisterStart = function(options, callback)
{
    app.get({ url: "/passkey/register", data: options?.query }, callback);
}

app.passkeyRegisterFinish = function(config, options, callback)
{
    app.passkeyClient.register(options?.name || app.account?.name, config?.challenge, {
        attestation: true,
        userHandle: config?.id,
        domain: config?.domain,
    }).then((data) => {
        app.sendRequest({ url: "/passkey/register", data: Object.assign(data || {}, options?.query) }, callback);
    }).catch((err) => {
        app.call(callback, err);
    });
}

app.passkeyRegister = function(options, callback)
{
    app.passkeyRegisterStart(options, (err, config) => {
        if (err) return app.call(callback, err);
        app.passkeyRegisterFinish(config, options, callback);
    });
}

app.passkeyLogin = function(options, callback)
{
    app.get({ url: "/passkey/login" }, (err, config) => {
        if (err) return app.call(callback, err);

        app.passkeyClient.authenticate(app.strSplit(options?.ids), config.challenge, {
            domain: config.domain,
        }).then((data) => {
            app.login({ url: "/passkey/login", data: Object.assign(data, options?.query) }, callback);
        }).catch((err) => {
            app.call(callback, err);
        });
    });
}

})();
