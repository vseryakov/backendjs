//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
// Based on https://github.com/felixge/node-measured
//

// - Meter - Things that are measured as events / interval.
//   - count: The total of all values added to the meter.
//   - rate: The rate of the meter since the last toJSON() call.
//   - mean: The average rate since the meter was started.
//   - m1: The rate of the meter biased towards the last 1 minute.
//   - m5: The rate of the meter biased towards the last 5 minutes.
//   - m15: The rate of the meter biased towards the last 15 minutes.
//
//  - Histogram - Keeps a resevoir of statistically relevant values biased towards the last 5 minutes to explore their distribution
//    - min: The lowest observed value.
//    - max: The highest observed value.
//    - sum: The sum of all observed values.
//    - var: The variance of all observed values.
//    - mean: The average of all observed values.
//    - dev: The standard deviation of all observed values.
//    - count: The number of observed values.
//    - med: median, 50% of all values in the resevoir are at or below this value.
//    - p75: See median, 75% percentile.
//    - p95: See median, 95% percentile.
//    - p99: See median, 99% percentile.
//    - p999: See median, 99.9% percentile.

const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');
const perf_hooks = require("perf_hooks");

exports.name = "metrics";

// Increments a counter in an object, creates a new var if not exist
exports.incr = function(obj, name, count)
{
    if (!obj[name]) obj[name] = 0;
    obj[name] += typeof count == "number" && count || 1;
    return obj[name];
}

// Returns all properties in an object, convert all metrics if necessary
exports.toJSON = function(obj)
{
    var json = {};
    for (const p in obj) {
        if (typeof obj[p] == "undefined" || typeof obj[p] == "function" || obj[p] === null) continue;
        json[p] = typeof obj[p].toJSON == "function" ? obj[p].toJSON() : obj[p];
    }
    return json;
}

exports.ExponentiallyMovingWeightedAverage = ExponentiallyMovingWeightedAverage;
function ExponentiallyMovingWeightedAverage(rateUnit, tickInterval)
{
    this._rateUnit = rateUnit || 60000;
    this._tickInterval = tickInterval || 5000;
    this._alpha = 1 - Math.exp(-this._tickInterval / this._rateUnit);
    this._count = 0;
    this._rate = 0;
}

ExponentiallyMovingWeightedAverage.prototype.update = function(n)
{
    this._count += n;
}

ExponentiallyMovingWeightedAverage.prototype.tick = function()
{
    this._rate += this._alpha * ((this._count / this._tickInterval) - this._rate);
    this._count = 0;
}

ExponentiallyMovingWeightedAverage.prototype.rate = function(timeUnit)
{
    return this._rate * timeUnit || 0;
}

exports.Meter = Meter;
function Meter(options)
{
    this._rateUnit = options?.rateUnit || 1000;
    this._tickInterval = options?.tickInterval || 5000;
    this._ttl = options?.ttl;
    this._m1Rate = new ExponentiallyMovingWeightedAverage(60000, this._tickInterval);
    this._m5Rate = new ExponentiallyMovingWeightedAverage(5 * 60000, this._tickInterval);
    this._m15Rate = new ExponentiallyMovingWeightedAverage(15 * 60000, this._tickInterval);
    this._count = this._currentSum = 0;
}

Meter.prototype.mark = function(value)
{
    if (!this._interval) this.start();
    value = typeof value == "number" && value || 1;
    this._count += value;
    this._currentSum += value;
    this._m1Rate.update(value);
    this._m5Rate.update(value);
    this._m15Rate.update(value);
    this._lastMark = Date.now();
};

Meter.prototype.start = function()
{
    clearInterval(this._interval);
    this._interval = setInterval(this._tick.bind(this), this._tickInterval);
    this._startTime = this._lastToJSON = this._lastMark = Date.now();
}

Meter.prototype.end = function()
{
    clearInterval(this._interval);
    delete this._interval;
}

