//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const api = require(__dirname + '/../api');
const crypto = require("node:crypto");
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const db = require(__dirname + '/../db');
const mod = require(__dirname + '/../accounts');

// Returns true of the given id is a valid user uuid
mod.isUid = function(id)
{
    return lib.isUuid(id, this.tables[this.table].id.prefix);
}

// If specified in the options, prepare credentials to be stored in the db, if no error occurred return null, otherwise an error object
mod.prepareSecret = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (!query.secret) delete query.secret;

    lib.series([
        function(next) {
            if (!query.secret) return next();
            var salt = crypto.randomBytes(16).toString("base64");
            crypto.scrypt(query.secret, salt, 64, (err, key) => {
                if (!err) query.secret = key.toString("base64") + ":" + salt;
                next(err);
            });
        },
        function(next) {
            var hooks = api.findHook('secret', '', query.login);
            if (!hooks.length) return next();
            lib.forEachSeries(hooks, (hook, next2) => {
                hook.callback(query, options, next2);
            }, next, true);
        },
    ], callback);
}

// Verify an existing user record with given password,
//  - user - if a string it is a hashed secret from an existing user record, otherwise must be an user object
//  - password - plain text password or other secret passed to be verified
mod.checkSecret = function(user, password, callback)
{
    if (typeof user == "string") user = { secret: user };
    if (!user?.secret || !password) {
        return callback({ status: 400, message: this.errInvalidSecret });
    }

    // Exact
    if (user.secret == password) return callback();

    lib.series([
        function(next) {
            if (!/^\$2b\$/.test(user.secret)) return next();
            if (!mod.bcryptMod) mod.bcryptMod = require('bcrypt');
            mod.bcryptMod.compare(password, user.secret, (err, rc) => {
                if (!rc) return next(1);
                // Convert to scrypt
                user.secret = password;
                mod.prepareSecret(user, (err) => {
                    if (err) return next(err);
                    db.update(mod.table, { login: user.login, secret: user.secret }, callback);
                });
            });
        },
        function(next) {
            var [secret, salt] = lib.strSplit(user.secret, ":");
            if (!secret || !salt) return next();
            crypto.scrypt(password, salt, 64, (err, key) => {
                if (!err && lib.timingSafeEqual(key, Buffer.from(secret, "base64"))) return callback();
                next();
            });
        },
    ], () => {
        callback({ status: 401, message: this.errInvalidSecret });
    });
}

// Load users from a JSON file, only add or update records
mod.loadFile = function(callback)
{
    if (!this.file) return;
    lib.readFile(this.file, { json: 1, logger: "error" }, (err, users) => {
        if (!err) {
            for (const p in users) {
                if (users[p].login && users[p].id && users[p].secret && users[p].name) {
                    this.users[users[p].login] = users[p];
                    logger.debug("loadFile:", mod.name, users[p]);
                }
            }
        }
        lib.tryCall(callback, err);
    });
}
