//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/../core');
const accounts = require(__dirname + '/../accounts');
const lib = require(__dirname + '/../lib');
const shell = core.modules.shell;

shell.help.push(
    "-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for API access",
    "-user-update login LOGIN [name NAME] [type TYPE] ... - update existing user record",
    "-user-del ID|LOGIN... - delete a user record",
    "-user-get ID|LOGIN ... - show user records",
    "-account-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user account for API access",
    "-account-update login LOGIN [name NAME] [type TYPE] ... - update existing user account",
    "-account-del ID|LOGIN... - delete a user account",
);


// Show account records by id or login
shell.cmdUserGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), function(login, next) {
        accounts.getUser(login, (err, row) => {
            if (row) shell.jsonFormat(row);
            next();
        });
    }, this.exit);
}

// Add a user login
shell.cmdUserAdd = function(options)
{
    accounts.addUser(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Update a user login
shell.cmdUserUpdate = function(options)
{
    accounts.updateUser(this.getQuery(), lib.objExtend(this.getArgs(), { isInternal: 1 }), this.exit);
}

// Delete a user login
shell.cmdUserDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), (login, next) => {
        accounts.delUser(login, next);
    }, this.exit);
}

shell.cmdAccountAdd = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    accounts.add({ query: query, account: {}, options: opts }, opts, this.exit);
}

shell.cmdAccountUpdate = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    this.getUser(query, (user) => {
        accounts.update({ account: user, query: query, options: opts }, opts, this.exit);
    });
}

shell.cmdAccountDel = function(options)
{
    var query = this.getQuery();
    var opts = lib.objExtend(this.getArgs(), { isInternal: 1 });
    this.getUser(query, (user) => {
        accounts.del({ account: user, obj: query, options: opts }, this.exit);
    });
}

