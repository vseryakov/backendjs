//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.test_js -test-cmd db ....
//

var fs = require("fs");
var cluster = require('cluster');
var util = require('util');
var path = require('path');
var child_process = require('child_process');
var bkjs = require('backendjs')
var bkutils = require('bkjs-utils');
var bkcache = require('bkjs-cache');
var core = bkjs.core;
var lib = bkjs.lib;
var ipc = bkjs.ipc;
var api = bkjs.api;
var db = bkjs.db;
var aws = bkjs.aws;
var server = bkjs.server;
var logger = bkjs.logger;

// Test object with functions for different areas to be tested
var tests = {
    name: "tests",
};
module.exports = tests;

// To be used in the tests, this function takes the following arguments:
//
// check(next, err, failure, ....)
//  - next is a callback to be called after printing error condition if any, it takes err as its argument
//  - err - is the error object passed by the most recent operation
//  - failure - must be true for failed test, the condition is evaluated by the caller and this is the result of it
//  - all other arguments are printed in case of error or result being false
//
//  NOTE: In forever mode (-test-forever) any error is ignored and not reported
//
// Example
//
//          function(next) {
//              db.get("bk_account", { id: "123" }, function(err, row) {
//                  tests.check(next, err, row && row.id == "123", "Record not found", row)
//              });
//          }
tests.check = function()
{
    var next = arguments[0], err = null;
    if (this.test.forever) return next();

    if (arguments[1] || arguments[2]) {
        var args = [ arguments[1] || new Error("failed condition") ];
        for (var i = 3; i < arguments.length; i++) args.push(arguments[i]);
        logger.error(args);
        err = args[0];
    }
    if (this.test.timeout) return setTimeout(function() { next(err) }, this.test.timeout);
    next(err);
}

// Run the test function which is defined in the tests module, all arguments will be taken from the options or the command line. Options
// use the same names as command line arguments without preceeding test- part.
//
// The common command line arguments that supported:
// - -test-cmd - name of the function to run
// - -test-workers - number of workers to run the test at the same time
// - -test-delay - number of milliseconds before starting worker processes, default is 500ms
// - -test-timeout - number of milliseconds between test steps, i.e. between invocations of the check
// - -test-interval - number of milliseconds between iterations
// - -test-iterations - how many times to run this test function, default is 1
// - -test-forever - run forever without reporting any errors, for performance testing
// - -test-file - a javascript file to be loaded with additional tests
//
// All other common command line arguments are used normally, like -db-pool to specify which db to use.
//
// After finish or in case of error the process exits if no callback is given.
//
// Example:
//
//          var bkjs = require("backendjs"), db = bkjs.db, tests = bkjs.tests;
//
//          tests.test_mytest = function(next) {
//             db.get("bk_account", { id: "123" }, function(err, row) {
//                 tests.check(next, err, row && row.id == "123", "Record not found", row)
//             });
//          }
//          tests.run();
//
//          # node tests.js -test-cmd mytest
//
//
// To perform server API testing, tests can be run with the app server and executed in the job worker,
// just pass a job name to be executed by the master. This can be run along the primary application but
// requires some configuration to be performed first:
//
// - create a user for backend testing, if the API does not require authentiction skip this step:
//
//           ./app.sh -shell -account-add login testuser secret testpw
//
// - configure global backend credentials
//
//           echo "backend-login=testuser" >> etc/config.local
//           echo "backend-secret=testpw" >> etc/config.local
//
// - to start a test command in the shell using local ./tests.js
//
//         ./app.sh -shell -test-run -test-cmd account
//
// - to start a test command in the shell using custom file with tests
//
//         ./app.sh -shell -test-run -test-cmd apitest -test-file tests/api.js
//
tests.run = function(options, callback)
{
    var self = this;
    if (!options) options = {};

    core.init(options, function(err) {
        if (err) {
            if (cluster.isMaster && typeof callback == "function") return callback(err);
            process.exit(1);
        }
        self.test = { role: cluster.isMaster ? "master" : "worker", iterations: 0, stime: Date.now() };
        self.test.delay = options.delay || lib.getArgInt("-test-delay", 500);
        self.test.countdown = options.iterations || lib.getArgInt("-test-iterations", 1);
        self.test.forever = options.forever || lib.getArgInt("-test-forever", 0);
        self.test.timeout = options.timeout || lib.getArgInt("-test-timeout", 0);
        self.test.interval = options.interval || lib.getArgInt("-test-interval", 0);
        self.test.keepmaster = options.keepmaster || lib.getArgInt("-test-keepmaster", 0);
        self.test.workers = options.workers || lib.getArgInt("-test-workers", 0);
        self.test.cmd = options.cmd || lib.getArg("-test-cmd");
        self.test.file = options.file || lib.getArg("-test-file");
        if (self.test.file && fs.existsSync(self.test.file)) require(self.test.file);
        if (self.test.file && fs.existsSync(core.cwd + "/" + self.test.file)) require(core.cwd + "/" + self.test.file);

        if (!self['test_' + self.test.cmd]) {
            var cmds = Object.keys(self).filter(function(x) { return x.substr(0, 5) == "test_" && typeof self[x] == "function" }).map(function(x) { return x.substr(5) }).join(", ");
            logger.log(self.name, "usage: ", process.argv[0], process.argv[1], "-test-cmd", "CMD", "where CMD is one of: ", cmds);
            if (cluster.isMaster && typeof callback == "function") return callback("invalid arguments");
            process.exit(1);
        }

        if (cluster.isMaster) {
            setTimeout(function() { for (var i = 0; i < self.test.workers; i++) cluster.fork(); }, self.test.delay);
            cluster.on("exit", function(worker) {
                if (!Object.keys(cluster.workers).length && !self.test.forever && !self.test.keepmaster) process.exit(0);
            });
        }

        logger.log(self.name, "started:", cluster.isMaster ? "master" : "worker", 'name:', self.test.cmd, 'db-pool:', core.modules.db.pool);

        lib.whilst(
            function () { return self.test.countdown > 0 || self.test.forever || options.running; },
            function (next) {
                self.test.countdown--;
                self["test_" + self.test.cmd](function(err) {
                    self.test.iterations++;
                    if (self.test.forever) err = null;
                    setTimeout(function() { next(err) }, self.test.interval);
                });
            },
            function(err) {
                self.test.etime = Date.now();
                if (err) {
                    logger.error(self.name, "failed:", self.test.role, 'name:', self.test.cmd, err);
                    if (cluster.isMaster && typeof callback == "function") return callback(err);
                    process.exit(1);
                }
                logger.log(self.name, "stopped:", self.test.role, 'name:', self.test.cmd, 'db-pool:', core.modules.db.pool, 'time:', self.test.etime - self.test.stime, "ms");
                if (cluster.isMaster && typeof callback == "function") return callback();
                process.exit(0);
            });
    });
};

