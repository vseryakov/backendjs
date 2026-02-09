//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  alpinejs-app 2024
//

const call = (callback, ...args) => (typeof callback == "function" && callback(...args))

// eslint-disable-next-line
export class Passkey {

    headers = {}
    register_path = "/passkey/register"
    login_path = "/passkey/login"

    constructor(options, callback)
    {
        if (this.client) return;
        import("/js/webauthn.min.mjs").then(mod => {
            this.client = mod.client;
            call(callback)
        }).catch (err => {
            call(callback, err);
        })
    }


    fetch(path, body, callback)
    {
        var opts = {
            method: "POST",
            body: JSON.stringify(body || {}),
            headers: Object.assign({
                "content-type": "application/json; charset=UTF-8"
            }, this.headers),
        }
        try {
            window.fetch(path, opts).then(async res => {
                var data = await res.json();
                call(callback, res.ok ? null : data, data);
            }).catch(err => {
                call(callback, err);
            })
        } catch (err) {
            call(callback, err);
        }
    }

    start(options, callback)
    {
        this.fetch(this.register_path, options?.body, callback);
    }

    finish(config, options, callback)
    {
        this.client.register(options?.name, config?.challenge, {
            attestation: true,
            userHandle: config?.id,
            domain: config?.domain,
        }).then(data => {
            this.fetch(this.register_path, Object.assign(data || {}, options?.body), callback);
        }).catch(err => {
            call(callback, err)
        });
    }

    register(options, callback)
    {
        this.start(options, (err, config) => {
            if (err) return call(callback, err);
            this.finish(config, options, callback);
        });
    }

    login(options, callback)
    {
        this.fetch(this.login_path, (err, config) => {
            if (err) return call(callback, err);

            this.client.authenticate(String(options?.ids || "").split(","), config.challenge, {
                domain: config.domain,
            }).then(data => {
                this.fetch(this.login_path, Object.assign(data, options?.body), callback);
            }).catch(err => {
                call(callback, err)
            });
        });
    }
}


