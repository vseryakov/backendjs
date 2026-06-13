//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { api, files } = require('backendjs');

const mod = {
    name: "bk_file",
};
module.exports = mod;

// Create API endpoints and routes
mod.configureMiddleware = function(options, callback)
{
    api.app.all("/file/:op", function(context) {
        const { err, data } = api.validate(context, {
            name: { required: 1 },
            prefix: { required: 1 },
        }, { query: 1 });
        if (err) return context.reply(err);

        var file = data.prefix.replace("/", "") + "/" + query.name.replace("/", "");

        switch (req.params.op) {
        case "get":
            files.send(req, file);
            break;

        case "put":
            files.upload(context, "file", data, (err) => {
                context.reply(err);
            });
            break;

        case "del":
            files.del(file, (err) => {
                context.reply(err);
            });
            break;

        default:
            api.sendReply(req, 400, "Invalid command");
        }
    });

    callback();
}
