
const lib = require("../lib");
const logger = require("../logger");

module.exports = class Trace {

    static #sock;

    /**
    * AWS X-Ray trace support
    *
    * Only supports local daemon UDP port 2000, to test locally
    *
    *    socat -U -v PIPE  udp-recv:2000
    *
    * @example
    *
    * var trace = new metrics.Trace({ _host: "127.0.0.1", annotations: { tag: app.onstance.tag, role: app.role } });
    * var sub1 = trace.start("subsegment1");
    * sub1.stop();
    * var sub2 = trace.start("subsegment2");
    * trace.stop(req);
    * trace.send();
    * trace.destroy();
    * @param {object} [options]
    * @param {Trqce} [parent]
    * @class Trace
    */

    constructor(options, parent)
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

    /**
     * Closes a segment or subsegment, for segments it sends it right away
     * @param {IncomingRequest} [req]
     * @memberOf Trace
     * @method stop
     */
    stop(req)
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

    /**
     * destroy all traces and subsegments
     * @method destroy
     * @memberOf Trace
     */
    destroy()
    {
        for (const i in this.subsegments) {
            this.subsegments[i].destroy();
        }
        for (const p in this) {
            if (typeof this[p] == "object") delete this[p];
        }
    }

    /**
     * @method toString
     * @memberOf Trace
     */
    toString(msg)
    {
        return lib.stringify(msg || this, (key, val) => (key[0] == "_" ? undefined : val))
    }


    /**
     * Sends a segment to local daemon
     * @memberOf Trace
     * @method send
     */
    send(msg)
    {
        if (!Trace.#sock) {
            Trace.#sock = require("node:dgram").createSocket('udp4').unref();
        }

        var json = this.toString(msg);

        Trace.#sock.send(`{"format":"json","version":1}\n${json}`, this._port || 2000, this._host, (err) => {
            logger.logger(err ? "error": "debug", "trace", "send:", err, json);
        });
    }

    /**
     * Starts a new subsegment
     * @param {object} [options]
     * @memberOf Trace
     * @method start
     */
    start(options)
    {
        var sub = new Trace(options, this);
        if (!this.subsegments) this.subsegments = [];
        this.subsegments.push(sub);
        return sub;
    }

}
