/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const http = require("node:http");
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const app = require(__dirname + '/../app');

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

    if (typeof options == "function") callback = options, options = null;
    options = Object.assign(options || {}, { method: "GET" });

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
 * @param {string|object} [options.clientContext] - Up to 3,583 bytes of base64-encoded data about the invoking client to pass to the
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
        let ctx = options.clientContext;
        if (typeof ctx !== "string") {
            ctx = Buffer.from(lib.stringify(ctx)).toString("base64");
        }
        options.headers["X-Amz-Client-Context"] = ctx;
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
 * Wrap Lambda SQS handler to use with Events module, each event is wrapped into SQS Event record and passed to the
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
 * @method lambdaSQSEventsProxy
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
 *     events.subscribe("", aws.lambdaSQSEventsProxy, handler);
 *
 *     // To provide custom context call it this way
 *
 *     // events.subscribe("", aws.lambdaSQSEventsProxy, { handler, context: { clientContext: { user_id: "12345" } } } });
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
aws.lambdaSQSEventsProxy = async function(event, callback)
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


const APIGatewayEventPayload1 = {
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
  isBase64Encoded: false,
  pathParameters: {},
  stageVariables: {},
  body: "",
}

const APIGatewayEventPayload2 = {
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
    isBase64Encoded: false,
    pathParameters: {},
    stageVariables: {},
    body: "",
}

/**
 * Wrap existing Lambda API Gateway handler to use within the backendjs.
 *
 * Each request is wrapped into API request context and passed to the
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
 * @method lambdaAPIGatewayProxy
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
 *     api.app.get("/lambda/*", aws.lambdaAPIGatewayProxy.bind(handler));
 *
 *     // Use V1 event payload context
 *     api.app.get("/lambda/*", aws.lambdaAPIGatewayProxy.bind({ handler, verson: 1 }));
 *
 *     // or with custom static context
 *
 *     // const requestContext = { authorizer: { lambda: { userId: 1 };
 *
 *     // api.app.get("/lambda/*", aws.lambdaAPIGatewayProxy.bind({ handler, context: { requestContext }} }));
 *
 *     // or with custom dynamic context
 *
 *     // api.app.get("/lambda/*", (context, next) => {
 *     //    const requestContext = { authorizer: { lambda: { userId: context.user?.id } }};
 *     //
 *     //    aws.lambdaAPIGatewayProxy.call({ handler, context: { requestContext }), next);
 *     // });
 * });
 *
 * @example <caption>Now to test api start it from command line</caption>
 * node test-lambda.js
 *
 */
