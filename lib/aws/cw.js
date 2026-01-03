/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

/**
 * AWS CloudWatch API request
 * @memberOf module:aws
 */
aws.queryCW = function(action, obj, options, callback)
{
    this.queryEndpoint("monitoring", '2010-08-01', action, obj, options, callback);
}

/**
 * AWS CloudWatch Log API request
 * @memberOf module:aws
 */
aws.queryCWL = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "Logs_20140328." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options?.region || this.region || 'us-east-1';
    opts.endpoint = "logs";
    opts.signer = this.querySigner;
    opts.action = action;
    logger.debug(opts.action, opts);
    this.fetch("https://logs." + opts.region + ".amazonaws.com/", opts, (err, params) => {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

/**
 * Creates or updates an alarm and associates it with the specified Amazon CloudWatch metric.
 * The options specify the following:
 *  - name - alarm name, if not specified metric name and dimensions will be used to generate alarm name
 *  - metric - metric name, default is `CPUUtilization`
 *  - namespace - AWS namespace, default is `AWS/EC2`
 *  - op - comparison operator, one of => | <= | > | < | GreaterThanOrEqualToThreshold | GreaterThanThreshold | LessThanThreshold | LessThanOrEqualToThreshold. Default is `>=`.
 *  - statistic - one of SampleCount | Average | Sum | Minimum | Maximum, default is `Average`
 *  - period - collection period in seconds, default is `60`
 *  - evaluationPeriods - the number of periods over which data is compared to the specified threshold, default is `15`
 *  - threshold - the value against which the specified statistic is compared, default is `90`
 *  - ok - ARN(s) to be notified on OK state
 *  - alarm - ARN(s) to be notified on ALARM state
 *  - insufficient_data - ARN(s) to be notified on INSUFFICIENT_DATA state
 *  - dimensions - the dimensions for the alarm's associated metric.
 * @memberOf module:aws
 */
aws.cwPutMetricAlarm = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    var ops = { ">=": "GreaterThanOrEqualToThreshold", ">": "GreaterThanThreshold", "<": "LessThanThreshold", "<=": "LessThanOrEqualToThreshold" };
    var metric = options.metric || "CPUUtilization";
    var namespace = options.namespace || "AWS/EC2";

    var params = {
        AlarmName: options.name || (namespace + ": " + metric + " " + lib.objDescr(options.dimensions)),
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
 * Publishes metric data points to Amazon CloudWatch.
 * The argumernts specify the following:
 *  - namespace - custome namespace, cannot start with `AWS`
 *  - data - an object with metric data:
 *    { metricName: value }, ...
 *    { metricName: {
 *           value: Number,
 *           dimension1: name1,
 *           ..
 *        },
 *    }, ...
 *    { metricName: {
 *           value: [min, max, sum, sample],
 *           dimension1: ...
 *        },
 *    }, ...
 *
 * The options can specify the following:
 * - storageResolution - 1 to use 1 second resolution
 * - timestamp - ms to be used as the timestamp instead of the current time
 * @memberOf module:aws
 */
aws.cwPutMetricData = function(namespace, data, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var batches = [], keys = [];
    for (var p in data) {
        keys.push(p);
        if (keys.length == 20) {
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
            var val = data[key];
            params["MetricData.member." + i + ".MetricName"] = key;
            if (typeof val == "number" || typeof val == "string") {
                params["MetricData.member." + i + ".Value"] = val;
            } else {
                var j = 1;
                if (lib.isArray(val.value)) {
                    params["MetricData.member." + i + ".StatisticValues.Minimum"] = val.value[0];
                    params["MetricData.member." + i + ".StatisticValues.Maximum"] = val.value[1];
                    params["MetricData.member." + i + ".StatisticValues.Sum"] = val.value[2];
                    params["MetricData.member." + i + ".StatisticValues.SampleCount"] = val.value[3];
                } else {
                    params["MetricData.member." + i + ".Value"] = val.value;
                }
                for (var d in val) {
                    if (d == "value") continue;
                    params["MetricData.member." + i + ".Dimensions.member." + j + ".Name"] = d;
                    params["MetricData.member." + i + ".Dimensions.member." + j + ".Value"] = val[d];
                    j++;
                }
            }
            if (options && options.storageResolution) {
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
 * Return metrics for the given query, the options can be specified:
 *  - name - a metric name
 *  - namespace - limit by namespace: AWS/AutoScaling, AWS Billing, AWS/CloudFront, AWS/DynamoDB, AWS/ElastiCache, AWS/EBS, AWS/EC2, AWS/ELB, AWS/ElasticMapReduce, AWS/Kinesis, AWS/OpsWorks, AWS/Redshift, AWS/RDS, AWS/Route53, AWS/SNS, AWS/SQS, AWS/SWF, AWS/StorageGateway
 * @memberOf module:aws
 */
aws.cwListMetrics = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
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
        if (typeof callback == "function") callback(err, rows);
    });
}

/**
 * Return collected metric statistics
 *
 * Options:
 * - start_time - starting timestamp
 * - end_time - ending timestamp
 * - period - aggregation period in seconds, default is 60, if < 0 then dunamically set it for the time range
 * - age - number of ms to go back in case start_time is not specified, fraction can be used, default is 30 secs if no timestamp are given
 * - namespace - namespace for all metrics, default is AWS/EC2
 * - desc - return data in descending order
 * - metrics - a list with metrics to retrieve:
 *    { name: "..",
 *      stat: "..",
 *      dimensions: { key: val, ...},
 *      [namespace: ".."],
 *      [label: "..""],
 *      [hidden: 1],
 *      [expression: ".."]
 *    }
 *
 * Returns an object: { data: [{ id, label, timestamps: [], data: [] }], errors: [] }
 *
 * Example:
 *
 *     aws.cwGetMetricData({ age: 300000, metrics: [{ name: "NetworkOut", label: "Traffic", stat: "Average", dimensions: { InstanceId: "i-1234567" } } ] }, lib.log)
 * @memberOf module:aws
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
        var metric = options.metrics[i];
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

    opts = lib.objFlatten(opts, { index: 1 });

    lib.doWhilst(
        function(next) {
            aws.queryCW("GetMetricData", opts, options, (err, res) => {
                if (err) return next(err);
                res = res?.GetMetricDataResponse?.GetMetricDataResult;
                opts.nextToken = res?.NextToken;

                rc.errors.push(...lib.objGet(res, "Messages.member", { list: 1 }).map((x) => (`${x.Code}: ${x.Value}`)));

                var d = lib.objGet(res, "MetricDataResults.member", { list: 1 });
                for (const m of d) {
                    if (!["PartialData", "Complete"].includes(m?.StatusCode)) {
                        var e = lib.objGet(m, "Messages.member", { list: 1 }).map((x) => (`${x.Code}: ${x.Value} (${x.Id}: ${x.Label})`));
                        if (e.length) rc.errors.push(...e);
                        continue;
                    }
                    var t = lib.objGet(m, "Timestamps.member", { list: 1 });
                    if (!t.length) continue;
                    var x = lib.objGet(m, "Values.member", { list: 1 });
                    var sum = 0, v = t.map((y, i) => {
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
 * Lists log events from the specified log group. You can list all the log events or filter the results using a filter pattern,
 * a time range, and the name of the log stream.
 * Options:
 *  - name - a group name, required
 *  - count - how many events to retrieve in one batch, 10000
 *  - limit - total number of events to return
 *  - filter - filter pattern
 *  - stime - start time in ms
 *  - etime - end time in ms
 *  - prefix - log stream prefix pattern
 *  - names - list of log streams to filter
 *  - token - a previous token to start with
 *  - timeout - how long to keep reading or waiting, ms
 * @memberOf module:aws
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
                for (const p in rc) if (p != "events") data[p] = rc[p];
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
 * Store events in the Cloudwatch Logs.
 * Options:
 * - name - log group name, required
 * - stream - log stream name, required
 * - events - a list of strings, or objects { timestamp, message }, required
 * - tm_pos - position in the message where the timestamp starts, default is 0
 * - tm_sep - separator after the timestamp, default is space
 * @memberOf module:aws
 */
aws.cwPutLogEvents = function(options, callback)
{
    var opts = {
        logGroupName: options.name,
        logStreamName: options.stream,
        logEvents: lib.isArray(options.events, []). map((x) => {
            var m = typeof x == "string" ? x : x.message;
            if (!m) return null;
            var t = x.timestamp;
            if (!t) {
                var e = m.indexOf(options.tm_sep || " ", options.tm_pos || 0);
                if (e > 0) t = lib.toMtime(m.substr(options.tm_pos || 0, e).trim());
            }
            return t ? { timestamp: t, message: m } : null;
        }).filter((x) => (x)),
    };
    if (!opts.logEvents.length) return lib.tryCall(callback);
    aws.queryCWL("PutLogEvents", opts, options, callback);
}

