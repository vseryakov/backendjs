/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS CloudWatch (metrics/alarms) API request.
 * @memberOf module:aws
 * @method queryCW
 * @param {string} action - CloudWatch API action, e.g. `PutMetricData`, `GetMetricData`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryEndpoint}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryCW = function(action, obj, options, callback)
{
    this.queryEndpoint("monitoring", '2010-08-01', action, obj, options, callback);
}

/**
 * AWS CloudWatch Logs API request.
 * @memberOf module:aws
 * @method queryCWL
 * @param {string} action - CloudWatch Logs API action, e.g. `FilterLogEvents`, `PutLogEvents`
 * @param {object} obj - API-specific request parameters
 * @param {object} [options] - request options passed to {@link module:aws.queryService}
 * @param {function} callback - `(err, data, request)`
 */
aws.queryCWL = function(action, obj, options, callback)
{
    this.queryService({ endpoint: "logs", target: "Logs_20140328", action }, obj, options, callback);
}

/**
 * Creates or updates an alarm and associates it with the specified Amazon CloudWatch metric.
 * @memberOf module:aws
 * @method cwPutMetricAlarm
 * @param {object} options
 * @param {string} [options.name] - alarm name, if not specified metric name and dimensions are used to generate one
 * @param {string} [options.metric=CPUUtilization] - metric name
 * @param {string} [options.namespace=AWS/EC2] - AWS namespace
 * @param {string} [options.op=>=] - comparison operator, one of `>=` | `<=` | `>` | `<` or the native names
 *   GreaterThanOrEqualToThreshold | GreaterThanThreshold | LessThanThreshold | LessThanOrEqualToThreshold
 * @param {string} [options.statistic=Average] - one of SampleCount | Average | Sum | Minimum | Maximum
 * @param {number} [options.period=60] - collection period in seconds
 * @param {number} [options.evaluationPeriods=15] - number of periods over which data is compared to the threshold
 * @param {number} [options.threshold=90] - value the statistic is compared against
 * @param {string|string[]} [options.ok] - ARN(s) to notify on OK state
 * @param {string|string[]} [options.alarm] - ARN(s) to notify on ALARM state
 * @param {string|string[]} [options.insufficient_data] - ARN(s) to notify on INSUFFICIENT_DATA state
 * @param {object} [options.dimensions] - dimensions for the alarm's metric as name:value
 * @param {function} callback
 */
aws.cwPutMetricAlarm = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var ops = { ">=": "GreaterThanOrEqualToThreshold", ">": "GreaterThanThreshold", "<": "LessThanThreshold", "<=": "LessThanOrEqualToThreshold" };
    var metric = options.metric || "CPUUtilization";
    var namespace = options.namespace || "AWS/EC2";

    var params = {
        AlarmName: options.name || (namespace + ": " + metric + " " + lib.inspect(options.dimensions)),
        MetricName: metric,
        Namespace: namespace,
        ComparisonOperator: ops[options.op] || options.op || "GreaterThanOrEqualToThreshold",
        Period: options.period || 60,
        EvaluationPeriods: options.evaluationPeriods || 15,
        Threshold: options.threshold || 90,
        Statistic: options.statistic || "Average"
    }
    var i = 1;
    for (var p in options.dimensions) {
        params["Dimensions.member." + i + ".Name"] = p;
        params["Dimensions.member." + i + ".Value"] = options.dimensions[p];
        i++;
    }
    lib.split(options.ok).forEach(function(x, i) { params["OKActions.member." + (i + 1)] = x; });
    lib.split(options.alarm).forEach(function(x, i) { params["AlarmActions.member." + (i + 1)] = x; });
    lib.split(options.insufficient_data).forEach(function(x, i) { params["InsufficientDataActions.member." + (i + 1)] = x; });

    this.queryCW("PutMetricAlarm", params, options, callback);
}