tests.resetTables = function(tables, callback)
{
    db.dropTables(tables, function() {
        db.createTables(callback);
    });
}

tests.startTestServer = function(options)
{
    var self = this;
    if (!options) options = {};

    if (!options.master) {
        options.running = options.stime = options.etime = options.id = 0;
        aws.getInstanceInfo(function() {
            setInterval(function() {
                core.sendRequest({ url: options.host + '/ping/' + core.instance.id + '/' + options.id }, function(err, params) {
                    if (err) return;
                    logger.debug(params.obj);

                    switch (params.obj.cmd) {
                    case "exit":
                    case "error":
                        process.exit(0);
                        break;

                    case "register":
                        options.id = params.obj.id;
                        break;

                    case "start":
                        if (options.running) break;
                        options.running = true;
                        options.stime = Date.now();
                        if (options.callback) {
                            options.callback(options);
                        } else
                        if (options.test) {
                            self.run(options);
                        }
                        break;

                    case "stop":
                        if (!options.running) break;
                        options.running = false;
                        options.etime = Date.now();
                        break;

                    case "shutdown":
                        self.shutdown();
                        break;
                    }
                });

                // Check shutdown interval
                if (!options.running) {
                    var now = Date.now();
                    if (!options.etime) options.etime = now;
                    if (now - options.etime > (options.idlelimit || 3600000)) core.shutdown();
                }
            }, options.interval || 5000);
        });
        return;
    }

    var nodes = {};
    var app = express();
    app.on('error', function (e) { logger.error(e); });
    app.use(function(req, res, next) { return api.checkQuery(req, res, next); });
    app.use(app.routes);
    app.use(function(err, req, res, next) {
        logger.error('startTestMaster:', req.path, err, err.stack);
        res.json(err);
    });
    try { app.listen(options.port || 8080); } catch(e) { logger.error('startTestMaster:', e); }

    // Return list of all nodes
    app.get('/nodes', function(req, res) {
        res.json(nodes)
    });

    // Registration: instance, id
    app.get(/^\/ping\/([a-z0-9-]+)\/([a-z0-9]+)/, function(req, res) {
        var now = Date.now();
        var obj = { cmd: 'error', mtime: now }
        var node = nodes[req.params[1]];
        if (node) {
            node.instance = req.params[0];
            node.mtime = now;
            obj.cmd = node.state;
        } else {
            obj.cmd = 'register';
            obj.id = lib.uuid();
            nodes[obj.id] = { state: 'stop', ip: req.connection.remoteAddress, mtime: now, stime: now };
        }
        logger.debug(obj);
        res.json(obj)
    });

    // Change state of the node(es)
    app.get(/^\/(start|stop|launch|shutdown)\/([0-9]+)/, function(req, res, next) {
        var obj = {}
        var now = Date.now();
        var state = req.params[0];
        var num = req.params[1];
        switch (state) {
        case "launch":
            break;

        case "shutdown":
            var instances = {};
            for (var n in nodes) {
                if (num <= 0) break;
                if (!instances[nodes[n].instance]) {
                    instances[nodes[n].instance] = 1;
                    num--;
                }
            }
            for (var n in nodes) {
                var node = nodes[n];
                if (node && node.state != state && instances[node.instance]) {
                    node.state = state;
                    node.stime = now;
                }
            }
            logger.log('shutdown:', instances);
            break;

        default:
            for (var n in nodes) {
                if (num <= 0) break;
                var node = nodes[n];
                if (node && node.state != state) {
                    node.state = state;
                    node.stime = now;
                    num--;
                }
            }
        }
        res.json(obj);
    });

    var interval = options.interval || 30000;
    var runlimit = options.runlimit || 3600000;

    setInterval(function() {
        var now = Date.now();
        for (var n in nodes) {
            var node = nodes[n]
            // Last time we saw this node
            if (now - node.mtime > interval) {
                logger.debug('cleanup: node expired', n, node);
                delete nodes[n];
            } else
            // How long this node was in this state
            if (now - node.stime > runlimit) {
                switch (node.state) {
                case 'start':
                    // Stop long running nodes
                    node.state = 'stop';
                    logger.log('cleanup: node running too long', n, node)
                    break;
                }
            }
        }
    }, interval);

    logger.log('startTestMaster: started', options || "");
}