Meter.prototype._tick = function()
{
    this._m1Rate.tick();
    this._m5Rate.tick();
    this._m15Rate.tick();

    if (this._ttl > 0 && Date.now() - this._lastMark > this._ttl) {
        this.end();
    }
}

Meter.prototype.reset = function()
{
    this.end();
    this.constructor.call(this);
}

Meter.prototype.meanRate = function()
{
    if (this._count === 0) return 0;
    return this._count / (Date.now() - this._startTime) * this._rateUnit;
}

Meter.prototype.currentRate = function()
{
    var now = Date.now();
    var duration = now - this._lastToJSON;
    var currentRate = duration ? this._currentSum / duration * this._rateUnit : 0;
    this._currentSum = 0;
    this._lastToJSON = now;
    return currentRate;
}

Meter.prototype.toJSON = function()
{
    return {
        count: this._count,
        rate: this.currentRate(),
        mean: this.meanRate(),
        m1: this._m1Rate.rate(this._rateUnit),
        m5: this._m5Rate.rate(this._rateUnit),
        m15: this._m15Rate.rate(this._rateUnit),
    };
};

exports.Histogram = Histogram;
function Histogram(options)
{
    this._handle = perf_hooks.createHistogram();
}

Histogram.prototype.update = function(value)
{
    this._handle.record(value = typeof value == "number" && value || 1);
}

Histogram.prototype.reset = function()
{
    this._handle.reset();
}

Histogram.prototype.toJSON = function()
{
    return {
        count: this._handle.count,
        min: this._handle.min,
        max: this._handle.max,
        mean: this._handle.mean,
        dev: this._handle.stddev,
        med: this._handle.percentile(50),
        p75: this._handle.percentile(75),
        p95: this._handle.percentile(95),
        p99: this._handle.percentile(99),
    };
}

exports.Timer = Timer;
function Timer(options)
{
    this._meter = new Meter(options);
    this._histogram = new Histogram(options);
}

Timer.prototype.start = function(value)
{
    var t = { start: Date.now(), count: value };
    t.end = this._endTimer.bind(t, this);
    return t;
}

Timer.prototype._endTimer = function(self)
{
    this.elapsed = Date.now() - this.start;
    self.update(this.elapsed, this.count);
    this.end = lib.noop;
    return this.elapsed;
}

Timer.prototype.update = function(time, count)
{
    this._histogram.update(time);
    this._meter.mark(count);
}

Timer.prototype.reset = function()
{
    this._meter.reset();
    this._histogram.reset();
}

Timer.prototype.end = function()
{
    this._meter.end();
}

Timer.prototype.toJSON = function()
{
    return {
        meter: this._meter.toJSON(),
        histogram: this._histogram.toJSON()
    }
}

// Create a Token Bucket object for rate limiting as per http://en.wikipedia.org/wiki/Token_bucket
//  - rate - the rate to refill tokens
//  - max - the maximum burst capacity
//  - interval - interval for the bucket refills, default 1000 ms
//
// Store as an array for easier serialization into JSON when keep it in the shared cache.
//
// Based on https://github.com/thisandagain/micron-throttle
//
exports.TokenBucket = TokenBucket;
function TokenBucket(rate, max, interval)
{
    this.configure(rate, max, interval);
}

// Initialize existing token with numbers for rate calculations
TokenBucket.prototype.configure = function(rate, max, interval, total)
{
    if (Array.isArray(rate)) {
        this._rate = lib.toNumber(rate[0]);
        this._max = lib.toNumber(rate[1]);
        this._count = lib.toNumber(rate[2]);
        this._time = lib.toNumber(rate[3]);
        this._interval = lib.toNumber(rate[4]);
        this._total = lib.toNumber(rate[5]);
    } else
    if (typeof rate == "object" && rate.rate) {
        this._rate = lib.toNumber(rate.rate);
        this._max = lib.toNumber(rate.max);
        this._count = lib.toNumber(rate.count);
        this._time = lib.toNumber(rate.time);
        this._interval = lib.toNumber(rate.interval);
        this._total = lib.toNumber(rate.total);
    } else {
        this._rate = lib.toNumber(rate, { min: 0 });
        this._max = lib.toNumber(max, { min: 0 }) || this._rate;
        this._count = this._max;
        this._time = Date.now();
        this._interval = lib.toNumber(interval, { min: 0 }) || 1000;
        this._total = lib.toNumber(total, { min: 0 });
    }
}

