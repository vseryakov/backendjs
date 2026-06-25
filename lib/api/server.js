/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const domain = require("node:domain");
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const metrics = require(__dirname + '/../metrics');
const RequestContext = api.RequestContext = require(__dirname + '/context');

/**
 * Create a Web server with options and request handler, returns a server object.
 *
 * Options can have the following properties:
 * @param {int} port - port number is required
 * @param {string} [bind] - address to bind
 * @param {string} [restart] - name of the processes to restart on address in use error, usually "web"
 * @param {objext} [ssl] - an object with SSL options for TLS createServer call
 * @param {int} [timeout] - number of idle milliseconds for the request to close
 * @param {int} [keepAliveTimeout] - number of milliseconds to keep the HTTP connecton alive
 * @param {int} [requestTimeout] - number of milliseconds to receive the entire request from the client
 * @param {int} [maxRequestsPerSocket] - number of requests a socket can handle before closing keep alive connection
 * @param {int} [maxHeaderSize] - maximum length of request headers in bytes
 * @param {boolean} [reusePort] - allows multiple sockets on the same host to bind to the same port
 * @param {string} [name] - server name to be assigned
 * @memberof module:api
 * @method createServer
 */
api.createServer = function(options, callback)
{
    if (!options?.port) {
        logger.error("createWebServer:", "api", "invalid options:", options);
        return null;
    }
    var server;
    if (options.ssl) {
        const opts = lib.clone(options.ssl);
        for (const p in options) if (p !== "ssl") opts[p] = options[p];
        server = https.createServer(opts, callback);
    } else {
        server = http.createServer(options, callback);
    }
    if (options.timeout) {
        server.timeout = options.timeout;
    }
    server.serverPort = options.port;
    if (options.name) {
        server.serverName = options.name;
    }
    if (options.keepAliveTimeout) {
        server.keepAliveTimeout = options.keepAliveTimeout;
        server.headersTimeout = Math.round(options.keepAliveTimeout * 1.25);
    }
    server.requestTimeout = options.requestTimeout || 0;
    server.maxRequestsPerSocket = options.maxRequestsPerSocket || 0;
    server.on('error', (err) => {
        logger.error("createWebServer:", "api", app.role, 'port:', options.port, lib.traceError(err));
        // Restart backend processes on address in use
        if (err.code === 'EADDRINUSE' && options.restartProcess) {
            app.killBackend(options.restartProcess, "SIGKILL", () => { process.exit(0) });
        }
    });

    try {
        server.listen({
            port: options.port,
            host: options.bind,
            backlog: options.backlog,
            reusePort: options.reusePort,
        });
    } catch (e) {
        logger.error("createWebServer:", "api", options, e);
        server = null;
    }
    logger.log("createWebServer:", "api", options);
    return server;
}

/**
  * Fatal error handler
  * @memberof module:api
  * @private
  */
function onFatal(context, err)
{
    onError(context, err);

    if (api.exitOnError) {
        app.exit();
    }
}

/**
 * Report an error and close the context
 * @memberof module:api
 * @private
 */
function onError(context, err)
{
    logger.error('onError:', "api", context, lib.traceError(err));
    context.reply(err);
    context.destroy();
}

/**
  * Finish the request and clear the context, metrics collection
  * @memberof module:api
  * @private
  */
function onEnd(context, end, chunk, encoding)
{
    const res = context.res;

    res.end = lib.noop;
    end.call(res, chunk, encoding);

    context.destroy();

    api.metrics.running--;

    if (res.statusCode) {
        metrics.incr(api.metrics, res.statusCode + "_count");
    }
    if (res.statusCode >= 400 && res.statusCode < 500) {
        api.metrics.bad_count++;
    }
    if (res.statusCode >= 500) {
        api.metrics.err_count++;
    }

    logger.dev('onEnd:', "api", context, metrics);
}

/**
  * Start server request processing, setup the context and access logging ad the end.
  * - `api.app.handle` must be a valid `function(context, next)`
  * - `api.handleMode`:
  *   - undefined - call handle directly, on caught error restart the process if enabled
  *   - "domain" - run inside a domain to catch all async exceptions, config as `api-handle-mode = domain`, on error restart the process if enabled
  *   - "als" - wrap request inside `lib.als` async store, config as `api-handle-mode = als`, on error just report and close the context,
  *       @{link module:lib.tryCatch} uses `lib.als` to emit error events
  * @param {IncomingRequest} req
  * @param {OutgoingMessage} res
  * @param {function} [next]
  * @memberof module:api
  * method handleRequest
  */
api.handleRequest = function(req, res)
{
    logger.dev("handleRequest:", "api", req.url);

    res.setHeader('server', api.version);

    // Monitor request queue size
    if (api.maxRequests && api.metrics.running >= api.maxRequests) {
        logger.debug("handleRequest:", "api", req.url, "busy:", api.maxRequests, api.metrics.running, api.metrics.busy_count);
        api.metrics.busy_count++;
        res.statusCode = 503;
        res.end();
        return;
    }

    api.metrics.que.update(++api.metrics.running);

    const context = new RequestContext(req, res, { trustProxy: api.trustProxy });
    context.on("destroy", api.writeAccesslog);
    context.on("error", onError.bind(null, context));

    res.end = onEnd.bind(null, context, res.end);

    try {
        switch (api.runMode) {
        case "domain":
            const d = domain.create();
            d.add(req);
            d.add(res);
            d.on('error', onFatal.bind(null, context));
            d.run(api.app.handle.bind(api.app), context);
            break;

        case "als":
            // tryCatch will send error signal to the context
            lib.als.run(context, api.app.handle.bind(api.app), context);
            break;

        default:
            api.app.handle(context);
        }
    } catch (err) {
        onFatal(context, err);
    }
}