// Below are test routines, each routine must start with `test_` to be used in -test-cmd
tests.test_account = function(callback)
{
    var myid, otherid;
    var login = lib.random();
    var secret = login;
    var gender = ['m','f'][lib.randomInt(0,1)];
    var bday = new Date(lib.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
    var latitude = lib.randomNum(this.bbox[0], this.bbox[2]);
    var longitude = lib.randomNum(this.bbox[1], this.bbox[3]);
    var name = "Name" + lib.randomInt(0, 1000);
    var email = "test@test.com"
    var icon = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABp0RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjUuMTAw9HKhAAAAPElEQVQoU2NggIL6+npjIN4NxIIwMTANFFAC4rtA/B+kAC6JJgGSRCgAcs5ABWASMHoVw////3HigZAEACKmlTwMfriZAAAAAElFTkSuQmCC";
    var msgs = null, icons = [];

    lib.series([
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, birthday: lib.strftime(bday, "%Y-%m-%d") }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/del", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || params.obj.name != name, "err1:", params.obj);
            });
        },
        function(next) {
            var query = { login: login + 'other', secret: secret, name: name + ' Other', gender: gender, birthday: lib.strftime(bday, "%Y-%m-%d") }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                otherid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, email: email, birthday: lib.strftime(bday, "%Y-%m-%d") }
            for (var i = 1; i < process.argv.length - 1; i++) {
                var d = process.argv[i].match(/^\-account\-(.+)$/);
                if (!d) continue;
                if (d[1] == "icon") {
                    icons.push(process.argv[++i]);
                } else {
                    query[d[1]] = process.argv[++i];
                }
            }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                myid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            if (!icons.length) return next();
            // Add all icons from the files
            var type = 0;
            lib.forEachSeries(icons, function(icon, next2) {
                icon = lib.readFileSync(icon, { encoding : "base64" });
                var options = { url: "/account/put/icon", login: login, secret: secret, method: "POST", postdata: { icon: icon, type: type++, acl_allow: "allow" }  }
                core.sendRequest(options, function(err, params) {
                    next2(err);
                });
            }, next);
        },
        function(next) {
            var options = { url: "/location/put", login: login, secret: secret, query: { latitude: latitude, longitude: longitude } };
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/update",login: login, secret: secret, query: { alias: "test" + name }, type: "testadmin", latitude: 1, ltime: 1, type: "admin" };
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/put/secret", login: login, secret: secret, query: { secret: "test" } };
            core.sendRequest(options, function(err, params) {
                secret = "test";
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                tests.check(next,err, !params.obj || params.obj.name != name || params.obj.alias != "test" + name || params.obj.latitude != latitude || params.obj.type, "err2:",params.obj);
            });
        },
        function(next) {
            var options = { url: "/account/put/icon", login: login, secret: secret, query: { icon: icon, type: 98, acl_allow: "all" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/put/icon", login: login, secret: secret, method: "POST", postdata: { icon: icon, type: 99, _width: 128, _height: 128, acl_allow: "auth" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/select/icon", login: login, secret: secret, query: { _consistent: 1 } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || params.obj.length!=2+icons.length || !params.obj[0].acl_allow || !params.obj[0].prefix, "err2-1:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/account/get", login: login, secret: secret, query: { id: otherid } }
            core.sendRequest(options, function(err, params) {
                tests.check(next,err, !params.obj || params.obj.length!=1 || params.obj[0].name, "err3:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/add", login: login, secret: secret, query: { peer: otherid, type: "like" }  }
            core.sendRequest(options, function(err, params) {
                options = { url: "/connection/add", login: login, secret: secret, query: { peer: otherid, type: "follow" }  }
                core.sendRequest(options, function(err, params) {
                    next(err);
                });
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "like" } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err4:", params.obj.count, params.obj.data);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || params.obj.like0!=1 || params.obj.follow0!=1, "err5:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/del", login: login, secret: secret, query: { peer: otherid, type: "like" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "follow" } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err6:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "follow", _accounts: 1 } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err7:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || params.obj.follow0!=1 || params.obj.ping!=0, "err8:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/del", login: login, secret: secret, query: {} }
            core.sendRequest(options, function(err, params) {
                next(err, "err5-3:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err9:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/counter/incr", login: login, secret: secret, query: { ping: "1" } }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || params.obj.like0!=0 || params.obj.ping!=1, "err10:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, query: { id: otherid, msg: "test123" }  }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj, "err7:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, query: { id: myid, icon: icon }  }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj, "err8:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, method: "POST", postdata: { id: myid, msg: "test000" }  }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj, "err11:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2, "err12:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2 || msgs.data[0].sender!=myid, "err13:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/archive", login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj, "err14:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/image", login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { _archive: 1 } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err15:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err16:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/sent", login: login, secret: secret, query: { recipient: otherid } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1 || params.obj.data[0].recipient!=otherid || params.obj.data[0].msg!="test123", "err15:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/archive", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2, "err17:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/del/archive", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                next(err, "err18:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/archive", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                tests.check(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err20:" , params.obj);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.test_location = function(callback)
{
    var self = this;
    var tables = {
            geo: { geohash: { primary: 1, index: 1, semipub: 1 },
                   id: { type: "int", primary: 1, pub: 1 },
                   latitude: { type: "real", semipub: 1, projection: 1 },
                   longitude: { type: "real", semipub: 1, projection: 1 },
                   distance: { type: "real" },
                   rank: { type: 'int', index: 1 },
                   status: { value: 'good', projection: 1 },
                   mtime: { type: "bigint", now: 1 }
            },
    };
    var locations = { LA: { name: "Los Angeles",  bbox: [ 33.60503975233155, -117.72825045393661, 34.50336024766845, -118.75374954606342 ], },
                      DC: { name: "Washington", bbox: [ 30.10, -77.5, 38.60, -76.5 ], },
                      SD: { name: "San Diego", bbox: [ 32.26553975233155, -118.8279466261797, 33.163860247668445, -115.4840533738203 ], },
                      SF: { name: "San Francisco", bbox: [ 37.32833975233156, -122.86154379633437, 38.22666024766845, -121.96045620366564 ] }, };
    var city = lib.getArg("-city", "LA");
    var bbox = (locations[city] || locations.LA).bbox;
    var rows = lib.getArgInt("-rows", 10);
    var distance = lib.getArgInt("-distance", 25);
    var round = lib.getArgInt("-round", 0);
    var reset = lib.getArgInt("-reset", 1);
    var latitude = lib.getArgInt("-lat", lib.randomNum(bbox[0], bbox[2]))
    var longitude = lib.getArgInt("-lon", lib.randomNum(bbox[1], bbox[3]))

    var rc = [], top = {}, bad = 0, good = 0, error = 0, count = rows/2;
    var ghash, gcount = Math.floor(count/2);
    // New bounding box for the tests
    bbox = bkutils.geoBoundingBox(latitude, longitude, distance);
    // To get all neighbors, we can only guarantee searches in the neighboring areas, even if the distance is within it
    // still can be in the box outside of the immediate neighbors, minDistance is an approximation
    var geo = lib.geoHash(latitude, longitude, { distance: distance });

    db.describeTables(tables);

    lib.series([
        function(next) {
            if (!cluster.isMaster && !reset) return next();
            self.resetTables(tables, next);
        },
        function(next) {
            if (!reset) return next();
            lib.whilst(
                function () { return good < rows + count; },
                function (next2) {
                    var lat = lib.randomNum(bbox[0], bbox[2]);
                    var lon = lib.randomNum(bbox[1], bbox[3]);
                    var obj = lib.geoHash(lat, lon);
                    obj.distance = lib.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance == null || obj.distance > distance) return next2();
                    // Make sure its in the neighbors
                    if (geo.neighbors.indexOf(obj.geohash) == -1) return next2();
                    // Create several records in the same geohash box
                    if (good > rows && ghash != obj.geohash) return next2();
                    good++;
                    obj.id = String(good);
                    obj.rank = good;
                    ghash = obj.geohash;
                    db.add("geo", obj, { silence_error: 1 }, function(err) {
                        if (!err) {
                            // Keep track of all records by area for top search by rank
                            if (!top[obj.geohash]) top[obj.geohash] = [];
                            top[obj.geohash].push(obj.rank);
                        } else {
                            good--;
                            if (error++ < 10) err = null;
                        }
                        next2(err);
                    });
                },
                function(err) {
                    next(err);
                });
        },
        function(next) {
            if (!reset) return next();
            // Records beyond our distance
            bad = good;
            lib.whilst(
                function () { return bad < good + count; },
                function (next2) {
                    var lat = lib.randomNum(bbox[0], bbox[2]);
                    var lon = lib.randomNum(bbox[1], bbox[3]);
                    var obj = lib.geoHash(lat, lon);
                    obj.distance = lib.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance == null || obj.distance <= distance || obj.distance > distance*2) return next2();
                    bad++;
                    obj.id = String(bad);
                    obj.rank = bad;
                    obj.status = "bad";
                    db.add("geo", obj, { silence_error: 1 }, function(err) {
                        if (err) {
                            bad--;
                            if (error++ < 10) err = null;
                        }
                        next2(err);
                    });
                },
                function(err) {
                    next(err);
                });
        },
        function(next) {
            // Scan all locations, do it in small chunks to verify we can continue within the same geohash area
            var query = { latitude: latitude, longitude: longitude, distance: distance };
            var options = { count: gcount, round: round };
            lib.doWhilst(
                function(next2) {
                    db.getLocations("geo", query, options, function(err, rows, info) {
                        options = info.next_token;
                        rows.forEach(function(x) { rc.push({ id: x.geohash + ":" + x.id, status: x.status }) })
                        next2();
                    });
                },
                function() { return options },
                function(err) {
                    var ids = {};
                    var isok = rc.every(function(x) { ids[x.id] = 1; return x.status == 'good' })
                    tests.check(next, err, rc.length!=good || Object.keys(ids).length!=good, "err1: ", rc.length, good, 'RC:', rc, ids);
                });
        },
        function(next) {
            // Scan all good locations with the top 3 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good", rank: good-3 };
            var options = { round: round, ops: { rank: 'gt' } };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' && x.rank > good-3 });
                tests.check(next, err, rows.length!=3 || !isok, "err2:", rows.length, isok, good, rows);
            });
        },
        function(next) {
            // Scan all locations beyond our good distance, get all bad with top 2 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance*2, status: "bad", rank: bad-2 };
            var options = { round: round, ops: { rank: 'gt' }, sort: "rank", desc: true };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'bad' && x.rank > bad-2 });
                tests.check(next, err, rows.length!=2 || !isok, "err3:", rows.length, isok, bad, rows);
            });
        },
        function(next) {
            // Scan all neighbors within the distance and take top 2 ranks only, in desc order
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good" };
            var options = { round: round, sort: "rank", desc: true, count: 50, top: 2, select: "latitude,longitude,id,status,rank" };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' })
                var iscount = Object.keys(top).reduce(function(x,y) { return x + Math.min(2, top[y].length) }, 0);
                tests.check(next, err, rows.length!=iscount || !isok, "err4:", rows.length, iscount, isok, rows, 'TOP:', top);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.test_db_basic = function(callback)
{
    var self = this;
    var tables = {
            test1: { id: { primary: 1, pub: 1 },
                     num: { type: "int" },
                     num2: { type: "int" },
                     num3: { type: "text", join: ["id","num"], strict_join: 1 },
                     email: {},
                     anum: { join: ["anum","num"], unjoin: ["anum","num"] },
                     jnum: { join: ["num2","num4"], unjoin: ["num2","num4"], strict_join: 1 },
                     num4: { hidden: 1 },
            },
    };
    var now = Date.now();
    var id = lib.random(64);
    var id2 = lib.random(64);
    var next_token = null;
    var ids = [];

    db.describeTables(tables);

    lib.series([
        function(next) {
             self.resetTables(tables, next);
        },
        function(next) {
            db.add("test1", { id: id, email: id, num: '1', num3: 1, num4: 1, anum: 1 }, function(err) {
                if (err) return next(err);
                db.put("test1", { id: id2, email: id2, num2: "2", num3: 2, num4: "2", anum: 2 }, next);
            });
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.num != 1 || row.num3 != row.id+"|"+row.num || row.anum != "1" || row.jnum, "err1:", row);
            });
        },
        function(next) {
            db.get("test1", { id: id2 }, function(err, row) {
                tests.check(next, err, !row || row.num4 != "2" || row.jnum != row.num2 + "|" + row.num4, "err2:", row);
            });
        },
        function(next) {
            // Type conversion for strictTypes
            db.get("test1", { id: id, num: '1' }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.num!=1, "err4:", row);
            });
        },
        function(next) {
            db.list("test1", String([id,id2]),  {}, function(err, rows) {
                tests.check(next, err, rows.length!=2, "err5:", rows.length, rows);
            });
        },
        function(next) {
            db.select("test1", { id: id, fake: 1 }, function(err, rows) {
                tests.check(next, err, rows.length!=1, "err6:", rows);
            });
        },
        function(next) {
            db.delAll("test1", { id: id }, next);
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                tests.check(next, err, row, "err7:", row);
            });
        },
        function(next) {
            db.put("test1", { id: id, email: id, num: 1 }, function(err) {
                tests.check(next, err, 0, "err8:");
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test", num: 2 }, function(err, rc, info) {
                tests.check(next, err, info.affected_rows!=1, "err9:", info);
            });
        },
        function(next) {
            db.incr("test1", { id: id, num2: 2 }, function(err, rc, info) {
                tests.check(next, err, info.affected_rows!=1, "err10:", info);
            });
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                tests.check(next, err, !row || row.email != "test" || row.num != 2 || row.num2 != 2, "err11:", row);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.test_db = function(callback)
{
    var self = this;
    var tables = {
            test1: { id: { primary: 1, pub: 1 },
                     num: { type: "int" },
                     num2: {},
                     num3: { join: ["id","num"] },
                     email: {},
                     anum: { join: ["anum","num"], unjoin: ["anum","num"] },
                     jnum: { join: ["num2","num4"], unjoin: ["num2","num4"], strict_join: 1 },
                     num4: { hidden: 1 },
            },
            test2: { id: { primary: 1, pub: 1, index: 1 },
                     id2: { primary: 1, projection: 1 },
                     email: { projection: 1 },
                     alias: { pub: 1 },
                     birthday: { semipub: 1 },
                     json: { type: "json" },
                     num: { type: "bigint", index: 1, projection: 1 },
                     num2: { type: "real" },
                     mtime: { type: "bigint" } },
            test3: { id : { primary: 1, pub: 1 },
                     num: { type: "counter", value: 0, pub: 1 } },
            test4: { id: { primary: 1, pub: 1 },
                     type: { pub: 1 } },
            test5: { id: { primary: 1, pub: 1 },
                     hkey: { primary: 1, join: ["type","peer"], ops: { select: "begins_with" }  },
                     type: { pub: 1 },
                     peer: { pub: 1 } },
    };
    var now = Date.now();
    var id = lib.random(64);
    var id2 = lib.random(128);
    var num2 = lib.randomNum(1, 1000);
    var next_token = null;
    var ids = [];

    db.setProcessRow("post", "test4", function(op, row, options, cols) {
        var type = (row.type || "").split(":");
        row.type = type[0];
        row.mtime = type[1];
        return row;
    });

    db.describeTables(tables);

    lib.series([
        function(next) {
             self.resetTables(tables, next);
        },
        function(next) {
            db.add("test1", { id: id, email: id, num: '1', num2: null, num3: 1, num4: 1, anum: 1 }, function(err) {
                if (err) return next(err);
                db.put("test1", { id: id2, email: id2, num: '2', num2: "2", num3: 1, num4: "4", anum: 1 }, function(err) {
                    if (err) return next(err);
                    db.put("test3", { id: id, num: 0, email: id, anum: 1 }, next);
                });
            });
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.num != 1 || row.num3 != row.id+"|"+row.num || row.anum != "1" || row.jnum, "err1:", row);
            });
        },
        function(next) {
            db.get("test1", { id: id2 }, function(err, row) {
                tests.check(next, err, !row || row.num4 != "4" || row.jnum != row.num2 + "|" + row.num4, "err1-1:", row);
            });
        },
        function(next) {
            db.get("test3", { id: id }, function(err, row) {
                tests.check(next, err, !row || row.id != id, "err1-2:", row);
            });
        },
        function(next) {
            // Type conversion for strictTypes
            db.get("test1", { id: id, num: '1' }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.num!=1, "err2:", row);
            });
        },
        function(next) {
            db.list("test1", String([id,id2]),  {}, function(err, rows) {
                var isok = rows.every(function(x) { return x.id==id || x.id==id2});
                var row1 = rows.filter(function(x) { return x.id==id}).pop();
                var row2 = rows.filter(function(x) { return x.id==id2}).pop();
                tests.check(next, err, rows.length!=2 || !isok, "err3:", rows.length, isok, rows);
            });
        },
        function(next) {
            db.add("test2", { id: id, id2: '1', email: id, alias: id, birthday: id, num: 0, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.add("test2", { id: id2, id2: '2', email: id, alias: id, birthday: id, num: 2, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test2", { id: id2, id2: '1', email: id2, alias: id2, birthday: id2, num: 1, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test3", { id: id2, num: 2, emai: id2 }, next);
        },
        function(next) {
            db.put("test4", { id: id, type: "like:" + Date.now() }, next);
        },
        function(next) {
            db.select("test4", { id: id }, function(err, rows) {
                tests.check(next, err, rows.length!=1 || rows[0].id != id || rows[0].type!="like", "err4:", rows);
            });
        },
        function(next) {
            db.delAll("test1", { id: id }, next);
        },
        function(next) {
            db.select("test2", { id: id2 }, { filter: function(req, row, o) { return row.id2 == '1' } }, function(err, rows) {
                tests.check(next, err, rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2 , "err5:", num2, rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: ["2"] },  { ops: { id2: "in" } }, function(err, rows) {
                tests.check(next, err, rows.length!=1 || rows[0].id2!='2', "err5-1:", rows.length, rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: "" },  { ops: { id2: "in" } }, function(err, rows) {
                tests.check(next, err, rows.length!=2, "err5-2:", rows.length, rows);
            });
        },
        function(next) {
            db.list("test3", String([id,id2]), function(err, rows) {
                tests.check(next, err, rows.length!=2, "err6:", rows);
            });
        },
        function(next) {
            db.incr("test3", { id: id, num: 3 }, { mtime: 1 }, function(err) {
                if (err) return next(err);
                db.incr("test3", { id: id, num: 1 }, function(err) {
                    if (err) return next(err);
                    db.incr("test3", { id: id, num: -2 }, next);
                });
            });
        },
        function(next) {
            db.get("test3", { id: id }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.num != 2, "err7:", row);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'gt' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                tests.check(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '2' || rows[0].num2 != num2, "err8:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'begins_with' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                tests.check(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '1' || rows[0].num2 != num2, "err8-1:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: "1,2" }, { ops: { id2: 'between' } }, function(err, rows) {
                tests.check(next, err, rows.length!=2, "err8-2:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, num: "1,2" }, { ops: { num: 'between' } }, function(err, rows) {
                tests.check(next, err, rows.length!=2, "err8-3:", rows);
            });
        },
        function(next) {
            db.update("test2", { id: id, id2: '1', email: id + "@test", json: [1, 9], mtime: now }, function(err) {
                if (err) return next(err);
                db.replace("test2", { id: id, id2: '1', email: id + "@test", num: 9, mtime: now }, { check_mtime: 'mtime' }, next);
            });
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { consistent: true }, function(err, row) {
                tests.check(next, err, !row || row.id != id  || row.email != id+"@test" || row.num == 9 || !Array.isArray(row.json), "err9:", row);
            });
        },
        function(next) {
            now = Date.now();
            db.replace("test2", { id: id, id2: '1', email: id + "@test", num: 9, num2: 9, json: { a: 1, b: 2 }, mtime: now }, { check_data: 1 }, next);
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { skip_columns: ['alias'], consistent: true }, function(err, row) {
                tests.check(next, err, !row || row.id != id || row.alias || row.email != id+"@test" || row.num!=9 || lib.typeName(row.json)!="object" || row.json.a!=1, "err9-1:", row);
            });
        },
        function(next) {
            db.update("test2", { id: id, id2: '1', mtime: now+1 }, next);
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { consistent: true }, function(err, row) {
                tests.check(next, err, !row || row.id != id  || row.email != id+"@test" || row.num != 9, "err9-2:", row);
            });
        },
        function(next) {
            db.del("test2", { id: id2, id2: '1' }, next);
        },
        function(next) {
            db.get("test2", { id: id2, id2: '1' }, { consistent: true }, function(err, row) {
                tests.check(next, err, row, "del:", row);
            });
        },
        function(next) {
            lib.forEachSeries([1,2,3,4,5,6,7,8,9], function(i, next2) {
                db.put("test2", { id: id2, id2: String(i), email: id, alias: id, birthday: id, num: i, num2: i, mtime: now }, next2);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            lib.forEachSeries([1,2,3], function(i, next2) {
                db.put("test5", { id: id, type: "like", peer: i }, next2);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            // Check pagination
            next_token = null;
            var rc = [];
            lib.forEachSeries([2, 3], function(n, next2) {
                db.select("test2", { id: id2 }, { sort: "id2", start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    rc.push.apply(rc, rows);
                    next2(err);
                });
            }, function(err) {
                // Redis cannot sort due to hash implementation, known bug
                var isok = db.pool == "redis" ? rc.length>=5 : rc.length==5 && (rc[0].id2 == 1 && rc[rc.length-1].id2 == 5);
                tests.check(next, err, !isok, "err10:", rc.length, isok, rc, next_token);
            })
        },
        function(next) {
            // Check pagination with small page size with condition on the range key
            next_token = null;
            lib.forEachSeries([2, 3], function(n, next2) {
                db.select("test2", { id: id2, id2: '0' }, { sort: "id2", ops: { id2: 'gt' }, start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    var isok = db.pool == "redis" ? rows.length>=n : rows.length==n;
                    tests.check(next2, err, !isok || !info.next_token, "err11:", rows.length, n, info, rows);
                });
            },
            function(err) {
                if (err) return next(err);
                db.select("test2", { id: id2, id2: '0' }, { ops: { id2: 'gt' }, start: next_token, count: 5, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    var isnum = db.pool == "redis" ? rows.length>=3 : rows.length==4;
                    var isok = rows.every(function(x) { return x.id2 > '0' });
                    tests.check(next, err, !isnum || !isok, "err12:", isok, rows.length, rows, info);
                });
            });
        },
        function(next) {
            tests.check(next, null, next_token, "err13: next_token must be null", next_token);
        },
        function(next) {
            db.add("test2", { id: id, id2: '2', email: id, alias: id, birthday: id, num: 2, num2: 1, mtime: now }, next);
        },
        function(next) {
            // Select by primary key and other filter
            db.select("test2", { id: id, num: 9, num2: 9 }, {  ops: { num: 'ge', num2: 'ge' } }, function(err, rows, info) {
                tests.check(next, err, rows.length==0 || rows[0].num!=9 || rows[0].num2!=9, "err13:", rows, info);
            });
        },
        function(next) {
            // Wrong query property
            db.select("test2", { id: id, num: 9, num2: 9, email: 'fake' }, {  ops: { num: 'ge' } }, function(err, rows, info) {
                tests.check(next, err, rows.length!=0, "err14:", rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter
            db.select("test2", { num: 9 }, { ops: { num: 'ge' } }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num >= 9 });
                tests.check(next, err, rows.length==0 || !isok, "err15:", isok, rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter and sorting
            db.select("test2", { id: id2, num: 1 }, { ops: { num: 'gt' }, sort: "num" }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num > 1 });
                tests.check(next, err, rows.length==0 || !isok , "err16:", isok, rows, info);
            });
        },
        function(next) {
            // Query with sorting with composite key
            db.select("test2", { id: id2 }, { desc: true, sort: "id2" }, function(err, rows, info) {
                tests.check(next, err, rows.length==0 || rows[0].id2!='9' , "err17:", rows, info);
            });
        },
        function(next) {
            // Query with sorting by another column/index
            db.select("test2", { id: id2 }, { desc: true, sort: "num" }, function(err, rows, info) {
                tests.check(next, err, rows.length==0 || rows[0].num!=9 , "err18:", rows, info);
            });
        },
        function(next) {
            // Scan all records
            var rows = [];
            db.scan("test2", {}, { count: 2 }, function(row, next2) {
                rows.push(row);
                next2();
            }, function(err) {
                tests.check(next, err, rows.length!=11, "err19:", rows.length);
            });
        },
        function(next) {
            db.select("test5", { id: id }, {}, function(err, rows) {
                tests.check(next, err, rows.length!=3 , "err20:", rows);
            });
        },
        function(next) {
            db.select("test5", { id: id, type: "like" }, {}, function(err, rows) {
                tests.check(next, err, rows.length!=3 , "err21:", rows);
                // New hkey must be created in the list
                ids = rows.map(function(x) { delete x.hkey; return x });
            });
        },
        function(next) {
            db.list("test5", ids, {}, function(err, rows) {
                tests.check(next, err, rows.length!=3 , "err22:", rows);
            });
        },
        function(next) {
            db.get("test5", { id: id, type: "like", peer: 2 }, {}, function(err, row) {
                tests.check(next, err, !row, "err23:", row);
            });
        },
        function(next) {
            db.put("test1", { id: id, email: id, num: 1 }, function(err) {
                tests.check(next, err, 0, "err24:");
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test", num: 1 }, { expected: { id: id, email: id }, updateOps: { num: "incr" } }, function(err, rc, info) {
                tests.check(next, err, info.affected_rows!=1, "err25:", info);
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test", num: 1 }, { expected: { id: id, email: "test" }, updateOps: { num: "incr" } }, function(err, rc, info) {
                tests.check(next, err, info.affected_rows!=1, "err26:", info);
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test" }, { expected: { id: id, email: id } }, function(err, rc, info) {
                tests.check(next, err, info.affected_rows, "err27:", info);
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test" }, { expected: { id: id, num: 1 }, ops: { num: "gt" } }, function(err, rc, info) {
                tests.check(next, err, !info.affected_rows, "err28:", info);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.test_s3icon = function(callback)
{
    var id = lib.getArg("-id", "1");
    api.saveIcon(core.cwd + "/web/img/loading.gif", id, { prefix: "account", images: api.imagesS3 }, function(err) {
        var icon = api.iconPath(id, { prefix: "account" });
        aws.queryS3(api.imagesS3, icon, { file: "tmp/" + path.basename(icon) }, function(err, params) {
            console.log('icon:', lib.statSync(params.file));
            callback(err);
        });
    });
}

tests.test_icon = function(callback)
{
    api.putIcon({ body: {}, files: { 1: { path: __dirname + "/web/img/loading.gif" } } }, 1, { prefix: "account", width: 100, height: 100 }, function(err) {
        callback(err);
    });
}

tests.test_limiter = function(callback)
{
    var opts = {
        name: lib.getArg("-name", "test"),
        rate: lib.getArgInt("-rate", 10),
        max: lib.getArgInt("-max", 10),
        interval: lib.getArgInt("-interval", 1000),
        queueName: lib.getArg("-queue"),
        pace: lib.getArgInt("-pace", 5),
    };
    var list = [];
    for (var i = 0; i < lib.getArgInt("-count", 10); i++) list.push(i);

    ipc.initServer();
    setTimeout(function() {
        lib.forEachSeries(list, function(i, next) {
            lib.doWhilst(
              function(next2) {
                  ipc.limiter(opts, function(delay) {
                      opts.delay = delay;
                      logger.log("limiter:", opts);
                      setTimeout(next2, delay);
                  });
              },
              function() {
                  return opts.delay;
              },
              function() {
                  setTimeout(next, opts.pace);
              });
        }, callback);
    }, 1000);
}

tests.test_cookie = function(callback)
{
    core.httpGet('http://www.google.com', { cookies: true }, function(err, params) {
        console.log('COOKIES:', params.cookies);
        callback(err);
    });
}

tests.test_busy = function(callback)
{
    var work = 524288;
    bkutils.initBusy(lib.getArgInt("-busy", 100));
    var interval = setInterval(function worky() {
        var howBusy = bkutils.isBusy();
        if (howBusy) {
          work /= 4;
          console.log("I can't work! I'm too busy:", howBusy + "ms behind");
        }
        work *= 2;
        for (var i = 0; i < work;) i++;
        console.log("worked:",  work);
      }, 100);
}

tests.test_cache = function(callback)
{
    var self = this;
    core.msgType = "none";
    core.cacheBind = "127.0.0.1";
    core.cacheHost = "127.0.0.1";
    var nworkers = lib.getArgInt("-test-workers");

    function run1(cb) {
        lib.series([
           function(next) {
               ipc.put("a", "1");
               ipc.put("b", "1");
               ipc.put("c", "1");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   tests.check(next, null, val!="1", "value must be 1, got", val)
               });
           },
           function(next) {
               ipc.get(["a","b","c"], function(val) {
                   tests.check(next, null, !val||val.a!="1"||val.b!="1"||val.c!="1", "value must be {a:1,b:1,c:1} got", val)
               });
           },
           function(next) {
               ipc.incr("a", 1);
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   tests.check(next, null, val!="2", "value must be 2, got", val)
               });
           },
           function(next) {
               ipc.put("a", "3");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   tests.check(next, null, val!="3", "value must be 3, got", val)
               });
           },
           function(next) {
               ipc.incr("a", 1);
               setTimeout(next, 10);
           },
           function(next) {
               ipc.put("c", {a:1});
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("c", function(val) {
                   val = lib.jsonParse(val)
                   tests.check(next, null, !val||val.a!=1, "value must be {a:1}, got", val)
               });
           },
           function(next) {
               ipc.del("b");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("b", function(val) {
                   tests.check(next, null, val!="", "value must be '', got", val)
               });
           },
           ],
           function(err) {
                if (!err) return cb();
                ipc.keys(function(keys) {
                    var vals = {};
                    lib.forEachSeries(keys || [], function(key, next) {
                        ipc.get(key, function(val) { vals[key] = val; next(); })
                    }, function() {
                        logger.log("keys:", vals);
                        cb(err);
                    });
                });
        });
    }

    function run2(cb) {
        lib.series([
           function(next) {
               ipc.get("a", function(val) {
                   tests.check(next, null, val!="4", "value must be 4, got", val)
               });
           },
           ],
           function(err) {
            cb(err);
        });
    }

    if (cluster.isMaster) {
        ipc.on("ready", function(msg) {
            if (nworkers == 1) return this.send({ op: "run1" });
            if (this.id == 1) return this.send({ op: "init" });
            if (this.id > 1) return this.send({ op: "run1" });
        });
        ipc.on("done", function(msg) {
            if (nworkers == 1) return;
            if (this.id > 1) cluster.workers[1].send({ op: "run2" });
        });
        if (!self.test.iterations) {
            ipc.initServer();
            setInterval(function() { logger.log('keys:', bkcache.lruKeys()); }, 1000);
        }
    } else {
        ipc.onMessage = function(msg) {
            switch (msg.op) {
            case "init":
                if (self.test.iterations) break;
                core.cacheBind = core.ipaddrs[0];
                core.cachePort = 20000;
                ipc.initServer();
                ipc.initWorker();
                break;

            case "run2":
                run2(function(err) {
                    if (!err) ipc.sendMsg("done");
                    callback(err);
                });
                break;

            case "run1":
                run1(function(err) {
                    if (!err) ipc.sendMsg("done");
                    callback(err);
                });
                break;
            }
        }
        if (!self.test.iterations) {
            ipc.initWorker();
        }
        ipc.sendMsg("ready");
    }
}

tests.test_pool = function(callback)
{
    var options = { min: lib.getArgInt("-min", 1),
                    max: lib.getArgInt("-max", 5),
                    idle: lib.getArgInt("-idle", 0),
                    create: function(cb) { cb(null,{ id:Date.now()}) }
    }
    var list = [];
    var pool = lib.createPool(options)
    lib.series([
       function(next) {
           console.log('pool0:', pool.stats(), 'list:', list.length);
           for (var i = 0; i < 5; i++) {
               pool.acquire(function(err, obj) { list.push(obj); console.log('added:', list.length); });
           }
           console.log('pool1:', pool.stats(), 'list:', list.length);
           next();
       },
       function(next) {
           while (list.length) {
               pool.release(list.shift());
           }
           next();
       },
       function(next) {
           console.log('pool2:', pool.stats(), 'list:', list.length);
           pool.acquire(function(err, obj) { list.push(obj); console.log('added:', list.length); });
           next();
       },
       function(next) {
           console.log('pool3:', pool.stats(), 'list:', list.length);
           pool.release(list.shift());
           next();
       },
       function(next) {
           setTimeout(function() {
               console.log('pool4:', pool.stats(), 'list:', list.length);
               next();
           }, options.idle*2);
       }], callback);
}

tests.test_config = function(callback)
{
    var argv = ["-uid", "1",
                "-proxy-port", "3000",
                "-api-allow-path", "^/a",
                "-api-allow-admin", "^/a",
                "-api-allow-account-dev=^/a",
                "-api-allow-anonymous=^/a",
                "-api-redirect-url", '{ "^a/$": "a", "^b": "b" }',
                "-logwatcher-email-error", "a",
                "-logwatcher-file-error", "a",
                "-logwatcher-file", "b",
                "-logwatcher-match-error", "a",
                "-db-create-tables",
                "-db-sqlite-pool-max", "10",
                "-db-sqlite-pool-1", "a",
                "-db-sqlite-pool-max-1", "10",
                "-db-sqlite-pool-cache-columns-1", "1",
            ];
    core.parseArgs(argv);
    logger.debug("poolParams:", db.poolParams);
    if (core.uid != 1) return callback("invalid uid");
    if (core.proxy.port != 3000) return callback("invalid proxy-port");
    if (!db._createTables) return callback("invalid create-tables");
    if (!db.poolParams.sqlite || db.poolParams.sqlite.max != 10) return callback("invalid sqlite max");
    if (!db.poolParams.sqlite1 || db.poolParams.sqlite1.url != "a") return callback("invalid sqlite1 url");
    if (db.poolParams.sqlite1.max != 10) return callback("invalid sqlite1 max");
    if (!db.poolParams.sqlite1.poolOptions.cacheColumns) return callback("invalid sqlite1 cache-columns");
    if (core.logwatcherEmail.error != "a") return callback("invalid logwatcher email:" + JSON.stringify(core.logwatcherEmail));
    if (core.logwatcherMatch.error.indexOf("a") == -1) return callback("invalid logwatcher match: " + JSON.stringify(core.logwatcherMatch));
    if (!core.logwatcherFile.some(function(x) { return x.file == "a" && x.type == "error"})) return callback("invalid logwatcher file: " + JSON.stringify(core.logwatcherFile));
    if (!core.logwatcherFile.some(function(x) { return x.file == "b"})) return callback("invalid logwatcher file: " + JSON.stringify(core.logwatcherFile));
    if (!api.allow.list.some(function(x) { return x == "^/a"})) return callback("invalid allow path");
    if (!api.allowAdmin.list.some(function(x) { return x == "^/a"})) return callback("invalid allow admin");
    callback();
}

tests.test_logwatcher = function(callback)
{
    var email = lib.getArg("-email");
    if (!email) return callback("-email is required")

    var argv = ["-logwatcher-email-error", email,
                "-logwatcher-email-test", email,
                "-logwatcher-email-warning", email,
                "-logwatcher-email-any", email,
                "-logwatcher-match-test", "TEST: ",
                "-logwatcher-match-any", "line:[0-9]+"
            ];
    var lines = [
                " ERROR: error1",
                " continue error1",
                "[] WARN: warning1",
                " backtrace test line:123",
                "[] TEST: test1",
                "[] ERROR: error2",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                " backtrace test line:456",
            ];
    core.parseArgs(argv);
    fs.appendFile(core.logFile, lines.join("\n"));
    core.watchLogs(function(err, errors) {
        console.log(errors);
        callback();
    });
}

tests.test_dblock = function(callback)
{
    var self = this;
    var tables = {
        dbtest: { id: { primary: 1, pub: 1 },
                  mtime: { type: "bigint" },
                  status: {}, },
    };

    var id = "ID";
    var interval = lib.getArgInt("-interval", 500);
    var count = lib.getArgInt("-count", 0);

    function queueJob(name, callback) {
        var now = Date.now(), mtime;
        db.get("dbtest", { id: id }, function(err, rc) {
            if (rc) {
                mtime = rc.mtime;
                // Ignore if the period is not expired yet
                if (now - mtime < interval) return callback();
                // Try to update the record using the time we just retrieved, this must be atomic/consistent in the database
                db.update("dbtest", { id: id, mtime: now, status: "running" }, { silence_error: 1, expected: { id: id, mtime: mtime } }, function(err, rc, info) {
                    if (err) return callback(err);
                    if (!info.affected_rows) return callback();
                    // We updated the record, we can start the job now
                    logger.log(name, "U: START A JOB", mtime, now);
                    return callback();
                });
            } else {
                db.add("dbtest", { id: id, mtime: now, status: "running" }, { silence_error: 1 }, function(err) {
                    // Cannot create means somebody was ahead of us, ingore
                    if (err) return callback(err);
                    // We created a new record, now we can start the job now
                    logger.log(name, "A: START A JOB", now, now);
                    return callback();
                });
            }
        });
    }

    lib.series([
        function(next) {
            if (cluster.isWorker) return next();
            self.resetTables(tables, next);
        },
        function(next) {
            for (var i = 0; i < count; i++) queueJob(i, lib.noop);
            queueJob(100, function() { next() });
        },
        function(next) {
            queueJob(200, function() { setTimeout(next, interval - 1) });
        },
        function(next) {
            for (var i = 0; i < count; i++) queueJob(i + 300, lib.noop);
            queueJob(400, function() { next() });
        },
        function(next) {
            setTimeout(next, 1000)
        },
    ], callback);
}

tests.test_dynamodb = function(callback)
{
    var a = {a:1,b:2,c:"3",d:{1:1,2:2},e:[1,2],f:[{1:1},{2:2}],g:true,h:null,i:["a","b"]};
    var b = aws.toDynamoDB(a);
    var c = aws.fromDynamoDB(b);
    logger.debug("dynamodb: from", a)
    logger.debug("dynamodb: to", b)
    logger.debug("dynamodb: to", c)
    if (JSON.stringify(a) != JSON.stringify(c)) return callback("Invalid convertion from " + JSON.stringify(c) + "to" + JSON.stringify(a));
    callback();
}

// Run main server if we execute this as standalone program
if (!module.parent) tests.run();
