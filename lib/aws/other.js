/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * Assume a role and return new credentials that can be used in other API calls
 * @memberof module:aws
 * @method stsAssumeRole
 */
aws.stsAssumeRole = function(options, callback)
{
    var params = {
        RoleSessionName: options.name || app.id,
        RoleArn: options.role,
    };
    this.querySTS("AssumeRole", params, options, (err, obj) => {
        if (!err) {
            obj = lib.objGet(obj, "AssumeRoleResponse.AssumeRoleResult");
            obj.credentials = {
                key: obj.Credentials.AccessKeyId,
                secret: obj.Credentials.SecretAccessKey,
                token: obj.Credentials.SessionToken,
                expiration: lib.toDate(obj.Credentials.Expiration).getTime(),
            };
            obj.Credentials = undefined;
        }
        if (typeof callback === "function") callback(err, obj);
    });
}

/**
 * Return a list of certificates,
 * - `status` can limit which certs to return, PENDING_VALIDATION | ISSUED | INACTIVE | EXPIRED | VALIDATION_TIMED_OUT | REVOKED | FAILED
 * @memberof module:aws
 * @method listCertificates
 */
aws.listCertificates = function(options, callback)
{
    var token, list = [];

    lib.doWhilst(
        function(next) {
            aws.queryACM("ListCertificates", { CertificateStatuses: options.status, MaxItems: 1000, NextToken: token }, (err, rc) => {
                if (err) return next(err);
                token = rc.NextToken;
                for (const i in rc.CertificateSummaryList) {
                    list.push(rc.CertificateSummaryList[i]);
                }
                next();
            });
        },
        function() {
            return token;
        },
        function(err) {
            lib.tryCall(callback, err, list);
        });
}

/**
 * Get a secret value from the Secrets Manager
 * @param {String} name
 * @param {object} [options]
 * @param {function} callback
 * @memberof module:aws
 * @method getSecretValue
 */
aws.getSecretValue = function(name, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const params = {
        SecretId: name,
        VersionId: options?.versionId,
        VersionStage: options?.VersionStage
    };
    this.querySecrets("GetSecretValue", params, options, callback);
}

/**
 * Return a list of secrets
 * @param {object} [options]
 * @param {string[]|object[]} [options.filters]
 * @param {string[]} [options.ids]
 * @memberof module:aws
 * @method batchGetSecrets
 */
aws.batchGetSecretValue = function(options, callback)
{
    var token, list = [];

    var Filters = lib.split(options.filters).map(x => ({ Key: x.key || "all", Values: x.values || [x] }));
    var SecretIdList = options.ids;

    lib.doWhilst(
        function(next) {
            aws.querySecrets("BatchGetSecretValue", { Filters, SecretIdList, NextToken: token }, (err, rc) => {
                if (err) return next(err);
                token = rc.NextToken;
                if (rc.SecretValues?.length) {
                    list.push(...rc.SecretValues);
                }
                next();
            });
        },
        function() {
            return token;
        },
        function(err) {
            lib.tryCall(callback, err, list);
        });
}

/**
 * Send converse request to Bedrock
 * @param {string} model
 * @param {object} query - native Bedrock API request body
 * @param {string} [query.prompt] - a user prompt to send
 * @param {string} [query.system] - system prompt
 * @param {number} [query.maxTokens] - max token limit
 * @param {number} [query.temperature] - randomness level
 * @param {object} [options]
 * @param {string} [options.region]
 * @memberof module:aws
 * @method bedrockConverse
 */
aws.bedrockConverse = function(model, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    const region = this.getServiceRegion("bedrock", options?.region || this.region || 'us-east-1');

    const url = `https://bedrock-mantle.${region}.api.aws/${model}/converse`;

    const postdata = Object.assign({}, query);

    if (!postdata.messages && postdata?.prompt) {
        postdata.messages = [ { role: "user", content: postdata.prompt } ];
    }

    if (typeof postdata.system == "string") {
        postdata.system = [ { text: postdata.system } ];
    }

    for (const p of ["maxTokens", "temperature"]) {
        if (postdata?.[p] !== undefined) {
            postdata.inferenceConfig = Object.assign(postdata.inferenceConfig || {}, { [p]: postdata[p] });
            delete postdata[p];
        }
    }

    const opts = this.getServiceOptions(Object.assign({ region, postdata }), options);

    this.fetch(url, opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) err = aws.parseError(rc);
        rc.logger(err ? rc.logger_error || "error" : "debug", "bedrockConverse:", err, "postdata:", rc.postdata, "data:", rc.data);
        if (typeof callback === "function") callback(err, rc.obj, rc);
    });
}

/**
 * Send invoke request to Bedrock,
 * see https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters.html
 * @param {string} model
 * @param {object} body - Invoke API inferenece body
 * @param {object} [options]
 * @param {string} [options.region]
 * @param {object} [options.headers]
 * @memberof module:aws
 * @method bedrockConverse
 */
aws.bedrockInvoke = function(model, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    const region = this.getServiceRegion("bedrock", options?.region || this.region || 'us-east-1');

    const url = `https://bedrock-runtime.${region}.api.aws/${model}/invoke`;

    const opts = this.getServiceOptions(Object.assign({ region, headers: options?.headers, body }), options);

    this.fetch(url, opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) err = aws.parseError(rc);
        rc.logger(err ? rc.logger_error || "error" : "debug", "bedrockInvoke:", err, "postdata:", rc.postdata, "data:", rc.data);
        if (typeof callback === "function") callback(err, rc.obj, rc);
    });
}

