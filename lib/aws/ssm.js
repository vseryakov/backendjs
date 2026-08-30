/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require('../lib');
const aws = require('../aws');

/**
 * AWS Systems Manager (SSM) API request.
 * @memberof module:aws
 * @method querySSM
 * @param {string} action - SSM API action, e.g. `GetParameter`, `SendCommand`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, data, request)`
 */
aws.querySSM = function(action, obj, options, callback)
{
    this.queryService({ endpoint: "ssm", target: "AmazonSSM", action }, obj, options, callback);
}

/**
 * Run a shell command on instances via SSM (AWS-RunShellScript document).
 * @memberof module:aws
 * @method ssmSendCommand
 * @param {string|string[]} cmds - one command or a list of commands to run
 * @param {string|string[]} instances - one instance id or a list of instance ids
 * @param {object} [options]
 * @param {function} callback
 */
aws.ssmSendCommand = function(cmds, instances, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const params = {
        DocumentName: "AWS-RunShellScript",
        InstanceIds: Array.isArray(instances) ? instances : [instances],
        Parameters: { commands: Array.isArray(cmds) ? cmds : [cmds] }
    };
    this.querySSM("SendCommand", params, options, callback);
}

/**
 * Poll an SSM command invocation until it finishes (leaves Pending/InProgress/Delayed) or times out.
 * @memberof module:aws
 * @method ssmWaitForCommand
 * @param {string} cmdId - the SSM command id
 * @param {string} instanceId - the instance id
 * @param {object} [options]
 * @param {number} [options.waitTimeout=60000] - how long to wait in ms
 * @param {number} [options.waitDelay=1000] - delay in ms between polls
 * @param {function} callback - `(err, output)`
 */
aws.ssmWaitForCommand = function(cmdId, instanceId, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    options = lib.clone(options, { retryOnError: 1 });
    options.retryCount = lib.toNumber(options.retryCount, { min: 3 });
    options.retryTimeout = lib.toNumber(options.retryTimeout, { min: 500 });
    options.waitDelay = lib.toNumber(options.waitDelay, { dflt: 1000, min: 500 });
    const expires = Date.now() + lib.toNumber(options.waitTimeout, { dflt: 60000, min: 100 });
    const status = ["Pending","InProgress","Delayed"];
    let output = {}, num = 0;
    const params = {
        CommandId: cmdId,
        InstanceId: instanceId,
    };
    lib.doWhilst(
        function(next) {
            aws.querySSM("GetCommandInvocation", params, options, (err, rc) => {
              if (err) return next(err);
              output = rc || {};
              setTimeout(next, num++ ? options.waitDelay : 0);
          });
      },
      function() {
          return lib.includes(status, output.Status) && Date.now() < expires;
      },
      function(err) {
          lib.tryCall(callback, err, output);
      }, true);
}

/**
 * Retrieve information about one or more parameters under a specified level in a
 * hierarchy from AWS System Manager
 * @param {string} path - The hierarchy for the parameter. Hierarchies start with a forward slash (/). The hierarchy is the
 * parameter name except the last part of the parameter. For the API call to succeed, the last part of the parameter name can't be in the path.
 * A parameter name hierarchy can have a maximum of 15 levels. Here is an example of a hierarchy: /Finance/Prod/IAD/WinServ2016/license33
 * @param {object} [options]
 * @param {object[]} [options.filters] - { Key: string, Option: string, Values: string[] }
 *  - Key can be Type, KeyId, and Label
 *  - Option can be Equal or BeginsWith, for Label only Equals
 *  - Values a list of strings to matche
 * @param {function} callback
 * @memberof module:aws
 * @method ssmGetParametersByPath
 */
aws.ssmGetParametersByPath = function(path, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    const list = [];
    const q = { Path: path, Recursive: true };
    if (options.filters) q.ParameterFilters = options.filters;

    lib.doWhilst(
        function(next) {
            aws.querySSM("GetParametersByPath", q, options, (err, rc) => {
              if (!err) {
                  q.NextToken = rc.NextToken;
                  list.push.apply(list, rc.Parameters);
              }
              next(err);
          });
      },
      function() {
          return q.NextToken;
      },
      function(err) {
          lib.tryCall(callback, err, list);
      }, true);
}

