//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const url = require('url');
const path = require('path');
const fs = require('fs');
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

// Assume a role and return new credentials that can be used in other API calls
aws.stsAssumeRole = function(options, callback)
{
    var params = {
        RoleSessionName: options.name || core.name,
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

// Detect image featires using AWS Rekognition service, the `name` can be a Buffer, a local file or an url to the S3 bucket. In the latter case
// the url can be just apath to the file inside a bucket if `options.bucket` is specified, otherwise it must be a public S3 url with the bucket name
// to be the first part of the host name. For CDN/CloudFront cases use the `option.bucket` option.
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
        fs.readFile(path.join(core.path.images, path.normalize(name)), function(err, data) {
            if (err) return callback && callback(err);
            const req = {
                Image: {
                    Bytes: data.toString("base64")
                }
            };
            aws.queryRekognition("DetectLabels", req, options, callback);
        });
    } else {
        name = url.parse(String(name));
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

// Return a list of certificates,
// - `status` can limit which certs to return, PENDING_VALIDATION | ISSUED | INACTIVE | EXPIRED | VALIDATION_TIMED_OUT | REVOKED | FAILED
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
