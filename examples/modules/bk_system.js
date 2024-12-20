//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var bkjs = require('backendjs');
var api = bkjs.api;
var ipc = bkjs.ipc;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// System management
const mod = {
    name: "bk_system",
    args: [
        { name: "perms", type: "map", maptype: "list", descr: "Allowed operations, ex: -bk_system-perms restart:api,init:queue;config;db" },
    ],
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureSystemAPI();
    callback()
}

// API for internal provisioning and configuration
mod.configureSystemAPI = function()
{
    api.app.post(/^\/system\/([^/]+)\/?(.+)?/, (req, res) => {
        if (mod.perms && !lib.isFlag(mod.perms[req.params[0]], req.params[1] || "*")) {
            return res.status(403).send("not allowed");
        }

        var options = api.getOptions(req);
        switch (req.params[0]) {
        case "restart":
            ipc.sendMsg(`${req.params[1] || "api"}:restart`);
            res.json({});
            break;

        case "init":
            if (req.params[1]) {
                ipc.broadcast(core.name + ":master", req.params[1] + ":" + req.params[0]);
            }
            res.json({});
            break;

        case "params":
            var args = [ [ '', core.args ] ];
            Object.keys(core.modules).forEach((n) => {
                if (core.modules[n].args) args.push([n, core.modules[n].args]);
            });
            switch (req.params[1]) {
            case 'get':
                res.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        if (!y._name) return;
                        var val = lib.objGet(x[0] ? core.modules[x[0]] : core, y._name);
                        if (val == null && !options.total) return;
                        data[y._key] = typeof val == "undefined" ? null : val;
                    });
                    return data;
                }, { "-home": core.home, "-log": logger.level }));
                break;

            case "info":
                res.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        data[(x[0] ? x[0] + "-" : "") + y.name] = y;
                    });
                    return data;
                }, {}));
                break;
            default:
                api.sendReply(res, 400, "Invalid command");
            }
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });
}

