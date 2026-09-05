/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS Lambda Invoke API request.
 * @memberof module:aws
 * @method lambdaInvoke
 * @param {string} name - Lambda function name,
 * Function name – my-function (name-only), my-function:v1 (with alias).
 * Function ARN – arn:aws:lambda:us-west-2:123456789012:function:my-function.
 * Partial ARN – 123456789012:function:my-function.
 * @param {object} body - function payload
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {string} [options.qualifier] - Specify a version or alias to invoke a published version of the function.
 * Length Constraints: Minimum length of 1. Maximum length of 128.
 * Pattern: \$(LATEST(\.PUBLISHED)?)|[a-zA-Z0-9-_$]+
 * @param {string} [options.invocationType] - Event for async,  RequestResponse or DryRun
 * @param {string} [options.logType] - Set to Tail to include the execution log in the response.
 * Applies to synchronously invoked functions only.
 * @param {string} [options.clientContext] - Up to 3,583 bytes of base64-encoded data about the invoking client to pass to the
 * function in the context object. Lambda passes the ClientContext object to your function for synchronous invocations only.
 * @param {string} [options.durableExecutionName] - A unique name for the durable execution.
 * @param {string} [options.tenantId] - The identifier of the tenant in a multi-tenant Lambda function.
 * @param {function} callback - `(err, data, request)`
 * The data object will contains the following properties:
 * - payload - response payload object
 * - functionError - error from the function
 * - logResult - last 4K of output
 * - executedVersion
 * - durableExecutionArn
 * @example
 * # aws.lambdaInvoke("myFunction", { data: 1234 }, { logType: "Tail" }, lib.log)
 *
 * {
 *    payload: { ... }
 *    logResult: "....",
 *    executedVersion: "$LATEST",
 *    durableExecutionName: "...."
 * }
 */
aws.lambdaInvoke = function(name, body, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    const region = this.getServiceRegion("lambda", options?.region || this.region || 'us-east-1');

    let url = `https://lambda.${region}.amazonaws.com/2015-03-31/functions/${name}/invocations`;

    if (options?.qualifier) {
        url += "?Qualifier=" + options.qualifier;
    }

    const opts = this.getServiceOptions(Object.assign({ region, service: "lambda", postdata: body }), options);

    if (options?.invocationType) {
        opts.headers["X-Amz-Invocation-Type"] = options.invocationType;
    }
    if (options?.logType) {
        opts.headers["X-Amz-Log-Type"] = options.logType;
    }
    if (options?.clientContext) {
        opts.headers["X-Amz-Client-Context"] = options.clientContext;
    }
    if (options?.durableExecutionName) {
        opts.headers["X-Amz-Durable-Execution-Name"] = options.durableExecutionName;
    }
    if (options?.tenantId) {
        opts.headers["X-Amz-Tenant-Id"] = options.tenantId;
    }

    this.fetch(url, opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) {
            err = aws.parseError(rc);
        }
        rc.logger(err ? rc.logger_error || "error" : "debug", "lambdaInvoke:", err, "postdata:", rc.postdata, "data:", rc.data);
        const obj = { payload: rc.obj };
        for (const p in rc.resheaders) {
            switch (p) {
            case "x-amz-function-error":
            case "x-amz-log-result":
            case "x-amz-executed-version":
            case "x-amz-durable-execution-arn":
                obj[lib.toCamel(p.substr(6))] = rc.resheaders[p];
                break;
            }
        }
        if (typeof callback === "function") callback(err, obj, rc);
    });
}

const mockContext = {
  functionName: '',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mock-function:$LATEST',
  memoryLimitInMB: 128,
  awsRequestId: process.id,
  logGroupName: 'logger',
  logStreamName: 'lambda',
  identity: {},
  clientContext: {},
  callbackWaitsForEmptyEventLoop: true,
  getRemainingTimeInMillis: () => 3000,
  done: (err, res) => {},
  fail: (err) => {},
  succeed: (res) => {}
};

/**
 * Wrap Lambda SQS handler to use with Events, each event is wrapped into SQS Event record and passed to the
 * real Lambda handler. The function context `this` must point to real Lambda handler or an object with .handler method.
 * @param {object} event - SQS Event with records
 * @param {object|function} [context] - user context
 * @param {function} [context.handler] - actual Lambda handler
 * @param {object} [context.context] - lambda context to be merged with mock context, this is deep merge
 * @param {function} [callback] - callback to return back to events processor, use err.status >= 600 to keep
 * the event in the queue for retry, err.status >= 400 to drop
 * @returns {undefined}
 * @memberof module:aws
 * @method lambdaEventsProxySQS
 * @example <caption>Assume there is a Lambda package and we want to run it locally via backendjs Events system instead of testing
 * inside AWS. Save a script `test-lambda.js` </caption>
 *
 * const { app, db, lib, events } = require("backendjs");
 * const handler = require("lambda-package");
 *
 * app.start({ worker: true }, async () => {
 *     await db.acreateTables();
 *
 *     const file = process.argv.find(x => x.endsWith(".json"));
 *     if (file) {
 *         lib.forEachLineSync(file, { json: true }, (event) => {
 *             events.putEvent("test", event);
 *         });
 *         await lib.sleep(1000);
 *     }
 *
 *     events.subscribe("", aws.lambdaEventsProxySQS, handler);
 *
 *     // or with custom context
 *     // events.subscribe("", aws.lambdaEventsProxySQS, { handler, context: { clientContext: { user_id: "12345" } } } });
 * });
 *
 * @example <caption>save minimal bkjs.conf to use local Sqlite queue</caption>
 *
 * db-pool=sqlite
 * db-sqlite-pool=var/test
 * queue-default=db://
 * events-routing=default:.*
 *
 * @example <caption>Now to test events start it from command line, pass a file with events
 * to publish, one event per line in JSON oformat
 * </caption>
 * node test-lambda.js events.json
 *
 */
