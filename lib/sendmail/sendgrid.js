/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

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
    this.options = lib.isObject(options);
    this.name = 'SendGrid';
    this.version = "1.0.0";
}
 
SendGridTransport.prototype.send = function(mail, callback)
{
    mail.normalize((err, data) => {
        if (err) return lib.tryCall(callback, err);
 
        const postdata = {
            from: { email: data.from?.address, name: data.from?.name },
            subject: data.subject,
            personalizations: [{}],
        };
        if (lib.isArray(data.to)) {
            const to = data.to.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (to.length) postdata.personalizations[0].to = to;
        }
        if (lib.isArray(data.cc)) {
            const cc = data.cc.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (cc.length) postdata.personalizations[0].cc = cc;
        }
        if (lib.isArray(data.bcc)) {
            const bcc = data.bcc.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
            if (bcc.length) postdata.personalizations[0].bcc = bcc;
        }
 
        if (lib.isArray(data.replyTo)) {
            postdata.reply_to_list = data.replyTo.filter((x) => (x.address)).map((x) => ({ email: x.address, name: x.name }));
        }
        if (data.text) {
            if (!postdata.content) postdata.content = [];
            postdata.content.push({ type: "text/plain", value: data.text });
        }
        if (data.html) {
            if (!postdata.content) postdata.content = [];
            postdata.content.push({ type: "text/html", value: data.html });
        }
        if (lib.isArray(data.attachments)) {
            for (const a of data.attachments) {
                if (!a.content) continue;
                if (a.encoding !== "base64") a.content = Buffer.from(a.content).toString('base64');
                if (!postdata.attachments) postdata.attachments = [];
                postdata.attachments.push({ type: a.contentType, content: a.content, filename: a.filename, disposition: a.disposition, content_id: a.cid });
            }
        }
        if (data.sendgrid) {
            for (const p of ["template_id", "categories", "headers", "custom_args", "batch_id", "asm", "ip_pool_name", "mail_settings", "tracking_settings"]) {
                if (data.sendgrid[p]) postdata[p] = data.sendgrid[p];
            }
        }

        if (this.options?.dryrun) {
            return lib.tryCall(callback, null, { data, postdata });
        }

        const key = this.options?.key || process.env.SENDGRID_API_KEY;
        if (!key) {
            return lib.tryCall(callback, { status: 500, message: "API key is missing" });
        }
 
        app.fetch("https://api.sendgrid.com/v3/mail/send", {
            headers: {
                authorization: `Bearer ${key}`,
            },
            method: "POST",
            postdata,
            retryOnError() { return this.status === 429 || this.status >= 500 },
            retryCount: this.options?.retryCount || 3,
            retryTimeout: this.options?.retryTimeout || 5000,
        }, (err, rc) => {
           if (!err && rc.status >= 400) {
               err = { status: rc.status, message: rc.obj?.message || rc.obj?.errors?.[0]?.message || rc.data };
           }
           lib.tryCall(callback, err, { messageId: data.messageId });
       });
    });
}
