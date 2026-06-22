/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const { api, lib, sendmail, shell } = require('../modules');

shell.help.push(
    "-user-add login LOGIN secret SECRET [name NAME] [type TYPE] ... - add a new user record for session access",
    "-user-add-token [name NAME] [type TYPE] [id ID] ... - add a new api token record for API access",
    "-user-update login LOGIN [name NAME] [type TYPE] ... - update existing user record",
    "-user-del ID|LOGIN... - delete a user record",
    "-user-get ID|LOGIN ... - show user records",
    "-user-secret secret ... - hash given plaintext secret",
    "-user-send-mfa [-subject S] [-text T] ID|LOGIN ID|LOGIN... - send MFA code via email"
);

shell.commands.userSendMfa = async function(options)
{
    const opts = shell.getArgs();

    const subject = opts.subject || "Your Verification Code";

    lib.forEverySeries(process.argv.slice(2).filter((x) => (x[0] != "-")), async (login, next) => {
        const user = await api.users.get(login);
        if (!user) return next();
        const code = api.users.prepareMFA(user);
        await api.users.aupdate({ login: user.login, mfa_code: user.mfa_code });
        const text = opts.text ? lib.sprintf(opts.text, code) : `Your verification code is ${code}`;
        sendmail.send({ to: user.login, subject, text }, next);
    }, shell.exit);
}

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

    if (query.totp_secret) {
        api.users.prepareTOTP(query);
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
