//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var bkjs = require('backendjs');
var bkdebug = require("bkjs-debug");
var logger = bkjs.logger;
var api = bkjs.api;

// System management
var debug = {
    name: "debug"
};
module.exports = debug;

// Initialize the module
debug.init = function(options)
{
}

// Create API endpoints and routes
debug.configureWeb = function(options, callback)
{
    this.configureDebugAPI();
    callback()
}

// Start/stop CPU V8 profiler, on stop, core.cpuProfile will contain the profiler nodes
debug.cpuProfiler = function(cmd)
{
    switch(type + "." + cmd) {
    case "get":
        return this.cpuProfile;

    case "start":
        bkdebug.startProfiling();
        break;

    case "stop":
        this.cpuProfile = bkdebug.stopProfiling();
        break;

    case "clear":
        this.cpuProfile = null;
        bkdebug.deleteAllProfiles();
        break;
    }
}

debug.heapProfiler = function(cmd, options)
{
    switch (cmd) {
    case "get":
        var snapshot = bkdebug.takeSnapshot();
        bkdebug.deleteAllSnapshots();
        return snapshot;

    case "save":
        var snapshot = bkdebug.takeSnapshot();
        snapshot.save((options && options.file) || ("tmp/" + process.pid + ".heapsnapshot"));
        bkdebug.deleteAllSnapshots();
        break;

    case "take":
        this.heapSnapshot = bkdebug.takeSnapshot();
        break;

    case "clear":
        this.heapSnapshot = null;
        bkdebug.deleteAllSnapshots();
        break;
    }
}

// API for internal provisioning and configuration
debug.configureDebugAPI = function()
{
    var self = this;
    // Return current statistics
    api.app.all(/^\/debug\/(cpu|heap)\/([a-z]+)/, function(req, res) {
        var options = api.getOptions(req);
        switch (req.params[0]) {
        case "cpu":
            res.json(self.cpuProfiler(req.params[1]) || {});
            break;

        case "heap":
            res.json(self.heapProfiler(req.params[1]) || {});
            break;

        default:
            api.sendReply(res, 400, "Invalid command:" + req.params[0]);
        }
    });
}

