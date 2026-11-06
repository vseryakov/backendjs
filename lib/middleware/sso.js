/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2025
 */
'use strict';

const qs = require('node:querystring');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const cache = require(__dirname + '/../cache');
const lib = require(__dirname + '/../lib');

/**
  * @module middleware/sso
  */

const mod =

/**
 * ## SSO middleware for the OAuth2 / OIDC Authorization Code flow
 *
 * A provider is a plain object. Endpoints are resolved from the
 * OpenID Connect discovery document when `issuer` is set, otherwise explicit endpoints are used, this
 * makes any conforming OAuth2/OIDC provider work without code changes.
 *
 * Provider fields:
 *
 * - `name` - provider name, matches the config key and the URL parameter
 * - `issuer` - OIDC issuer, when set the endpoints and `jwks_uri` are read from `issuer + /.well-known/openid-configuration`
 * - `discovery` - explicit discovery document URL, used instead of `issuer` when set
 * - `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri` - explicit endpoints, used when discovery is not available
 * - `scopes` - default scope list, default `["openid"]`
 * - `client_id`, `client_secret` - OAuth2 client credentials, a missing secret makes the client public
 * - `token_auth` - how the client authenticates at the token endpoint: `body` (client_secret in form), `basic` (HTTP Basic), `none` (public client), auto-detected from `client_secret` if unset
 * - `identity` - how the user is resolved: `id_token` (verify the OIDC id_token via JWKS), `userinfo` (call the userinfo endpoint), or `both`
 * - `subject_field` - stable profile identifier for local account mapping, default `sub`
 *
 * ## Google
 *
 * ```
 * middleware-sso-providers-google = {"client_id":"xxx","client_secret":"yyy"}
 * ```
 *
 * Google is the `google` preset, issuer `https://accounts.google.com`, no other config is required.
 *
 * Uses browser-bound transactions and provider/issuer/subject-derived local logins, never email linking.
 * Reuses {@link module:api/users} / {@link module:api/session} to provision and session-login a local user.
 *
 * ## Endpoints
 *
 * Two endpoints drive the flow, both take the provider as a path parameter:
 *
 * - `GET /sso/login/:provider` - starts the flow, generates the PKCE state and redirects to the provider
 * - `GET /sso/callback/:provider` - handles the provider redirect, exchanges the code and logs the user in
 *
 * ```js
 * const { api, middleware } = require("backendjs");
 * const { sso } = middleware;
 *
 * api.app.get("/sso/login/:provider", sso.login);
 * api.app.get("/sso/callback/:provider", sso.callback);
 * ```
 *
 * ## Config
 *
 * ```
 * middleware-sso-providers-google = {"client_id":"xxx","client_secret":"yyy"}
 *
 * middleware-sso-enable = 1
 * middleware-sso-login-path = /sso/login/:provider
 * middleware-sso-callback-path = /sso/callback/:provider
 *
 * middleware-users-enable = /app/*
 * middleware-users-login-redirect = /login.html
 * middleware-users-redirect = /
 *
 * api-users-table = bk_user
 * ```
 *
 */

