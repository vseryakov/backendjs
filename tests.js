//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.js -cmd account ....
//

var fs = require("fs");
var cluster = require('cluster');
var util = require('util');
var path = require('path');
var async = require('async');
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;
var backend = require('backendjs')
core = backend.core;
ipc = backend.ipc;
api = backend.api;
db = backend.db;
aws = backend.aws;
server = backend.server;
logger = backend.logger;
bn = backend.backend;

var females = [ "mary", "patricia", "linda", "barbara", "elizabeth", "jennifer", "maria", "susan",
                "carol", "ruth", "sharon", "michelle", "laura", "sarah", "kimberly", "deborah", "jessica",
                "heather", "teresa", "doris", "gloria", "evelyn", "jean", "cheryl", "mildred",
                "katherine", "joan", "ashley", "judith"];

var males = [ "james", "john", "robert", "michael", "william", "david", "richard", "charles", "joseph",
              "thomas", "christopher", "daniel", "paul", "mark", "donald", "george", "kenneth", "steven",
              "justin", "terry", "gerald", "keith", "samuel", "willie", "ralph", "lawrence", "nicholas",
              "roy", "benjamin"];

var locations = { LA: { name: "Los Angeles",  bbox: [ 33.60503975233155, -117.72825045393661, 34.50336024766845, -118.75374954606342 ], },
                  DC: { name: "Washington", bbox: [ 30.10, -77.5, 38.60, -76.5 ], },
                  SD: { name: "San Diego", bbox: [ 32.26553975233155, -118.8279466261797, 33.163860247668445, -115.4840533738203 ], },
                  SF: { name: "San Francisco", bbox: [ 37.32833975233156, -122.86154379633437, 38.22666024766845, -121.96045620366564 ] }, };

// Test object with functions for different areas to be tested
var tests = {
    city: "",
    bbox: [0, 0, 0, 0],
};