aws.lambdaEventsProxySQS = async function(event, callback)
{
    const handler = lib.isFunc(this, lib.isFunc(this?.handler));
    if (!handler) return callback({ status: 500, message: "no handler" });

    const sqsEvent = {
        Records: [
            {
                messageId: event.id,
                receiptHandle: event.id,
                body: event.data,
                attributes: {
                    ApproximateReceiveCount: 1,
                    SentTimestamp: event.time,
                    SenderId: event.origin,
                    ApproximateFirstReceiveTimestamp: Date.now(),
                },
                qmessageAttributes: {},
                md5OfBody: "",
                eventSource: "aws:sqs",
                eventSourceARN: `arn:aws:sqs:${aws.region}:123456789012:${event.received}`,
                awsRegion: aws.region,
            }
        ]
    };

    try {
        const rc = await handler(sqsEvent, lib.extend({}, mockContext, this.context));

        const err = rc?.batchItemFailures?.[0] ? { status: 600 } : null;
        callback(err);
    } catch (err) {
        callback(err);
    }
}


const apiContext = {
  resource: "/",
  path: "/",
  httpMethod: "GET",
  headers: {},
  multiValueHeaders: {},
  queryStringParameters: {},
  multiValueQueryStringParameters: {},
  requestContext: {
    accountId: "123456789012",
    apiId: "id",
    authorizer: {},
    domainName: "id.execute-api.us-east-1.amazonaws.com",
    domainPrefix: "id",
    extendedRequestId: "request-id",
    httpMethod: "GET",
    identity: {},
    path: "/",
    protocol: "HTTP/1.1",
    requestId: "id=",
    requestTime: "",
    requestTimeEpoch: 0,
    resourceId: null,
    resourcePath: "/",
    stage: "$default"
  },
  pathParameters: null,
  stageVariables: null,
  body: "",
}

/**
 * Wrap Lambda API Gateway handler to use with api odule, each request is wrapped into APIrequest context and passed to the
 * real Lambda handler. The function context `this` must point to real Lambda handler or an object with .handler method.
 * @param {object} event - SQS Event with records
 * @param {object|function} [context] - user context
 * @param {function} [context.handler] - actual Lambda handler
 * @param {object} [context.context] - lambda context to be merged with mock context, this is deep merge
 * @param {function} [callback] - callback to return back to events processor, use err.status >= 600 to keep
 * the event in the queue for retry, err.status >= 400 to drop
 * @returns {undefined}
 * @memberof module:aws
 * @method lambdaProxyAPIGateway
 * @example <caption>Assume there is a Lambda package and we want to run it locally via backendjs Events system instead of testing
 * inside AWS. Save a script `test-lambda.js` </caption>
 *
 * const { app, db, lib, events } = require("backendjs");
 * const handler = require("lambda-package");
 *
 * app.start({ worker: true }, async () => {
 *     await db.acreateTables();
 *
 *     const file = process.argv.find(x => x.endsWith(".json"));
 *     if (file) {
 *         lib.forEachLineSync(file, { json: true }, (event) => {
 *             events.putEvent("test", event);
 *         });
 *         await lib.sleep(1000);
 *     }
 *
 *     events.subscribe("", aws.lambdaProxyAPIGateway, handler);
 *
 *     // or with custom context
 *     // events.subscribe("", aws.lambdaProxyAPIGateway, { handler, context: { clientContext: { user_id: "12345" } } } });
 * });
 *
 * @example <caption>save minimal bkjs.conf to use local Sqlite queue</caption>
 *
 * db-pool=sqlite
 * db-sqlite-pool=var/test
 * queue-default=db://
 * events-routing=default:.*
 *
 * @example <caption>Now to test events start it from command line, pass a file with events
 * to publish, one event per line in JSON oformat
 * </caption>
 * node test-lambda.js events.json
 *
 */
aws.lambdaProxyAPIGateway = async function(context, callback)
{
    const handler = lib.isFunc(this, lib.isFunc(this?.handler));
    if (!handler) return callback({ status: 500, message: "no handler" });

    try {
        const rc = await handler(lib.extend({}, apiContext, this.context));
        context.send(rc.statusCode || 200);
    } catch (err) {
        callback(err);
    }

    return {
        "statusCode": 200,
        "headers": { "headername": "headervalue" },
        "multiValueHeaders": { "headerName": ["headerValue", "headerValue2"] },
        "body": "Hello from Lambda!"
    }
}

