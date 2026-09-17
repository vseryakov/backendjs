/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS Lambda API request.
 * @memberof module:aws
 * @method queryLambda
 * @param {string} path - Lamda API path, e.g. `/MyFunction/invocations`
 * @param {object} postdata - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryLambda = function(path, postdata, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    const region = this.getServiceRegion("lambda", options?.region || this.region || 'us-east-1');
    const url = `https://lambda.${region}.amazonaws.com/2015-03-31/functions${path}`;

    const opts = this.getServiceOptions(Object.assign({ region, service: "lambda", postdata }), options);

    aws.fetch(url, opts, (err, rc) => {
        if (rc.status < 200 || rc.status >= 399) {
            err = aws.parseError(rc);
        }
        rc.logger(err ? rc.logger_error || "error" : "debug", "queryLambda:", err, "postdata:", rc.postdata, "data:", rc.data);
        if (typeof callback === "function") callback(err, rc.obj, rc);
    });
}

/**
 * AWS Lambda list all functions
 * @memberof module:aws
 * @method lambdaList
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, functions)`
 */
aws.lambdaList = function(options, callback)
{
    var marker, list = [];
    lib.doWhilst(
        function(next) {
            aws.queryLambda(marker ? "?Marker=" + marker : "", "", options, (err, rc) => {
                if (!err) {
                    marker = rc?.NextMarker;
                    if (rc?.Functions?.length) {
                        list.push(...rc.Functions);
                    }
                }
                next(err);
           });
       },
       function() {
           return marker;
       },
       function(err) {
           callback(err, list);
       });

}

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

    options = options || {};
    options.headers = options.headers || {};

    if (options?.qualifier) {
        options.query = Object.assign(options.query || {}, { Qualifier: options.qualifier });
    }

    if (options?.invocationType) {
        options.headers["X-Amz-Invocation-Type"] = options.invocationType;
    }
    if (options?.logType) {
        options.headers["X-Amz-Log-Type"] = options.logType;
    }
    if (options?.clientContext) {
        options.headers["X-Amz-Client-Context"] = options.clientContext;
    }
    if (options?.durableExecutionName) {
        options.headers["X-Amz-Durable-Execution-Name"] = options.durableExecutionName;
    }
    if (options?.tenantId) {
        options.headers["X-Amz-Tenant-Id"] = options.tenantId;
    }

    aws.queryLambda(`/${name}/invocations`, body, options, (err, obj, rc) => {
        obj = { payload: obj };
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

const sqsContext = {
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
 * real Lambda handler.
 *
 * The function context `this` must point to real Lambda handler or an object with .handler method:
 * - function - the Lambda handler method to call
 * - object
 *   - .handler - actual Lambda handler
 *   - .context - lambda context to be merged with Lambda handler default context, this is deep merge
 *
 * @param {object} event - SQS Event with records
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
 *     // Publish events into the queue first
 *     const file = process.argv.find(x => x.endsWith(".json"));
 *     if (file) {
 *         lib.forEachLineSync(file, { json: true }, (event) => {
 *             events.putEvent("test", event);
 *         });
 *         await lib.sleep(1000);
 *     }
 *
 *     // Now we are ready to process these events with lambda
 *
 *     events.subscribe("", aws.lambdaEventsProxySQS, handler);
 *
 *     // To provide custom context call it this way
 *
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
        const rc = await handler(sqsEvent, lib.extend({}, sqsContext, this.context));

        const err = rc?.batchItemFailures?.[0] ? { status: 600 } : null;
        callback(err);
    } catch (err) {
        callback(err);
    }
}


const apiContext1 = {
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
    authorizer: { iam: {}, jwt: {}, lambda: {} },
    domainName: "id.execute-api.us-east-1.amazonaws.com",
    domainPrefix: "id",
    extendedRequestId: "request-id",
    httpMethod: "GET",
    identity: {},
    path: "/",
    protocol: "HTTP/1.1",
    requestId: "id",
    requestTime: "",
    requestTimeEpoch: 0,
    resourceId: null,
    resourcePath: "/",
    stage: "$default"
  },
  isBase64Encodedd: false,
  pathParameters: {},
  stageVariables: {},
  body: "",
}

