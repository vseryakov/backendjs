//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
'use strict';


const { modules, api, ipc, app, lib, logger } = require('backendjs');

// System management
const mod = {
    name: "bk_system",
};
module.exports = mod;

// Create API endpoints and routes
mod.configureMiddleware = function(options, callback)
{
    api.app.post("/system/:op/*", (context) => {

        switch (context.params.op) {
        case "restart":
            ipc.sendMsg(`${context.params[0] || "api"}:restart`);
            context.json({});
            break;

        case "init":
            if (context.params[1]) {
                ipc.broadcast(app.id + ":server", context.params[1] + ":" + context.params[0]);
            }
            context.json({});
            break;

        case "params":
            var args = [];
            Object.keys(modules).forEach((n) => {
                if (modules[n].args) args.push([n, app.modules[n].args]);
            });
            switch (context.params[1]) {
            case 'get':
                context.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        if (!y._name) return;
                        var val = lib.objGet(modules[x[0]], y._name);
                        if (val == null && !options.total) return;
                        data[y._key] = typeof val == "undefined" ? null : val;
                    });
                    return data;
                }, { "-home": app.home, "-log": logger.level }));
                break;

            case "info":
                context.json(args.reduce((data, x) => {
                    x[1].forEach((y) => {
                        data[(x[0] ? x[0] + "-" : "") + y.name] = y;
                    });
                    return data;
                }, {}));
                break;
            default:
                context.reply({ status: 400, message: "Invalid command" });
            }
            break;

        default:
            context.reply({ status: 400, message: "Invalid command" });
        }
    });
}

