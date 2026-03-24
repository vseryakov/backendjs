//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api, image } = require('backendjs');

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
    for (const i in req.body?.items) {
        const item = req.body.items[i];
        if (req.files?.[item.id]?.path) item.file = req.files[item.id]?.path;
    }

    image.composite(req.body.items, req.body.defaults).then(rc => {
        req.res.header("pragma", "no-cache");
        res.setHeader("cache-control", "max-age=0, no-cache, no-store");
        res.type("image/png");
        res.send(rc[0]._buffer);
    }).catch(err => api.sendReply(res, 400, err));
}

