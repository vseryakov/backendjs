//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const util = require('util');
const url = require('url');
const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

aws.queryDDBStreams = function(action, obj, options, callback)
{
    this._queryDDB("DynamoDBStreams_20120810", "streams.dynamodb", action, obj, options, callback);
}
