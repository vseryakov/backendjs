//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { modules, api, ipc, core, lib, logger } = require('backendjs');

// System management
const mod = {
    name: "bk_system",
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    api.app.post(/^\/system\/([^/]+)\/?(.+)?/, (req, res) => {

        switch (req.params[0]) {
        case "restart":
            ipc.sendMsg(`${req.params[1] || "api"}:restart`);
            res.json({});
            break;

        case "init":
            if (req.params[1]) {
                ipc.broadcast(app.id + ":server", req.params[1] + ":" + req.params[0]);
            }
            res.json({});
            break;

        case "params":
            var args = [];
            Object.keys(modules).forEach((n) => {
                if (modules[n].args) args.push([n, app.modules[n].args]);
            });
            switch (req.params[1]) {
            case 'get':
                res.json(args.reduce((data, x) => {
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

