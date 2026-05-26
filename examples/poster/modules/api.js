//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api } = require('backendjs');
const image = require('backendjs/lib/util/image');

//
// A demo module that implements a CRUD app to create social poster images
//
module.exports = {
    name: "poster",

    //
    // Default hook to initialize our Express routes, called automatically durng API initialization
    //
    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.Router().
                post("/render", api.handleMultipart, render));

        callback();
    },
};

function render(req, res)
{
    const body = req.context.body;

    for (const i in body?.items) {
        const item = body.items[i];
        if (req.files?.[item.id]?.path) item.file = req.files[item.id]?.path;
    }

    image.composite(body.items, body.defaults).then(rc => {
        req.res.header("pragma", "no-cache");
        res.setHeader("cache-control", "max-age=0, no-cache, no-store");
        res.type("image/png");
        res.send(rc[0]._buffer);
    }).catch(err => api.sendReply(req, 400, err));
}

