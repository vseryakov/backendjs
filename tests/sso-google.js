/*
 * Interactive Google SSO test against the real provider using a localhost callback.
 *
 * Google OAuth client (Web application) must have the redirect URI:
 *   http://localhost:8999/sso/callback/google
 *
 * Run:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node --test tests/sso-google.js
 *
 * OR put into bkjs.conf.local
 *
 * middleware-sso-providers-google = {"client_id":"xxx","client_secret":"yyy"}
 *
 * Then sign in in the opened browser (Chrome/Firefox, Safari rejects Secure cookies on http://localhost).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { ainit, astop } = require("./utils");
const { api, lib, middleware } = require("../");

const sso = middleware.sso;
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const BASE = "http://localhost:8999";

describe("SSO Google localhost", { skip: !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET }, async () => {

    let done;
    const loggedIn = new Promise(resolve => { done = resolve });

    before(async () => {
        await ainit({ api: 1, cache: 1, noipc: 1, roles: process.env.BKJS_ROLES || "users,sqlite,sso" });
        Object.assign(sso.providers.google, { client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET });

        api.app.get("/app/1", (context) => {
            context.send(200, "Signed in as " + context.user?.name + ", you can close this window");
            done(context.user);
        });
    });

    after(async () => {
        await astop();
    });

    it("redirects to Google with PKCE and nonce", async () => {
        const { provider, err } = await sso.resolve("google");
        assert.ifError(err);

        const { request: rc } = await lib.afetch({ url: BASE + "/sso/login/google", noredirects: 1 });
        assert.equal(rc.status, 302, rc.data);

        const url = new URL(rc.resheaders.location);
        assert.equal(url.origin + url.pathname, provider.authorization_endpoint);
        assert.equal(url.searchParams.get("client_id"), GOOGLE_CLIENT_ID);
        assert.equal(url.searchParams.get("redirect_uri"), BASE + "/sso/callback/google");
        assert.equal(url.searchParams.get("scope"), "openid email profile");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.match(url.searchParams.get("nonce"), /^[A-Za-z0-9_-]{43}$/);
    });

    it("completes the login in the browser", async () => {
        const url = BASE + "/sso/login/google?return=/app/1";
        console.log("Open in the browser to sign in:", url);
        spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).on("error", lib.noop);

        const user = await loggedIn;
        assert.match(user?.login, /^sso:[0-9a-f]{64}$/);
        assert.ok(user.id);

        const { data } = await api.users.aget({ login: user.login });
        assert.equal(data?.id, user.id);
        console.log("Logged in:", data.login, data.name);
    });
});
