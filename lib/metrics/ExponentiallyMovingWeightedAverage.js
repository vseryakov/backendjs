

module.exports = class ExponentiallyMovingWeightedAverage {

    constructor(rateUnit, tickInterval)
    {
        this._rateUnit = rateUnit || 60000;
        this._tickInterval = tickInterval || 5000;
        this._alpha = 1 - Math.exp(-this._tickInterval / this._rateUnit);
        this._count = 0;
        this._rate = 0;
    }

    update(n)
    {
        this._count += n;
    }

    tick()
    {
        this._rate += this._alpha * ((this._count / this._tickInterval) - this._rate);
        this._count = 0;
    }

    rate(timeUnit)
    {
        return this._rate * timeUnit || 0;
    }
}
