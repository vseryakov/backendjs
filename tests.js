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
	    	if (err) logger.error(self.name, "failed:", type, err);
	    	logger.log(self.name, "stopped:", type, core.mnow() - self.start_time, "ms");
	    	process.exit(0);
	    });
};

tests.accounts = function(callback) 
{
	var secret = core.random();
    var email = secret + "@test.com";
    var gender = ['m','f'][core.randomInt(0,1)];
    var bday = new Date(core.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
    var latitude = core.randomNum(bbox[0], bbox[2]);
    var longitude = core.randomNum(bbox[1], bbox[3]);
    var name = core.toTitle(gender == 'm' ? males[core.randomInt(0, males.length - 1)] : females[core.randomInt(0, females.length - 1)]);
    
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
            var options = { email: email, secret: secret }
            core.sendRequest("/account/get", options, function(err, params) {
                console.log('ACCOUNT:', params.obj);
                next(err);
            });
        }
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
    
tests.cookies = function(callback) 
{
	core.httpGet('http://www.google.com', { cookies: true }, function(err, params) {
		console.log('COOKIES:', params.cookies);
		callback(err);
	});
}

tests.locations = function(callback) 
{
	var self = this;
	var tables = {
			geo: [ { name: "id", pub: 1 },
			       { name: "geohash", primary: 1 },
			       { name: "georange", primary: 1 },
                   { name: "latitude", type: "real" },
                   { name: "longitude", type: " real" },
			       { name: "mtime", type: "int" } ],	
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
			test: [ { name: "id", primary: 1, pub: 1 },
			        { name: "range", primary: 1 },
			        { name: "email", unique: 1 },
			        { name: "alias", pub: 1 },
			        { name: "birthday", semipub: 1 },
			        { name: "num", type: "int" },
			        { name: "json", type: "json" },
			        { name: "mtime", type: "int" } ],	
	};
	var now = core.now();
	var id = core.random(64);
	var id2 = core.random(128);
	var next_token = null;
	async.series([
	    function(next) {
	    	db.initTables(tables, next);
	    },
	    function(next) {
	    	db.add("test", { id: id, range: '1', email: id, alias: id, birthday: id, mtime: now }, next);
	    },
	    function(next) {
	    	db.add("test", { id: id2, range: '2', email: id, alias: id, birthday: id, mtime: now }, next);
	    },
	    function(next) {
	    	db.put("test", { id: id2, range: '1', email: id2, alias: id2, birthday: id2, mtime: now }, next);
	    },
	    function(next) {
	    	db.incr("test", { id: id, range: '1', num: 1 }, function(err) {
	    		db.incr("test", { id: id, range: '1', num: 1 }, function(err) {
	    			db.incr("test", { id: id, range: '1', num: 0 }, next);
	    		});
	    	});
	    },
	    function(next) {
	    	db.get("test", { id: id }, { skip_columns: ['email'] }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id && !rows[0].email || rows[0].num != 2 ? (err || "err1:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	db.select("test", { id: id2, range: '1' }, { ops: { range: 'GT' }, select: 'id,range,mtime' }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].email || rows[0].range != '2' ? (err || "err2:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	db.select("test", { id: [id,id2] }, { select: 'id,mtime' }, function(err, rows) {
	    		next(err || rows.length!=3 || rows[0].email ? (err || "err3:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	db.list("test", String([id,id2]), { public_columns: 1, keys: ['id'] }, function(err, rows) {
	    		next(err || rows.length!=3 || rows[0].email ? (err || "err4:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	db.update("test", { id: id, email: id + "@test", json: [1, 9], mtime: now }, function(err) {
	    		db.replace("test", { id: id, email: id + "@test", num: 9, mtime: now }, { check_mtime: 'mtime' }, next);
	    	});
	    },
	    function(next) {
	    	db.get("test", { id: id }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id  || rows[0].email != id+"@test" || rows[0].num == 9 || !Array.isArray(rows[0].json) ? (err || "err5:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	now = core.now;
	    	db.replace("test", { id: id, email: id + "@test", num: 9, mtime: now }, { check_data: 1 }, next);
	    },
	    function(next) {
	    	db.get("test", { id: id }, function(err, rows) {
	    		next(err || rows.length!=1 || rows[0].id != id  || rows[0].email != id+"@test" || rows[0].num!=9 ? (err || "err6:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	db.del("test", { id: id2, range: '1' }, next);
	    },
	    function(next) {
	    	db.get("test", { id: id2 }, function(err, rows) {
	    		next(err || rows.length!=1 ? (err || "del:" + util.inspect(rows)) : 0);
	    	});
	    },
	    function(next) {
	    	async.forEachSeries([1,2,3,4,5,6,7,8,9,10], function(i, next2) {
	    		db.put("test", { id: id2, range: i, email: id, alias: id, birthday: id, mtime: now }, next2);
	    	}, function(err) {
	    		next(err);
	    	});
	    },
	    function(next) {
	    	db.select("test", { id: id2, range: '1' }, { ops: { range: 'GT' }, count: 2, select: 'id,range' }, function(err, rows, info) {
	    		next_token = info.next_token;
	    		next(err || rows.length!=2 || !info.next_token ? (err || "err7:" + util.inspect(rows, info)) : 0);
	    	});
	    },
	    function(next) {
	    	db.select("test", { id: id2, range: '1' }, { ops: { range: 'GT' }, start: next_token, count: 2, select: 'id,range' }, function(err, rows, info) {
	    		next(err || rows.length!=2 || !info.next_token ? (err || "err8:" + util.inspect(rows, info)) : 0);
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


