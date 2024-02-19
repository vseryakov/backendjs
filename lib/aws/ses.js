//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

// AWS SES API request
aws.querySES = function(action, obj, options, callback)
{
    this.queryEndpoint("email", '2010-12-01', action, obj, options, callback);
}

// Send an email via SES
// The following options supported:
//  - from - an email to use in the From: header
//  - cc - list of email to use in CC: header
//  - bcc - list of emails to use in Bcc: header
//  - replyTo - list of emails to ue in ReplyTo: header
//  - returnPath - email where to send bounces
//  - charset - charset to use, default is UTF-8
//  - html - if set the body is sent as MIME HTML
aws.sesSendEmail = function(to, subject, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var params = { "Message.Subject.Data": subject, "Message.Subject.Charset": options.charset || "UTF-8" };
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Data"] = body;
    params["Message.Body." + (options.html ? "Html" : "Text") + ".Charset"] = options.charset || "UTF-8";
    params.Source = options.from || core.emailFrom || ("admin@" + core.domain);
    lib.strSplit(to).forEach(function(x, i) { params["Destination.ToAddresses.member." + (i + 1)] = x; })
    if (options.cc) lib.strSplit(options.cc).forEach(function(x, i) { params["Destination.CcAddresses.member." + (i + 1)] = x; })
    if (options.bcc) lib.strSplit(options.bcc).forEach(function(x, i) { params["Destination.BccAddresses.member." + (i + 1)] = x; })
    if (options.replyTo) lib.strSplit(options.replyTo).forEach(function(x, i) { params["ReplyToAddresses.member." + (i + 1)] = x; })
    if (options.returnPath) params.ReturnPath = options.returnPath;
    this.querySES("SendEmail", params, options, callback);
}

// Send raw email
// The following options accepted:
//  - to - list of email addresses to use in RCPT TO
//  - from - an email to use in from header
aws.sesSendRawEmail = function(body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var params = { "RawMessage.Data": body };
    if (options) {
        if (options.from) params.Source = options.from;
        if (options.to) lib.strSplit(options.to).forEach(function(x, i) { params["Destinations.member." + (i + 1)] = x; })
    }
    this.querySES("SendRawEmail", params, options, callback);
}
