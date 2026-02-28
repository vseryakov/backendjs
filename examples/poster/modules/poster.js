//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api, files } = require('backendjs');

//
// A demo module that implements a CRUD app to create social poster images
//
module.exports = {
    name: "poster",

    //
    // Default hook to initialize our Express routes
    //
    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.express.Router().
                post("/render", api.handleMultipart, render));

        callback();
    },
};

function render(req, res)
{
    for (const p in req.body) {
        if (req.files[p]?.path) req.body[p].file = req.files[p]?.path;
    }

    files.image.composite(req.body).then(rc => {
        req.res.header("pragma", "no-cache");
        res.setHeader("cache-control", "max-age=0, no-cache, no-store");
        res.type("image/png");
        res.send(rc.$.buffer);
    }).catch(err => api.sendReply(res, 400, err));
}