/**
 * Publishes metric data points to Amazon CloudWatch, batching up to 20 metrics per request.
 * @memberOf module:aws
 * @method cwPutMetricData
 * @param {string} namespace - custom namespace, cannot start with `AWS`
 * @param {object} data - an object with metric data keyed by metric name, each value may be:
 *   - a number/string: the metric value
 *   - `{ value: Number, dimension1: name1, ... }`: value plus dimensions
 *   - `{ value: [min, max, sum, sampleCount], dimension1: ... }`: statistic set plus dimensions
 * @param {object} [options]
 * @param {number} [options.storageResolution] - 1 to use 1 second high resolution
 * @param {number} [options.timestamp] - ms timestamp to use instead of the current time
 * @param {function} callback
 */
aws.cwPutMetricData = function(namespace, data, options, callback)
{
    if (typeof options === "function") callback = options, options = null;

    var batches = [], keys = [];
    for (const p in data) {
        keys.push(p);
        if (keys.length === 20) {
            batches.push(keys);
            keys = [];
        }
    }
    if (keys.length) batches.push(keys);
    lib.forEverySeries(batches, (batch, next) => {
        var params = {
            Namespace: namespace,
        }
        var i = 1;
        for (const key of batch) {
            const val = data[key];
            params["MetricData.member." + i + ".MetricName"] = key;
            if (typeof val === "number" || typeof val === "string") {
                params["MetricData.member." + i + ".Value"] = val;
            } else {
                let j = 1;
                if (lib.isArray(val.value)) {
                    params["MetricData.member." + i + ".StatisticValues.Minimum"] = val.value[0];
                    params["MetricData.member." + i + ".StatisticValues.Maximum"] = val.value[1];
                    params["MetricData.member." + i + ".StatisticValues.Sum"] = val.value[2];
                    params["MetricData.member." + i + ".StatisticValues.SampleCount"] = val.value[3];
                } else {
                    params["MetricData.member." + i + ".Value"] = val.value;
                }
                for (const d in val) {
                    if (d === "value") continue;
                    params["MetricData.member." + i + ".Dimensions.member." + j + ".Name"] = d;
                    params["MetricData.member." + i + ".Dimensions.member." + j + ".Value"] = val[d];
                    j++;
                }
            }
            if (options?.storageResolution) {
                params["MetricData.member." + i + ".StorageResolution"] = 1;
            }
            if (options && options.timestamp > 0) {
                params["MetricData.member." + i + ".Timestamp"] = lib.toDate(options.timestamp).toISOString();
            }
            i++;
        }
        aws.queryCW("PutMetricData", params, options, next);
    }, callback, true);
}

/**
 * Return the list of CloudWatch metrics matching the query.
 * @memberOf module:aws
 * @method cwListMetrics
 * @param {object} [options]
 * @param {string} [options.name] - a metric name to filter by
 * @param {string} [options.namespace] - limit by namespace, e.g. AWS/EC2, AWS/DynamoDB, AWS/ELB, AWS/RDS, AWS/SQS...
 * @param {object} [options.dimensions] - dimensions filter as name:value
 * @param {function} callback - `(err, rows)` where rows is a list of metric descriptors
 */
aws.cwListMetrics = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = {};

    var params = {};
    if (options.name) params.MetricName = options.name;
    if (options.namespace) params.Namespace = options.namespace;
    var i = 1;
    for (var p in options.dimensions) {
        params["Dimensions.member." + i + ".Name"] = p;
        params["Dimensions.member." + i + ".Value"] = options.dimensions[p];
        i++;
    }
    this.queryCW("ListMetrics", params, options, function(err, rc) {
        var rows = lib.objGet(rc, "ListMetricsResponse.ListMetricsResult.Metrics.member", { list: 1 });
        if (typeof callback === "function") callback(err, rows);
    });
}

