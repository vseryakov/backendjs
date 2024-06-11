//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const mod = require(__dirname + '/../auth');

// Returns true of the given id is a valid user uuid
mod.isUid = function(id)
{
    return lib.isUuid(id, this.tables[this.table].id.prefix);
}

// If specified in the options, prepare credentials to be stored in the db, if no error occurred return null, otherwise an error object
//  - hash - use bcrypt or argon2 explicitely, otherwise use the config
mod.prepareSecret = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    if (!query.secret) delete query.secret;
    var hash = options.hash || mod.hash;

    lib.series([
        function(next) {
            if (!query.secret || hash != "bcrypt") return next();
            if (!mod.bcryptMod) mod.bcryptMod = require('bcrypt');
            mod.bcryptMod.hash(query.secret, mod.bcrypt, (err, enc) => {
                if (!err) query.secret = enc;
                next(err);
            });
        },
        function(next) {
            if (!query.secret || hash != "argon2") return next();
            if (!mod.argon2Mod) mod.argon2Mod = require("argon2");
            mod.argon2Mod.hash(query.secret, mod.argon2).then((enc) => {
                query.secret = enc;
                next();
            }).catch(next);
        },
        function(next) {
            var hooks = api.findHook('secret', '', query.login);
            if (!hooks.length) return next();
            lib.forEachSeries(hooks, function(hook, next2) {
                hook.callback.call(api, query, options, next2);
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
    if (!user || !user.secret || !password) {
        return callback({ status: 400, message: this.errInvalidSecret });
    }

    // Exact
    if (user.secret == password) return callback();

    // Legacy scrambled mode
    var scrambled = user.login ? lib.sign(password, user.login, "sha256") : NaN;
    if (user.secret == scrambled) return callback();

    lib.series([
        function(next) {
            if (!/^\$2b\$/.test(user.secret)) return next();
            if (!mod.bcryptMod) mod.bcryptMod = require('bcrypt');
            mod.bcryptMod.compare(password, user.secret, (err, rc) => {
                if (rc) return callback();
                next();
            });
        },
        function(next) {
            if (!/^\$2b\$/.test(user.secret)) return next();
            if (!scrambled) return next();
            if (!mod.bcryptMod) mod.bcryptMod = require('bcrypt');
            mod.bcryptMod.compare(scrambled, user.secret, (err, rc) => {
                if (rc) return callback();
                next();
            });
        },
        function(next) {
            if (!/^\$argon/.test(user.secret)) return next();
            if (!mod.argon2Mod) mod.argon2Mod = require("argon2");
            mod.argon2Mod.verify(user.secret, password).then((rc) => {
                if (rc) return callback();
                next();
            }).catch(() => (next()));
        },
        function(next) {
            if (!/^\$argon/.test(user.secret)) return next();
            if (!scrambled) return next();
            if (!mod.argon2Mod) mod.argon2Mod = require("argon2");
            mod.argon2Mod.verify(user.secret, scrambled).then((rc) => {
                if (rc) return callback();
                next();
            }).catch(() => (next()));
        },
    ], () => {
        callback({ status: 401, message: this.errInvalidSecret });
    });
}

// Load users from a JSON file, only add or update records
mod.loadUsers = function(callback)
{
    if (!this.usersFile) return;
    lib.readFile(this.usersFile, { json: 1, logger: "error" }, (err, users) => {
        if (!err) {
            for (const p in users) {
                if (users[p].login && users[p].id && users[p].secret && users[p].name) {
                    this.users[users[p].login] = users[p];
                    logger.debug("loadUsers:", users[p]);
                }
            }
        }
        lib.tryCall(callback, err);
    });
}

