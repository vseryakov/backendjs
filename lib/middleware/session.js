/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
  * @module middleware/session
  */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

const mod =

/**
 * Session cookies, encrypted cookie value as HMAC signed by user's secret.
 *
 */


module.exports = {
    name: "middleware.session",
    args: [
        { name: "cache", descr: "Cache name for session control" },
        { name: "age", type: "int", min: 300000, descr: "Session age in milliseconds" },
        { name: "same-site", descr: "Session SameSite option" },
        { name: "secure", type: "bool", descr: "Set cookie Secure flag" },
        { name: "cookie-(.+)", obj: "cookie", type: "map", nocamel: 1, descr: "Cookie settings for requests that match beginning of the path", example: "-middleware-session-cookie-/testing secure:false,sameSite:None" },
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
 * @memberof module:middleware/session
 * @method getCookieOptions
 */
mod.getCookieOptions = function(context, options)
{
    var path = "", host = "";
    for (const p in this.cookie) {
        if (p[0] == "/") {
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
 * Set a cookie by name and domain, the value is always encrypted
 * @param {Request} req
 * @param {string} name
 * @param {string|Object} value
 * @param {Object} [options]
 * @memberof module:middleware/session
 * @method setCookie
 */
mod.setCookie = function(context, value, options)
{
    value = value ? lib.jsonToBase64(value, mod.secret) : "";
    var opts = this.getCookieOptions(context, {
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
 * Parse session cookies or headers if the successfully parsed it is saved in the `req.context.session`
 * @param {Object} req
 * @return {Object|null} session object if valid and not expired, { id, exp, hash }
 * @memberof module:middleware/session
 * @method parse
 */
mod.parse = function(context)
{
    if (!context.session) {
        const cookie = lib.base64ToJson(context.cookie(this.header), mod.secret);

        const session = lib.split(cookie);
        if (session.length != 3) return;

        const exp = lib.toNumber(session[1]);
        if (exp < Date.now()) return;

        context.session = Object.create(null, {
            id: { value: session[0] },
            exp: { value: exp },
            hash: { value: session[2], enumerable: false },
        });
        logger.debug("parse:", mod.name, context);
    }
    return context.session;
}

/**
 * Create a session cookie for the request, the ID with expiration signed by secret
 * @param {Request} req
 * @param {string} id - session id
 * @param {boolean} true if cookies set
 * @memberof module:middleware/session
 * @method create
 */
mod.create = function(context, id, secret)
{
    if (!id || !secret) return;
    const exp = Date.now() + this.age;
    context.session = { id, exp };
    let token = `${id},${exp}`;
    token += "," + lib.sign(secret, token);
    this.setCookie(context, token);
    logger.debug("create:", mod.name, context);
    return context.session;
}

/**
 * Verify session against context user
 * @param {Request} req
 * @param {string} id
 * @param {string} secret
 * @param {boolean} true if verified
 * @memberof module:middleware/session
 * @method verify
 */
mod.verify = function(context, id, secret)
{
    const session = mod.parse(context);
    return session && session.hash === lib.sign(secret, `${id},${session?.exp}`);
}

/**
 * Clear session cookie for the request
 * @param {Request} req
 * @memberof module:middleware/session
 * @method clear
 */
mod.clear = function(context)
{
    this.parse(context);
    this.setCookie(context, "");
    logger.debug("clear:", mod.name, context);
}

