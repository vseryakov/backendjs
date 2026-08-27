/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require('../lib');
const aws = require('../aws');

/**
 * AWS SNS (Simple Notification Service) API request.
 * @memberof module:aws
 * @method querySNS
 * @param {string} action - SNS API action, e.g. `Publish`, `CreateTopic`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryEndpoint}
 * @param {function} callback - `(err, data, request)`
 */
aws.querySNS = function(action, obj, options, callback)
{
    this.queryEndpoint("sns", '2010-03-31', action, obj, options, callback);
}

/**
 * Create a platform endpoint for a device on a supported push service (GCM, APNS...).
 * @memberof module:aws
 * @method snsCreatePlatformEndpoint
 * @param {string} token - device token from the notification service
 * @param {object} [options]
 * @param {string} [options.appArn] - platform application ARN, defaults to `aws.snsAppArn`
 * @param {string} [options.data] - custom user data to associate with the endpoint
 * @param {function} callback - `(err, endpointArn)`
 */
aws.snsCreatePlatformEndpoint = function(token, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof callback !== "function") callback = lib.noop;
    if (!options) options = {};

    var params = { PlatformApplicationArn: options.appArn || this.snsAppArn, Token: token };
    if (options.data) params.CustomUserData = options.data;

    this.querySNS("CreatePlatformEndpoint", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreatePlatformEndpointResponse.CreatePlatformEndpointResult.EndpointArn", { str: 1 });
        callback(err, arn);
    });
}

/**
 * Set attributes for a platform endpoint.
 * @memberof module:aws
 * @method snsSetEndpointAttributes
 * @param {string} arn - the endpoint ARN
 * @param {object} [options]
 * @param {string} [options.token] - device token for the notification service
 * @param {string} [options.data] - custom user data to associate with the endpoint
 * @param {boolean} [options.enabled] - enable/disable notification delivery to this endpoint
 * @param {function} callback
 */
aws.snsSetEndpointAttributes = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn }, n = 1;
    if (options.data) params["Attributes.entry." + (n++) + ".CustomUserData"] = options.data;
    if (options.token) params["Attributes.entry." + (n++) + ".Token"] = options.token;
    if (options.enabled) params["Attributes.entry." + (n++) + ".Enabled"] = options.enabled;
    this.querySNS("SetEndpointAttributes", params, options, callback);
}

/**
 * Delete a platform endpoint from Amazon SNS.
 * @memberof module:aws
 * @method snsDeleteEndpoint
 * @param {string} arn - the endpoint ARN
 * @param {object} [options]
 * @param {function} callback
 */
aws.snsDeleteEndpoint = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { EndpointArn: arn };
    this.querySNS("DeleteEndpoint", params, options, callback);
}

/**
 * Publish a message to a topic's subscribers or to a specific endpoint.
 * @memberof module:aws
 * @method snsPublish
 * @param {string} arn - target topic or endpoint ARN
 * @param {string|object} msg - message string, or an object sent as JSON message structure
 * @param {object} [options]
 * @param {string} [options.subject] - optional subject when the target supports it
 * @param {function} callback
 */
aws.snsPublish = function(arn, msg, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TargetArn: arn, Message: msg };
    if (typeof msg !== "string") {
        params.Message = lib.stringify(msg);
        params.MessageStructure = "json";
    }
    if (options.subject) {
        params.Subject = options.subject.replace(/[^\x20-\x7F]/g, "").substr(0, 100);
    }

    this.querySNS("Publish", params, options, callback);
}

/**
 * Create an SNS topic.
 * @memberof module:aws
 * @method snsCreateTopic
 * @param {string} name - topic name
 * @param {object} [options]
 * @param {function} callback - `(err, topicArn)`
 */
aws.snsCreateTopic = function(name, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof callback !== "function") callback = lib.noop;
    if (!options) options = {};

    var params = { Name: name };
    this.querySNS("CreateTopic", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "CreateTopicResponse.CreateTopicResult.TopicArn", { str: 1 });
        callback(err, arn);
    });
}

/**
 * Update topic attributes. Provide one of the high-level attributes, or granular delivery policy fields.
 * @memberof module:aws
 * @method snsSetTopicAttributes
 * @param {string} arn - the topic ARN
 * @param {object} [options]
 * @param {string} [options.name] - new display name
 * @param {object} [options.policy] - access policy object
 * @param {object} [options.deliveryPolicy] - full delivery policy object
 * @param {string} [options.protocol] - protocol the granular delivery policy applies to
 * @param {number} [options.minDelayTarget] - retry policy min delay
 * @param {number} [options.maxDelayTarget] - retry policy max delay
 * @param {number} [options.numRetries] - number of retries
 * @param {number} [options.numMaxDelayRetries] - retries at max delay
 * @param {string} [options.backoffFunction] - backoff function name
 * @param {number} [options.maxReceivesPerSecond] - throttle policy rate
 * @param {boolean} [options.disableSubscriptionOverrides] - disable subscription overrides
 * @param {function} callback
 */
