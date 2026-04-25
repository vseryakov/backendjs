/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const path = require('path');
const fs = require('fs');
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
            delete obj.Credentials;
        }
        if (typeof callback == "function") callback(err, obj);
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
    if (typeof options == "function") callback = options, options = null;
    var params = {
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
