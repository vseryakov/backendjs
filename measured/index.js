//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Feb 2014
//
// Based on https://github.com/felixge/node-measured
//

exports.Counter = require('./Counter');
exports.Meter = require('./Meter');
exports.Histogram = require('./Histogram');
exports.Timer = require('./Timer');

module.exports = Collection;

function Collection()
{
    this._metrics = {};
}

Collection.prototype.toJSON = function()
{
    var json = {};
    for (var metric in this._metrics) {
        json[metric] = this._metrics[metric].toJSON();
    }
    return json;
};

Collection.prototype.end = function()
{
    var metrics = this._metrics;
    Object.keys(metrics).forEach(function(name) {
        var metric = metrics[name];
        if (metric.end) metric.end();
    });
};

["Counter", "Meter", "Histogram", "Timer"].forEach(function(name) {
    var mod = exports[name];
    Collection.prototype[name] = function(name, properties) {
        if (!this._metrics[name]) this._metrics[name] = new mod(properties);
        return this._metrics[name];
    };
});

