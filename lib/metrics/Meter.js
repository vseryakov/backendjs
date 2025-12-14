
const ExponentiallyMovingWeightedAverage = require('./ExponentiallyMovingWeightedAverage');


module.exports = class Meter {

    /**
    * - Meter - Things that are measured as events / interval.
    *   - count: The total of all values added to the meter.
    *   - rate: The rate of the meter since the last toJSON() call.
    *   - mean: The average rate since the meter was started.
    *   - m1: The rate of the meter biased towards the last 1 minute.
    *   - m5: The rate of the meter biased towards the last 5 minutes.
    *   - m15: The rate of the meter biased towards the last 15 minutes.
    * @param {object} [options]
    * @class Meter
    */
    constructor(options) {
        if (options?.reset) this._reset = options?.reset;
        this._unit = options?.unit || 1000;
        this._interval = options?.interval || 5000;
        this._init();
    }

    _init() {
        this._m1Rate = new ExponentiallyMovingWeightedAverage(60000, this._interval);
        this._m5Rate = new ExponentiallyMovingWeightedAverage(5 * 60000, this._interval);
        this._m15Rate = new ExponentiallyMovingWeightedAverage(15 * 60000, this._interval);
        this._count = this._sum = 0;
    }

    mark(value) {
        if (!this._timer) this.start();
        value = typeof value == "number" && value || 1;
        this._count += value;
        this._sum += value;
        this._m1Rate.update(value);
        this._m5Rate.update(value);
        this._m15Rate.update(value);
        this.lastMark = Date.now();
    }

    start() {
        clearInterval(this._timer);
        this._timer = setInterval(this._tick.bind(this), this._interval);
        this.startTime = this.lastJSON = this.lastMark = Date.now();
    }

    end() {
        clearInterval(this._timer);
        delete this._timer;
    }

    _tick() {
        this._m1Rate.tick();
        this._m5Rate.tick();
        this._m15Rate.tick();
    }

    reset() {
        this.end();
        this._init();
    }

    meanRate() {
        if (this._count === 0) return 0;
        return this._count / (Date.now() - this.startTime) * this._unit;
    }

    currentRate() {
        var now = Date.now();
        var duration = now - this.lastJSON;
        var rate = duration ? this._sum / duration * this._unit : 0;
        this._sum = 0;
        this.lastJSON = now;
        return rate;
    }

    toJSON(options) {
        const rc = {
            count: this._count,
            rate: this.currentRate(),
            mean: this.meanRate(),
            m1: this._m1Rate.rate(this._unit),
            m5: this._m5Rate.rate(this._unit),
            m15: this._m15Rate.rate(this._unit),
        };
        if (this._reset || options?.reset) this.reset();
        return rc;
    }

}

