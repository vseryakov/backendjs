//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

core.describeArgs("aws", [
    { name: "logwatcher-groups", type: "list", descr: "List of AWS Cloudwatch Logs groups to watch for errors" },
    { name: "logwatcher-filter", descr: "AWS Cloudwatch Logs filter pattern, only matched events will be returned and analyzed the the core logwatcher regexps" },
]);

// AWS CloudWatch API request
aws.queryCW = function(action, obj, options, callback)
{
    this.queryEndpoint("monitoring", '2010-08-01', action, obj, options, callback);
}

// AWS CloudWatch Log API request
aws.queryCWL = function(action, obj, options, callback)
{
    var headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': "Logs_20140328." + action };
    var opts = this.queryOptions("POST", lib.stringify(obj), headers, options);
    opts.region = options && options.region || this.region || 'us-east-1';
    opts.endpoint = "logs";
    opts.signer = this.querySigner;
    opts.action = action;
    logger.debug(opts.action, opts);
    this.httpGet("https://logs." + opts.region + ".amazonaws.com/", opts, function(err, params) {
        if (params.status != 200) err = aws.parseError(params, options);
        if (typeof callback == "function") callback(err, params.obj);
    });
}

// Creates or updates an alarm and associates it with the specified Amazon CloudWatch metric.
// The options specify the following:
//  - name - alarm name, if not specified metric name and dimensions will be used to generate alarm name
//  - metric - metric name, default is `CPUUtilization`
//  - namespace - AWS namespace, default is `AWS/EC2`
//  - op - comparison operator, one of => | <= | > | < | GreaterThanOrEqualToThreshold | GreaterThanThreshold | LessThanThreshold | LessThanOrEqualToThreshold. Default is `>=`.
//  - statistic - one of SampleCount | Average | Sum | Minimum | Maximum, default is `Average`
//  - period - collection period in seconds, default is `60`
//  - evaluationPeriods - the number of periods over which data is compared to the specified threshold, default is `15`
//  - threshold - the value against which the specified statistic is compared, default is `90`
//  - ok - ARN(s) to be notified on OK state
//  - alarm - ARN(s) to be notified on ALARM state
//  - insufficient_data - ARN(s) to be notified on INSUFFICIENT_DATA state
//  - dimensions - the dimensions for the alarm's associated metric.
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
    lib.strSplit(options.ok).forEach(function(x, i) { params["OKActions.member." + (i + 1)] = x; });
    lib.strSplit(options.alarm).forEach(function(x, i) { params["AlarmActions.member." + (i + 1)] = x; });
    lib.strSplit(options.insufficient_data).forEach(function(x, i) { params["InsufficientDataActions.member." + (i + 1)] = x; });

    this.queryCW("PutMetricAlarm", params, options, callback);
}

// Publishes metric data points to Amazon CloudWatch.
// The argumernts specify the following:
//  - namespace - custome namespace, cannot start with `AWS`
//  - data - an object with metric data:
//    { metricName: value }, ...
//    { metricName: {
//           value: Number,
//           dimension1: name1,
//           ..
//        },
//    }, ...
//    { metricName: {
//           value: [min, max, sum, sample],
//           dimension1: ...
//        },
//    }, ...
//
// The options can specify the following:
// - storageResolution - 1 to use 1 second resolution
// - timestamp - ms to be used as the timestamp instead of the current time
//
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
    }, callback);
}

// Return metrics for the given query, the options can be specified:
//  - name - a metric name
//  - namespace - limit by namespace: AWS/AutoScaling, AWS Billing, AWS/CloudFront, AWS/DynamoDB, AWS/ElastiCache, AWS/EBS, AWS/EC2, AWS/ELB, AWS/ElasticMapReduce, AWS/Kinesis, AWS/OpsWorks, AWS/Redshift, AWS/RDS, AWS/Route53, AWS/SNS, AWS/SQS, AWS/SWF, AWS/StorageGateway
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

