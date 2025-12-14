
const lib = require("../lib");


module.exports = class TokenBucket {

    /**
    * Create a Token Bucket object for rate limiting as per http://en.wikipedia.org/wiki/Token_bucket
    *  - rate - the rate to refill tokens
    *  - max - the maximum burst capacity
    *  - interval - interval for the bucket refills, default 1000 ms
    *
    * Store as an array for easier serialization into JSON when keep it in the shared cache.
    *
    * Based on https://github.com/thisandagain/micron-throttle
    * @param {number|object|number[]} rate
    * @param {number} max
    * @param {number} interval
    *
    * @class TokenBucket
    */
    constructor(rate, max, interval)
    {
        this.configure(rate, max, interval);
    }

    /**
     * Initialize existing token with numbers for rate calculations
     *
     * @memberOf TokenBucket
     * @method configure
     */
    configure(rate, max, interval, total)
    {
        if (Array.isArray(rate)) {
            this._rate = lib.toNumber(rate[0]);
            this._max = lib.toNumber(rate[1]);
            this._count = lib.toNumber(rate[2]);
            this._time = lib.toNumber(rate[3]);
            this._interval = lib.toNumber(rate[4]);
            this._total = lib.toNumber(rate[5]);
        } else
        if (typeof rate == "object" && rate?.rate) {
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

    /**
     * Return a JSON object to be serialized/saved, can be used to construct new object as the `rate` param
     * @memberOf TokenBucket
     * @method toJSON
     */
    toJSON()
    {
        return { rate: this._rate, max: this._max, count: this._count, time: this._time, interval: this._interval, total: this._total };
    }

    /**
     * Return a string to be serialized/saved, can be used to construct new object as the `rate` param
     * @memberOf TokenBucket
     * @method toString
     */
    toString()
    {
        return this.toArray().join(",");
    }

    /**
     * Return an array object to be serialized/saved, can be used to construct new object as the `rate` param
     * @memberOf TokenBucket
     * @method toArray
     */
    toArray()
    {
        return [this._rate, this._max, this._count, this._time, this._interval, this._total];
    }

    /**
     * Return true if this bucket uses the same rates in arguments
     * @memberOf TokenBucket
     * @method equal
     */
    equal(rate, max, interval)
    {
        rate = lib.toNumber(rate, { min: 0 });
        max = lib.toNumber(max || rate, { min: 0 });
        interval = lib.toNumber(interval || 1000, { min: 1 });
        return this._rate === rate && this._max === max && this._interval == interval;
    }

    /**
    * Consume N tokens from the bucket, if no capacity, the tokens are not pulled from the bucket.
    *
    * Refill the bucket by tracking elapsed time from the last time we touched it.
    *
    *      min(totalTokens, current + (fillRate * elapsedTime))
    * @memberOf TokenBucket
    * @method consume
    */
    consume(tokens)
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

    /**
     * Returns number of milliseconds to wait till number of tokens can be available again
     */
    delay(tokens)
    {
        return Math.max(0, this._interval - (tokens >= this._max ? 0 : this._elapsed));
    }

}
