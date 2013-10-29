//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.js -cmd account ....
//

var path = require('path');
var async = require('async');
var backend = require('backend')
core = backend.core;
api = backend.api;
db = backend.db;
aws = backend.aws;
server = backend.server;
logger = backend.logger;

// Test object with function for different ares to be tested
var tests = {
    name: 'tests',
    start_time: 0,
    
    start: function(type) {
        var self = this;
        if (!this[type]) {
            logger.error(this.name, 'no such test:', type);
            process.exit(1);
        }
        this.start_time = core.mnow();
        var count = core.getArgInt("-count", 1);
        
        logger.log(self.name, "started:", type);
        async.whilst(
           function () { return count > 0; },
           function (next) {
               count--;
               self[type](next);
           },
           function(err) {
               if (err) logger.error(self.name, "failed:", type, err);
               logger.log(self.name, "stopped:", type, core.mnow() - self.start_time, "ms");
               process.exit(0);
           });
    },
    
    accounts: function(callback) {
        var email = core.random() + "@test.com";
        var secret = core.random();
        var bbox = [ 37.79, -122.505, 37.2, -122.0 ];  // San Francisco area
        
        async.series([
            function(next) {
                var d = new Date(core.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
                var query = { email: email, secret: secret, name: core.random(), birthday: core.strftime(d, "%Y-%m-%d") }
                core.sendRequest("/account/add", { query: query }, function(err, params) {
                    next(err);
                });
            },
            function(next) {
                var options = { email: email, secret: secret }
                core.sendRequest("/account/get", options, function(err, params) {
                    console.log('ACCOUNT:', params.obj);
                    next(err);
                });
            },
            function(next) {
                var options = { email: email, secret: secret, query: { latitude: core.randomNum(bbox[0], bbox[2]), longitude: core.randomNum(bbox[1], bbox[3]), location: "San Francisco" } };
                core.sendRequest("/account/location/put", options, function(err, params) {
                    next(err);
                });
            },
            function(next) {
                var options = { email: email, secret: secret }
                core.sendRequest("/account/get", options, function(err, params) {
                    console.log('ACCOUNT:', params.obj);
                    next(err);
                });
            }
        ],
        function(err) {
            callback(err)
        });
    },

    locations: function(callback) {
        var key = core.random() + "@test.com";
        async.series([
            function(next) {
                core.sendRequest("/account/add?email=" + email + "&secret=" + secret + "&name=&birthday=" + core.strftime(""), function(data) {
                    next();
                });
            },
            function(next) {
                call(key, "/account/get", function(data) {
                    next();
                });
            },
            function(next) {
                call(key, "/account/location/put?latitude=10&longitude=-10&location=test", function(data) {
                    next();
                });
            },
            function(next) {
                call(key, "/account/get", function(data) {
                    next();
                });
            }
        ],
        function(err) {
            callback(err)
        });
    },

    s3icon: function(callback) {
        var id = core.getArg("-id", "1");
        api.putIconS3("../web/img/loading.gif", id, { prefix: "account" }, function(err) {
            var icon = core.iconPath(id, { prefix: "account" });
            aws.queryS3(api.imagesS3, icon, { file: "tmp/" + path.basename(icon) }, function(err, params) {
                console.log('icon:', core.statSync(params.file));
                callback(err);
            });
        });
    },
    
    cookies: function(callback) {
        core.httpGet('http://www.google.com', { cookies: true }, function(err, params) {
            console.log('COOKIES:', params.cookies);
            callback(err);
        });
    },
};

// By default use data/ inside the source tree, if used somewhere else, config or command line parameter should be used for home
core.parseArgs(["-home", "data"]);

backend.run(function() {
    tests.start(core.getArg("-cmd"));
});


