//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
// Based on https://github.com/felixge/node-measured
//

// - Meter - Things that are measured as events / interval.
//   - count: The total of all values added to the meter.
//   - rate: The rate of the meter since the last toJSON() call.
//   - rate_mean: The average rate since the meter was started.
//   - rate_1m: The rate of the meter biased towards the last 1 minute.
//   - rate_5m: The rate of the meter biased towards the last 5 minutes.
//   - rate_15m: The rate of the meter biased towards the last 15 minutes.
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
function ExponentiallyMovingWeightedAverage(timePeriod, tickInterval)
{
    this._timePeriod = timePeriod || 60000;
    this._tickInterval = tickInterval || 5000;
    this._alpha = 1 - Math.exp(-this._tickInterval / this._timePeriod);
    this._count = 0;
    this._rate = 0;
}

ExponentiallyMovingWeightedAverage.prototype.update = function(n)
{
    this._count += n;
}

ExponentiallyMovingWeightedAverage.prototype.tick = function()
{
    this._count = 0;
    this._rate += (this._alpha * ((this._count / this._tickInterval) - this._rate));
}

ExponentiallyMovingWeightedAverage.prototype.rate = function(timeUnit)
{
    return (this._rate || 0) * timeUnit;
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
    var currentRate = duration ? (this._currentSum / duration * this._rateUnit) : 0;
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

// Based on http://en.wikipedia.org/wiki/Binary_Heap as well as http://eloquentjavascript.net/appendix2.html
exports.BinaryHeap = BinaryHeap;
function BinaryHeap(options)
{
    this._elements = options?.elements || [];
    this._score = options?.score || this._score;
}

BinaryHeap.prototype.add = function(/* elements */)
{
    for (var i = 0; i < arguments.length; i++) {
        var element = arguments[i];
        this._elements.push(element);
        this._bubble(this._elements.length - 1);
    }
}

BinaryHeap.prototype.first = function()
{
    return this._elements[0];
}

BinaryHeap.prototype.removeFirst = function()
{
    var root = this._elements[0];
    var last = this._elements.pop();
    if (this._elements.length > 0) {
        this._elements[0] = last;
        this._sink(0);
    }
    return root;
}

BinaryHeap.prototype.clone = function()
{
    return new BinaryHeap({ elements: this.toArray(), score: this._score });
}

BinaryHeap.prototype.toSortedArray = function()
{
    var array = [];
    var clone = this.clone();

    while (true) {
        var element = clone.removeFirst();
        if (element === undefined) break;
        array.push(element);
    }
    return array;
}

BinaryHeap.prototype.toArray = function()
{
    return [].concat(this._elements);
}

BinaryHeap.prototype.size = function()
{
    return this._elements.length;
}

BinaryHeap.prototype._bubble = function(bubbleIndex)
{
    var bubbleElement = this._elements[bubbleIndex];
    var bubbleScore = this._score(bubbleElement);

    while (bubbleIndex > 0) {
        var parentIndex = this._parentIndex(bubbleIndex);
        var parentElement = this._elements[parentIndex];
        var parentScore = this._score(parentElement);
        if (bubbleScore <= parentScore) break;
        this._elements[parentIndex] = bubbleElement;
        this._elements[bubbleIndex] = parentElement;
        bubbleIndex = parentIndex;
    }
}

BinaryHeap.prototype._sink = function(sinkIndex)
{
    var sinkElement = this._elements[sinkIndex];
    var sinkScore = this._score(sinkElement);
    var length = this._elements.length;

    while (true) {
        var swapIndex = null;
        var swapScore = null;
        var swapElement = null;
        var childIndexes = this._childIndexes(sinkIndex);
        for (var i = 0; i < childIndexes.length; i++) {
            var childIndex = childIndexes[i];
            if (childIndex >= length) break;
            var childElement = this._elements[childIndex];
            var childScore = this._score(childElement);
            if (childScore > sinkScore) {
                if (swapScore === null || swapScore < childScore) {
                    swapIndex = childIndex;
                    swapScore = childScore;
                    swapElement = childElement;
                }
            }
        }
        if (swapIndex === null) break;
        this._elements[swapIndex] = sinkElement;
        this._elements[sinkIndex] = swapElement;
        sinkIndex = swapIndex;
    }
}

BinaryHeap.prototype._parentIndex = function(index)
{
    return Math.floor((index - 1) / 2);
}

BinaryHeap.prototype._childIndexes = function(index)
{
    return [ 2 * index + 1, 2 * index + 2 ];
}

BinaryHeap.prototype._score = function(element)
{
    return element.valueOf();
}

exports.ExponentiallyDecayingSample = ExponentiallyDecayingSample;
function ExponentiallyDecayingSample(options)
{
    this._elements = new BinaryHeap({ score: function(element) { return -element.priority; } });
    this._rescaleInterval = options?.rescaleInterval || 3600000;
    this._alpha = options?.alpha || 0.015;
    this._size = options?.size || 1028;
    this._landmark = null;
    this._nextRescale = null;
}

ExponentiallyDecayingSample.prototype.update = function(value, timestamp)
{
    var now = Date.now();
    if (!this._landmark) {
        this._landmark = now;
        this._nextRescale = this._landmark + this._rescaleInterval;
    }

    timestamp = timestamp || now;
    var newSize = this._elements.size() + 1;
    var element = { priority: this._priority(timestamp - this._landmark), value: value };

    if (newSize <= this._size) {
        this._elements.add(element);
    } else
    if (element.priority > this._elements.first().priority) {
        this._elements.removeFirst();
        this._elements.add(element);
    }
    if (now >= this._nextRescale) this._rescale(now);
}

ExponentiallyDecayingSample.prototype.toSortedArray = function()
{
    return this._elements.toSortedArray().map((element) => (element.value));
}

ExponentiallyDecayingSample.prototype.toArray = function()
{
    return this._elements.toArray().map((element) => (element.value));
}

ExponentiallyDecayingSample.prototype._weight = function(age)
{
    // We divide by 1000 to not run into huge numbers before reaching a rescale event.
    return Math.exp(this._alpha * (age / 1000));
}

ExponentiallyDecayingSample.prototype._priority = function(age)
{
    return this._weight(age) / this._random();
}

ExponentiallyDecayingSample.prototype._random = function()
{
    return Math.random();
}

ExponentiallyDecayingSample.prototype._rescale = function(now)
{
    now = now || Date.now();
    var self = this;
    var oldLandmark = this._landmark;
    this._landmark = now || Date.now();
    this._nextRescale = now + this._rescaleInterval;
    var factor = self._priority(-(self._landmark - oldLandmark));
    this._elements.toArray().forEach((element) => { element.priority *= factor });
}

exports.Histogram = Histogram;
function Histogram(options)
{
    this._sample = new ExponentiallyDecayingSample();
    this._min = null;
    this._max = null;
    this._count = 0;
    this._sum = 0;
    // These are for the Welford algorithm for calculating running variance without floating-point doom.
    this._varianceM = 0;
    this._varianceS = 0;
}

Histogram.prototype.update = function(value)
{
    value = typeof value == "number" && value || 1;
    this._count++;
    this._sum += value;
    this._sample.update(value);
    this._updateMin(value);
    this._updateMax(value);
    this._updateVariance(value);
}

Histogram.prototype.percentiles = function(percentiles)
{
    var values = this._sample.toArray().sort(function(a, b) { return (a === b) ? 0 : a - b; });

    var results = {};
    for (var i = 0; i < percentiles.length; i++) {
        var percentile = percentiles[i];
        if (!values.length) {
            results[percentile] = null;
            continue;
        }
        var pos = percentile * (values.length + 1);
        if (pos < 1) {
            results[percentile] = values[0];
        } else
        if (pos >= values.length) {
            results[percentile] = values[values.length - 1];
        } else {
            var lower = values[Math.floor(pos) - 1];
            var upper = values[Math.ceil(pos) - 1];
            results[percentile] = lower + (pos - Math.floor(pos)) * (upper - lower);
        }
    }
    return results;
}

Histogram.prototype.reset = function()
{
    this.constructor.call(this);
}

Histogram.prototype.toJSON = function()
{
    var percentiles = this.percentiles([ 0.5, 0.75, 0.95, 0.99, 0.999 ]);
    return {
        count: this._count,
        min: this._min,
        max: this._max,
        sum: this._sum,
        var: this._calculateVariance(),
        mean: this._calculateMean(),
        dev: this._calculateStddev(),
        med: percentiles[0.5],
        p75: percentiles[0.75],
        p95: percentiles[0.95],
        p99: percentiles[0.99],
        p999: percentiles[0.999],
    };
}

Histogram.prototype._updateMin = function(value)
{
    if (this._min === null || value < this._min) this._min = value;
}

Histogram.prototype._updateMax = function(value)
{
    if (this._max === null || value > this._max) this._max = value;
}

Histogram.prototype._updateVariance = function(value)
{
    if (this._count === 1) {
        this._varianceM = value;
    } else {
        var oldM = this._varianceM;
        this._varianceM += ((value - oldM) / this._count);
        this._varianceS += ((value - oldM) * (value - this._varianceM));
    }
}

Histogram.prototype._calculateMean = function()
{
    return this._count === 0 ? 0 : this._sum / this._count;
}

Histogram.prototype._calculateVariance = function()
{
    return this._count <= 1 ? null : this._varianceS / (this._count - 1);
}

Histogram.prototype._calculateStddev = function()
{
    return this._count < 1 ? null : Math.sqrt(this._calculateVariance());
}

exports.Timer = Timer;
function Timer(options)
{
    this._meter = options?.meter || new Meter(options);
    this._histogram = options?.histogram || new Histogram(options);
}

Timer.prototype.start = function(value)
{
    var t = { start: Date.now(), count: value };
    t.end = this.endTimer.bind(t, this);
    return t;
}

Timer.prototype.endTimer = function(self)
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
