//
// Timers are a combination of Meters and Histograms.
// They measure the rate as well as distribution of scalar events.


const Meter = require("./Meter");
const Histogram = require("./Histogram");

function noop() {}

class Timer {

    constructor(options) {
        this.meter = new Meter(options);
        this.histogram = new Histogram(options);
    }

    start(value) {
        var timer = { start: Date.now(), count: value };
        timer.end = this._end.bind(this, timer);
        return timer;
    }

    _end(timer) {
        timer.elapsed = Date.now() - timer.start;
        this.update(timer.elapsed, timer.count);
        timer.end = noop;
        return timer.elapsed;
    }

    update(time, count) {
        this.lastUpdate = Date.now();
        this.histogram.update(time);
        this.meter.mark(count);
    }

    reset() {
        this.meter.reset();
        this.histogram.reset();
    }

    end() {
        this.meter.end();
    }

    toJSON(options) {
        return {
            meter: this.meter.toJSON(options),
            histogram: this.histogram.toJSON(options),
        }
    }
}

module.exports = Timer;

