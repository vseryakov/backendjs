
module.exports = ExponentiallyMovingWeightedAverage;

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