/**
 * Return collected metric statistics for one or more metrics/expressions.
 * @memberOf module:aws
 * @method cwGetMetricData
 * @param {object} options
 * @param {number} [options.start_time] - starting timestamp
 * @param {number} [options.end_time] - ending timestamp
 * @param {number} [options.period=60] - aggregation period in seconds, if < 0 it is set dynamically for the range
 * @param {number} [options.age] - ms to go back if start_time is not given (default 30 secs)
 * @param {string} [options.namespace=AWS/EC2] - default namespace for all metrics
 * @param {boolean} [options.desc] - return data in descending order
 * @param {number} [options.timeout] - stop paginating after this many ms
 * @param {boolean} [options.zeros] - include series whose values sum to zero
 * @param {object[]} options.metrics - metrics to retrieve, each item:
 *   `{ name, stat, dimensions:{key:val}, [id], [namespace], [label], [hidden], [expression] }`
 * @param {function} callback - `(err, rc)` where rc is `{ start, end, period, data:[{ id, label, timestamps:[], data:[] }], errors:[] }`
 * @example
 *     aws.cwGetMetricData({ age: 300000, metrics: [{ name: "NetworkOut", label: "Traffic", stat: "Average", dimensions: { InstanceId: "i-1234567" } } ] }, lib.log)
 */
aws.cwGetMetricData = function(options, callback)
{
    var end = lib.toDate(options.end_time || Date.now());
    var start = lib.toDate(options.start_time || (Date.now() - lib.toNumber(options.age, { min: 30000, max: 86400000*63 })));
    var period = options.period > 0 ? options.period : 60;
    if (options.period < 0) {
        const age = (end - start)/60000;
        period = age <= 30 ? 10 : age <= 300 ? 60 : age <= 720 ? 300 : age <= 1440 ? 900 : age <= 1440*5 ? 3600 : age < 1440*10 ? 3600*2 : 3600*6;
   }

    var rc = { start, end, period, data: [], errors: [] }, t0 = Date.now();

    var opts = {
        StartTime: start.toISOString(),
        EndTime: end.toISOString(),
        ScanBy: options.desc ? "TimestampDescending": "TimestampAscending",
        MetricDataQueries: { member: [] },
    };
    for (const i in options.metrics) {
        const metric = options.metrics[i];
        let dimensions;
        for (const d in metric.dimensions) {
            if (!dimensions) dimensions = { member: [] };
            dimensions.member.push({ Name: d, Value: metric.dimensions[d] });
        }
        if (metric.expression) {
            opts.MetricDataQueries.member.push({
                Id: metric.id || `m${i}`,
                Label: metric.label,
                Expression: metric.expression,
            });
        } else
        if (metric.name) {
            opts.MetricDataQueries.member.push({
                Id: metric.id || `e${i}`,
                Label: metric.label || metric.name,
                MetricStat: {
                    Metric: {
                        MetricName: metric.name,
                        Namespace: metric.namespace || options.namespace || "AWS/EC2",
                        Dimensions: dimensions || undefined,
                    },
                    Period: period,
                    Stat: metric.stat || options.stat || "Average",
                },
                ReturnData: metric.hidden ? false : undefined,
            });
        }
    }

    logger.debug("cwGetMetricData:", opts);

    if (!opts.MetricDataQueries.member.length) {
        return callback(null, rc);
    }

    opts = lib.flatten(opts, { index: 1 });

    lib.doWhilst(
        function(next) {
            aws.queryCW("GetMetricData", opts, options, (err, res) => {
                if (err) return next(err);
                res = res?.GetMetricDataResponse?.GetMetricDataResult;
                opts.nextToken = res?.NextToken;

                rc.errors.push(...lib.objGet(res, "Messages.member", { list: 1 }).map((x) => (`${x.Code}: ${x.Value}`)));

                var d = lib.objGet(res, "MetricDataResults.member", { list: 1 }), t, x, v, sum;
                for (const m of d) {
                    if (!["PartialData", "Complete"].includes(m?.StatusCode)) {
                        const e = lib.objGet(m, "Messages.member", { list: 1 }).map((x) => (`${x.Code}: ${x.Value} (${x.Id}: ${x.Label})`));
                        if (e.length) rc.errors.push(...e);
                        continue;
                    }
                    t = lib.objGet(m, "Timestamps.member", { list: 1 });
                    if (!t.length) continue;
                    x = lib.objGet(m, "Values.member", { list: 1 });
                    sum = 0, v = t.map((y, i) => {
                        y = lib.toNumber(x[i] || 0);
                        sum += y;
                        return y;
                    });
                    if (sum || options.zeros) {
                        rc.data.push({
                            id: m.Id,
                            label: m.Label,
                            timestamps: t,
                            data: v,
                        });
                    }
                }
                next();
            });
        },
        function() {
            return opts.nextToken &&
                   (!options.timeout || Date.now() - t0 < options.timeout);
        },
        function(err) {
            callback(err, rc);
        }, true);
}

