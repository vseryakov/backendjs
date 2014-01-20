//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.js -cmd account ....
//

var util = require('util');
var path = require('path');
var async = require('async');
var backend = require('backend')
core = backend.core;
api = backend.api;
db = backend.db;
aws = backend.aws;
server = backend.server;
logger = backend.logger;

var females = [ "mary", "patricia", "linda", "barbara", "elizabeth", "jennifer", "maria", "susan", 
                "carol", "ruth", "sharon", "michelle", "laura", "sarah", "kimberly", "deborah", "jessica", 
                "heather", "teresa", "doris", "gloria", "evelyn", "jean", "cheryl", "mildred", 
                "katherine", "joan", "ashley", "judith"];

var males = [ "james", "john", "robert", "michael", "william", "david", "richard", "charles", "joseph", 
              "thomas", "christopher", "daniel", "paul", "mark", "donald", "george", "kenneth", "steven", 
              "justin", "terry", "gerald", "keith", "samuel", "willie", "ralph", "lawrence", "nicholas", 
              "roy", "benjamin"];

var location = "Los Angeles";
var bbox = [ 33.60503975233155, -117.72825045393661, 34.50336024766845, -118.75374954606342 ]; // Los Angeles 34.05420, -118.24100

// Test object with function for different ares to be tested
var tests = {
    name: 'tests',
    start_time: 0,
};

tests.start = function(type) 
{
	var self = this;
	if (!this[type]) {
		logger.error(this.name, 'no such test:', type);
		process.exit(1);
	}
	this.start_time = core.mnow();
	var count = core.getArgInt("-iterations", 1);
	switch (core.getArg("-bbox")) {
	case "SF":
		location = "San Francisco";
		bbox = [ 37.32833975233156, -122.86154379633437, 38.22666024766845, -121.96045620366564 ];  // San Francisco 37.77750, -122.41100
		break;
	case "SD": 
		location = "San Diego";
		bbox = [ 32.26553975233155, -118.8279466261797, 33.163860247668445, -115.4840533738203 ]; // San Diego 32.71470, -117.15600
		break;
	}
        
	logger.log(self.name, "started:", type);
	async.whilst(
	    function () { return count > 0; },
	    function (next) {
	    	count--;
	    	self[type](next);
	    },
	    function(err) {
	    	if (err) {
	    	    logger.error(self.name, "failed:", type, err);
	    	} else {
	    	    logger.log(self.name, "stopped:", type, core.mnow() - self.start_time, "ms");
	    	}
	    	process.exit(0);
	    });
};