module.exports = {
    name: "middleware.sso",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "providers-([a-z0-9_]+)", obj: "providers.$1", type: "json", merge: 1, logger: "error", descr: "Provider config, i.e. client_id, client_secret, issuer, scopes, subject_field, redirect_uri", example: "middleware-sso-providers-google = {\"client_id\":\"xxx\",\"client_secret\":\"yyy\"}" },
        { name: "login-path", descr: "Login route, provider in path", example: "middleware-sso-login-path = /sso/login/:provider" },
        { name: "callback-path", descr: "Callback route, provider in path", example: "middleware-sso-callback-path = /sso/callback/:provider" },
        { name: "enable", type: "bool", descr: "Enable SSO endpoints" },
        { name: "discovery-age", type: "int", min: 60000, descr: "Cache time in ms for the discovery documents" },
        { name: "alg", type: "list", descr: "Allowed id_token signature algorithms, the token header alg must be in this list" },
        { name: "redirect", descr: "Location to redirect to after a successful login" },
        { name: "login-redirect", descr: "Location to redirect to when not authenticated" },
        { name: "auto-create", type: "bool", descr: "Create a local user on first login when missing" },
        { name: "user-roles", type: "list", descr: "Roles assigned to provisioned SSO users" },
        { name: "user-flags", type: "list", descr: "Flags/tags assigned to provisioned SSO users" },
        { name: "state-key", descr: "Cache key prefix for the OAuth state", default: "sso.state" },
        { name: "state-age", type: "int", min: 60000, descr: "OAuth state TTL in ms" },
        { name: "protocol", type: "list", descr: "Protocols allowed in urls, default is https:" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
        { name: "reset", type: "callback", callback(v) { if (v) this.reset() }, descr: "Reset cache" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    providers: {
        google: {
            issuer: "https://accounts.google.com",
            scopes: ["openid", "email", "profile"],
            identity: "id_token",
        },
        github: {
            authorization_endpoint: "https://github.com/login/oauth/authorize",
            token_endpoint: "https://github.com/login/oauth/access_token",
            userinfo_endpoint: "https://api.github.com/user",
            scopes: ["read:user", "user:email"],
            identity: "userinfo",
            token_auth: "body",
            subject_field: "id",
        },
        oidc: {},
    },

    protocol: ["https:"],

    discoveryAge: 3600000,

    alg: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"],

    endpoints: ["issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"],

    stateKey: "sso.state",
    stateAge: 600000,
    autoCreate: false,
    userRoles: [],
    userFlags: [],
    redirect: "/",

    _cache: new lib.LRUCache(),

    errNoProvider: "No SSO provider specified",
    errNoState: "Invalid or expired SSO state",
    errUnknownProvider: "Unknown SSO provider",
    errNoCode: "Authorization code is required",
    errNoToken: "No token returned by the provider",
    errNoProfile: "No user profile returned by the provider",
    errInvalidIdToken: "Invalid identity token",
    errNoLogin: "No user login resolved from the provider profile",
    errRequireHTTPS: "SSO callback requires HTTPS",
};

/**
 * Start SSO middleware, registers the login, callback
 *
 * @memberof module:middleware/sso
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ""}`;

    if (mod.enable) {

        if (mod.loginPath) {
            api.app.use("GET" + method, mod.loginPath, mod.login);
        }

        if (mod.callbackPath) {
            api.app.use("GET" + method, mod.callbackPath, mod.callback);
        }
    }

    callback();
}

/**
 * Reset the discovery cache
 * @memberof module:middleware/sso
 * @method reset
 */
mod.reset = function()
{
    mod._cache.clear();
}

/**
 * Start the OAuth flow: resolve the provider, generate the PKCE state and code verifier, store the
 * state server-side, then redirect the user to the provider authorization endpoint.
 *
 * The provider is taken from `context.params.provider`. Only local root-relative `?return=` URLs are
 * accepted. Login and callback must use HTTPS on the same host for the browser-binding cookie.
 *
 * @param {RequestContext} context
 * @memberof module:middleware/sso
 * @method login
 * @async
 */
mod.login = async function(context)
{
    const name = context.params?.provider;
    const { err, provider } = await mod.resolve(name);
    if (err) {
        logger.error("login:", mod.name, name, err);
        return context.reply({ status: 400, message: mod.errUnknownProvider });
    }

    const state = lib.randomBytes(32, "base64url");
    const binding = lib.randomBytes(32, "base64url");
    const nonce = provider.identity === "userinfo" ? undefined : lib.randomBytes(32, "base64url");
    const verifier = lib.randomBytes(32, "base64url");
    const code_challenge = lib.hash(verifier, "sha256", "base64url");
    const redirect_uri = provider.redirect_uri ?? mod.redirectUrl(context, name);

    if (!mod.isUrl(redirect_uri)) {
        return context.reply({ status: 400, message: mod.errRequireHTTPS });
    }

    const value = lib.stringify({
        name,
        nonce,
        verifier,
        redirect_uri,
        expires: Date.now() + mod.stateAge,
        return_url: mod.returnUrl(context.query?.return),
    });
    const key = mod.cacheKey(state, binding);

    const { err: err2 } = await cache.aput(key, value, { ttl: mod.stateAge });
    if (err2) {
        return context.reply({ status: 500, message: "SSO state storage failed" });
    }

    mod.setCookie(context, state, binding);

    const url = mod.authUrl(provider, { state, nonce, code_challenge, redirect_uri });
    context.redirect(302, url);
}

/**
 * Handle the provider callback: verify and consume the state, exchange the code for tokens, resolve
 * the user profile, provision or load the local user, start a session and redirect.
 *
 * @param {RequestContext} context
 * @memberof module:middleware/sso
 * @method callback
 * @async
 */
mod.callback = async function(context)
{
    const { code, state, error } = context.query || {};
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) ||
        (code !== undefined && !lib.isString(code)) ||
        (error !== undefined && !lib.isString(error)) ||
        (!code && !error) ||
        (code && error)) {
        return context.reply({ status: 400, message: mod.errNoState });
    }

    const binding = context.cookie(`__Host-bk-sso-${state}`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(binding)) {
        return context.reply({ status: 400, message: mod.errNoState });
    }

    const key = mod.cacheKey(state, binding);
    const data = await cache.aget(key, { del: 1 });
    if (data?.err) {
        return context.reply({ status: 500, message: "SSO state storage failed" });
    }

    mod.setCookie(context, state, "");

    const cookie = lib.jsonParse(data?.data, { logger: "debug" });

    if (!lib.isString(cookie?.name) ||
        cookie.name !== context.params?.provider ||
        !/^[A-Za-z0-9_-]{43}$/.test(cookie.verifier) ||
        !lib.isString(cookie.redirect_uri) ||
        !Number.isFinite(cookie.expires) ||
        cookie.expires <= Date.now()) {
        return context.reply({ status: 400, message: mod.errNoState });
    }
    if (error) {
        return context.reply({ status: 401, message: "SSO authorization denied" });
    }

    const { provider } = await mod.resolve(cookie.name);
    if (!provider) {
        return context.reply({ status: 400, message: mod.errNoProvider });
    }

    // RFC 9207 mix-up defense: when the provider returns iss it must match
    const iss = context.query?.iss;
    if (iss !== undefined && iss !== provider.issuer) {
        return context.reply({ status: 400, message: mod.errNoState });
    }

    if (provider.identity !== "userinfo" && !/^[A-Za-z0-9_-]{43}$/.test(cookie.nonce)) {
        return context.reply({ status: 400, message: mod.errNoState });
    }

    const tokens = await mod.exchangeCode(provider, code, {
        code_verifier: cookie.verifier,
        redirect_uri: cookie.redirect_uri,
    });
    if (!tokens) {
        return context.reply({ status: 401, message: "SSO token exchange failed" });
    }

    const profile = await mod.getProfile(provider, tokens, { nonce: cookie.nonce });
    if (!profile) {
        return context.reply({ status: 401, message: "SSO user resolution failed" });
    }

    let user = await mod.getUser(provider, profile);
    if (!user) {
        return context.reply({ status: 403, message: "SSO user is not allowed" });
    }
    if (user.err) {
        logger.error("callback:", mod.name, provider.name, "user resolution failed", user);
        return context.reply({ status: 500, message: "SSO user storage failed" });
    }
    if (!user.data?.id || !user.data?.secret) {
        return context.reply({ status: 500, message: "SSO session creation failed" });
    }

    api.users.prepareSession(context, user.data);
    user = await api.users.aupdate({
        login: user.data.login,
        login_time: Date.now(),
        access_time: Date.now(),
        sessions: user.data.sessions,
    });
    if (user?.err) {
        api.session.clear(context);
        logger.error("callback:", mod.name, "session update failed", user);
        return context.reply({ status: 500, message: "SSO session storage failed" });
    }

    const target = mod.returnUrl(cookie.return_url) || mod.returnUrl(mod.redirect) || "/";
    logger.debug("callback:", mod.name, "login:", user.data.login);
    context.redirect(302, target);
}

