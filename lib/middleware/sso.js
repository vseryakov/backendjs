/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2025
 */
'use strict';

const crypto = require('node:crypto');
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
 * Uses browser-bound transactions and provider/issuer/subject-derived local logins, never email linking.
 * Reuses {@link module:api/sso} for the provider logic and {@link module:api/users} /
 * {@link module:api/session} to provision and session-login a local user, Google is the `google` preset.
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
 * middleware-sso-enabled = google
 * middleware-sso-provider-google = {"client_id":"xxx","client_secret":"yyy"}
 *
 * middleware-sso-login-path = /sso/login/:provider
 * middleware-sso-callback-path = /sso/callback/:provider
 *
 * middleware-sso-enable = /app/*
 * middleware-sso-login-redirect = /login.html
 * middleware-sso-redirect = /
 *
 * api-users-table = bk_user
 * ```
 *
 * ## Protected endpoints
 *
 * In `enable` mode {@link module:middleware/sso.handle} verifies the cookie session like
 * {@link module:middleware/users} and sets `context.user`, authorization is delegated to {@link module:api/acl}.
 *
 */

module.exports = {
    name: "middleware.sso",

    /**
     * @var {ConfigOptions[]}
     * @default
     */
    args: [
        { name: "enabled", type: "list", descr: "List of enabled provider names, when empty any preset or configured provider is allowed" },
        { name: "provider-(.+)", obj: "providers", type: "json", make: "$1", descr: "Per-provider config merged over the preset, i.e. client_id, client_secret, issuer, scopes, subject_field, redirect_uri", example: "middleware-sso-provider-google = {\"client_id\":\"xxx\",\"client_secret\":\"yyy\"}" },
        { name: "login-path", descr: "Login route, provider in path", example: "middleware-sso-login-path = /sso/login/:provider" },
        { name: "callback-path", descr: "Callback route, provider in path", example: "middleware-sso-callback-path = /sso/callback/:provider" },
        { name: "enable", type: "list", descr: "Endpoints that require an SSO session" },
        { name: "redirect", descr: "Location to redirect to after a successful login" },
        { name: "login-redirect", descr: "Location to redirect to when not authenticated" },
        { name: "user-auto-create", type: "bool", descr: "Create a local user on first login when missing" },
        { name: "user-roles", type: "list", descr: "Roles assigned to provisioned SSO users" },
        { name: "user-flags", type: "list", descr: "Flags/tags assigned to provisioned SSO users" },
        { name: "state-key", descr: "Cache key prefix for the OAuth state", default: "sso.state" },
        { name: "state-age", type: "int", min: 60000, descr: "OAuth state TTL in ms" },
        { name: "priority", type: "int", descr: "Add routes with this priority sorting number, for config mode only" },
        { name: "err-(.+)", descr: "Error messages for various cases" },
    ],

    providers: {},
    enabled: [],

    stateKey: "sso.state",
    stateAge: 600000,
    userAutoCreate: false,
    userRoles: [],
    userFlags: [],
    redirect: "/",
    errNoProvider: "No SSO provider specified",
    errNoState: "Invalid or expired SSO state",
};

/**
 * Start SSO middleware, registers the login, callback and protected-endpoint routes from config
 *
 * @memberof module:middleware/sso
 * @method configureMiddleware
 */