const apiContext2 = {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/",
    rawQueryString: "",
    cookies: [],
    headers: {},
    queryStringParameters: {},
    requestContext: {
        accountId: "123456789012",
        apiId: "api-id",
        authentication: {},
        authorizer: { iam: {}, jwt: {}, lambda: {} },
        domainName: "id.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "id",
        http: {
            method: "GET",
            path: "/",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: ""
        },
        requestId: "1",
        routeKey: "$default",
        stage: "$default",
        time: "",
        timeEpoch: 0
    },
    isBase64Encodedd: false,
    pathParameters: {},
    stageVariables: {},
    body: "",
}

/**
 * Wrap Lambda API Gateway handler to use with api module, each request is wrapped into API request context and passed to the
 * real Lambda handler. By default payload V2 version is used.
 *
 * The function context `this` must point to real Lambda handler or an object with .handler method:
 * - function - the Lambda handler method to call
 * - object
 *   - .handler - actual Lambda handler
 *   - .context - API Gateway Event V1 or V2 context to be merged with default event, this is deep merge
 *   - .version - 1 or 2 to choose which payload event version to merge with and pass to the handler, 2 is default
 *
 * @param {RequestContext} context - API request context object
 * @param {function} [callback] - callback to return back to events processor, use err.status >= 600 to keep
 * the event in the queue for retry, err.status >= 400 to drop
 * @returns {undefined}
 * @memberof module:aws
 * @method lambdaProxyAPIGateway
 *
 * @example <caption>save minimal bkjs.conf to use local Sqlite queue</caption>
 *
 * middleware-body-enable = true
 *
 * @example <caption>Assume there is a Lambda package and we want to run it locally via backendjs API router instead of testing
 * inside AWS. Save a script `test-lambda.js` </caption>
 *
 * const { app, api, lib } = require("backendjs");
 * const handler = require("lambda-package");
 *
 * app.start({ api: true }, async () => {
 *
 *     api.app.get("/lambda/*", aws.lambdaProxyAPIGateway.bind(handler));
 *
 *     // Use V1 event payload context
 *     api.app.get("/lambda/*", aws.lambdaProxyAPIGateway.bind({ handler, verson: 1 }));
 *
 *     // or with custom static context
 *
 *     // const requestContext = { authorizer: { lambda: { userId: 1 };
 *
 *     // api.app.get("/lambda/*", aws.lambdaProxyAPIGateway.bind({ handler, context: { requestContext }} }));
 *
 *     // or with custom dynamic context
 *
 *     // api.app.get("/lambda/*", (context, next) => {
 *     //    const requestContext = { authorizer: { lambda: { userId: context.user?.id } }};
 *     //
 *     //    aws.lambdaProxyAPIGateway.call({ handler, context: { requestContext }), next);
 *     // });
 * });
 *
 * @example <caption>Now to test events start it from command line</caption>
 * node test-lambda.js
 *
 */
aws.lambdaProxyAPIGateway = async function(context, callback)
{
    const handler = lib.isFunc(this, lib.isFunc(this?.handler));
    if (!handler) return callback({ status: 500, message: "no handler" });

    try {
        let event;
        if (this.context?.version !== 1) {
            event = lib.extend({}, apiContext2, this.context, {
                rawPath: context.path,
                routeKey: `${context.route?.method} ${context.route?.path}`,
                headers: context.req.headers,
                rawQueryString: context.search,
                queryStringParameters: context.query,
                pathParameters: context.params,
                body: context.body,
                requestContext: {
                    http: {
                        method: context.method,
                        path: context.path,
                        userAgent: context.req.headers["user-agent"],
                    },
                    routeKey: `${context.route?.method} ${context.route?.path}`,
                    requestId: context.reqID,
                    timeEpoch: context.time,
                    time: new Date(context.time).toISOString,
                }
            });
        } else {
            event = lib.extend({}, apiContext1, this.context, {
                path: context.path,
                resource: context.path,
                httpMethod: context.method,
                headers: context.req.headers,
                queryStringParameters: context.query,
                pathParameters: context.params,
                body: context.body,
                requestContext: {
                    httpMethod: context.method,
                    path: context.path,
                    resourcePath: context.path,
                    requestId: context.reqID,
                    requestTimeEpoch: context.time,
                    requestTime: new Date(context.time).toISOString,
                }
            });
        }

        const rc = await handler(event);
        for (const p in rc?.headers) context.setHeader(p, rc.headers[p]);
        for (const p in rc?.multiValueHeaders) context.setAppendHeader(p, rc.multiValueHeaders[p]);
        context.send(rc?.statusCode || 200, rc.body);
    } catch (err) {
        callback(err);
    }
}