// Strict URL validation
mod.isUrl = function(url)
{
    if (typeof url !== "string") return;
    url = URL.parse(url);
    return url &&
           mod.protocol.includes(url.protocol) &&
           !url.username &&
           !url.password &&
           !url.hash &&
           !url.search ? url : undefined;
}

/**
 * Build the provider authorization URL with PKCE.
 *
 * @param {object} provider - resolved provider
 * @param {object} options
 * @param {string} options.state - CSRF state, stored server-side by the caller
 * @param {string} options.code_challenge - base64url SHA256 of the code verifier
 * @param {string} options.redirect_uri - callback URL, must match exactly what the provider expects
 * @param {string} [options.nonce] - OIDC nonce, store with the transaction and pass to getUser
 * @param {string[]} [options.scopes] - override the provider default scopes
 * @param {object} [options.params] - extra query params forwarded to the provider
 * @returns {string} the full authorization URL
 * @memberof module:middleware/sso
 * @method authUrl
 */
mod.authUrl = function(provider, options)
{
    const query = {
        ...options.params,
        response_type: "code",
        client_id: provider.client_id,
        redirect_uri: options.redirect_uri,
        scope: (options.scopes ?? provider.scopes ?? ["openid"]).join(" "),
        state: options.state,
        nonce: options.nonce,
        code_challenge: options.code_challenge,
        code_challenge_method: "S256",
    };
    for (const p in query) {
        if (query[p] === undefined) delete query[p];
    }

    const sep = provider.authorization_endpoint.includes("?") ? "&" : "?";
    return provider.authorization_endpoint + sep + qs.encode(query);
}

