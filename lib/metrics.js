//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2014
//
// Based on https://github.com/felixge/node-measured
//

var util = require("util");
var lib = require(__dirname + '/lib');

exports.Counter = Counter;
function Counter(properties)
{
    properties = properties || {};
    this._count = properties.count || 0;
}

Counter.prototype.toJSON = function()
{
    return this._count;
}

Counter.prototype.inc = function(n)
{
    this._count += lib.toNumber(n || 1);
    return this._count;
}

Counter.prototype.dec = function(n)
{
    this._count -= lib.toNumber(n || 1);
    return this._count;
}

Counter.prototype.reset = function(count)
{
    this._count = count || 0;
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
function Meter(properties)
{
    properties = properties || {};
    this._rateUnit = properties.rateUnit || 1000;
    this._tickInterval = properties.tickInterval || 5000;
    this._m1Rate = new ExponentiallyMovingWeightedAverage(60000, this._tickInterval);
    this._m5Rate = new ExponentiallyMovingWeightedAverage(5 * 60000, this._tickInterval);
    this._m15Rate = new ExponentiallyMovingWeightedAverage(15 * 60000, this._tickInterval);
    this._count = 0;
    this._currentSum = 0;
    this._lastToJSON = null;
    this._interval = null;
    this._startTime = null;
}

Meter.prototype.mark = function(n)
{
    if (!this._interval) this.start();
    n = lib.toNumber(n || 1);
    this._count += n;
    this._currentSum += n;
    this._m1Rate.update(n);
    this._m5Rate.update(n);
    this._m15Rate.update(n);
};

Meter.prototype.start = function()
{
    this._interval = setInterval(this._tick.bind(this), this._tickInterval);
    this._startTime = this._lastToJSON = Date.now();
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
        rate: this.currentRate(),
        rcount: this._count,
        rmean: this.meanRate(),
        r1m: this._m1Rate.rate(this._rateUnit),
        r5m: this._m5Rate.rate(this._rateUnit),
        r15m: this._m15Rate.rate(this._rateUnit),
    };
};

// Based on http://en.wikipedia.org/wiki/Binary_Heap as well as http://eloquentjavascript.net/appendix2.html
exports.BinaryHeap = BinaryHeap;
function BinaryHeap(options)
{
    options = options || {};
    this._elements = options.elements || [];
    this._score = options.score || this._score;
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
    return new BinaryHeap({ elements : this.toArray(), score : this._score });
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
    options = options || {};
    this._elements = new BinaryHeap({ score : function(element) { return -element.priority; } });
    this._rescaleInterval = options.rescaleInterval || 3600000;
    this._alpha = options.alpha || 0.015;
    this._size = options.size || 1028;
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
    var element = { priority : this._priority(timestamp - this._landmark), value : value };

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
    return this._elements.toSortedArray().map(function(element) { return element.value; });
}

ExponentiallyDecayingSample.prototype.toArray = function()
{
    return this._elements.toArray().map(function(element) { return element.value; });
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
    this._elements.toArray().forEach(function(element) { element.priority *= factor; });
}

exports.Histogram = Histogram;
function Histogram(properties)
{
    properties = properties || {};
    this._sample = properties.sample || new ExponentiallyDecayingSample();
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
    value = lib.toNumber(value);
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
        hmin: this._min,
        hmax: this._max,
        hsum: this._sum,
        hvar: this._calculateVariance(),
        hmean: this._calculateMean(),
        hdev: this._calculateStddev(),
        hcnt: this._count,
        hmed: percentiles[0.5],
        h75p: percentiles[0.75],
        h95p: percentiles[0.95],
        h99p: percentiles[0.99],
        h999p: percentiles[0.999],
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
    if (this._count === 1) return this._varianceM = value;
    var oldM = this._varianceM;
    this._varianceM += ((value - oldM) / this._count);
    this._varianceS += ((value - oldM) * (value - this._varianceM));
}

Histogram.prototype._calculateMean = function()
{
    return (this._count === 0) ? 0 : this._sum / this._count;
}

Histogram.prototype._calculateVariance = function()
{
    return (this._count <= 1) ? null : this._varianceS / (this._count - 1);
}

Histogram.prototype._calculateStddev = function()
{
    return (this._count < 1) ? null : Math.sqrt(this._calculateVariance());
}

exports.Timer = Timer;
function Timer(properties)
{
    properties = properties || {};
    this._meter = properties.meter || new Meter;
    this._histogram = properties.histogram || new Histogram;
}

