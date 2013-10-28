//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.js -cmd account ....
//

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
        logger.log(self.name, "started:", type);
        
        this[type](function(err) {
            logger.log(self.name, "stopped:", type, core.mnow() - self.start_time, "ms", err || "");
            process.exit(err ? 1 : 0);    
        });
    },
    
    accounts: function(callback) {
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

    s3: function(callback) {
        api.putIconS3("../web/img/loading.gif", 1, { prefix: "account" }, function(err) {
            api.getIconS3(1, { prefix: "account", file: "tmp/1.jpg" }, function(err) {
                console.log('icon:', core.statSync("tmp/1.jpg"));
            });
        });
    },
    
    cookies: function(callback) {
        core.httpGet('http://google.com', { cookies: true }, function(err, params) {
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


