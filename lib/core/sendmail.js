//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require("fs");
const url = require("url");
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const aws = require(__dirname + '/../aws');

// Send email via `nodemailer` with SMTP transport, other supported transports:
// - fake: - same as json
// - json: - return message as JSON
// - file: - save to a file in the `tmp/`
// - sendgrid: - send via SendGrid
// - ses: - send via AWS SES service v1, ses2: use V2
//
core.sendmail = function(options, callback)
{
    if (!options.from) options.from = this.emailFrom || "admin";
    if (options.from.indexOf("@") == -1) options.from += "@" + this.domain;
    logger.debug("sendmail:", options);

    try {
        var transport, dryrun = options.dryrun;
        var h = url.parse(options.transport || this.emailTransport || "", true);

        switch (h.protocol) {
        case "fake:":
        case "json:":
            transport = { jsonTransport: true };
            break;

        case "file:":
            transport = {
                send: function(mail, done) {
                    mail.normalize((err, data) => {
                        fs.writeFile(`${core.path.tmp}/email-${data.envelope.to}.json`, lib.stringify(data), done);
                    });
                }
            };
            break;

        case "ses:":
        case "ses2:":
            if (!core.modules.aws.key || !core.modules.aws.secret) break;
            transport = new SESTransport({ ...h.query, protocol: h.protocol, dryrun });
            break;

        case "sendgrid:":
            transport = new SendGridTransport({ ...h.query, dryrun });
            break;
        }
        if (!core.nodemailer) core.nodemailer = require("nodemailer");
        var mailer = core.nodemailer.createTransport(transport || core.smtp || { host: "localhost", port: 25 });
        mailer.sendMail(options, (err, rc) => {
            if (err) logger.error('sendmail:', err, options, rc);
            lib.tryCall(callback, err, rc);
        });

    } catch (err) {
        logger.error('sendmail:', err, options);
        lib.tryCall(callback, err);
    }
}

// Main logic is copied and modified from the original nodemailer's SESTransport

function SESTransport(options)
{
    this.options = options || {};
    this.name = 'SES';
    this.version = core.vesion;
}

var LeWindows;

SESTransport.prototype.send = function(mail, callback)
{
    const envelope = mail.data.envelope || mail.message.getEnvelope();

    const getRawMessage = next => {
        // do not use Message-ID and Date in DKIM signature
        if (typeof mail.data._dkim?.skipFields == 'string') {
            mail.data._dkim.skipFields += ':date:message-id';
        } else {
            if (!mail.data._dkim) mail.data._dkim = {};
            mail.data._dkim.skipFields = 'date:message-id';
        }

        LeWindows = LeWindows || require("nodemailer/lib/mime-node/le-windows");

        var source = mail.message.createReadStream();
        var dest = source.pipe(new LeWindows());
        var chunks = [], chunk;

        dest.on('readable', () => {
            while ((chunk = dest.read()) !== null) chunks.push(chunk);
        });
        source.once('error', err => dest.emit('error', err));
        dest.once('error', err => { next(err) });
        dest.once('end', () => next(null, Buffer.concat(chunks)));
    };

    setImmediate(() => {
        getRawMessage((err, raw) => {
            if (err) return lib.tryCall(callback, err);

            const from = mail.message._headers.find(header => ["from", "From"].includes(header.key));
            var region = this.options.region || aws.region;
            var opts = {
                from: from?.value || envelope.from,
                to: envelope.to,
                config: this.options.config,
                region,
            };
            var method = "sesSendRawEmail";
            if (this.options.protocol == "ses2:") method += "2";

            if (this.options.dryrun) {
                return lib.tryCall(callback, null, { envelope, raw: Buffer.from(raw).toString() });
            }

            aws[method](Buffer.from(raw).toString("base64"), opts, (err, rc) => {
                if (!err) {
                    if (this.options.protocol == "ses:") {
                        rc.MessageId = lib.objGet(rc, "SendRawEmailResponse.SendRawEmailResult.MessageId");
                    }
                    rc.messageId = '<' + rc.MessageId + (!/@/.test(rc.MessageId) ? '@' + region + '.amazonses.com' : '') + '>';
                }
                lib.tryCall(callback, err, rc);
            });
        });
    });
}

function SendGridTransport(options)
{
    this.options = options || {};
    this.name = 'SendGrid';
    this.version = core.vesion;
}

SendGridTransport.prototype.send = function(mail, callback)
{
    mail.normalize((err, data) => {
        if (err) return lib.tryCall(callback, err);

        var req = {
            from: { email: data.from?.address, name: data.from?.name },
            subject: data.subject,
            personalizations: [{}],
        };
        if (lib.isArray(data.to)) {
            const to = data.to.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (to.length) req.personalizations[0].to = to;
        }
        if (lib.isArray(data.cc)) {
            const cc = data.cc.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (cc.length) req.personalizations[0].cc = cc;
        }
        if (lib.isArray(data.bcc)) {
            const bcc = data.bcc.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (bcc.length) req.personalizations[0].bcc = bcc;
        }

        if (lib.isArray(data.replyTo)) {
            req.reply_to_list = data.replyTo.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
        }
        if (data.text) {
            if (!req.content) req.content = [];
            req.content.push({ type: "text/plain", value: data.text });
        }
        if (data.html) {
            if (!req.content) req.content = [];
            req.content.push({ type: "text/html", value: data.html });
        }
        if (lib.isArray(data.attachments)) {
            for (const a of data.attachments) {
                if (!a.content) continue;
                if (a.encoding != "base64") a.content = Buffer.from(a.content).toString('base64');
                if (!req.attachments) req.attachments = [];
                req.attachments.push({ type: a.contentType, content: a.content, filename: a.filename, disposition: a.disposition, content_id: a.cid });
            }
        }
        if (data.sendgrid) {
            for (const p of ["template_id", "categories", "headers", "custom_args", "batch_id", "asm", "ip_pool_name", "mail_settings", "tracking_settings"]) {
                if (data.sendgrid[p]) req[p] = data.sendgrid[p];
            }
        }
        if (this.options.dryrun) {
            return lib.tryCall(callback, null, { data, req });
        }

        core.httpGet("https://api.sendgrid.com/v3/mail/send",
            { headers: {
                Authorization: `Bearer ${this.options.apikey || core.sendgridKey}`,
                "content-type": "application/json",
            },
            method: "POST",
            postdata: req,
            retryOnError: function() { return this.status == 429 || this.status >= 500 },
            retryCount: this.options.retryCount || 3,
            retryTimeout: this.options.retryTimeout || 5000,
        }, (err, rc) => {
           if (!err && rc.status >= 400) {
               err = { status: rc.status, message: rc.obj?.errors?.length && rc.obj.errors[0].message || rc.data };
           }
           lib.tryCall(callback, err, { messageId: data.messageId });
       });
    });
}