Timer.prototype.start = function()
{
    var t = { start: Date.now() };
    t.end = this.endTimer.bind(t, this);
    return t;
}

Timer.prototype.endTimer = function(self)
{
    this.elapsed = Date.now() - this.start;
    self.update(this.elapsed);
    this.end = lib.noop;
    return this.elapsed;
}

Timer.prototype.update = function(value)
{
    this._meter.mark();
    this._histogram.update(value);
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
    var result = this._meter.toJSON();
    var json = this._histogram.toJSON();
    for (var key in json) result[key] = json[key];
    return result;
}

exports.Metrics = Metrics;
function Metrics()
{
    for (var i = 0; i < arguments.length - 1; i+= 2) this[arguments[i]] = arguments[i + 1];
}

Metrics.prototype.toJSON = function()
{
    var json = {};
    for (var p in this) {
        if (typeof this[p] == "undefined" || typeof this[p] == "function" || this[p] === null) continue;
        json[p] = this[p].toJSON ? this[p].toJSON() : this[p];
    }
    return json;
}

Metrics.prototype.find = function(filter, list)
{
    if (!list) list = [];
    for (var p in this) {
        if (filter.test(p)) list.push(this[p]);
        if (this[p] && typeof this[p].find == "function") this[p].find(filter, list);
    }
    return list;
}

Metrics.prototype.call = function(name, filter)
{
    if (util.isRegExp(filter)) {
        this.find(filter).forEach(function(x) {
            if (typeof x[name] == "function") x[name]();
        });
    } else {
        for (var p in this) {
            if (this[p] && typeof this[p][name] == "function") this[p][name]();
        }
    }
}

Metrics.prototype.reset = function(filter)
{
    this.call("reset", filter);
}

Metrics.prototype.end = function(filter)
{
    this.call("end", filter);
}

Metrics.prototype.destroy = function(name)
{
    if (!this[name]) return;
    if (typeof this[name].end == "function") this[name].end();
    delete this[name];
}

Metrics.prototype.Counter = function(name, properties)
{
    if (!this[name]) this[name] = new Counter(properties);
    return this[name];
}

Metrics.prototype.Timer = function(name, properties)
{
    if (!this[name]) this[name] = new Timer(properties);
    return this[name];
}

Metrics.prototype.Meter = function(name, properties)
{
    if (!this.metrics[name]) this.metrics[name] = new Meter(properties);
    return this.metrics[name];
}

Metrics.prototype.Histogram = function(name, properties)
{
    if (!this[name]) this[name] = new Histogram(properties);
    return this[name];
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
TokenBucket.prototype.configure = function(rate, max, interval)
{
    if (Array.isArray(rate)) {
        this._rate = lib.toNumber(rate[0], { min: 0 });
        this._max = lib.toNumber(rate[1] || this._rate, { min: 0 });
        this._count = lib.toNumber(rate[2] || this._max);
        this._time = lib.toNumber(rate[3] || Date.now());
        this._interval = lib.toNumber(rate[4] || 1000, { min: 1 });
    } else
    if (typeof rate == "object" && rate.rate) {
        this._rate = lib.toNumber(rate.rate , { min: 0 });
        this._max = lib.toNumber(rate.max || this._rate, { min: 0 });
        this._count = lib.toNumber(rate.count || this._max);
        this._time = lib.toNumber(rate.time || Date.now());
        this._interval = lib.toNumber(rate.interval || 1000, { min: 1 });
    } else {
        this._rate = lib.toNumber(rate, { min: 0 });
        this._max = lib.toNumber(max || this._rate, { min: 0 });
        this._count = this._max;
        this._time = Date.now();
        this._interval = interval || 1000;
    }
}

// Return a JSON object to be serialized/saved
TokenBucket.prototype.toJSON = function()
{
    return { rate: this._rate, max: this._max, count: this._count, time: this._time, interval: this._interval };
}

// Return a string to be serialized/saved
TokenBucket.prototype.toString = function()
{
    return this._rate + "," + this._max + "," + this._count + "," + this._time + "," + this._interval;
}

// Return an array object to be serialized/saved
TokenBucket.prototype.toArray = function()
{
    return [this._rate, this._max, this._count, this._time, this._interval];
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
    if (tokens > this._count) return false;
    this._count -= tokens;
    return true;
}

// Returns number of milliseconds to wait till number of tokens can be available again
TokenBucket.prototype.delay = function(tokens)
{
    return Math.max(0, this._interval - (tokens >= this._max ? 0 : this._elapsed));
}
