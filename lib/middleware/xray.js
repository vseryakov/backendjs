/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const app = require(__dirname + '/../app');
const metrics = require(__dirname + '/../metrics');

/**
  * @module middleware/xray
  */

const mod = {
    name: "middleware.xray",
    args: [
        { name: "path", type: "regexpobj", descr: "Trace only if matched request path" },
        { name: "interval", type: "number", descr: "Interval in ms how often to trace requests, must be > 0 to enable tracing" },
        { name: "host", descr: "Host where to send traces" },
    ],
    _time: 0,
};

/**
 * Tracing middleware, if matched creates AWS X-Ray tracing as `context.trace`
 * @example
 * middleware-xray-path = ^/app
 *
 * middleware-xray-interval = 60000
 *
 */

module.exports = mod;

/**
 * Initialize tracing and metrics
 * @param {RequestContext} context
 * @param {function} next
 * @memberof module:middleware/xray
 * @method handle
 */

mod.handle = function(context, next)
{
    if (mod.interval > 0 &&
        mod.path?.rx &&
        context.time - mod._time > mod.interval &&
        mod.path.rx.test(context.path)) {

        var opts = {
            _host: mod.host,

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

        if (app.env.type == "aws") {
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

        mod._time = context.time;
    }

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
    delete context.trace;
}
