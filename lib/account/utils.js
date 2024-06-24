//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require("util");
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const db = require(__dirname + '/../db');
const mod = require(__dirname + '/../account');

// Returns an account record by login or id, to make use of a cache add to the config `db-cache-keys-bk_user-id=id`
mod.get = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof query == "string") {
        query = { [lib.isUuid(query) ? "id" : "login"]: query };
    }
    if (query?.login) {
        var user = this.users[query.login];
        if (user) return callback(null, user);
        db.get(this.table, query, callback);
    } else
    if (query?.id) {
        for (const p in this.users) {
            if (this.users[p].id == query.id) return callback(null, this.users[p]);
        }
        var opts = { noscan: 1, cacheKeyName: "id", ops: { id: "eq" }, count: 1, first: 1 };
        db.select(this.table, { id: query.id }, opts, (err, row, info) => {
            if (!row) return callback(err);
            // For databases that do not support all columns with indexes(DynamoDB) we have to re-read by the primary key
            if (row.name && row.mtime) return callback(null, row, info);
            db.get(this.table, { login: row.login }, callback);
        });
    } else {
        callback();
    }
}
mod.aget = util.promisify(mod.get.bind(mod));

// Registers a new account, returns new record in the callback,
// if `options.isInternal` is true then allow to set all properties
// `options.internalQuery` can be used to add restricted properties if not in isInternal mode
// otherwise internal properties will not be added
mod.add = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query.login) return lib.tryCall(callback, { status: 400, message: this.errInvalidUser });
    if (!query.secret) return lib.tryCall(callback, { status: 400, message: this.errInvalidPasswd });
    if (!query.name) return lib.tryCall(callback, { status: 400, message: this.errInvalidName });

    options = lib.objClone(options, "result_obj", 1, "first", 1);
    query = Object.assign({}, query);

    this.prepareSecret(query, options, (err) => {
        if (err) return lib.tryCall(callback, err);

        if (!(options.isInternal || api.checkAccountType(options.account, this.adminRoles))) {
            api.clearQuery(this.table, query, "internal");
        }
        Object.assign(query, options?.internalQuery);
        delete query.id;

        db.add(this.table, query, options, (err, row, info) => {
            if (!err) {
                for (const p in row) query[p] = row[p];
            }
            lib.tryCall(callback, err, query, info);
        });
    });
}
mod.aadd = util.promisify(mod.add.bind(mod));

// Updates an existing account by login or id,
// if `options.isInternal` is true then allow to update all properties,
// `options.internalQuery` can be used to add restricted properties if not in isInternal mode
// returns a new record in the callback
mod.update = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    options = lib.objClone(options, "returning", "*", "first", 1);
    query = Object.assign({}, query);

    this.prepareSecret(query, options, (err) => {
        if (err) return lib.tryCall(callback, err);

        if (!(options.isInternal || api.checkAccountType(options.account, mod.adminRoles))) {
            api.clearQuery(this.table, query, "internal");
            if (query.login) delete query.id;
        }
        Object.assign(query, options?.internalQuery);
        if (!query.name) delete query.name;
        if (!this.isUid(query.id)) delete query.id;

        if (query.login) {
            db.update(this.table, query, options, callback);
        } else
        if (query.id) {
            db.select(this.table, { id: query.id }, { cacheKeyName: "id", count: 1, first: 1 }, (err, row) => {
                if (!row) return callback(err, { status: 404, message: this.errInvalidId });

                query.login = row.login;
                db.update(this.table, query, options, callback);
            });
        } else {
            lib.tryCall(callback, { status: 400, message: this.errInvalidParams });
        }
    });
}
mod.aupdate = util.promisify(mod.update.bind(mod));

// Deletes an existing account by login or id, no admin checks, returns the old record in the callback
mod.del = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof query == "string") {
        query = { [this.isUid(query) ? "id" : "login"]: query };
    }
    options = lib.objClone(options, "returning", "old", "first", 1);
    query = Object.assign({}, query, options?.query);

    if (query.login) {
        db.del(this.table, query, options, callback);
    } else
    if (query.id) {
        db.select(this.table, { id: query.id }, { cacheKeyName: "id", count: 1, first: 1 }, (err, row) => {
            if (!row) return callback(err, { status: 404, message: this.errInvalidId });

            query.login = row.login;
            db.del(this.table, query, options, callback);
        });
    } else {
        lib.tryCall(callback, { status: 400, message: this.errInvalidParams });
    }
}
mod.adel = util.promisify(mod.del.bind(mod));

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