// Return collected metric statistics
//
// Options:
// - start_time - starting timestamp
// - end_time - ending timestamp
// - period - aggregation period in seconds, default is 60
// - age - number of hours to go back in case end_time is not specified, fraction can be used, default is 1h if no timestamp are given
// - namespace - namespace for all metrics, default is AWS/EC2
// - metrics - a list with metrics to retrieve: { name: "..", stat: "..", dimensions: { key: val, ...}, [namespace: ".."], [label: "..""] }
//
// Example:
//
//     aws.cwGetMetricData({ age: 5, metrics: [{ name: "NetworkOut", label: "Traffic", stat: "Average", dimensions: { InstanceId: "i-1234567" } } ] }, lib.log)
//
aws.cwGetMetricData = function(options, callback)
{
    var age = lib.toNumber(options.age, { min: 1, max: 120 });
    var end_time = lib.toDate(options.end_time || Date.now());
    var start_time = lib.toDate(options.start_time || (Date.now() - Math.round(age * 86400000)));
    var period = options.period > 0 ? options.period :
                 age > 0 ? (age <= 0.5 ? 10 : age <= 5 ? 60 : age <= 12 ? 300 : age <= 24 ? 900 : age <= 24*10 ? 3600 : age < 24*10 ? 3600*2 : 3600*6) : 60;

    var opts = {
        StartTime: start_time.toISOString(),
        EndTime: end_time.toISOString(),
        MetricDataQueries: { member: [] },
    };
    for (const i in options.metrics) {
        var metric = options.metrics[i];
        if (!metric.name) continue;
        var dimensions;
        for (const d in metric.dimensions) {
            var v = lib.isArray(metric.dimensions[d], [metric.dimensions[d]]).map((x) => ({ Name: d, Value: x }));
            if (!v.length) continue;
            if (!dimensions) dimensions = [];
            dimensions.push(...v);
        }
        opts.MetricDataQueries.member.push({
            Id: metric.name.toLowerCase() + i,
            Label: metric.label,
            MetricStat: {
                Metric: {
                    MetricName: metric.name,
                    Namespace: metric.namespace || options.namespace || "AWS/EC2",
                    Dimensions: dimensions ? { member: dimensions } : undefined,
                },
                Period: period,
                Stat: metric.stat || options.stat || "Average",
            },
        });
    }

    if (!opts.MetricDataQueries.member.length) return callback();
    opts = lib.objFlatten(opts, { index: 1 });
    this.queryCW("GetMetricData", opts, options, function(err, rc) {
        var series = [];
        lib.objGet(rc, "GetMetricDataResponse.GetMetricDataResult.MetricDataResults.member", { list: 1 }).forEach((x) => {
            var t = lib.objGet(x, "Timestamps.member", { list: 1 });
            if (!lib.isArray(t)) return;
            var v = lib.objGet(x, "Values.member", { list: 1 });
            var d = t.map((y, i) => ([y, v[i]]));
            series.push({ id: x.Id, data: d, label: x.Label });
        });
        callback(err, series);
    });
}

// Lists log events from the specified log group. You can list all the log events or filter the results using a filter pattern,
// a time range, and the name of the log stream.
// Options:
//  - name - a group name, required
//  - count - how many events to retrieve in one batch, 10000
//  - limit - total number of events to return
//  - filter - filter pattern
//  - stime - start time in ms
//  - etime - end time in ms
//  - prefix - log stream prefix pattern
//  - names - list of log streams to filter
//  - token - a previous token to start with
aws.cwlFilterLogEvents = function(options, callback)
{
    var opts = {
        logGroupName: options.name,
        limit: options.count,
        filterPattern: options.filter,
        startTime: options.stime,
        endTime: options.etime,
        logStreamNamePrefix: options.prefix,
        logStreamNames: options.names,
        nextToken: options.token,
    };
    var data = { events: [] }, t0 = Date.now();
    lib.doWhilst(
        function(next) {
            aws.queryCWL("FilterLogEvents", opts, options, (err, rc) => {
                logger.debug("cwlFilterLogEvents:", err, opts, rc);
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
        });
}

aws.watchLogs = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    this.logwatcherMtime = Date.now();

    core.watchLogsInit(options, (err, opts) => {
        logger.debug('watchLogs:', "aws:", this.logwatcherGroups, this.logwatcherFilter, err, opts);

        lib.forEach(aws.logwatcherGroups, (name, next) => {
            var q = {
                name: name,
                filter: aws.logwatcherFilter,
                stime: opts.last_pos[name] || (Date.now() - 3600000),
                etime: Date.now(),
            };
            aws.cwlFilterLogEvents(q, (err, rc) => {
                logger.debug('watchLogs:', "aws:", err, q, "matches:", rc.events.length);
                if (!err) return next();
                core.watchLogsMatch(opts, rc.events.map((x) => (x.message)));
                if (options && options.dryrun) return next();
                core.watchLogsSave(name, q.etime, () => (next()));
            });
        }, function(err) {
            core.watchLogsSend(opts, callback);
        });
    });
}