tests.account = function(callback) 
{
    var id = core.random();
	var secret = core.random();
    var email = secret + "@test.com";
    var gender = ['m','f'][core.randomInt(0,1)];
    var bday = new Date(core.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
    var latitude = core.randomNum(bbox[0], bbox[2]);
    var longitude = core.randomNum(bbox[1], bbox[3]);
    var name = core.toTitle(gender == 'm' ? males[core.randomInt(0, males.length - 1)] : females[core.randomInt(0, females.length - 1)]);
    var icon = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABp0RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjUuMTAw9HKhAAAAPElEQVQoU2NggIL6+npjIN4NxIIwMTANFFAC4rtA/B+kAC6JJgGSRCgAcs5ABWASMHoVw////3HigZAEACKmlTwMfriZAAAAAElFTkSuQmCC";

    async.series([
        function(next) {
            var query = { email: email, secret: secret, name: name, alias: name, gender: gender, birthday: core.strftime(bday, "%Y-%m-%d") }
            core.sendRequest("/account/add", { query: query }, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { latitude: latitude, longitude: longitude, location: location } };
            core.sendRequest("/location/put", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { alias: "test" + name } };
            core.sendRequest("/account/update", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret }
            core.sendRequest("/account/get", options, function(err, params) {
                next(err || !params.obj || params.obj.name != name || params.obj.alias != "test" + name || params.obj.latitude != latitude ? (err || "err1:" + util.inspect(params.obj)) : 0);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { secret: "test" } };
            core.sendRequest("/account/put/secret", options, function(err, params) {
                secret = "test";
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { icon: icon }  }
            core.sendRequest("/account/put/icon", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret }
            core.sendRequest("/account/get", options, function(err, params) {
                next(err || !params.obj || !params.obj.icon0 ? (err || "err1:" + util.inspect(params.obj)) : 0);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { id: id, type: "like" }  }
            core.sendRequest("/connection/add", options, function(err, params) {
                options = { email: email, secret: secret, query: { id: core.random(), type: "like" }  }
                core.sendRequest("/connection/add", options, function(err, params) {
                    next(err);
                });
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { type: "like" } }
            core.sendRequest("/connection/get", options, function(err, params) {
                next(err || !params.obj || params.obj.length!=2 ? (err || "err2:" + util.inspect(params.obj)) : 0);
            });
        },
        function(next) {
            var options = { email: email, secret: secret }
            core.sendRequest("/counter/get", options, function(err, params) {
                next(err || !params.obj || params.obj.like!=2 ? (err || "err3:" + util.inspect(params.obj)) : 0);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { id: id, type: "like" }  }
            core.sendRequest("/connection/del", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { email: email, secret: secret, query: { type: "like" } }
            core.sendRequest("/connection/get", options, function(err, params) {
                next(err || !params.obj || params.obj.length!=1 ? (err || "err4:" + util.inspect(params.obj)) : 0);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.s3icon = function(callback) 
{
	var id = core.getArg("-id", "1");
	api.putIconS3("../web/img/loading.gif", id, { prefix: "account" }, function(err) {
		var icon = core.iconPath(id, { prefix: "account" });
		aws.queryS3(api.imagesS3, icon, { file: "tmp/" + path.basename(icon) }, function(err, params) {
			console.log('icon:', core.statSync(params.file));
			callback(err);
		});
	});
}
    
tests.icon = function(callback) 
{
    api.putIcon({ body: {}, files: { 1: { path: "../web/img/loading.gif" } } }, 1, { prefix: "account" }, function(err) {
        callback(err);
    });
}

tests.cookie = function(callback) 
{
	core.httpGet('http://www.google.com', { cookies: true }, function(err, params) {
		console.log('COOKIES:', params.cookies);
		callback(err);
	});
}

tests.location = function(callback) 
{
	var self = this;
	var tables = {
			geo: { id: { pub: 1 },
			       geohash: { primary: 1 },
			       georange: { primary: 1 },
                   latitude: { type: "real" },
                   longitude: { type: "real" },
			       mtime: { type: "int" } 
			},	
	};
    var rows = core.getArgInt("-rows", 1);
    var options = {};
    
    async.series([
        function(next) {
        	db.initTables(tables, next);
        },
        function(next) {
        	async.whilst(
        		    function () { return rows > 0; },
        		    function (next2) {
        		    	rows--;
        	            var latitude = core.randomNum(bbox[0], bbox[2]);
        	            var longitude = core.randomNum(bbox[1], bbox[3]);
        	            var obj = core.geoHash(latitude, longitude);
        	            obj.georange += ":" + rows;
        		    	db.put("geo", obj, next2);
        		    },
        		    function(err) {
        		    	next(err);
        		    });

        },
        function(next) {
        	options.latitude = core.randomNum(bbox[0], bbox[2]);
        	options.longitude = core.randomNum(bbox[1], bbox[3]);
            options.distance = core.getArgInt("-distance", 2);
            options.count = core.getArgInt("-count", 5);
            options.calc_distance = 1;
            db.getLocations("geo", options, function(err, rows, info) {
            	logger.debug('geo1:', rows.length, 'records', options, 'rows:', rows);
                next(err);
            });
        },
        function(next) {
            db.getLocations("geo", options, function(err, rows, info) {
            	logger.debug('geo2:', rows.length, 'records', options, 'rows:', rows);
                next(err);
            });
        }
    ],
    function(err) {
        callback(err);
    });
}

tests.db = function(callback) 
{
	var self = this;
	var tables = {
	        test1: { id: { primary: 1, pub: 1 } },
			test2: { id: { primary: 1, pub: 1 },
			         range: { primary: 1 },
			         email: { },
			         alias: { pub: 1 },
			         birthday: { semipub: 1 },
			         json: { type: "json" },
			         num: { type: "int" },
			         mtime: { type: "int" } },	
			test3: { id : { primary: 1 },
			         num: { type: "counter", value: 0 } },
	};
	var now = core.now();
	var id = core.random(64);
	var id2 = core.random(128);
	var next_token = null;
	async.series([
	    function(next) {
	        logger.log('TEST: create');
	    	db.initTables(tables, next);
	    },
	    function(next) {
            logger.log('TEST: add1');
            db.add("test1", { id: id }, function() {
                db.add("test1", { id: id2 }, next);
            });
        },
        function(next) {
            logger.log('TEST: put1');
            db.put("test3", { id: id, num: 0 }, next);
        },
        function(next) {
            logger.log('TEST: get add');
            db.get("test1", { id: id }, function(err, rows) {
                next(err || rows.length!=1 || rows[0].id != id);
            });
        },
        function(next) {
            logger.log('TEST: list');
            db.list("test1", String([id,id2]), { public_columns: 1 }, function(err, rows) {
                next(err || rows.length!=2 || rows[0].email ? (err || "err4:" + util.inspect(rows)) : 0);
            });
        },
	    function(next) {
	        logger.log('TEST: add2');
	    	db.add("test2", { id: id, range: '1', email: id, alias: id, birthday: id, num: 0, mtime: now }, next);
	    },
	    function(next) {
	        logger.log('TEST: add3');
	    	db.add("test2", { id: id2, range: '2', email: id, alias: id, birthday: id, num: 0, mtime: now }, next);
	    },
	    function(next) {
	        logger.log('TEST: add4');
	    	db.put("test2", { id: id2, range: '1', email: id2, alias: id2, birthday: id2, num: 0, mtime: now }, next);
	    },
	    function(next) {
	        logger.log('TEST: incr');
	    	db.incr("test3", { id: id, num: 1 }, { mtime: 1 }, function(err) {
	    		db.incr("test3", { id: id, num: 1 }, function(err) {
	    		    db.incr("test3", { id: id, num: -1 }, next);
	    		});
	    	});
	    },
	    function(next) {
	        logger.log('TEST: get after incr');
	    	db.get("test3", { id: id }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id && rows[0].num != 1 ? (err || "err1:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: select columns');
	    	db.select("test2", { id: id2, range: '1' }, { ops: { range: 'gt' }, select: 'id,range,mtime' }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].email || rows[0].range != '2' ? (err || "err3:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
            logger.log('TEST: select columns2');
            db.select("test2", { id: id2, range: '1' }, { ops: { range: 'begins_with' }, select: 'id,range,mtime' }, function(err, rows) {
                next(err || rows.length!=1 || rows[0].email || rows[0].range != '1' ? (err || "err3:" + util.inspect(rows)) : 0);
            });
        },
	    function(next) {
	        logger.log('TEST: update');
	    	db.update("test2", { id: id, range: '1', email: id + "@test", json: [1, 9], mtime: now }, function(err) {
	    	    logger.log('TEST: replace after update');
	    		db.replace("test2", { id: id, range: '1', email: id + "@test", num: 9, mtime: now }, { check_mtime: 'mtime' }, next);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: get after update');
	    	db.get("test2", { id: id, range: '1' }, { consistent: true }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id  || rows[0].email != id+"@test" || rows[0].num == 9 || !Array.isArray(rows[0].json) ? (err || "err5:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: replace');
	    	now = core.now();
	    	db.replace("test2", { id: id, range: '1', email: id + "@test", num: 9, mtime: now }, { check_data: 1 }, next);
	    },
	    function(next) {
	        logger.log('TEST: get after replace');
	    	db.get("test2", { id: id, range: '1' }, { skip_columns: ['alias'], consistent: true }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id  || rows[0].alias || rows[0].email != id+"@test" || rows[0].num!=9 ? (err || "err6:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: del');
	    	db.del("test2", { id: id2, range: '1' }, next);
	    },
	    function(next) {
	        logger.log('TEST: get after del');
	    	db.get("test2", { id: id2, range: '1' }, { consistent: true }, function(err, rows) {
	    		next(err || rows.length!=0 ? (err || "del:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: put series');
	    	async.forEachSeries([1,2,3,4,5,6,7,8,9,10], function(i, next2) {
	    		db.put("test2", { id: id2, range: String(i), email: id, alias: id, birthday: id, mtime: now }, next2);
	    	}, function(err) {
	    		next(err);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: select range');
	    	db.select("test2", { id: id2, range: '1' }, { ops: { range: 'gt' }, count: 2, select: 'id,range' }, function(err, rows, info) {
	    		next_token = info.next_token;
	    		next(err || rows.length!=2 || !info.next_token ? (err || "err7:" + util.inspect(rows, info)) : 0);
	    	});
	    },
	    function(next) {
	        logger.log('TEST: select next range');
	    	db.select("test2", { id: id2, range: '1' }, { ops: { range: 'gt' }, start: next_token, count: 2, select: 'id,range' }, function(err, rows, info) {
	    		next(err || rows.length!=2 || rows[0].range !='3' || !info.next_token ? (err || "err8:" + util.inspect(rows, info)) : 0);
	    	});
	    },
	],
	function(err) {
		callback(err);
	});
}

tests.leveldb = function(callback)
{
    var ldb = null;
    async.series([
        function(next) {
            new backend.backend.LevelDB(core.path.spool + "/ldb", { create_if_missing: true }, function(err) {
                ldb = this;
                next(err);
            });
        },
        function(next) {
            for (var i = 0; i < 100; i++) {
                ldb.putSync(String(i), String(i));
            }
            next();
        },
        function(next) {
            async.forEachSeries([100,101,102,103], function(i, next) {
                ldb.put(String(i), String(i), next);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            ldb.get("1", function(err, val) {
                next(err || val != "1" ? (err || "err1:" + util.inspect(val)) : 0);
            });
        },
        function(next) {
            ldb.all("100", "104", function(err, list) {
                next(err || list.length != 4 ? (err || "err2:" + util.inspect(list)) : 0);
            });
        },
    ],
    function(err) {
        callback(err);
    });    
}

// By default use data/ inside the source tree, if used somewhere else, config or command line parameter should be used for home
core.parseArgs(["-home", "data"]);

backend.run(function() {
    tests.start(core.getArg("-cmd"));
});


