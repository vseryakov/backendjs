/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const app = require(__dirname + '/../app');
const metrics = require(__dirname + '/../metrics');

/**
  * @module middleware/xray
  */

const mod = {
    name: "middleware.xray",
    args: [
        { name: "path", type: "regexp", descr: "Trace only if request path match" },
        { name: "interval", type: "number", descr: "Interval in ms how often to trace requests, must be > 0 to enable tracing" },
        { name: "host", descr: "Host where to send traces" },
    ],
    _time: 0,
};

/**
 * Tracing middleware, if matched the path and interval is set it sends AWS X-Ray traces to the configured remote or local host listening
 * on UDP port 2000.
 *
 * Traces are sent only every interval in ms as long as it is greater than 0.
 *
 * Trace instance is exposed as `context.trace` and implements {@link Trace}
 *
 * ## Global usage
 *
 * Config:
 * ```
 * middleware-xray-path = ^/app
 * middleware-xray-interval = 60000
 * ```
 *
 * ```js
 * api.app.get("/api/endpoint", middleware.xray)
 * ```
 *
 * ## Explicit routing
 *
 * Add explicit routes with different tracing options
 *
 * ```js
 * api.app.get("/api/endpoint", middleware.xray.handle.bind({ path: /^\//, interval: 1000 }))
 * ```
 *
 */

module.exports = mod;

/**
 * Tracing middleware
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/xray
 * @method handle
 */

mod.handle = function(context, next)
{
    if (!this.interval ||
        context.time - (this._time ?? 0) < this.interval ||
        typeof this.path?.test !== "function" ||
        !this.path.test(context.path)) {
        return next();
    }

    var opts = {
        _host: this.host,

        service: {
            version: app.version,
        },
        annotations: {
            pid: process.pid,
            reqId: context.reqID,
            tag: app.env.tag || app.id,
            role: app.role,
            roles: app.env.roles,
        }
    };

    if (app.env.type === "aws") {
        opts.aws = {};
        if (app.env.container) {
            opts.aws.ecs = {
                container: app.env.container,
                container_id: app.env.container_id,
            };
        }
        if (app.env.image) {
            opts.aws.ec2 = {
                instance_id: app.env.id,
                ami_id: app.env.image,
            };
        }
    }
    context.trace = new metrics.Trace(opts);
    context.on("destroy", destroy);

    this._time = context.time;

    next();
}

function destroy(context)
{
    if (!context?.trace?.stop) return;

    context.trace.stop({
        statusCode: context.res?.statusCode,
        method: context.method,
        url: context.url,
        host: context.host
    });
    context.trace.send();
    context.trace.destroy();
    context.trace = undefined;
}