/** Only root-relative destinations are accepted, including after percent decoding. */
mod.returnUrl = function(value)
{
    if (typeof value !== "string") return;
    const decoded = lib.decodeURIComponent(value);
    if (!value.startsWith("/") ||
        value.startsWith("//") ||
        !decoded.startsWith("/") ||
        decoded.startsWith("//") ||
        /[\\\\\x00-\x1f\x7f]/.test(decoded) ||
        /\s/.test(value)) return;
    if (URL.parse(value, "https://sso.invalid").origin === "https://sso.invalid") return value;
}

/**
 * Build the callback redirect_uri as an absolute URL the provider will redirect back to, it must
 * match exactly what is registered with the provider.
 *
 * @param {RequestContext} context
 * @param {string} name - provider name
 * @returns {string}
 * @memberof module:middleware/sso
 * @method redirectUrl
 */
mod.redirectUrl = function(context, name)
{
    const path = mod.callbackPath ? mod.callbackPath.replace(":provider", name) : `/sso/callback/${name}`;
    return `${context.proto}://${context.host}${path}`;
}

mod.cacheKey = function(state, binding)
{
    return `${mod.stateKey}.${state}.${lib.hash(binding, "sha256", "hex")}`;
}

mod.setCookie = function(context, state, value)
{
    context.setCookie(`__Host-bk-sso-${state}`, value, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: value ? Math.ceil(mod.stateAge / 1000) : 0,
        expires: value ? undefined : new Date(1),
    });
}

/**
 * Resolve the local user by provider/issuer and stable subject, never email or username, or provision
 * one when `user-auto-create` is set. Returns `{ user }`, `{ err }` on storage
 * failure, or an empty object when the user is not allowed.
 *
 * @param {object} provider - resolved provider
 * @param {object} profile - user profile from {@link module:api/sso.getUser}
 * @returns {Promise} with `{ err, user }` or empty
 * @memberof module:middleware/sso
 * @method getUser
 * @async
 */
mod.getUser = async function(provider, profile)
{
    const subject = profile?.[provider?.subject_field ?? "sub"];
    if (!lib.isString(provider?.name) ||
        !(lib.isString(subject) || Number.isSafeInteger(subject) && subject >= 0)) {
        return;
    }

    const login = "sso:" + lib.hash(lib.stringify([provider.name, lib.isString(provider.issuer), lib.toString(subject)]), "sha256", "hex");

    let user = await api.users.aget({ login });
    if (user?.err || user?.data) return user;

    if (!mod.autoCreate) {
        logger.debug("getUser:", mod.name, "no user and no auto-create", login);
        return;
    }

    user = await api.users.aadd({
        login,
        name: profile.name ?? login,
        secret: lib.hash(lib.random()),
        create_time: Date.now(),
        roles: mod.userRoles,
        flags: mod.userFlags,
    });

    if (user?.err?.code === "AlreadyExists") {
        return api.users.aget({ login });
    }
    return user;
}

/**
 * Resolve the user profile for the provider, uses the id_token and/or the userinfo endpoint per
 * `provider.identity`, returns the merged profile.
 *
 * @param {object} provider - resolved provider
 * @param {object} tokens - tokens from {@link module:middleware/sso.exchangeCode}
 * @param {object} [options] - expected nonce for OIDC token verification
 * @returns {Promise} empty on error or profile object
 * @memberof module:middleware/sso
 * @method getProfile
 * @async
 */
