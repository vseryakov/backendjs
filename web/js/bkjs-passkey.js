//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2024
//

// Passkey support

bkjs.passkey = {
    init: function(callback) {
        if (bkjs.passkey.client) return;
        import("/js/webauthn.min.mjs").then((mod) => {
            bkjs.passkey.client = mod.client;
            bkjs.cb(callback)
        }).catch((e) => {
            console.log(e);
            bkjs.cb(callback, e)
        });
    },

    register: function(options, callback) {
        bkjs.get({ url: "/passkey/register" }, async (err, rc) => {
            if (err) return bkjs.cb(callback, err);

            try {
                var data = await bkjs.passkey.client.register(options?.name || bkjs.account?.name, rc.challenge, {
                    attestation: true,
                    userHandle: rc.id,
                    domain: rc.domain,
                });
            } catch (e) {
                return bkjs.cb(callback, e);
            }
            bkjs.sendRequest({ url: "/passkey/register", data: data }, callback);
        });
    },

    login: function(options, callback) {
        bkjs.get({ url: "/passkey/login" }, async (err, rc) => {
            if (err) return bkjs.cb(callback, err);

            try {
                var data = await bkjs.passkey.client.authenticate(bkjs.strSplit(options?.ids), rc.challenge, {
                    domain: rc.domain,
                });
                data.challenge = rc.challenge;
                data._session = bkjs.session;
            } catch (e) {
                return bkjs.cb(callback, e);
            }
            bkjs.sendRequest({ url: "/passkey/login", data: data }, callback);
        });
    }
};
