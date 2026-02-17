/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');

module.exports = SendGridTransport;

/**
 * SendGrid transport for nodemailer
 *
 * Send options can include `key` property or env variable SENDGRID_API_KEY will be used.
 */

function SendGridTransport(options)
{
    this.options = options || {};
    this.name = 'SendGrid';
    this.version = "1.0.0";
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
 
        app.fetch("https://api.sendgrid.com/v3/mail/send",
            { headers: {
                Authorization: `Bearer ${this.options.key || process.env.SENDGRID_API_KEY}`,
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