mod.configureMiddleware = function(_options, callback)
{
    const method = `#${this.priority ?? ""}`;

    if (mod.loginPath) {
        api.app.use("GET" + method, mod.loginPath, mod.login);
    }

    if (mod.callbackPath) {
        api.app.use("GET" + method, mod.callbackPath, mod.callback);
    }

    if (mod.enable?.length) {
        for (const path of mod.enable) {
            api.app.use(method, path, mod);
        }
    }

    callback();
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
    const provider = await mod.getProvider(name);
    if (!provider) {
        return context.reply({ status: 400, message: mod.errNoProvider });
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const binding = crypto.randomBytes(32).toString("base64url");
    const nonce = provider.identity === "userinfo" ? undefined : crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const redirect_uri = provider.redirect_uri ?? mod.redirectUri(context, name);

    if (!api.sso.isHttpsUrl(redirect_uri)) {
        return context.reply({ status: 400, message: "SSO callback requires HTTPS" });
    }
    const key = mod.stateCacheKey(state, binding);
    const { err } = await cache.aget(key, { set: JSON.stringify({
        provider: name,
        nonce,
        verifier,
        redirect_uri,
        expires: Date.now() + mod.stateAge,
        return_url: mod.returnUrl(context.query?.return),
    }), ttl: mod.stateAge });
    if (err) return context.reply({ status: 500, message: "SSO state storage failed" });
    mod.stateCookie(context, state, binding);

    const url = api.sso.getAuthUrl(provider, { state, nonce, code_challenge: challenge, redirect_uri });
    logger.debug("login:", mod.name, name);

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
    if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        (code !== undefined && (typeof code !== "string" || !code)) ||
        (error !== undefined && (typeof error !== "string" || !error)) ||
        (!code && !error) || (code && error)) {
        return context.reply({ status: 400, message: mod.errNoState });
    }
    const binding = context.cookie(`__Host-bk-sso-${state}`);
    if (typeof binding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(binding)) {
        return context.reply({ status: 400, message: mod.errNoState });
    }

    const { err: stateErr, data } = await cache.aget(mod.stateCacheKey(state, binding), { del: 1 });
    if (stateErr) return context.reply({ status: 500, message: "SSO state storage failed" });
    mod.stateCookie(context, state, "");
    const s = lib.jsonParse(data, { logger: "debug" });
    if (!s || typeof s.provider !== "string" || s.provider !== context.params?.provider ||
        typeof s.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(s.verifier) ||
        typeof s.redirect_uri !== "string" || !Number.isFinite(s.expires) || s.expires <= Date.now()) {
        return context.reply({ status: 400, message: mod.errNoState });
    }
    if (error) return context.reply({ status: 401, message: "SSO authorization denied" });

    const provider = await mod.getProvider(s.provider);
    if (!provider) {
        return context.reply({ status: 400, message: mod.errNoProvider });
    }

    if (provider.identity !== "userinfo" && (typeof s.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(s.nonce))) {
        return context.reply({ status: 400, message: mod.errNoState });
    }
    const { err, tokens } = await api.sso.exchangeCode(provider, code, {
        code_verifier: s.verifier,
        redirect_uri: s.redirect_uri,
    });
    if (err) return context.reply({ status: 401, message: "SSO token exchange failed" });

    const { err: err2, profile } = await api.sso.getUser(provider, tokens, { nonce: s.nonce });
    if (err2) return context.reply({ status: 401, message: "SSO user resolution failed" });

    const { err: err3, user } = await mod.getUser(provider, profile);
    if (err3) {
        logger.error("callback:", mod.name, "user resolution failed", err3);
        return context.reply({ status: 500, message: "SSO user storage failed" });
    }
    if (!user) return context.reply({ status: 403, message: "SSO user is not allowed" });
    if (!user.id || !user.secret) {
        return context.reply({ status: 500, message: "SSO session creation failed" });
    }

    api.users.prepareSession(context, user);
    const now = Date.now();
    const { err: err4 } = await api.users.aupdate({
        login: user.login,
        login_time: now,
        access_time: now,
        sessions: user.sessions,
    });
    if (err4) {
        api.session.clear(context);
        logger.error("callback:", mod.name, "session update failed", err4);
        return context.reply({ status: 500, message: "SSO session storage failed" });
    }

    const target = mod.returnUrl(s.return_url) || mod.returnUrl(mod.redirect) || "/";
    logger.debug("callback:", mod.name, "login:", user.login);
    context.redirect(302, target);
}

/**
 * Session verification for protected endpoints, verifies the cookie session against the users table
 * and authorizes via {@link module:api/acl}, reusing the logic of {@link module:middleware/users}.
 *
 * @param {RequestContext} context
 * @param {function} next - next middleware or endpoint handler
 * @memberof module:middleware/sso
 * @method handle
 */
mod.handle = function(context, next)
{
    logger.debug("handle:", mod.name, context.path);

    api.users.verifySession(context, (err, user) => {
        if (err) {
            return mod.loginRedirect ?
                   context.redirect(302, mod.loginRedirect) :
                   context.reply(err);
        }

        context.user = user;
        err = mod.authorize(context);
        if (err) return context.reply(err);

        next();
    });
}

/**
 * Authorization check after a valid session, delegates to {@link module:api/acl}.
 * At least one ACL must match; explicit deny takes precedence.
 *
 * @param {RequestContext} context
 * @returns {undefined|object}
 * @memberof module:middleware/sso
 * @method authorize
 */