/**
 * Lists log events from the specified log group, optionally filtered by pattern, time range and stream.
 * @memberOf module:aws
 * @method cwlFilterLogEvents
 * @param {object} options
 * @param {string} options.name - log group name, required
 * @param {number} [options.count=10000] - how many events to retrieve per batch
 * @param {number} [options.limit] - total number of events to return
 * @param {string} [options.filter] - CloudWatch Logs filter pattern
 * @param {number} [options.stime] - start time in ms
 * @param {number} [options.etime] - end time in ms
 * @param {string} [options.prefix] - log stream name prefix pattern
 * @param {string[]} [options.names] - list of log streams to filter
 * @param {string} [options.token] - pagination token to start with
 * @param {number} [options.delay] - delay in ms between batches
 * @param {number} [options.timeout] - how long to keep reading/waiting, ms
 * @param {function} callback - `(err, data)` where data is `{ events:[], ... }`
 */
aws.cwlFilterLogEvents = function(options, callback)
{
    var opts = {
        logGroupName: options.name,
        limit: options.count || Math.min(10000, options.limit) || undefined,
        filterPattern: options.filter,
        startTime: options.stime,
        endTime: options.etime,
        logStreamNamePrefix: options.prefix || undefined,
        logStreamNames: lib.isArray(options.names, undefined),
        nextToken: options.token,
    };
    var data = { events: [] }, t0 = Date.now();
    lib.doWhilst(
        function(next) {
            aws.queryCWL("FilterLogEvents", opts, options, (err, rc) => {
                logger.debug("cwFilterLogEvents:", err, opts, rc);
                if (err) return next(err);
                opts.nextToken = rc.nextToken;
                data.events.push.apply(data.events, lib.isArray(rc.events, []));
                for (const p in rc) if (p !== "events") data[p] = rc[p];
                setTimeout(next, options.delay || 0);
            });
        },
        function() {
            return opts.nextToken &&
                   (!options.limit || data.events.length < options.limit) &&
                   (!options.timeout || Date.now() - t0 < options.timeout);
        },
        function(err) {
            lib.tryCall(callback, err, data);
        }, true);
}

/**
 * Store events in CloudWatch Logs.
 * @memberOf module:aws
 * @method cwPutLogEvents
 * @param {object} options
 * @param {string} options.name - log group name, required
 * @param {string} options.stream - log stream name, required
 * @param {string[]|object[]} options.events - list of strings or objects `{ timestamp, message }`, required
 * @param {number} [options.tm_pos=0] - position in the message where the timestamp starts (used to auto-derive timestamp)
 * @param {string} [options.tm_sep=' '] - separator after the timestamp
 * @param {function} callback
 */
aws.cwPutLogEvents = function(options, callback)
{
    var opts = {
        logGroupName: options.name,
        logStreamName: options.stream,
        logEvents: lib.isArray(options.events, []). map((x) => {
            var m = typeof x === "string" ? x : x.message;
            if (!m) return null;
            var t = x.timestamp;
            if (!t) {
                const e = m.indexOf(options.tm_sep || " ", options.tm_pos || 0);
                if (e > 0) t = lib.toMtime(m.substr(options.tm_pos || 0, e).trim());
            }
            return t ? { timestamp: t, message: m } : null;
        }).filter((x) => (x)),
    };
    if (!opts.logEvents.length) return lib.tryCall(callback);
    aws.queryCWL("PutLogEvents", opts, options, callback);
}

