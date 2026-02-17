/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

module.exports = SESTransport;

/**
 * Main logic is copied and modified from the original nodemailer's SESTransport
 *
 * Send options can include: region, config
 *
 * uses {@link module:aws.sesSendRawEmail2}
 */

function SESTransport(options)
{
    this.options = options || {};
    this.name = 'SES';
    this.version = "1.0.0";
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
            if (this.options.dryrun) {
                return lib.tryCall(callback, null, { envelope, raw: Buffer.from(raw).toString() });
            }

            aws.sesSendRawEmail2(Buffer.from(raw).toString("base64"), opts, (err, rc) => {
                if (!err) {
                    rc.messageId = '<' + rc.MessageId + (!/@/.test(rc.MessageId) ? '@' + region + '.amazonses.com' : '') + '>';
                }
                lib.tryCall(callback, err, rc);
            });
        });
    });
}
