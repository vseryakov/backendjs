//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  alpinejs-app 2024
//

// Passkey support

export class Passkeys {

    constructor(options, callback)
    {
        this.reg_path = options?.reg_path || "/passkey/register"
        this.login_path = options?.login_path || "/passkey/login"

        if (this.client) return;
        import("/js/webauthn.min.mjs").then(mod => {
            this.client = mod.client;
            app.call(callback)
        }).catch(err => {
            app.call(callback, err);
        });
    }

    start(options, callback)
    {
        app.fetch(this.reg_path, { body: options?.body }, callback);
    }

    finish(config, options, callback)
    {
        this.client.register(options?.name || app.user?.name, config?.challenge, {
            attestation: true,
            userHandle: config?.id,
            domain: config?.domain,
        }).then(data => {
            app.fetch(this.reg_path, { body: Object.assign(data || {}, options?.body) }, callback);
        }).catch(err => {
            app.call(callback, err);
        });
    }

    register(options, callback)
    {
        this.start(options, (err, config) => {
            if (err) return app.call(callback, err);
            this.finish(config, options, callback);
        });
    }

    login(options, callback)
    {
        app.fetch(this.login_path, (err, config) => {
            if (err) return app.call(callback, err);

            this.client.authenticate(app.util.split(options?.ids), config.challenge, {
                domain: config.domain,
            }).then(data => {
                app.fetch(this.login_path, { body: Object.assign(data, options?.body) }, callback);
            }).catch(err => {
                app.call(callback, err);
            });
        });
    }
}
