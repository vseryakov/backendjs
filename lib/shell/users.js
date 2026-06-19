/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { api, lib, shell } = require('../modules');

shell.help.push(
    "-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for session access",
    "-user-add-token [name NAME] [type TYPE] [id ID] ... - add a new api token record for API access",
    "-user-update login LOGIN [name NAME] [type TYPE] ... - update existing user record",
    "-user-del ID|LOGIN... - delete a user record",
    "-user-get ID|LOGIN ... - show user records",
    "-user-secret secret ... - hash given plaintext secret",
);


shell.commands.userSecret = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), async (pw, next) => {
        const { err, secret } = await lib.aprepareSecret(pw);
        console.log(secret || err);
        next();
    }, shell.exit);
}

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
shell.commands.userAdd = async function(options)
{
    const query = shell.getQuery();
    const opts = shell.getArgs();

    if (query.secret) {
        const { err, secret } = await lib.aprepareSecret(query.secret);
        if (!err) query.secret = secret;
    }

    api.users.add(query, Object.assign(opts, { isInternal: 1 }), (err, row) => {
        shell.exit(err, !err ? row?.id : "")
    });
}

// Add a user api token
shell.commands.userAddToken = async function(options)
{
    const query = shell.getQuery();
    const opts = shell.getArgs();

    const token = api.users.prepareToken(query, opts);

    api.users.add(query, Object.assign(opts, { isInternal: 1 }), (err, row) => {
       shell.exit(err, !err ? token : "");
    });
}


// Update a user login
shell.commands.userUpdate = async function(options)
{
    const query = shell.getQuery();

    if (query.secret) {
        const { err, secret } = await lib.aprepareSecret(query.secret);
        if (!err) query.secret = secret;
    }

    api.users.update(query, Object.assign(shell.getArgs(), { isInternal: 1 }), shell.exit);
}

// Delete a user login
shell.commands.userDel = function(options)
{
    lib.forEachSeries(process.argv.slice(2).filter((x) => (x[0] != "-")), (login, next) => {
        api.users.del(login, next);
    }, shell.exit);
}
