/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

/**
  * @module api/session
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * Session support as possibly encrypted cookie value signed by user's secret.
 *
 * Parsed session is stored in the `context.session` as an object:
 *
 * ```js
 * { type: "cookie", id: string, exp: number, sig: string }`
 * ```
 */


module.exports = {
    name: "api.session",
    args: [
        { name: "cache", descr: "Cache name for session control", example: "api-session-cache = redis" },
        { name: "age", type: "int", min: 300000, descr: "Session age in milliseconds", example: "api-session-age = 86400000" },
        { name: "same-site", descr: "Session SameSite header" },
        { name: "secure", type: "bool", descr: "Set cookie Secure flag" },
        { name: "cookie-(.+)", obj: "cookie", type: "map", no_camel: 1, descr: "Cookie settings for requests that match beginning of the path", example: "api-session-cookie-/testing = secure:false,sameSite:None" },
        { name: "secret", descr: "Encryption secret, if empty sessions will only be signed but not encrypted" },
        { name: "header", descr: "Cookie name to use for session" },
    ],

    /**
     * @var {string} - header/cookie name to keep signature
     * @default
     */
    header: "bk-sid",

    age: 86400 * 1000,
    sameSite: "strict",
    secure: true,
    cookie: {},
};


/**
 * Find a closest cookie by host/domain/path, longest takes precedence, returns found cookie merged with the options
 * @param {RequestContext} context
 * @param {Object} [options]
 * @returns {Object}
 * @memberof module:api/session
 * @method getCookieOptions
 */
mod.getCookieOptions = function(context, options)
{
    var path = "", host = "";
    for (const p in this.cookie) {
        if (p[0] === "/") {
            if (context.path.startsWith(p) && p.length > path.length) {
                path = p;
            }
        } else

        if ((p === context.host || p === context.domain) && p.length > host.length) {
            host = p;
        }
    }
    options ??= {};
    if (path) Object.assign(options, this.cookie[path]);
    if (host) Object.assign(options, this.cookie[host]);
    return options;
}

/**
 * Set a cookie by name and domain, the value is encrypted if `api.session.secret` is defined,
 * Max-Age is set if value is not empty otherwise the cookie set Expires in the past.
 * @param {RequestContext} context
 * @param {string|object} value
 * @param {Object} [options]
 * @memberof module:api/session
 * @method setCookie
 */
mod.setCookie = function(context, value, options)
{
    value = value ? lib.jsonToBase64(value, mod.secret) : "";
    const opts = this.getCookieOptions(context, {
        httpOnly: true,
        path: options?.path ?? "/",
        secure: options?.secure ?? this.secure,
        sameSite: options?.sameSite ?? this.sameSite,
    });
    if (value) {
        opts.maxAge = options?.age ?? this.age;
    } else {
        opts.expires = new Date(1);
    }
    context.setCookie(mod.header, value, opts);
}

/**
 * Parse session cookies or headers if the successfully parsed it is saved in the `context.session`
 * @param {RequestContext} context
 * @return {{ id: string, exp: number, sig: string }|undefined} session object if valid and not expired
 * @memberof module:api/session
 * @method parse
 */
mod.parse = function(context)
{
    if (!context.session) {
        let cookie = context.cookie(this.header);
        if (!cookie) return;

        cookie = lib.base64ToJson(cookie, mod.secret);
        if (!cookie) return;

        const session = lib.split(cookie);
        if (session.length !== 3) return;

        const exp = lib.toNumber(session[1]);
        if (exp < Date.now()) return;

        context.session = Object.create(null, {
            type: { value: "cookie" },
            id: { value: session[0], enumerable: true },
            exp: { value: exp, enumerable: true },
            sig: { value: session[2] },
        });
        logger.debug("parse:", mod.name, context);
    }
    return context.session;
}

/**
 * Create a session cookie, the id and exp signed by provided secret,
 * if `api.session.secret` is defined the signed token is also encrypted and stored as base64.
 * NOTE: context will be updated with session cookie
 * @param {RequestContext} context
 * @param {object} user - user with id and secret properties
 * @return {undefined|object} an object if cookies set as `context.session`
 * @memberof module:api/session
 * @method create
 * @example
 * const session = session.create(context, user);
 * { type: "cookie", id, exp }
 */
mod.create = function(context, user)
{
    if (!user?.id || !user?.secret) return;
    const exp = Date.now() + this.age;
    context.session = Object.assign(Object.create(null), {
        type: "cookie",
        id: user.id,
        exp
    });
    let token = `${user.id},${exp}`;
    token += "," + lib.sign(user.secret, token);
    this.setCookie(context, token);
    logger.debug("create:", mod.name, context);
    return context.session;
}

/**
 * (Parse) and Verify context session signature against given user secret
 * @param {RequestContext} context
 * @param {string} secret
 * @param {boolean} true if verified
 * @memberof module:api/session
 * @method verify
 * @example <caption>simple middleware to verify current sessions against users table, simplified</caption>
 *
 * api.app.use("/portal/*", (context, next) => {
 *     const session = api.session.parse(context);
 *
 *     api.users.get(session?.id, (err, user) => {
 *
 *         if (!api.session.verify(context, user?.secret)) {
 *             return context.reply({ status: 401, message: "invalid session" });
 *         }
 *         next();
 *     });
 * });
 */
mod.verify = function(context, secret)
{
    const session = mod.parse(context);
    return session && lib.timingSafeEqual(session.sig, lib.sign(secret, `${session.id},${session.exp}`));
}

/**
 * Expire and clear session cookie for the context, clears context.session
 * @param {RequestContext} context
 * @memberof module:api/session
 * @method clear
 */
mod.clear = function(context)
{
    const session = this.parse(context);
    this.setCookie(context, "");
    context.session = null;
    logger.debug("clear:", mod.name, context, session);
}

