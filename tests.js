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
api = backend.core;
db = backend.core;
server = backend.core;
logger = backend.logger;

function test_account() 
{
    var key = core.random() + "@test.com";
    async.series([
        function(next) {
            call(key, "/account/add?id=" + key + "&secret=" + secret + "&name=Test&birthday=" + core.strftime(""), function(data) {
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
    function() {
        exit();
    });
}

backend.run(function() {

    logger.log('tests: started'); 
    var start = core.mnow();
    function exit() {
        logger.log("tests: stopped", core.mnow() - start, "ms");
        process.exit(0);
    }
    
    switch(core.getArg("-cmd")) {
    case "account":
        test_account();
        break;
    }

});


