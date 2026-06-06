//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api, middleware } = require('backendjs');
const image = require('backendjs/lib/util/image');

//
// A demo module that implements a CRUD app to create social poster images
//
module.exports = {
    name: "poster",

    //
    // Default hook to initialize our Express routes, called automatically durng API initialization
    //
    configureMiddleware(options, callback)
    {
        api.app.use("/api/render", middleware.multipart, render);

        callback();
    },
};

function render(context)
{
    const body = context.body;

    for (const i in body?.items) {
        const item = body.items[i];
        if (context.files?.[item.id]?.path) item.file = context.files[item.id]?.path;
    }

    image.composite(body.items, body.defaults).then(rc => {
        context.setHeader("cache-control", "max-age=0, no-cache, no-store").
                send(200, rc[0]._buffer, "image/png");
    }).catch(err => context.reply(err));
}

