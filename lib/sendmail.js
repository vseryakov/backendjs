/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/**
 * @module sendmail
 */

const fs = require("fs");
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

const sendmail = {
    name: "sendmail",
    args: [
        { name: "from", descr: "Email address to be used when sending emails from the backend" },
        { name: "transport", descr: "Send emails via supported transports: ses:, sendgrid:, fake:, file:, json:, if not set default SMTP settings are used" },
        { name: "smtp", obj: "smtp", type: "map", merge: 1, descr: "SMTP server parameters, user, password, host, ssl, tls...see nodemailer for details" },
        { name: "options-(.+)", obj: "options.$1", type: "map", merge: 1, descr: "Transport specific parameters", example: "sendmail-options-sendgrid = key:xxxx\nsendmail-options-ses = config:cfg1,region:us-west-2" },
    ],
    options: {},
};

const mods = {};

/**
 * Send email via various transports
 */
module.exports = sendmail;

/**
 * Send email via `nodemailer` with SMTP transport, other supported transports:
 * @param {object} options
 * @param {string} [options.transport] - supported transports:
 * - fake: - same as json
 * - json: - return message as JSON
 * - file: - save to a file in the `/tmp/`
 * - ses: - send via AWS SES service v2
 * - sendgrid: using SendGrid API
 * @param {string} [options.subject] - subject line
 * @param {string} [options.from] - FROM address
 * @param {string} [options.to] - TO address
 * @param {string} [options.cc] - CC address
 * @param {string} [options.bcc] - BCC address
 * @param {string} [options.text] - text body
 * @param {string} [options.html] - HTML body
 * @param {function} [callback]
 * @memberof module:sendmail
 * @method send
 */
sendmail.send = function(options, callback)
{
    if (!options.from) options.from = this.from || "admin";
    if (options.from.indexOf("@") == -1) options.from += "@" + app.domain;
    logger.debug("sendmail:", options);

    try {
        var transport, opts = { dryrun: options.dryrun };
        var h = URL.parse(options.transport || this.emailTransport || "");
        var proto = h?.protocol?.slice(0, -1);

        switch (proto) {
        case "fake":
        case "json":
            transport = { jsonTransport: true };
            break;

        case "file":
            transport = {
                send: function(mail, done) {
                    mail.normalize((err, data) => {
                        fs.writeFile(`${app.tmpDir}/email-${data.envelope.to}.json`, lib.stringify(data), done);
                    });
                }
            };
            break;

        case "ses":
        case "sendgrid":
            if (!mods[proto]) mods[proto] = lib.tryRequire(__dirname + "/sendmail/" + proto);
            if (!mods[proto]) return lib.tryCall(callback, { status: 500, message: "service unavailable" });
            Object.assign(opts, this.options[proto]);
            opts.protocol = h.protocol;
            for (const [k, v] of h.searchParams) opts[k] = v;
            transport = new mods[proto](opts);
            break;
        }

        if (!mods.nodemailer) {
            mods.nodemailer = lib.tryRequire("nodemailer");
            if (!mods.nodemailer) return lib.tryCall(callback, { status: 500, message: "service unavailable" });
        }
        var mailer = mods.nodemailer.createTransport(transport || sendmail.smtp || { host: "localhost", port: 25 });
        mailer.sendMail(options, (err, rc) => {
            if (err) logger.error('sendmail:', err, options, rc);
            lib.tryCall(callback, err, rc);
        });

    } catch (err) {
        logger.error('sendmail:', err, options);
        lib.tryCall(callback, err);
    }
}

