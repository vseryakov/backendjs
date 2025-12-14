
const perf_hooks = require("perf_hooks");

module.exports = class Histogram {

    /**
    *  - Histogram - Keeps a resevoir of statistically relevant values biased towards the last 5 minutes to explore their distribution
    *    - count: The number of observed values.
    *    - min: The lowest observed value.
    *    - max: The highest observed value.
    *    - mean: The average of all observed values.
    *    - dev: The standard deviation of all observed values.
    *    - med: median, 50% of all values in the resevoir are at or below this value.
    *    - p75: See median, 75% percentile.
    *    - p95: See median, 95% percentile.
    *    - p99: See median, 99% percentile.
    *    - p999: See median, 99.9% percentile.
    * @param {object} [options]
    * @class Histogram
    */
    constructor(options) {
        if (options?.reset) this._reset = options?.reset;
        this._handle = perf_hooks.createHistogram();
    }

    update(value) {
        this.lastUpdate = Date.now();
        this._handle.record(typeof value == "number" && value > 0 ? value : 1);
    }

    reset() {
        this._handle.reset();
    }

    toJSON(options) {
        this.lastJSON = Date.now();

        const rc = {
            count: this._handle.count,
            min: this._handle.min,
            max: this._handle.max,
            mean: this._handle.mean,
            dev: this._handle.stddev,
            med: this._handle.percentile(50),
            p25: this._handle.percentile(25),
            p75: this._handle.percentile(75),
            p95: this._handle.percentile(95),
            p99: this._handle.percentile(99),
        };
        if (this._reset || options?.reset) this.reset();
        return rc;
    }
}

