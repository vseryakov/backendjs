/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const fs = require('fs');
const util = require("util");
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const mod = require(__dirname + '/../jobs');


/**
 * Create a new cron job, for remote jobs additional property args can be used in the object to define
 * arguments for the instance backend process, properties must start with -
 * @param {object} jobspec
 * @example
 *
 * { "cron": "0 10 * * * *", "croner": { "maxRun": 3 }, "job": "server.processQueue" },
 * { "cron": "0 30 * * * *", "job": { "server.processQueue": { "name": "queue1" } } },
 * { "cron": "0 5 * * * *", "job": [ { "scraper.run": { "url": "host1" } }, { "scraper.run": { "url": "host2" } } ] }
 *
 * @memberof module:jobs
 * @method scheduleCronjob
 */
mod.scheduleCronjob = function(jobspec)
{
    jobspec = this.isJob(jobspec);
    if (util.types.isNativeError(jobspec)) {
        logger.error("scheduleCronjob:", "invalid", jobspec);
        return false;
    }
    if (lib.toBool(jobspec.disabled)) {
        return false;
    }
    logger.debug('scheduleCronjob:', jobspec);
    try {
        if (!this.croner) this.croner = require('croner');
        var cj = new this.croner.Cron(jobspec.cron, jobspec.croner || {}, (job) => {
            mod.submitJob(job.jobspec, { queueName: job.jobspec.queueName || mod.cronQueue }, (err) => {
                if (err) logger.error("scheduleCronjob:", err, job.jobspec);
            });
        });
        cj.jobspec = jobspec;
        this.crontab.push(cj);
        return true;
    } catch (e) {
        logger.error("scheduleCronjob:", e, jobspec);
        return false;
    }
}

/**
 * Schedule a list of cron jobs, types is used to cleanup previous jobs for the same type for cases when
 * a new list needs to replace the existing jobs. Empty list does nothing, to reset the jobs for the particular type and
 * empty invalid jobs must be passed, like: ```[ {} ]```
 * @param {string} type
 * @param {object[]} list
 * @returns {int} number of cron jobs actually scheduled.
 * @memberof module:jobs
 * @method scheduleCronjobs
 */
mod.scheduleCronjobs = function(type, list)
{
    if (!Array.isArray(list)) return 0;
    this.crontab = this.crontab.filter((cj) => {
        if (cj.jobspec._type != type) return 1;
        cj.stop();
        return 0;
    });
    var n = 0
    list.forEach((js) => {
        js._type = type;
        if (mod.scheduleCronjob(js)) n++;
    });
    return n;
}

/**
 * Load crontab from JSON file as list of job specs:
 * - cron - cron time interval spec: 'second' 'minute' 'hour' 'dayOfMonth' 'month' 'dayOfWeek'
 * - croner - optional object with additional properties for the Croner object
 * - job - a string as obj.method or an object with job name as property name and the value is an object with
 *    additional jobspec for the job passed as first argument, a job callback always takes jobspec and callback as 2 arguments
 * - disabled - disable the job but keep in the cron file, it will be ignored
 * - queueName - name of the queue where to submit this job, if not given it uses cron-queue
 * - uniqueTtl - defines that this job must be the only one in the queue for the number of milliseconds specified, after that
 *    time another job with the same arguments can be submitted.
 *
 * The expressions used by Croner(https://croner.56k.guru) are very similar to those of Vixie Cron, but with a few additions and changes as outlined below:
 *
 * ┌──────────────── (optional) second (0 - 59)
 * │ ┌────────────── minute (0 - 59)
 * │ │ ┌──────────── hour (0 - 23)
 * │ │ │ ┌────────── day of month (1 - 31)
 * │ │ │ │ ┌──────── month (1 - 12, JAN-DEC)
 * │ │ │ │ │ ┌────── day of week (0 - 6, SUN-Mon)
 * │ │ │ │ │ │       (0 to 6 are Sunday to Saturday; 7 is Sunday, the same as 0)
 * │ │ │ │ │ │
 * * * * * * *
 *
 * @example
 *
 * [ { cron: "0 0 * * * *", job: "scraper.run" }, ..]
 *
 * @memberof module:jobs
 * @method loadCronjobs
 */
mod.loadCronjobs = function()
{
    if (!this.cronFile) return;

    fs.readFile(this.cronFile, (err, data) => {
        if (err) return logger.error("loadCronjobs:", err);
        mod.parseCronjobs("file", data);

        if (this._cwatcher) this._cwatcher.close();
        this._cwatcher = fs.watch(this.cronFile, () => {
            clearTimeout(this._ctimer);
            this._ctimer = setTimeout(mod.loadCronjobs.bind(mod), 5000);
        });
    });
}

// Parse a JSON data with cron jobs and schedule for the given type, this can be used to handle configuration properties
mod.parseCronjobs = function(type, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();
    if (typeof data != "string" || !data.length) return;
    var hash = lib.hash(data);
    if (!this._hash) this._hash = {};
    if (this._hash[type] == hash) return;
    this._hash[type] = hash;
    var n = this.scheduleCronjobs(type, lib.jsonParse(data, { datatype: "list", logger: "error" }));
    logger.info("parseCronjobs:", type, n, "jobs");
    return n;
}


