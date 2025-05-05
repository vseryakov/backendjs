//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/../core');
const users = require(__dirname + '/../users');
const lib = require(__dirname + '/../lib');
const shell = core.modules.shell;
const apiusers = core.modules.api.users;

shell.help.push(
    "-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for API access",
    "-user-update login LOGIN [name NAME] [type TYPE] ... - update existing user record",
    "-user-del ID|LOGIN... - delete a user record",
    "-user-get ID|LOGIN ... - show user records",
    "-api-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new API user",
    "-api-user-update login LOGIN [name NAME] [type TYPE] ... - update existing API user",
    "-api-user-del ID|LOGIN... - delete an API user",
);


// Show user records by id or login
shell.cmdUserGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), function(login, next) {
        users.get(login, (err, row) => {
            if (row) shell.jsonFormat(row);
            next();
        });
    }, this.exit);
}

// Add a user login
shell.cmdUserAdd = function(options)
{
    users.add(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Update a user login
shell.cmdUserUpdate = function(options)
{
    users.update(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Delete a user login
shell.cmdUserDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), (login, next) => {
        users.del(login, next);
    }, this.exit);
}

shell.cmdApiUserdd = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    apiusers.add({ query, user: {}, options: opts }, opts, this.exit);
}

shell.cmdApiUserUpdate = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    this.getUser(query, (user) => {
        apiusers.update({ user, query, options: opts }, opts, this.exit);
    });
}

shell.cmdApiUserDel = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    this.getUser(query, (user) => {
        apiusers.del({ user, query, options: opts }, this.exit);
    });
}

