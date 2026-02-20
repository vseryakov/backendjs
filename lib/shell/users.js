/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { api, lib, shell } = require('../modules');

shell.help.push(
    "-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for API access",
    "-user-update login LOGIN [name NAME] [type TYPE] ... - update existing user record",
    "-user-del ID|LOGIN... - delete a user record",
    "-user-get ID|LOGIN ... - show user records",
);


// Show user records by id or login
shell.commands.userGet = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), function(login, next) {
        api.users.get(login, (err, row) => {
            if (row) shell.jsonFormat(row);
            next();
        });
    }, shell.exit);
}

// Add a user login
shell.commands.userAdd = function(options)
{
    api.users.add(shell.getQuery(), Object.assign(shell.getArgs(), { isInternal: 1 }), shell.exit);
}

// Update a user login
shell.commands.userUpdate = function(options)
{
    api.users.update(shell.getQuery(), Object.assign(shell.getArgs(), { isInternal: 1 }), shell.exit);
}

// Delete a user login
shell.commands.userDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), (login, next) => {
        api.users.del(login, next);
    }, shell.exit);
}