// Return a JSON object to be serialized/saved
TokenBucket.prototype.toJSON = function()
{
    return { rate: this._rate, max: this._max, count: this._count, time: this._time, interval: this._interval, total: this._total };
}

// Return a string to be serialized/saved
TokenBucket.prototype.toString = function()
{
    return this.toArray().join(",");
}

// Return an array object to be serialized/saved
TokenBucket.prototype.toArray = function()
{
    return [this._rate, this._max, this._count, this._time, this._interval, this._total];
}

// Return true if this bucket uses the same rates in arguments
TokenBucket.prototype.equal = function(rate, max, interval)
{
    rate = lib.toNumber(rate, { min: 0 });
    max = lib.toNumber(max || rate, { min: 0 });
    interval = lib.toNumber(interval || 1000, { min: 1 });
    return this._rate === rate && this._max === max && this._interval == interval;
}

// Consume N tokens from the bucket, if no capacity, the tokens are not pulled from the bucket.
//
// Refill the bucket by tracking elapsed time from the last time we touched it.
//
//      min(totalTokens, current + (fillRate * elapsedTime))
//
TokenBucket.prototype.consume = function(tokens)
{
    var now = Date.now();
    if (now < this._time) this._time = now - this._interval;
    this._elapsed = now - this._time;
    if (this._count < this._max) this._count = Math.min(this._max, this._count + this._rate * (this._elapsed / this._interval));
    this._time = now;
    if (typeof tokens != "number" || tokens < 0) tokens = 0;
    this._total += tokens;
    if (tokens > this._count) return false;
    this._count -= tokens;
    return true;
}

// Returns number of milliseconds to wait till number of tokens can be available again
TokenBucket.prototype.delay = function(tokens)
{
    return Math.max(0, this._interval - (tokens >= this._max ? 0 : this._elapsed));
}

// AWS X-Ray trace support
// sends only fully closed segments to the local daemon to UDP port 2000

exports.Trace = Trace;
function Trace(options)
{
    this.name = options?.name || process.title;
    this.id = lib.randomBytes(8);
    this.trace_id = `1-${Math.round(new Date().getTime() / 1000).toString(16)}-${lib.randomBytes(12)}`;
    this.start_time = Date.now() / 1000;

    for (const p in options) {
        if (this[p] === undefined) this[p] = options[p];
    }
}

// Closes a segment or subsegment, for segments it sends it right away
Trace.prototype.stop = function(req)
{
    this.end_time = Date.now() / 1000;

    if (req?.res?.statusCode) {
        this.http = {
            request: {
                url: req.url,
            },
            response: {
                status: req.res.statusCode
            }
        }
    }
    for (const i in this.subsegments) {
        if (!this.subsegments[i].end_time) this.subsegments[i].end_time = Date.now() / 1000;
    }
    this.send();
}

var _sock;

// Sends a segment to local daemon
Trace.prototype.send = function()
{
    if (!_sock) {
        _sock = require("node:dgram").createSocket('udp4').unref();
    }

    const msg = `{"format":"json","version":1}\n` + lib.stringify(this);

    _sock.send(msg, 2000, (err) => {
        if (err) logger.error("trace", "send:", err);
    });
}

// Starts a new subsegment
Trace.prototype.start = function(name)
{
    var sub = {
        name: name,
        id: lib.randomBytes(8),
        start_time: Date.now() / 1000,
        stop: () => { sub.end_time = Date.now() / 1000; delete sub.stop }
    }
    if (!this.subsegments) this.subsegments = [];
    this.subsegments.push(sub);
    return sub;
}

