//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var domain = require('domain');
var cluster = require('cluster');
var os = require('os');
var core = require(__dirname + '/../core');
var ipc = require(__dirname + '/../ipc');
var aws = require(__dirname + '/../aws');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

// Setup MySQL database driver
db.mysqlInitPool = function(options)
{
    if (!utils.MysqlDatabase) {
        logger.error("MySQL driver is not compiled in, consider to install libmysqlclient library");
        return this.nopool;
    }

    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "mysql";
    options.type = "mysql";
    options.dboptions = { typesMap: { json: "text", bigint: "bigint" }, sqlPlaceholder: "?", defaultType: "VARCHAR(128)", noIfExists: 1, noJson: 1, noMultiSQL: 1 };
    var pool = this.sqlInitPool(options);
    pool.connect = function(options, callback) {
        new utils.MysqlDatabase(options.db, function(err) {
            callback(err, this);
        });
    }
    pool.cacheIndexes = self.mysqlCacheIndexes;
    return pool;
}

db.mysqlCacheIndexes = function(options, callback)
{
    var self = this;
    self.get(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        self.dbkeys = {};
        self.dbindexes = {};
        client.query("SHOW TABLES", function(err, tables) {
            core.forEachSeries(tables, function(table, next) {
                table = table[Object.keys(table)[0]].toLowerCase();
                client.query("SHOW INDEX FROM " + table, function(err, rows) {
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table]) continue;
                        var col = self.dbcolumns[table][rows[i].Column_name];
                        switch (rows[i].Key_name) {
                        case "PRIMARY":
                            if (!self.dbkeys[table]) self.dbkeys[table] = [];
                            self.dbkeys[table].push(rows[i].Column_name);
                            if (col) col.primary = true;
                            break;

                        default:
                            if (!self.dbindexes[rows[i].Key_name]) self.dbindexes[rows[i].Key_name] = [];
                            self.dbindexes[rows[i].Key_name].push(rows[i].Column_name);
                            break;
                        }
                    }
                    next();
                });
            }, function(err) {
                self.free(client);
                if (callback) callback(err);
            });
        });
    });
}

