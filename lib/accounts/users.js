//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require("util");
const api = require(__dirname + '/../api');
const lib = require(__dirname + '/../lib');
const db = require(__dirname + '/../db');
const mod = require(__dirname + '/../accounts');

// Returns a user record by login or id, to make use of a cache add to the config `db-cache-keys-bk_user-id=id`
mod.getUser = function(query, options, callback)
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
mod.agetUser = util.promisify(mod.getUser.bind(mod));

// Registers a new user, returns new record in the callback,
// if `options.isInternal` is true then allow to set all properties
// `options.internalQuery` can be used to add restricted properties if not in isInternal mode
// otherwise internal properties will not be added
mod.addUser = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query.login) return lib.tryCall(callback, { status: 400, message: this.errInvalidUser });
    if (!query.secret) return lib.tryCall(callback, { status: 400, message: this.errInvalidPasswd });
    if (!query.name) return lib.tryCall(callback, { status: 400, message: this.errInvalidName });

    options = lib.objClone(options, "result_obj", 1, "first", 1);
    query = Object.assign({}, query);

    this.prepareSecret(query, options, (err) => {
        if (err) return lib.tryCall(callback, err);

        if (!options.isInternal) {
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
mod.aaddUser = util.promisify(mod.addUser.bind(mod));

// Updates an existing user by login or id,
// if `options.isInternal` is true then allow to update all properties,
// `options.internalQuery` can be used to add restricted properties if not in isInternal mode
// returns a new record in the callback
mod.updateUser = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    options = lib.objClone(options, "returning", "*", "first", 1);
    query = Object.assign({}, query);

    this.prepareSecret(query, options, (err) => {
        if (err) return lib.tryCall(callback, err);

        if (!options.isInternal) {
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
mod.aupdateUser = util.promisify(mod.updateUser.bind(mod));

// Deletes an existing user by login or id, no admin checks, returns the old record in the callback
mod.delUser = function(query, options, callback)
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
mod.adelUser = util.promisify(mod.delUser.bind(mod));
