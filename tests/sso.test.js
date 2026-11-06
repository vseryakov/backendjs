/* global  */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ainit, astop } = require("./utils");
const { api, lib, middleware } = require("../");

const sso = middleware.sso;
const roles = process.env.BKJS_ROLES || "users,sqlite,sso";

const ISSUER = "http://127.0.0.1:8999/idp";

// Minimal in-process OIDC/OAuth2 provider, the knobs in `idp` make it misbehave on purpose
const idp = { codes: {} };
let privateJwk, publicJwk;

function authorize(context)
{
    const q = context.query;
    const url = new URL(q.redirect_uri);
    url.searchParams.set("state", q.state);
    if (idp.deny) {
        url.searchParams.set("error", "access_denied");
    } else {
        const code = lib.random();
        idp.codes[code] = { ...q, sub: idp.sub };
        url.searchParams.set("code", code);
    }
    if (idp.iss) url.searchParams.set("iss", idp.iss);
    context.redirect(302, url.toString());
}

function checkCode(context, client_id, client_secret)
{
    const b = context.body || {};
    const req = idp.codes[b.code];
    delete idp.codes[b.code];
    const auth = context.auth;
    const authorized = auth?.type === "Basic" ?
        auth.user === client_id && auth.password === client_secret && !b.client_secret :
        b.client_id === client_id && b.client_secret === client_secret;

    if (!req || !authorized ||
        b.grant_type !== "authorization_code" ||
        b.redirect_uri !== req.redirect_uri ||
        req.client_id !== client_id ||
        req.code_challenge_method !== "S256" ||
        lib.hash(b.code_verifier, "sha256", "base64url") !== req.code_challenge) {
        context.reply({ status: 400, error: "invalid_grant" });
        return;
    }
    return req;
}

function setupIdp()
{
    api.app.get("/idp/.well-known/openid-configuration", (context) => {
        context.json({
            issuer: ISSUER,
            authorization_endpoint: ISSUER + "/authorize",
            token_endpoint: ISSUER + "/token",
            userinfo_endpoint: ISSUER + "/userinfo",
            jwks_uri: ISSUER + "/jwks",
        });
    });
    api.app.get("/idp/jwks", (context) => { context.json({ keys: [publicJwk] }) });
    api.app.get("/idp/authorize", authorize);
    api.app.post("/idp/token", async (context) => {
        const req = checkCode(context, "cid", "secret");
        if (!req) return;
        const now = lib.now();
        let { token } = await lib.JWT.sign({ iss: ISSUER, aud: "cid", sub: req.sub, nonce: req.nonce, iat: now, exp: now + 300, name: "Oidc User", ...idp.claims }, privateJwk, "ES256");
        if (idp.tamper) token = token.replace(/\.[^.]+$/, ".AAAA");
        context.json({ access_token: "at-" + req.sub, token_type: "Bearer", id_token: token });
    });

    api.app.get("/gh/authorize", authorize);
    api.app.post("/gh/token", (context) => {
        const req = checkCode(context, "ghid", "ghsecret");
        if (req) context.json({ access_token: "gh-" + req.sub, token_type: "bearer", scope: "read:user" });
    });
    api.app.get("/gh/user", (context) => {
        const token = context.auth?.type === "Bearer" && context.auth.token;
        if (!token?.startsWith("gh-") || !context.req.headers["user-agent"]) return context.reply({ status: 401 });
        context.json({ id: Number(token.substr(3)), login: "octo", name: "Octo Cat" });
    });
}

async function get(url, cookies)
{
    if (url[0] === "/") url = "http://127.0.0.1:" + api.port + url;
    const { request } = await lib.afetch({ url, noredirects: 1, cookies: cookies || {} });
    return request;
}

function cookies(rc, jar = {})
{
    for (const [name, c] of Object.entries(rc.rescookies || {})) {
        if (c.value) jar[name] = c.value; else delete jar[name];
    }
    return jar;
}

// Runs the browser side: app login -> provider authorize -> returns the app callback request
async function login(provider, query = "")
{
    const rc = await get(`/sso/login/${provider}${query}`);
    assert.equal(rc.status, 302, rc.data);
    const authorizeUrl = new URL(rc.resheaders.location);
    const jar = cookies(rc);

    const rc2 = await get(authorizeUrl.toString());
    assert.equal(rc2.status, 302, rc2.data);
    return { authorizeUrl, jar, callback: rc2.resheaders.location };
}

async function callback(flow)
{
    const rc = await get(flow.callback, { ...flow.jar });
    cookies(rc, flow.jar);
    return rc;
}

