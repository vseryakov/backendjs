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
 * Detect image features using AWS Rekognition service, the `name` can be a Buffer, a local file or an url to the S3 bucket. In the latter case
 * the url can be just apath to the file inside a bucket if `options.bucket` is specified, otherwise it must be a public S3 url with the bucket name
 * to be the first part of the host name. For CDN/CloudFront cases use the `option.bucket` option.
 * @memberof module:aws
 * @method detectLabels
 */
aws.detectLabels = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    if (Buffer.isBuffer(name)) {
        const req = {
            Image: {
                Bytes: name.toString("base64")
            }
        };
        aws.queryRekognition("DetectLabels", req, options, callback);
    } else
    if (name && options && options.bucket) {
        const req = {
            Image: {
                S3Object: {
                    Bucket: options.bucket,
                    Name: name[0] == "/" ? name.substr(1) : name
                }
            }
        };
        aws.queryRekognition("DetectLabels", req, options, callback);
    } else
    if (name && name[0] == "/") {
        fs.readFile(path.normalize(name), function(err, data) {
            if (err) return callback && callback(err);
            const req = {
                Image: {
                    Bytes: data.toString("base64")
                }
            };
            aws.queryRekognition("DetectLabels", req, options, callback);
        });
    } else {
        name = URL.parse(String(name));
        if (!name) return callback && callback({ status: 400, message: "invalid url" })
        if (name.pathname && name.pathname[0] == "/") name.pathname = name.pathname.substr(1);
        const req = {
            Image: {
                S3Object: {
                    Bucket: name.hostname && name.hostname.split(".")[0],
                    Name: name.pathname
                }
            }
        };
        if (!req.Image.S3Object.Bucket || !req.Image.S3Object.Name) return callback && callback({ status: 404, message: "invalid image" });
        aws.queryRekognition("DetectLabels", req, options, callback);
    }
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
    this.querySecrets("GetSecretValue", params, options, (err, rc) => {
        if (!err) rc.value = rc.SecretString || rc.SecretBinary;
        callback(err, rc);
    });
}