aws.snsSetTopicAttributes = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof callback !== "function") callback = lib.noop;
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
        let policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] === "undefined") return;
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
            params.AttributeValue = lib.stringify({ [options.protocol]: policy });
        }
    }

    this.querySNS("SetTopicAttributes", params, options, callback);
}

/**
 * Delete an SNS topic.
 * @memberof module:aws
 * @method snsDeleteTopic
 * @param {string} arn - the topic ARN
 * @param {object} [options]
 * @param {function} callback
 */
aws.snsDeleteTopic = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    this.querySNS("DeleteTopic", params, options, callback);
}

/**
 * Subscribe an endpoint to a topic. If confirmation is required the returned ARN is null and a token is
 * sent to the endpoint. The protocol is auto-detected from the endpoint when not given.
 * @memberof module:aws
 * @method snsSubscribe
 * @param {string} arn - the topic ARN
 * @param {string} endpoint - the endpoint (URL, ARN, email, phone number...)
 * @param {object} [options]
 * @param {string} [options.protocol] - protocol: http/https/sqs/email/sms/application (auto-detected if omitted)
 * @param {function} callback - `(err, subscriptionArn)`
 */
aws.snsSubscribe = function(arn, endpoint, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof callback !== "function") callback = lib.noop;
    if (!options) options = {};

    // Detect the protocol form the ARN
    if (!options.protocol && typeof endpoint === "string") {
        if (lib.rxUrl.test(endpoint)) options.protocol = endpoint.substr(0, 4); else
        if (endpoint.match(/^arn:aws:/)) options.protocol = "sqs"; else
        if (endpoint.match(/^[^ ]@[^ ]+$/)) options.protocol = "email"; else
        if (endpoint.match(/[0-9-]+/)) options.protocol = "sms"; else options.protocol = "application";
    }

    var params = { TopicARN: arn, Protocol: options.protocol, Endpoint: endpoint };
    this.querySNS("Subscribe", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
    });
}

/**
 * Confirm a subscription by validating the token sent to the endpoint by an earlier Subscribe action.
 * @memberof module:aws
 * @method snsConfirmSubscription
 * @param {string} arn - the topic ARN
 * @param {string} token - confirmation token received at the endpoint
 * @param {object} [options]
 * @param {function} callback - `(err, subscriptionArn)`
 */
aws.snsConfirmSubscription = function(arn, token, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (typeof callback !== "function") callback = lib.noop;
    if (!options) options = {};

    var params = { TopicARN: arn, Token: token };
    this.querySNS("ConfirmSubscription", params, options, function(err, obj) {
        var arn = null;
        if (!err) arn = lib.objGet(obj, "SubscribeResponse.SubscribeResult.SubscriptionArn", { str: 1 });
        callback(err, arn);
    });
}

/**
 * Update subscription attributes, either a full delivery policy or granular retry/throttle fields.
 * @memberof module:aws
 * @method snsSetSubscriptionAttributes
 * @param {string} arn - the subscription ARN
 * @param {object} [options]
 * @param {object} [options.deliveryPolicy] - full delivery policy object
 * @param {number} [options.minDelayTarget] - retry policy min delay
 * @param {number} [options.maxDelayTarget] - retry policy max delay
 * @param {number} [options.numRetries] - number of retries
 * @param {number} [options.numMaxDelayRetries] - retries at max delay
 * @param {string} [options.backoffFunction] - one of linear | arithmetic | geometric | exponential
 * @param {number} [options.maxReceivesPerSecond] - throttle policy rate
 * @param {function} callback
 */
aws.snsSetSubscriptionAttributes = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { TopicArn: arn };
    if (options.deliveryPolicy) {
        params.AttrributeName = "DeliveryPolicy";
        params.AttributeValue = lib.stringify(options.deliveryPolicy);
    } else {
        let policy = null;
        ["minDelayTarget", "maxDelayTarget", "numRetries", "numMaxDelayRetries", "backoffFunction"].forEach(function(x) {
            if (typeof options[x] === "undefined") return;
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

/**
 * Unsubscribe from a topic.
 * @memberof module:aws
 * @method snsUnsubscribe
 * @param {string} arn - the subscription ARN
 * @param {object} [options]
 * @param {function} callback
 */
aws.snsUnsubscribe = function(arn, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = { Name: arn };
    this.querySNS("Unsubscribe", params, options, callback);
}

/**
 * List all SNS topic ARNs.
 * @memberof module:aws
 * @method snsListTopics
 * @param {object} [options]
 * @param {function} callback - `(err, arns)` where arns is a list of topic ARN strings
 */
aws.snsListTopics = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = {};
    this.querySNS("ListTopics", params, options, function(err, rc) {
        var list = lib.objGet(rc, "ListTopicsResponse.ListTopicsResult.Topics.member", { list: 1 });
        if (typeof callback === "function") return callback(err, list.map(function(x) { return x.TopicArn }));
    });
}

