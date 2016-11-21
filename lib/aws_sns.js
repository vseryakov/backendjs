//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2012
//

var util = require('util');
var logger = require(__dirname + '/logger');
var core = require(__dirname + '/core');
var lib = require(__dirname + '/lib');
var aws = require(__dirname + '/aws');

// AWS SNS API request
aws.querySNS = function(action, obj, options, callback)
{
    this.queryEndpoint("sns", '2010-03-31', action, obj, options, callback);
}

// Creates an endpoint for a device and mobile app on one of the supported push notification services, such as GCM and APNS.
//
// The following properties can be specified in the options:
//   - appArn - an application ARN to be used for push notifications, if not passed, global `-sns-app-arn` will be used.
//   - data - a user data to be associated with the endpoint arn
//
// All capitalized properties in the options will be pased as is. The callback will be called with an error if any and the endpoint ARN
aws.snsCreatePlatformEndpoint = function(token, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { PlatformApplicationArn: options.appArn || this.snsAppArn, Token: token };
    if (options.data) params.CustomUserData = options.data;

    this.querySNS("CreatePlatformEndpoint", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreatePlatformEndpointResponse.CreatePlatformEndpointResult.EndpointArn", { str: 1 });
        callback(err, arn);
    });
}

// Sets the attributes for an endpoint for a device on one of the supported push notification services, such as GCM and APNS.
//
// The following properties can be specified in the options:
//  - token - a device token for the notification service
//  - data - a user data to be associated with the endpoint arn
//  - enabled - true or false to enable/disable the deliver of notifications to this endpoint
aws.snsSetEndpointAttributes = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn }, n = 1;
    if (options.data) params["Attributes.entry." + (n++) + ".CustomUserData"] = options.data;
    if (options.token) params["Attributes.entry." + (n++) + ".Token"] = options.token;
    if (options.enabled) params["Attributes.entry." + (n++) + ".Enabled"] = options.enabled;
    this.querySNS("SetEndpointAttributes", params, options, callback);
}

// Deletes the endpoint from Amazon SNS.
aws.snsDeleteEndpoint = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn };
    this.querySNS("DeleteEndpoint", params, options, callback);
}

// Sends a message to all of a topic's subscribed endpoints or to a mobile endpoint.
// If msg is an object, then it will be pushed as JSON.
// The options may take the following properties:
//  - subject - optional subject to be included in the message if the target supports it
aws.snsPublish = function(arn, msg, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TargetArn: arn, Message: msg };
    if (typeof msg != "string") {
        params.Message = lib.stringify(msg);
        params.MessageStructure = "json";
    }
    if (options.subject) params.Subject = options.subject;

    this.querySNS("Publish", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsCreateTopic = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("CreateTopic", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreateTopicResponse.CreateTopicResult.TopicArn", { str: 1 });
        callback(err, arn);
    });
}

// Updates the topic attributes.
// The following options can be used:
//  - name - new topic name
//  - policy - an object with access policy
//  - deliveryPolicy - an object with delivery attributes, can specify all or only the ones that needed to be updated
aws.snsSetTopicAttributes = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { TopicArn: arn };
    if (options.name) {
        params.AttrributeName = "DisplayName";
        params.AttributeValue = options.name;
    } else
    if (options.policy) {
        params.AttrributeName = "Policy";
        params.AttributeValue = lib.stringify(options.policy);
    } else
    if (options.deliveryPolicy) {
        params.AttrributeName = "DeliveryPolicy";
        params.AttributeValue = lib.stringify(options.deliveryPolicy);
    } else {
        var policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] == "undefined") return;
            if (!policy) policy = {};
            if (!policy.defaultHealthyRetryPolicy) policy.defaultHealthyRetryPolicy = {};
            policy.defaultHealthyRetryPolicy[x] = options[x];
        });
        if (options.maxReceivesPerSecond) {
            if (!policy) policy = {};
            policy.defaultThrottlePolicy = { maxReceivesPerSecond: options.maxReceivesPerSecond };
        }
        if (options.disableSubscriptionOverrides) {
            if (!policy) policy = {};
            policy.disableSubscriptionOverrides = options.disableSubscriptionOverrides;
        }
        if (policy && options.protocol) {
            params.AttrributeName = "DeliveryPolicy";
            params.AttributeValue = lib.stringify(lib.objNew(options.protocol, policy));
        }
    }

    this.querySNS("SetTopicAttributes", params, options, callback);
}

// Deletes the topic from Amazon SNS.
aws.snsDeleteTopic = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    this.querySNS("DeleteTopic", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success, if the topic requires
// confirmation the arn returned will be null and a token will be sent to the endpoint for confirmation.
aws.snsSubscribe = function(arn, endpoint, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    // Detect the protocol form the ARN
    if (!options.protocol && typeof endpoint == "string") {
        if (endpoint.match(/^https?\:\/\//)) options.protocol = endpoint.substr(0, 4); else
        if (endpoint.match(/^arn\:aws\:/)) options.protocol = "sqs"; else
        if (endpoint.match(/^[^ ]@[^ ]+$/)) options.protocol = "email"; else
        if (endpoint.match(/[0-9-]+/)) options.protocol = "sms"; else
        options.protocol = "application";
    }

    var params = { TopicARN: arn, Protocol: options.protocol, Endpoint: endpoint };
    this.querySNS("Subscribe", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
    });
}

// Verifies an endpoint owner's intent to receive messages by validating the token sent to the
// endpoint by an earlier Subscribe action. If the token is valid, the action creates a new subscription
// and returns its Amazon Resource Name (ARN) in the callback.
aws.snsConfirmSubscription = function(arn, token, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (typeof callback != "function") callback = lib.noop;
    if (!options) options = {};

    var params = { TopicARN: arn, Token: token };
    this.querySNS("ConfirmSubscription", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
    });
}

// Updates the subscription attributes.
// The following options can be used:
//  - name - new topic name
//  - deliveryPolicy - an object with delivery attributes, can specify all or only the ones that needed to be updated
//  - minDelayTarget - update delivery policy by attribute name
//  - maxDelayTarget
//  - numRetries
//  - numMaxDelayRetries
//  - backoffFunction - one of linear|arithmetic|geometric|exponential
//  - maxReceivesPerSecond
aws.snsSetSubscriptionAttributes = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    if (options.deliveryPolicy) {
        params.AttrributeName = "DeliveryPolicy";
        params.AttributeValue = lib.stringify(options.deliveryPolicy);
    } else {
        var policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] == "undefined") return;
            if (!policy) policy = {};
            if (!policy.healthyRetryPolicy) policy.healthyRetryPolicy = {};
            policy.healthyRetryPolicy[x] = options[x];
        });
        if (options.maxReceivesPerSecond) {
            if (!policy) policy = {};
            policy.throttlePolicy = { maxReceivesPerSecond: options.maxReceivesPerSecond };
        }
        if (policy) {
            params.AttrributeName = "DeliveryPolicy";
            params.AttributeValue = lib.stringify(policy);
        }
    }

    this.querySNS("SetSubscriptionAttributes", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsUnsubscribe = function(arn, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("Unsubscribe", params, options, callback);
}

// Creates a topic to which notifications can be published. The callback returns topic ARN on success.
aws.snsListTopics = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};

    var params = {};
    this.querySNS("ListTopics", params, options, function(err, rc) {
        var list = lib.objGet(rc, "ListTopicsResponse.ListTopicsResult.Topics.member", { list: 1 });
        if (typeof callback == "function") return callback(err, list.map(function(x) { return x.TopicArn }));
    });
}