tests.account = function(callback)
{
    var myid, otherid;
    var id = core.random();
    var login = id;
	var secret = id;
    var gender = ['m','f'][core.randomInt(0,1)];
    var bday = new Date(core.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
    var latitude = core.randomNum(this.bbox[0], this.bbox[2]);
    var longitude = core.randomNum(this.bbox[1], this.bbox[3]);
    var name = core.toTitle(gender == 'm' ? males[core.randomInt(0, males.length - 1)] : females[core.randomInt(0, females.length - 1)]);
    var icon = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABp0RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjUuMTAw9HKhAAAAPElEQVQoU2NggIL6+npjIN4NxIIwMTANFFAC4rtA/B+kAC6JJgGSRCgAcs5ABWASMHoVw////3HigZAEACKmlTwMfriZAAAAAElFTkSuQmCC";
    var msgs = null, icons = [];

    async.series([
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, birthday: core.strftime(bday, "%Y-%m-%d") }
            core.sendRequest("/account/add", { sign: false, query: query }, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/account/del", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.name != name, "err1:", params.obj);
            });
        },
        function(next) {
            var query = { login: login + 'other', secret: secret, name: name + ' Other', gender: gender, birthday: core.strftime(bday, "%Y-%m-%d") }
            core.sendRequest("/account/add", { sign: false, query: query }, function(err, params) {
                otherid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, birthday: core.strftime(bday, "%Y-%m-%d") }
            for (var i = 1; i < process.argv.length - 1; i++) {
                var d = process.argv[i].match(/^\-account\-(.+)$/);
                if (!d) continue;
                if (d[1] == "icon") {
                    icons.push(process.argv[++i]);
                } else {
                    query[d[1]] = process.argv[++i];
                }
            }
            core.sendRequest("/account/add", { sign: false, query: query }, function(err, params) {
                myid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            if (!icons.length) return next();
            // Add all icons from the files
            var type = 0;
            async.forEachSeries(icons, function(icon, next2) {
                icon = fs.readFileSync(icon).toString("base64");
                var options = { login: login, secret: secret, method: "POST", postdata: { icon: icon, type: type++, acl_allow: "allow" }  }
                core.sendRequest("/account/put/icon", options, function(err, params) {
                    next2(err);
                });
            }, next);
        },
        function(next) {
            var options = { login: login, secret: secret, query: { latitude: latitude, longitude: longitude } };
            core.sendRequest("/location/put", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { alias: "test" + name } };
            core.sendRequest("/account/update", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { secret: "test" } };
            core.sendRequest("/account/put/secret", options, function(err, params) {
                secret = "test";
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/account/get", options, function(err, params) {
                core.checkTest(next,err, !params.obj || params.obj.name != name || params.obj.alias != "test" + name || params.obj.latitude != latitude, "err1:",params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { icon: icon, type: 98, acl_allow: "all" }  }
            core.sendRequest("/account/put/icon", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, method: "POST", postdata: { icon: icon, type: 99, _width: 128, _height: 128, acl_allow: "auth" }  }
            core.sendRequest("/account/put/icon", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { _consistent: 1 } }
            core.sendRequest("/account/select/icon", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.length!=2+icons.length || !params.obj[0].acl_allow, "err2:", params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { id: id, type: "like" }  }
            core.sendRequest("/connection/add", options, function(err, params) {
                options = { login: login, secret: secret, query: { id: core.random(), type: "like" }  }
                core.sendRequest("/connection/add", options, function(err, params) {
                    next(err);
                });
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { type: "like" } }
            core.sendRequest("/connection/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2, "err3:",params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/counter/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.like0!=2, "err4:", params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { id: id, type: "like" }  }
            core.sendRequest("/connection/del", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { type: "like" } }
            core.sendRequest("/connection/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err5:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/counter/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.like0!=1 || params.obj.ping!=0, "err6:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: {} }
            core.sendRequest("/connection/del", options, function(err, params) {
                next(err, "err5:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { } }
            core.sendRequest("/connection/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err5-1:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { ping: "1" } }
            core.sendRequest("/counter/incr", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/counter/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.like0!=0 || params.obj.ping!=1, "err66:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { id: otherid, msg: "test123" }  }
            core.sendRequest("/message/add", options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err7:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { id: myid, icon: icon }  }
            core.sendRequest("/message/add", options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err8:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { } }
            core.sendRequest("/message/get", options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err9:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { sender: myid } }
            core.sendRequest("/message/get", options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err9-1:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { } }
            core.sendRequest("/message/get/unread", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err10:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest("/message/read", options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err11:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest("/message/image", options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { _read: 1 } }
            core.sendRequest("/message/get/unread", options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err13:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { } }
            core.sendRequest("/message/get/unread", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err14:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { id: otherid } }
            core.sendRequest("/message/get/sent", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1 || params.obj.data[0].sender!=myid || params.obj.data[0].msg!="test123", "err14-1:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: {} }
            core.sendRequest("/message/get/recipient", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1 || params.obj.data[0]!=myid, "err14-2:" , myid, params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { sender: myid } }
            core.sendRequest("/message/del", options, function(err, params) {
                next(err, "err14-2:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret, query: { sender: myid } }
            core.sendRequest("/message/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err14-3:" , params.obj);
            });
        },
        function(next) {
            var options = { login: login, secret: secret }
            core.sendRequest("/counter/get", options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.msg_count!=1 || params.obj.msg_read!=1, "err15:" , params.obj);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.location = function(callback)
{
	var self = this;
	var tables = {
			geo: { geohash: { primary: 1, index: 1, semipub: 1 },
			       id: { type: "int", primary: 1, pub: 1 },
                   latitude: { type: "real", semipub: 1 },
                   longitude: { type: "real", semipub: 1 },
                   distance: { type: "real" },
                   rank: { type: 'int', index: 1, dynamodb: { projection: ["status"] } },
                   status: { value: 'good' },
			       mtime: { type: "bigint", now: 1 }
			},
	};
	var bbox = this.bbox;
    var rows = core.getArgInt("-rows", 10);
    var distance = core.getArgInt("-distance", 25)
    var round = core.getArgInt("-round", 0)
    var reuse = core.getArgInt("-reuse", 0)
    var latitude = core.getArgInt("-lat", 0)
    var longitude = core.getArgInt("-lon", 0)

    if (!latitude) latitude = core.randomNum(bbox[0], bbox[2])
    if (!longitude) longitude = core.randomNum(bbox[1], bbox[3])

    var rc = [], top = {}, bad = 0, good = 0, error = 0, count = rows/2;
    var ghash, gcount = Math.floor(count/2);
    // New bounding box for the tests
    bbox = backend.backend.geoBoundingBox(latitude, longitude, distance);
    // To get all neighbors, we can only guarantee searches in the neighboring areas, even if the distance is within it
    // still can be in the box outside of the immediate neighbors, minDistance is an approximation
    var geo = core.geoHash(latitude, longitude, { distance: distance });

    async.series([
        function(next) {
            if (reuse) return next();
            async.forEachSeries(Object.keys(tables), function(t, next2) {
                db.drop(t, function() { next2() });
            }, next);
        },
        function(next) {
            if (reuse) return next();
        	db.initTables(tables, next);
        },
        function(next) {
            if (reuse) return next();
        	async.whilst(
        		function () { return good < rows + count; },
        		function (next2) {
        		    var lat = core.randomNum(bbox[0], bbox[2]);
        		    var lon = core.randomNum(bbox[1], bbox[3]);
        		    var obj = core.geoHash(lat, lon);
                    obj.distance = core.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance > distance) return next2();
                    // Make sure its in the neighbors
                    if (geo.neighbors.indexOf(obj.geohash) == -1) return next2();
                    // Create several records in the same geohash box
                    if (good > rows && ghash != obj.geohash) return next2();
                    good++;
        		    obj.id = String(good);
        		    obj.rank = good;
                    ghash = obj.geohash;
        		    db.add("geo", obj, { ignore_error: 1 }, function(err) {
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
            if (reuse) return next();
            // Records beyond our distance
            bad = good;
            async.whilst(
                function () { return bad < good + count; },
                function (next2) {
                    var lat = core.randomNum(bbox[0], bbox[2]);
                    var lon = core.randomNum(bbox[1], bbox[3]);
                    var obj = core.geoHash(lat, lon);
                    obj.distance = core.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance <= distance || obj.distance > distance*2) return next2();
                    bad++;
                    obj.id = String(bad);
                    obj.rank = bad;
                    obj.status = "bad";
                    db.add("geo", obj, { ignore_error: 1 }, function(err) {
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
            // Scan all locations, do it in small chunks to verify we can continue withint the same geohash area
            var query = { latitude: latitude, longitude: longitude, distance: distance };
            var options = { count: gcount, round: round };
            async.doUntil(
                function(next2) {
                    db.getLocations("geo", query, options, function(err, rows, info) {
                        options = info;
                        rows.forEach(function(x) { rc.push({ id: x.geohash + ":" + x.id, status: x.status }) })
                        next2();
                    });
                },
                function() { return !options.more },
                function(err) {
                    var ids = {};
                    var isok = rc.every(function(x) { ids[x.id] = 1; return x.status == 'good' })
                    core.checkTest(next, err, rc.length!=good || Object.keys(ids).length!=good, "err1: ", rc.length, good, 'RC:', rc, ids);
                });
        },
        function(next) {
            // Scan all good locations with the top 3 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good", rank: good-3 };
            var options = { round: round, ops: { rank: 'gt' } };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' && x.rank > good-3 });
                core.checkTest(next, err, rows.length!=3 || !isok, "err2:", rows.length, isok, good, rows);
            });
        },
        function(next) {
            // Scan all locations beyond our good distance, get all bad with top 2 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance*2, status: "bad", rank: bad-2 };
            var options = { round: round, ops: { rank: 'gt' }, sort: "rank", desc: true };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'bad' && x.rank > bad-2 });
                core.checkTest(next, err, rows.length!=2 || !isok, "err3:", rows.length, isok, bad, rows);
            });
        },
        function(next) {
            // Scan all neighbors within the distance and take top 2 ranks only, in desc order
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good" };
            var options = { round: round, sort: "rank", desc: true, count: 50, top: 2, select: "geohash,id,status,rank" };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' })
                var iscount = Object.keys(top).reduce(function(x,y) { return x + Math.min(2, top[y].length) }, 0);
                core.checkTest(next, err, rows.length!=iscount || !isok, "err4:", rows.length, iscount, isok, rows, 'TOP:', top);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.db = function(callback)
{
	var self = this;
	var tables = {
	        test1: { id: { primary: 1, pub: 1 },
	                 email: {} },
			test2: { id: { primary: 1, pub: 1, index: 1 },
			         id2: { primary: 1 },
			         email: {},
			         alias: { pub: 1 },
			         birthday: { semipub: 1 },
			         json: { type: "json" },
			         num: { type: "int", index: 1, dynamodb: { projection: ['num','id2','email'] } },
			         num2: { type: "real" },
			         mtime: { type: "int" } },
			test3: { id : { primary: 1, pub: 1 },
			         num: { type: "counter", value: 0, pub: 1 } },
	};
	var now = core.now();
	var id = core.random(64);
	var id2 = core.random(128);
    var num2 = core.randomNum(this.bbox[0], this.bbox[2]);
	var next_token = null;

	async.series([
	    function(next) {
	         async.forEachSeries(Object.keys(tables), function(t, next2) {
	             db.drop(t, function() { next2() });
	         }, next);
	    },
	    function(next) {
	    	db.initTables(tables, next);
	    },
	    function(next) {
            db.add("test1", { id: id, email: id }, function(err) {
                if (err) return next(err);
                db.put("test1", { id: id2, email: id2 }, function(err) {
                    if (err) return next(err);
                    db.put("test3", { id: id, num: 0 }, next);
                });
            });
        },
        function(next) {
            db.get("test3", { id: id }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id, "err1:", row);
            });
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id, "err2:", row);
            });
        },
        function(next) {
            db.list("test1", String([id,id2]),  function(err, rows) {
                var isok = rows.every(function(x) { return x.id==id || x.id==id2});
                core.checkTest(next, err, rows.length!=2 || !isok, "err4:", rows.length, isok, rows);
            });
        },
	    function(next) {
	    	db.add("test2", { id: id, id2: '1', email: id, alias: id, birthday: id, num: 0, num2: num2, mtime: now }, next);
	    },
	    function(next) {
	    	db.add("test2", { id: id2, id2: '2', email: id, alias: id, birthday: id, num: 0, num2: num2, mtime: now }, next);
	    },
	    function(next) {
	    	db.put("test2", { id: id2, id2: '1', email: id2, alias: id2, birthday: id2, num: 0, num2: num2, mtime: now }, next);
	    },
	    function(next) {
            db.select("test2", { id: id2 }, { filter: function(row, o) { return row.id2 == '1' } }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2 , "err5:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2 }, { async_filter: function(rows, opts, cb) {
                    cb(null, rows.filter(function(r) { return r.id2 == '1' }));
                }
            }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2, "err5-1:", rows.length, rows);
            });
        },
        function(next) {
            db.list("test1", String([id,id2]), { check_public: id }, function(err, rows) {
                var row1 = rows.filter(function(x) { return x.id==id}).pop();
                var row2 = rows.filter(function(x) { return x.id==id2}).pop();
                core.checkTest(next, err, rows.length!=2 || !row1.email || row2.email, "err6:", rows);
            });
        },
	    function(next) {
	    	db.incr("test3", { id: id, num: 1 }, { mtime: 1 }, function(err) {
	    	    if (err) return next(err);
	    		db.incr("test3", { id: id, num: 1 }, function(err) {
	    		    if (err) return next(err);
	    		    db.incr("test3", { id: id, num: -1 }, next);
	    		});
	    	});
	    },
	    function(next) {
	    	db.get("test3", { id: id }, function(err, row) {
	    		core.checkTest(next, err, !row || row.id != id && row.num != 1, "err7:", row);
	    	});
	    },
	    function(next) {
	    	db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'gt' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
	    		core.checkTest(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '2' || rows[0].num2 != num2, "err8:", rows);
	    	});
	    },
	    function(next) {
            db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'begins_with' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '1' || rows[0].num2 != num2, "err8-1:", rows);
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
	    		core.checkTest(next, err, !row || row.id != id  || row.email != id+"@test" || row.num == 9 || !Array.isArray(row.json), "err9:", row);
	    	});
	    },
	    function(next) {
	    	now = core.now();
	    	db.replace("test2", { id: id, id2: '1', email: id + "@test", num: 9, num2: 9, json: { a: 1, b: 2 }, mtime: now }, { check_data: 1 }, next);
	    },
	    function(next) {
	    	db.get("test2", { id: id, id2: '1' }, { skip_columns: ['alias'], consistent: true }, function(err, row) {
	    		core.checkTest(next, err, !row || row.id != id || row.alias || row.email != id+"@test" || row.num!=9 || core.typeName(row.json)!="object" || row.json.a!=1, "err9-1:", row);
	    	});
	    },
	    function(next) {
	    	db.del("test2", { id: id2, id2: '1' }, next);
	    },
	    function(next) {
	    	db.get("test2", { id: id2, id2: '1' }, { consistent: true }, function(err, row) {
	    		core.checkTest(next, err, row, "del:", row);
	    	});
	    },
	    function(next) {
	    	async.forEachSeries([1,2,3,4,5,6,7,8,9], function(i, next2) {
	    		db.put("test2", { id: id2, id2: String(i), email: id, alias: id, birthday: id, num: i, num2: i, mtime: now }, next2);
	    	}, function(err) {
	    		next(err);
	    	});
	    },
        function(next) {
            // Check pagination
	        var rc = [];
            next_token = null;
            async.forEachSeries([2, 3], function(n, next2) {
                db.select("test2", { id: id2 }, { start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    rc.push.apply(rc, rows);
                    next2(err);
                });
            }, function(err) {
                // Redis cannot sort due to hash implementation, known bug
                var isok = db.pool == "redis" ? rc.length>=5 : rc.length==5 && (rc[0].id2 == 1 && rc[rc.length-1].id2 == 5);
                core.checkTest(next, err, !isok, "err10:", rc.length, isok, rc);
            })
	    },
	    function(next) {
	        // Check pagination with small page size with condition on the range key
            next_token = null;
	        async.forEachSeries([2, 3], function(n, next2) {
	            db.select("test2", { id: id2, id2: '0' }, { ops: { id2: 'gt' }, start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
	                next_token = info.next_token;
	                var isok = db.pool == "redis" ? rows.length>=n : rows.length==n;
	                core.checkTest(next2, err, !isok || !info.next_token, "err11:", rows.length, n, info, rows);
	            });
	        },
	        function(err) {
	            if (err) return next(err);
	            db.select("test2", { id: id2, id2: '0' }, { ops: { id2: 'gt' }, start: next_token, count: 5, select: 'id,id2' }, function(err, rows, info) {
	                next_token = info.next_token;
	                var isnum = db.pool == "redis" ? rows.length>=3 : rows.length==4;
	                var isok = rows.every(function(x) { return x.id2 > '0' });
	                core.checkTest(next, err, !isnum || !isok, "err12:", isok, rows.length, rows, info);
	            });
	        });
        },
	    function(next) {
	        core.checkTest(next, null, next_token, "err13: next_token must be null", next_token);
	    },
        function(next) {
            db.add("test2", { id: id, id2: '2', email: id, alias: id, birthday: id, num: 2, num2: 1, mtime: now }, next);
        },
	    function(next) {
            // Select by primary key and other filter
            db.select("test2", { id: id, num: 9, num2: 9 }, {  ops: { num: 'ge', num2: 'ge' } }, function(err, rows, info) {
                core.checkTest(next, err, rows.length==0 || rows[0].num!=9 || rows[0].num2!=9, "err13:", rows, info);
            });
        },
        function(next) {
            // Wrong query property
            db.select("test2", { id: id, num: 9, num2: 9, email: 'fake' }, {  ops: { num: 'ge' } }, function(err, rows, info) {
                core.checkTest(next, err, rows.length!=0, "err14:", rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter
            db.select("test2", { num: 9 }, { ops: { num: 'ge' } }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num >= 9 });
                core.checkTest(next, err, rows.length==0 || !isok, "err15:", isok, rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter and sorting
            db.select("test2", { id: id2, num: 1 }, { ops: { num: 'gt' }, sort: "num" }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num > 1 });
                core.checkTest(next, err, rows.length==0 || !isok , "err16:", isok, rows, info);
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
    api.putIcon({ body: {}, files: { 1: { path: __dirname + "/web/img/loading.gif" } } }, 1, { prefix: "account", width: 100, height: 100 }, function(err) {
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

tests.lmdb = function(callback)
{
    var db = null, env;
    var type = core.getArg("-type", "lmdb");
    async.series([
        function(next) {
            if (type != "leveldb") return next();
            new bn.LevelDB(core.path.spool + "/ldb", { create_if_missing: true }, function(err) {
                db = this;
                next(err);
            });
        },
        function(next) {
            if (type != "lmdb") return next();
            env = new bn.LMDBEnv({ path: core.path.spool, dbs: 1 });
            next();
        },
        function(next) {
            if (type != "lmdb") return next();
            env = new bn.LMDB(env, { name: "lmdb", flags: bn.MDB_CREATE }, function(err) {
                db = this;
                next(err);
            });
        },
        function(next) {
            for (var i = 0; i < 100; i++) {
                db.put(String(i), String(i));
            }
            next();
        },
        function(next) {
            async.forEachSeries([100,101,102,103], function(i, next) {
                db.put(String(i), String(i), next);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            db.get("1", function(err, val) {
                core.checkTest(next, err, val != "1", "err1:",val);
            });
        },
        function(next) {
            db.all("100", "104", function(err, list) {
                core.checkTest(next, err, list.length != 4, "err2:", list);
            });
        },
        function(next) {
            db.incr("1", 1, function(err, val) {
                next(err);
            });
        },
        function(next) {
            db.get("1", function(err, val) {
                core.checkTest(next, err, val != "2", "err3:", val);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.nnpubsub = function(callback)
{
    if (cluster.isMaster) {
        var count = 0;
        var addr = "tcp://127.0.0.1:1234 tcp://127.0.0.1:1235";
        var sock = new bn.NNSocket(bn.AF_SP, bn.NN_SUB);
        sock.connect(addr);
        sock.subscribe("");
        sock.setCallback(function(err, data) {
            logger.log('subscribe:', err, this.socket, data, 'count:', count++);
            if (data == "exit") process.exit(0);
        });
    } else {
        var count = core.getArgInt("-count", 10);
        var addr = "tcp://127.0.0.1:" + (cluster.worker.id % 2 == 0 ? 1234 : 1235);
        var sock = new bn.NNSocket(bn.AF_SP, bn.NN_PUB);
        sock.bind(addr);

        async.whilst(
           function () { return count > 0; },
           function (next) {
               count--;
               sock.send(addr + ':' + core.random());
               logger.log('publish:', sock, addr, count);
               setTimeout(next, core.randomInt(1000));
           },
           function(err) {
               logger.log('sockets1:', bn.nnSockets())
               sock.send("exit");
               sock = null;
               logger.log('sockets2:', bn.nnSockets())
               callback(err);
           });
    }
}

tests.nncache = function(callback)
{
    var slave = core.getArgInt("-slave", 0);
    core.cacheHost = "127.0.0.1:20194,127.0.0.1:20197";

    if (cluster.isMaster) {
        if (!slave) {
            main = 1;
            var args = process.argv.slice(1).concat(["-cache-port", "20197", "-msg-port", "20198", "-slave", "1"]);
            var pid = execFile(process.argv[0], args, {}, function(err, stdout, stderr) {
                if (err) console.log(err);
                if (stderr) console.log(stderr);
                if (stdout) console.log(stdout);
                pid = null;
                if (!Object.keys(cluster.workers).length) process.exit(0);
            });
        }
        ipc.initServer();
        cluster.on('exit', function(worker, code, signal) {
            if (Object.keys(cluster.workers).length) return;
            if (slave) process.exit(0);
            if (!pid) process.exit(0);
        });
    } else {
        ipc.initClient();
        async.series([
           function(next) {
               logger.log("step 1");
               setTimeout(next, 1000);
           },
           function(next) {
               if (slave) return next();
               logger.log("set 1");
               db.put("bk_counter", { id: "1", ping: 1 }, { cached: 1 }, next);
           },
           function(next) {
               logger.log("step 2");
               setTimeout(next, 1000);
           },
           function(next) {
               db.getCached("bk_counter", { id: "1" }, { select: ["id", "ping"] }, function(err, row) {
                   logger.log("get ", row.ping);
                   next();
               });
           },
           function(next) {
               if (slave) return next();
               logger.log("set 2");
               db.put("bk_counter", { id: "1", ping: 2 }, { cached: 1 }, next);
           },
           function(next) {
               logger.log("step 3");
               setTimeout(next, 1000);
           }],
           function(err) {
                db.getCached("bk_counter", { id: "1" }, { select: ["id", "ping"] }, function(err, row) {
                    logger.log("end ", row.ping);
                    callback(err);
                });
        });
    }
}

tests.pubsub = function(callback)
{

}

tests.nndb = function(callback)
{
    var bind = core.getArg("-bind", "ipc://var/nndb.sock");
    var socket = core.getArg("-socket", "NN_PULL");
    var type = core.getArg("-type", "lmdb"), pool;

    if (cluster.isMaster) {
        pool = db.lmdbInitPool({ db: "stats", type: type });
        db.query({ op: "server" }, { pool: type, bind: bind, socket: socket }, function(err) {
            if (err) logger.error(err);
        });

    } else {
        pool = db.nndbInitPool({ db: bind, socket: socket == "NN_REP" ? "NN_REQ" : "NN_PUSH" });
        async.series([
           function(next) {
               db.put("", { name: "1", value: 1 }, { pool: pool.name }, next);
           },
           function(next) {
               db.get("", "1", { pool: pool.name }, function(err, row) {
                   logger.log("get ", row);
                   next(err);
               });
           },
           function(next) {
               db.incr("", { name: "1", value: 2 }, { pool: pool.name }, next);
           },
           function(next) {
               db.get("", { name: "1" }, { pool: pool.name }, function(err, row) {
                   logger.log("get ", row);
                   next(err);
               });
           }],callback);
    }
}

tests.pool = function(callback)
{
    var options = { min: core.getArgInt("-min", 1),
                    max: core.getArgInt("-max", 5),
                    idle: core.getArgInt("-idle", 0),
                    create: function(cb) { cb(null,{ id:Date.now()}) }
    }
    var list = [];
    var pool = core.createPool(options)
    async.series([
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

backend.run(function() {
    var l = locations[core.getArg("-city", "LA")] || locations.LA;
    tests.city = l.name;
    tests.bbox = l.bbox;
    core.runTest(tests);
});


