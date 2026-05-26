/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const domain = require("node:domain");
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const metrics = require(__dirname + '/../metrics');
const RequestContext = api.RequestContext = require(__dirname + '/context');

function onError(req, res, err)
{
    logger.error('handleServerRequest:', "api", req.context, lib.traceError(err));

    if (!res.headersSent) {
        api.sendReply(req, err);
    }
    api.writeAccesslog(req.context);
    req.context?.destroy();

    if (api.exitOnError) {
        app.exit();
    }
}

/**
 * run cleanup hooks and clear the request explicitly, finish metrics collection
 */
function onEnd(req, res, end, chunk, encoding)
{
    res.end = end;
    res.end(chunk, encoding);

    api.writeAccesslog(req.context);
    req.context.destroy();

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
}

/**
 * Start server request processing, setup the context and access logging ad the end.
 * - `api.app` must be a valid function, default or other like Express app to handle requests
 * - `api.useDomain` is set then processing runs inside a domain to catch all async exceptions, it can be set in config as `api-use-domain = 1`
 * @param {object} req
 * @param {object} res
 * @method handleRequest
 * @memberof module:api
 */
api.handleRequest = function(req, res)
{
    logger.dev("handleRequest:", "api", req.url);

    res.setHeader('Server', api.version);

    // Monitor request queue size
    if (api.maxRequests && api.metrics.running >= api.maxRequests) {
        api.metrics.busy_count++;
        res.statusCode = 503;
        res.end();
        return;
    }

    api.metrics.que.update(++api.metrics.running);

    req.context = new RequestContext(req, res, { trustProxy: api.trustProxy });

    res.end = onEnd.bind(null, req, res, res.end);

    if (api.useDomain) {
        const d = domain.create();
        d.on('error', onError.bind(null, req, res));
        d.add(req);
        d.add(res);
        d.run(api.app, req, res);
    } else {
        try {
            api.app(req, res);
        } catch (err) {
            onError(req, res, err);
        }
    }
}

/**
 * Default middleware application and router
 *
 * @memberof module:api
 * @method app
 */
api.app = function(req, res)
{

}

