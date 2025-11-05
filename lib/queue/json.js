/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const Client = require(__dirname + "/client");
const fs = require("fs");

/**
 * Queue client using JSON files, one event per line.
 *
 * File name format: queueName-YYYY-MM-DDTHH:MM:SS.MSECZ-SEQNUM
 *
 * The URL must look like: `json://...`.
 * If no path is given it is placed in the current directory.
 *
 * Files are rotated by size or number of lines whatever is met first,
 * use cache config options `bk-size` and `bk-count` to set
 *
 * @example
 *      -queue-events json://
 *      -queue-events json:///path/accesslog-?bk-count=1000&bk-size=1000000
 * @module
 */

const client = {
    name: "json",

    create: function(options) {
        if (/^json:\/\//.test(options?.url)) return new JSONClient(options);
    }
};

module.exports = client;

class JSONClient extends Client {

    file
    name
    seq = 0
    size = 0;
    count = 0;

    constructor(options) {
        super(options);
        this.name = client.name;
        this.applyOptions();
        this.emit("ready");
    }

    submit(events, options, callback) {
        logger.dev("submit:", this.url, events, options);

        lib.series([
            (next) => {
                if (this.file) return next();
                this.name = `${this.pathname || ""}-${this.queueName}-${new Date().toISOString()}-${this.seq++}.json`;
                fs.open(this.name, 'w', (err, handle) => {
                    if (!err) this.file = handle;
                    next(err);
                });
            },

            (next) => {
                if (!Array.isArray(events)) events = [events];
                fs.write(this.file, events.map(x => {
                    var line = JSON.stringify(x) + "\n";
                    this.count++;
                    this.size += line.length;
                    return line;
                }).join(""), next);
            },

            (next) => {
                if ((this.options.size > 0 && this.size >= this.options.size) ||
                    (this.options.count > 0 && this.count >= this.options.count)) {
                    logger.debug("submit:", this.url, "closing", this.name, this.size, this.count);
                    this.file = null;
                    this.size = this.count = 0;
                }
                next();
            },

        ], callback, true);
    }
}