mod.getProfile = async function(provider, tokens, options)
{
    const identity = provider.identity ?? "id_token";
    if (!["id_token", "userinfo", "both"].includes(identity) || !tokens) {
        logger.error("getProfile:", mod.name, provider.name, "invalid identity/tokens", identity);
        return;
    }

    let profile = {};

    if (identity === "id_token" || identity === "both") {
        const claims = await mod.verifyIdToken(provider, tokens.id_token, options);
        if (!claims) {
            logger.error("getProfile:", mod.name, provider.name, "invalid JWT token");
            return;
        }
        Object.assign(profile, claims);
    }

    if (identity === "userinfo" || identity === "both") {
        if (!lib.isString(tokens.access_token) || !mod.isUrl(provider.userinfo_endpoint)) {
            logger.error("getProfile:", mod.name, provider.name, "missing access_token");
            return;
        }
        const { err, ok, obj } = await lib.afetch({
            url: provider.userinfo_endpoint,
            headers: { authorization: "Bearer " + tokens.access_token, accept: "application/json", "user-agent": "backendjs" },
            noredirects: true,
        });
        if (!ok || !obj || obj.error || (identity === "both" && obj.sub !== profile.sub)) {
            logger.error("getProfile:", mod.name, provider.name, "invalid userinfo", err, obj);
            return;
        }
        profile = Object.assign(obj, profile);
    }

    const subject = profile[provider.subject_field ?? "sub"];
    if (!lib.isString(subject) && !(Number.isSafeInteger(subject) && subject >= 0)) {
        logger.error("getProfile:", mod.name, provider.name, "invalid subject", profile);
        return;
    }
    return profile;
}

/**
 * Resolves the endpoints from the discovery document when needed,
 * returns a fully resolved provider or `{ err }` on failure. The result is cached on `mod.discovery`.
 *
 * @param {object|string} provider - provider config object, or a preset name when a string
 * @returns {Promise} with `{ err, provider }`
 * @memberof module:middleware/sso
 * @method resolve
 * @async
 */
mod.resolve = async function(provider)
{
    if (lib.isString(provider)) {
        const name = provider;
        provider = Object.hasOwn(mod.providers, name) ? { name, ...mod.providers[name] } : undefined;
    }

    if (!lib.isObject(provider)) return { err: lib.newError(mod.errUnknownProvider) };

    const identity = provider.identity ?? "id_token";
    let discovered = {};
    if (!provider.authorization_endpoint || !provider.token_endpoint ||
        (provider.issuer && ((identity !== "userinfo" && !provider.jwks_uri) ||
        (identity !== "id_token" && !provider.userinfo_endpoint)))) {

        const { err, doc } = await mod.getDiscovery(provider);
        if (err) return { err };
        if (doc) discovered = doc;
    }

    const resolved = lib.objCreate({}, provider);
    for (const key of mod.endpoints) {
        resolved[key] ??= discovered[key];
    }
    resolved.name = provider.name ?? resolved.name;
    resolved.scopes ??= ["openid"];
    resolved.identity ??= "id_token";
    resolved.token_auth = resolved.token_auth ?? (resolved.client_secret ? "body" : "none");

    if (!lib.isString(resolved.client_id) ||
        !["id_token", "userinfo", "both"].includes(resolved.identity) ||
        !["body", "basic", "none"].includes(resolved.token_auth) ||
        !Array.isArray(resolved.scopes) ||
        resolved.scopes.some(x => !lib.isString(x)) ||
        !mod.isUrl(resolved.authorization_endpoint) ||
        !mod.isUrl(resolved.token_endpoint) ||
        (resolved.issuer && !mod.isUrl(resolved.issuer)) ||
        (resolved.identity !== "userinfo" && (!mod.isUrl(resolved.issuer) || !resolved.jwks_uri)) ||
        (resolved.identity !== "id_token" && !resolved.userinfo_endpoint) ||
        (resolved.userinfo_endpoint && !mod.isUrl(resolved.userinfo_endpoint)) ||
        (resolved.jwks_uri && !mod.isUrl(resolved.jwks_uri))) {
        return { err: lib.newError("Invalid SSO provider configuration") };
    }

    return { provider: resolved };
}

/**
 * Load and cache the OpenID Connect discovery document for the provider, returns `{ err }` when no
 * discovery source is configured, in that case the provider must supply the endpoints explicitly.
 *
 * @param {object} provider
 * @returns {Promise} with `{ err, doc }`
 * @memberof module:middleware/sso
 * @method getDiscovery
 * @async
 */
mod.getDiscovery = async function(provider)
{
    // OIDC Discovery 4: a terminating / is removed from the issuer before appending the well-known path
    const url = provider.discovery || provider.issuer && provider.issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration";
    if (!url) return {};

    if (!mod.isUrl(provider.issuer) || !mod.isUrl(url)) {
        return { err: lib.newError("SSO discovery requires a trusted HTTPS issuer and URL") };
    }

    let doc = mod._cache.get(url);
    if (!doc) {
        const { err, ok, obj } = await lib.afetch({ url, noredirects: true });
        if (err) logger.error("getDiscovery:", mod.name, provider.name, url, err);
        if (!ok) return { err: lib.newError("SSO discovery failed") };

        if (!obj || Array.isArray(obj) || obj.issuer !== provider.issuer ||
            mod.endpoints.some(key => (obj[key] && !mod.isUrl(obj[key])))) {
            return { err: lib.newError("Invalid SSO discovery document") };
        }
        mod._cache.put(url, obj, Date.now() + mod.discoveryAge);
        doc = obj;
    }

    if (doc.issuer !== provider.issuer) {
        return { err: lib.newError("SSO discovery issuer mismatch") };
    }
    return { doc };
}

