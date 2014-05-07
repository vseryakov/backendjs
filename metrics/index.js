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

function Metrics(name)
{
    this.metrics = {};
    if (name) this.name = name;
}

Metrics.prototype.toJSON = function()
{
    var json = {};
    if (this.name) json.name = this.name;
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