describe("SSO middleware", async () => {

    before(async () => {
        const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        publicJwk = { ...await crypto.subtle.exportKey("jwk", publicKey), kid: "k1" };
        privateJwk = { ...await crypto.subtle.exportKey("jwk", privateKey), kid: "k1", alg: "ES256" };

        await ainit({ api: 1, cache: 1, noipc: 1, roles });
        api.app.all("/app/1", (context) => { context.send(200, "app") });
        setupIdp();
    });

    after(async () => {
        await astop();
    });

    beforeEach(() => {
        Object.assign(idp, { sub: lib.uuid(), claims: {}, iss: ISSUER, deny: false, tamper: false });
        sso.autoCreate = true;
    });

    it("validates return and endpoint urls", () => {
        assert.equal(sso.returnUrl("/app/1?x=1"), "/app/1?x=1");
        for (const url of ["//evil.com", "/\\evil.com", "/%2F%2Fevil.com", "https://evil.com", "app", "/a b", "/a\x00", 1]) {
            assert.equal(sso.returnUrl(url), undefined, String(url));
        }
        assert.ok(sso.isUrl("https://idp.test/token"));
        for (const url of ["ftp://idp.test", "https://u:p@idp.test", "https://idp.test/#a", "https://idp.test/?a=1", "javascript:alert(1)"]) {
            assert.equal(sso.isUrl(url), undefined, url);
        }
    });

    it("resolves providers by name and rejects unknown ones", async () => {
        const { provider } = await sso.resolve("test");
        assert.equal(provider.name, "test");
        assert.equal(provider.token_endpoint, ISSUER + "/token");
        assert.equal(sso.providers.test.name, undefined, "preset must not be mutated");

        for (const name of ["none", "__proto__", "constructor", "toString", undefined]) {
            assert.ok((await sso.resolve(name)).err, String(name));
        }
        const rc = await get("/sso/login/constructor");
        assert.equal(rc.status, 400);
    });

    it("completes the OIDC code flow with PKCE and nonce", async () => {
        const flow = await login("test", "?return=/app/1");
        const q = flow.authorizeUrl.searchParams;
        assert.equal(flow.authorizeUrl.origin + flow.authorizeUrl.pathname, ISSUER + "/authorize");
        assert.equal(q.get("response_type"), "code");
        assert.equal(q.get("client_id"), "cid");
        assert.equal(q.get("scope"), "openid email");
        assert.equal(q.get("redirect_uri"), `http://127.0.0.1:${api.port}/sso/callback/test`);
        assert.match(q.get("nonce"), /^[A-Za-z0-9_-]{43}$/);

        const first = { ...flow, jar: { ...flow.jar } };
        const rc = await callback(flow);
        assert.equal(rc.status, 302, rc.data);
        assert.equal(rc.resheaders.location, "/app/1");
        assert.ok(flow.jar[api.session.header], "session cookie");
        assert.equal(Object.keys(flow.jar).some(x => x.startsWith("__Host-bk-sso-")), false, "state cookie cleared");

        assert.equal((await get("/app/1", flow.jar)).status, 200);
        assert.equal((await get("/app/1")).status, 302);

        // State is single use
        const replay = await callback(first);
        assert.equal(replay.status, 400);

        // Same subject maps to the same local user
        const user = await api.users.aget({ login: "sso:" + lib.hash(lib.stringify(["test", ISSUER, idp.sub]), "sha256", "hex") });
        assert.equal(user.data?.name, "Oidc User");
        const rc2 = await callback(await login("test"));
        assert.equal(rc2.status, 302);
        assert.equal((await api.users.aget({ login: user.data.login })).data?.id, user.data.id);
    });

    it("rejects invalid callback state", async () => {
        let flow = await login("test");
        assert.equal((await callback({ ...flow, jar: {} })).status, 400, "no browser binding");

        flow = await login("test");
        assert.equal((await callback({ ...flow, callback: flow.callback.replace("/test?", "/github?") })).status, 400, "provider mismatch");

        flow = await login("test");
        assert.equal((await callback({ ...flow, callback: flow.callback.replace(/state=[^&]+/, "state=x") })).status, 400, "bad state");
        assert.equal((await callback({ ...flow, callback: flow.callback + "&error=access_denied" })).status, 400, "code with error");
    });

    it("handles provider error responses", async () => {
        idp.deny = true;
        const rc = await callback(await login("test"));
        assert.equal(rc.status, 401);
    });

    it("rejects issuer mismatch per RFC 9207", async () => {
        idp.iss = "https://evil.test";
        const rc = await callback(await login("test"));
        assert.equal(rc.status, 400);
    });

    it("rejects invalid id tokens", async () => {
        const now = lib.now();
        const cases = [
            { claims: { nonce: "x".repeat(43) } },
            { claims: { aud: "other" } },
            { claims: { iss: "https://evil.test" } },
            { claims: { azp: "other" } },
            { claims: { aud: ["cid", "other"] } },
            { claims: { exp: now - 10 } },
            { claims: { exp: undefined } },
            { claims: { iat: undefined } },
            { tamper: true },
        ];
        for (const c of cases) {
            Object.assign(idp, { claims: {}, tamper: false }, c);
            const rc = await callback(await login("test"));
            assert.equal(rc.status, 401, lib.stringify(c));
        }
        const user = await api.users.aget({ login: "sso:" + lib.hash(lib.stringify(["test", ISSUER, idp.sub]), "sha256", "hex") });
        assert.ok(!user.data);
    });

    it("completes the OAuth2 userinfo flow", async () => {
        idp.sub = String(lib.randomInt(1, 1000000));
        idp.iss = undefined;
        const flow = await login("github", "?return=//evil.com");
        assert.equal(flow.authorizeUrl.searchParams.has("nonce"), false);
        assert.equal(flow.authorizeUrl.searchParams.get("scope"), "read:user user:email");

        const rc = await callback(flow);
        assert.equal(rc.status, 302, rc.data);
        assert.equal(rc.resheaders.location, "/");
        assert.equal((await get("/app/1", flow.jar)).status, 200);

        const user = await api.users.aget({ login: "sso:" + lib.hash(lib.stringify(["github", "", idp.sub]), "sha256", "hex") });
        assert.equal(user.data?.name, "Octo Cat");
    });

    it("does not create users without auto-create", async () => {
        sso.autoCreate = false;
        const rc = await callback(await login("test"));
        assert.equal(rc.status, 403);
    });
});