/**
 * Exchange an authorization code for tokens at the provider token endpoint, sends the PKCE code
 * verifier and authenticates the client per `provider.token_auth`.
 *
 * @param {object} provider - resolved provider
 * @param {string} code - authorization code from the callback
 * @param {object} options
 * @param {string} options.code_verifier - PKCE code verifier
 * @param {string} options.redirect_uri - must match the value used at the authorization step
 * @returns {Promise} empty on error or object where it has `access_token` and optionally `id_token`
 * @memberof module:middleware/sso
 * @method exchangeCode
 * @async
 */
mod.exchangeCode = async function(provider, code, options)
{
    if (!lib.isString(code) || !mod.isUrl(provider.token_endpoint)) return;

    const formdata = {
        grant_type: "authorization_code",
        code,
        redirect_uri: options.redirect_uri,
        code_verifier: options.code_verifier,
    };

    // Providers like GitHub return form-encoded responses unless JSON is asked for
    const headers = { accept: "application/json" };
    if (provider.token_auth === "basic" && provider.client_secret) {
        headers.authorization = "Basic " + Buffer.from(`${encodeURIComponent(provider.client_id)}:${encodeURIComponent(provider.client_secret)}`).toString("base64");
    } else {
        formdata.client_id = provider.client_id;
        if (provider.token_auth === "body" && provider.client_secret) {
            formdata.client_secret = provider.client_secret;
        }
    }

    const { err, ok, obj } = await lib.afetch({
        url: provider.token_endpoint,
        method: "POST",
        formdata,
        headers,
        noredirects: true,
    });

    if (!ok || !obj || obj.error ||
        !lib.isString(obj.access_token) ||
        (obj.token_type !== undefined && lib.isString(obj.token_type).toLowerCase() !== "bearer")) {
        logger.error("exchangeCode:", mod.name, provider.name, provider.token_endpoint, err, obj);
        return;
    }
    return obj;
}

/**
 * Verify an OIDC id_token with the provider JWKS, checks the issuer and audience, returns the claims.
 *
 * @param {object} provider - resolved provider
 * @param {string} id_token
 * @param {object} [options]
 * @param {string} [options.nonce] - expected transaction nonce
 * @returns {Promise} empty on error or claims object
 * @memberof module:middleware/sso
 * @method verifyIdToken
 * @async
 */
mod.verifyIdToken = async function(provider, id_token, options)
{
    if (!lib.isString(id_token)) {
        logger.error("verifyIdToken:", mod.name, provider.name, mod.errNoToken)
        return;
    }

    if (!mod.isUrl(provider.issuer) || !lib.isString(provider.client_id)) {
        logger.error("verifyIdToken:", mod.name, provider.name, mod.errInvalidIdToken)
        return;
    }

    const jwks = provider.jwks_uri;
    const keys = await lib.JWT.getKeys(jwks, { age: mod.discoveryAge });
    if (!keys || keys.err) {
        logger.error("verifyIdToken:", mod.name, provider.name, keys);
        return;
    }

    const { err, payload } = await lib.JWT.verify(id_token, keys.keys, {
        jwks: 1,
        alg: lib.isArray(provider.alg, mod.alg),
        iss: provider.issuer,
        aud: provider.client_id,
        iat: true,
        nbf: true,
        exp: true,
    });
    // OIDC Core 3.1.3.7: exp/iat are required, azp must match when present or with multiple audiences
    if (err ||
        !lib.isString(payload.sub) ||
        !lib.isPositive(payload.exp) ||
        !lib.isPositive(payload.iat) ||
        ((payload.azp !== undefined || (Array.isArray(payload.aud) && payload.aud.length > 1)) && payload.azp !== provider.client_id) ||
        (options?.nonce && payload.nonce !== options.nonce)) {
        logger.error("verifyIdToken:", mod.name, provider.name, mod.errInvalidIdToken, payload);
        return;
    }
    return payload;
}


