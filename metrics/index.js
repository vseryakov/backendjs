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

module.exports = Metrics;

function Metrics()
{
    this.metrics = {};
    for (var i = 0; i < arguments.length - 1; i+= 2) this[arguments[i]] = arguments[i + 1];
}

Metrics.prototype.toJSON = function()
{
    var json = {};
    for (var p in this) {
        if (p != "metrics" && typeof this[p] != "undefined" && typeof this[p] != null) json[p] = this[p];
    }
    for (var metric in this.metrics) {
        json[metric] = this.metrics[metric].toJSON();
    }
    return json;
};

Metrics.prototype.end = function()
{
    var metrics = this.metrics;
    Object.keys(metrics).forEach(function(name) {
        var metric = metrics[name];
        if (metric.end) metric.end();
    });
};

["Counter", "Meter", "Histogram", "Timer"].forEach(function(name) {
    var mod = exports[name];
    Metrics.prototype[name] = function(name, properties) {
        if (!this.metrics[name]) this.metrics[name] = new mod(properties);
        return this.metrics[name];
    };
});

