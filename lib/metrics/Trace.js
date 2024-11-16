// AWS X-Ray trace support
//
// Only supports local daemon UDP port 2000, to test locally
//
//    socat -U -v PIPE  udp-recv:2000
//
// Example:
//
//        var trace = new metrics.Trace({ annotations: { tag: core.onstance.tag, role: core.role } });
//        var sub1 = trace.start("subsegment1");
//        sub1.stop();
//        var sub2 = trace.start("subsegment2");
//        trace.stop(req);
//        trace.send();
//        trace.destroy();
//

const lib = require("../lib");
const logger = require("../logger");

module.exports = Trace;
function Trace(options, parent)
{
    if (parent instanceof Trace) {
        this._parent = parent;
    } else {
        this.trace_id = `1-${Math.round(new Date().getTime() / 1000).toString(16)}-${lib.randomBytes(12)}`;
    }
    this.id = lib.randomBytes(8);

    this._start = Date.now();
    this.start_time = this._start / 1000;

    if (typeof options == "string") {
        this.name = options;
    } else {
        for (const p in options) {
            if (this[p] === undefined) this[p] = options[p];
        }
    }
    if (!this.name) this.name = process.title.split(/[^a-z0-9_-]/i)[0];
}

// Closes a segment or subsegment, for segments it sends it right away
Trace.prototype.stop = function(req)
{
    if (!this.end_time) {
        this._end = Date.now();
        this.end_time = this._end / 1000;
    }

    if (req?.res?.statusCode) {
        this.http = {
            request: {
                method: req.method || "GET",
                url: `http${req.options.secure}://${req.options.host}${req.url}`,
            },
            response: {
                status: req.res.statusCode
            }
        }
    }
    for (const i in this.subsegments) this.subsegments[i].stop();
}

Trace.prototype.destroy = function()
{
    for (const i in this.subsegments) this.subsegments[i].destroy();
    for (const p in this) if (typeof this[p] == "object") delete this[p];
}

Trace.prototype.toString = function(msg)
{
    return lib.stringify(msg || this, (key, val) => (key[0] == "_" ? undefined : val))
}

var _sock;

// Sends a segment to local daemon
Trace.prototype.send = function(msg)
{
    if (!_sock) {
        _sock = require("node:dgram").createSocket('udp4').unref();
    }

    var json = this.toString(msg);

    _sock.send(`{"format":"json","version":1}\n${json}`, 2000, (err) => {
        logger.logger(err ? "error": "debug", "trace", "send:", err, json);
    });
}

// Starts a new subsegment
Trace.prototype.start = function(options)
{
    var sub = new Trace(options, this);
    if (!this.subsegments) this.subsegments = [];
    this.subsegments.push(sub);
    return sub;
}

