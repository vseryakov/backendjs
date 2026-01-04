/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const logger = require(__dirname + '/../logger');

/**
 * AWS SES API request
 * @memberof module:aws
 * @method querySES
 */
aws.querySES = function(action, obj, options, callback)
{
    this.queryEndpoint("email", '2010-12-01', action, obj, options, callback);
}

/**
 * Send an email via SES
 * The following options supported:
 *  - from - an email to use in the From: header
 *  - cc - list of email to use in CC: header
 *  - bcc - list of emails to use in Bcc: header
 *  - replyTo - list of emails to ue in ReplyTo: header
 *  - returnPath - email where to send bounces
 *  - charset - charset to use, default is UTF-8
 *  - html - if set the body is sent as MIME HTML
 *  - config - configuration set name
 * @memberof module:aws
 * @method sesSendEmail
 */
aws.sesSendEmail = function(to, subject, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var params = { "Message.Subject.Data": subject, "Message.Subject.Charset": options.charset || "UTF-8" };
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Data"] = body;
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Charset"] = options.charset || "UTF-8";
    params.Source = options.from || app.emailFrom || ("admin@" + app.domain);
    lib.split(to).forEach((x, i) => { params["Destination.ToAddresses.member." + (i + 1)] = x; })
    if (options.cc) lib.split(options.cc).forEach((x, i) => { params["Destination.CcAddresses.member." + (i + 1)] = x; })
    if (options.bcc) lib.split(options.bcc).forEach((x, i) => { params["Destination.BccAddresses.member." + (i + 1)] = x; })
    if (options.replyTo) lib.split(options.replyTo).forEach((x, i) => { params["ReplyToAddresses.member." + (i + 1)] = x; })
    if (options.returnPath) params.ReturnPath = options.returnPath;
    if (options.config) params.ConfigurationSetName = options.config;
    this.querySES("SendEmail", params, options, callback);
}

/**
 * Send raw email
 * The following options accepted:
 *  - to - list of email addresses to use in RCPT TO
 *  - from - an email to use in from header
 *  - config - configuration set name
 * @memberof module:aws
 * @method sesSendRawEmail
 */
aws.sesSendRawEmail = function(body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { "RawMessage.Data": body };
    if (options) {
        if (options.from) params.Source = options.from;
        if (options.to) lib.split(options.to).forEach((x, i) => { params["Destinations.member." + (i + 1)] = x; })
        if (options.config) params.ConfigurationSetName = options.config;
    }
    this.querySES("SendRawEmail", params, options, callback);
}

/**
 * SES V2 version
 * @memberof module:aws
 * @method sesSendRawEmail2
 */
aws.sesSendRawEmail2 = function(body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var params = {
        Content: { Raw: { Data: body } }
    };
    if (options) {
        if (options.from) params.FromEmailAddress = options.from;
        if (options.to) params.Destination = { ToAddresses: lib.split(options.to) }
        if (options.config) params.ConfigurationSetName = options.config;
    }

    var headers = { 'content-type': 'application/x-amz-json-1.1' };
    var opts = this.queryOptions("POST", lib.stringify(params), headers, options);
    opts.region = this.getServiceRegion("email", options?.region || this.region || 'us-east-1');
    opts.endpoint = "ses";
    opts.action = "SendEmail";
    opts.signer = this.querySigner;
    logger.debug(opts.action, opts);
    aws.fetch(`https://email.${opts.region}.amazonaws.com/v2/email/outbound-emails`, opts, (err, params) => {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}