mod.authorize = function(context)
{
    if (api.acl.isDenied(context.path, context.user.roles)) {
        return { status: 403, message: this.errDeny, code: "DENY" };
    }

    if (api.acl.isAllowed(context.path, context.user.roles)) {
        return;
    }

    if (api.acl.isMatched(context.path, "*")) {
        return;
    }

    return { status: 403, message: this.errNoMatch, code: "NOMATCH" };
}

/**
 * Resolve a provider by name, merges the per-provider config over the preset and runs the discovery
 * resolution, returns a cached provider or undefined on failure.
 *
 * @param {string} name - provider name
 * @returns {Promise} resolved provider or undefined
 * @memberof module:middleware/sso
 * @method getProvider
 * @async
 */
mod.getProvider = async function(name)
{
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]+$/.test(name)) return undefined;

    // Only explicitly enabled providers are accepted when the list is set.
    if (mod.enabled?.length && !mod.enabled.includes(name)) {
        return undefined;
    }

    const preset = Object.hasOwn(api.sso.presets, name) ? api.sso.presets[name] : undefined;
    const cfg = Object.hasOwn(mod.providers, name) ? mod.providers[name] : undefined;
    if (!preset && !cfg) return undefined;

    const { err, provider } = await api.sso.resolve({ ...(preset || {}), ...(cfg || {}), name });
    if (err) {
        logger.error("getProvider:", mod.name, name, err);
        return undefined;
    }

    return provider;
}

/**
 * Build the callback redirect_uri as an absolute URL the provider will redirect back to, it must
 * match exactly what is registered with the provider.
 *
 * @param {RequestContext} context
 * @param {string} name - provider name
 * @returns {string}
 * @memberof module:middleware/sso
 * @method redirectUri
 */
mod.redirectUri = function(context, name)
{
    const path = mod.callbackPath ? mod.callbackPath.replace(":provider", name) : `/sso/callback/${name}`;
    return `${context.proto}://${context.host}${path}`;
}

/**
 * Resolve the local user by provider/issuer and stable subject, never email or username, or provision
 * one when `user-auto-create` is set. Returns `{ user }`, `{ err }` on storage
 * failure, or an empty object when the user is not allowed.
 *
 * @param {object} provider - resolved provider
 * @param {object} profile - user profile from {@link module:api/sso.getUser}
 * @returns {Promise} with `{ err, user }`
 * @memberof module:middleware/sso
 * @method getUser
 * @async
 */
mod.getUser = async function(provider, profile)
{
    const login = mod.userLogin(provider, profile);
    if (!login) return {};

    const { err: getErr, data: user } = await api.users.aget({ login });
    if (getErr) return { err: getErr };
    if (user) return { user };

    if (!mod.userAutoCreate) {
        logger.debug("getUser:", mod.name, "no user and no auto-create", login);
        return {};
    }

    const roles = mod.userRoles?.length ? mod.userRoles.slice() : undefined;
    const flags = mod.userFlags?.length ? mod.userFlags.slice() : undefined;

    const { err, data } = await api.users.aadd({
        login,
        name: profile.name ?? login,
        secret: lib.hash(lib.random()),
        create_time: Date.now(),
        roles,
        flags,
    });

    if (err?.code === "AlreadyExists") {
        const { err, data } = await api.users.aget({ login });
        return { err, user: data };
    }
    if (err) return { err };
    return { user: data };
}

/** Return the local login for a stable provider subject, suitable for explicit provisioning. */
mod.userLogin = function(provider, profile)
{
    const subject = profile?.[provider.subject_field ?? "sub"];
    if (typeof provider.name !== "string" || !provider.name ||
        !(typeof subject === "string" && subject.length || Number.isSafeInteger(subject) && subject >= 0)) return;
    const identity = JSON.stringify([provider.name, provider.issuer || "", String(subject)]);
    return "sso:" + crypto.createHash("sha256").update(identity).digest("hex");
}

mod.stateCacheKey = function(state, binding)
{
    return `${mod.stateKey}.${state}.${crypto.createHash("sha256").update(binding).digest("hex")}`;
}

mod.stateCookie = function(context, state, value)
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

/** Only root-relative destinations are accepted, including after percent decoding. */
mod.returnUrl = function(value)
{
    if (typeof value !== "string") return;
    try {
        const decoded = decodeURIComponent(value);
        if (!value.startsWith("/") || value.startsWith("//") || !decoded.startsWith("/") || decoded.startsWith("//") ||
            /[\\\\\x00-\x1f\x7f]/.test(decoded) || /\s/.test(value)) return;
        if (new URL(value, "https://sso.invalid").origin === "https://sso.invalid") return value;
    } catch {}
}