aws.lambdaAPIGatewayProxy = async function(context, callback)
{
    const handler = lib.isFunc(this, lib.isFunc(this?.handler));
    if (!handler) return callback({ status: 500, message: "no handler" });

    try {
        let event;
        if (this.context?.version !== 1) {
            event = lib.extend({}, APIGatewayEventPayload2, this.context, {
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
            event = lib.extend({}, APIGatewayEventPayload1, this.context, {
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

/**
 * Wrap api module to run inside Lambda API Gateway handler.
 *
 * API Gateway event is wrapped into API request/response and passed to the api module, all router methods work as in
 * regular HTTP requests, the response is formatted as Lambda JSON on finish.
 *
 * @param {object} event - API Gateway evbent object
 * @param {object} lambdaContext - Lambda context
 * @returns {Promise(object)}
 * @memberof module:aws
 * @method lambdaAPIGatewayHandler
 *
 * @example <caption>index.mjs: Import backendjs and point the handler to this method</caption>
 *
 * import { aws } from "backendjs";
 *
 * exports.handler = aws.lambdaAPIGatewayHandler;
 *
 */
aws.lambdaAPIGatewayHandler = async function(event, lambdaContext)
{
    logger.debug("lambdaAPIGatewayHandler:", aws.name, event);

    if (!api.initialized) {
        api.port = 0;
        api.runMode = "";
        await app.ainit();
        await api.ainit();
    }

    const req = new APIGatewayRequest(event, lambdaContext);
    const res = new APIGatewayResponse(req, event, lambdaContext);

    await api.ahandleRequest(req, res);

    const result = res.result;
    res.result = undefined;

    return result;
}

/**
 * Wrap http.IncomingMessage to handle body from the Lambda context
 * @param {object} event -
 * @param {object} context - Lambda context
 * @extends http.IncomingMessage
 * @private
 */
class APIGatewayRequest extends http.IncomingMessage {
    #data = null

    constructor(event, context) {
        super();
        this.lambdaEvent = event;
        this.lambdaContext = context;
        this.v2 = event.rawPath && event.requestContext?.http && true;

        this.httpVersion = "HTTP/1.1";
        this.method = event.requestContext?.http?.method || event.httpMethod;
        this.url = this.v2 ? event.rawPath : event.path;

        let query = event.rawQueryString || "";
        if (!query) {
            const params = event.multiValueQueryStringParameters || event.queryStringParameters;
            for (const key in params) {
                const val = params[key];
                if (Array.isArray(val)) {
                    if (query) query += "&";
                    query += val.map(v => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join('&');
                } else {
                    if (val === undefined) continue;
                    if (query) query += "&";
                    query += `${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
                }
            }
        }
        if (query) {
            this.url += "?" + query;
        }

        this.#data = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body || "";
        this.setEncoding('utf8');
        this.headers['content-length'] = Buffer.isBuffer(this.#data) ? this.#data.length: Buffer.byteLength(this.#data, 'utf8');

        if (event.multiValueHeaders) {
            for (const key in event.multiValueHeaders) {
                const val = event.multiValueHeaders[key];
                if (!val?.length) continue;
                this.headers[key] = val.map(encodeHeader).join(key === "set-cookie" ? "; " : ", ");
            }
            if (this.elb) {
                event.headers = undefined;
            }
        }

        for (const key in event.headers) {
            const val = event.headers[key];
            if (val === undefined || val === null) continue;
            this.headers[key] ??= encodeHeader(val);
        }

        if (Array.isArray(event.cookies)) {
            this.headers.cookie = event.cookies.join('; ');
        }
    }

    /**
     * Provide message data for body middleware
     */
    _read() {
        const d = this.#data;
        this.#data = null;
        this.push(d);
    }
}

/**
 * Wrap ServerResponse to send responses as Lambda response
 * @param {object} event -
 * @param {object} context - Lambda context
 * @extends http.ServerResponse
 * @private
 */
class APIGatewayResponse extends http.OutgoingMessage {
    #data = []

    constructor(req, event, context) {
        super();
        this.req = req;
        this.statusCode = 200;
        this.lambdaEvent = event;
        this.lambdaContext = context;
        this.v2 = event.rawPath && event.requestContext?.http && true;
        this.elb = event.requestContext?.elb && true;
    }

    /**
     * Collect all data in memory
     */
    write(chunk, encoding) {
        this.#data.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        return true;
    }

    /**
     * Override end to send as Lambda result
     * @param {string|Buffer|Uint8Array} chunk
     * @param {string} [encoding]
     */
    end(chunk, encoding) {

        const headers = this.getHeaders();

        const isBase64Encoded = !/^text\/|(xml|json)\b/.test(headers["content-type"]);

        if (chunk?.length) {
            this.write(chunk, encoding);
        }

        if (Array.isArray(this.#data)) {
            this.#data = Buffer.concat(this.#data);
        }

        const result = {
            statusCode: this.statusCode,
            isBase64Encoded,
            body: this.#data?.toString(isBase64Encoded ? "base64" : "utf8") || "",
        };

        if (this.lambdaEvent.multiValueHeaders) {
            result.multiValueHeaders = {};
            for (const key in headers) {
                const val = headers[key];
                result.multiValueHeaders[key] = Array.isArray(val) ? val : [val];
            }
        } else {
            result.headers = {};
            for (const key in headers) {
                const val = headers[key];
                result.headers[key] = this.elb ? val[0] :
                                      Array.isArray(val) ? val.join("; ") : val;
            }
        }

        if (this.v2) {
            result.cookies = this.getHeader("set-cookie") ?? [];
            delete result.headers?.["set-cookie"];
        }

        this.result = result;

        this.lambdaEvent = undefined;
        this.lambdaContext = undefined;
        this.emit("finish");
    }
}

function encodeHeader(value)
{
    return /[^\x00-\x7F]/.test(value) ? encodeURIComponent(value) : value;
}


Object.defineProperty(aws, "APIGatewayEventPayload1", { value: APIGatewayEventPayload1 });
Object.defineProperty(aws, "APIGatewayEventPayload2", { value: APIGatewayEventPayload2 });

aws.APIGatewayRequest = APIGatewayRequest;
aws.APIGatewayResponse = APIGatewayResponse;

