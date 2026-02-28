//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api, files, logger } = require('backendjs');

//
// A demo module that implements a CRUD app to create social poster images
//
const mod =

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

const params = {
    file: {},
    text: {},
    size: {},
    font: {},
    fontfile: {},
    alpha: {},
    bgalpha: {},
    spacing: { type: "int" },
    align: {},
    justify: { type: "bool" },
    wrap: {},
    dpi: { type: "int" },
    weight: {},
    style: {},
    width: { type: "int" },
    height: { type: "int" },
    background: {},
    color: {},
    radius: { type: "int" },
    border: { type: "int" },
    border_color: {},
    border_radius: { type: "int" },
    padding: { type: "int" },
    padding_x: { type: "int" },
    padding_y: { type: "int" },
    padding_top: { type: "int" },
    padding_bottom: { type: "int" },
    padding_left: { type: "int" },
    padding_right: { type: "int" },
    padding_color: {},
    fit: {},
    position: {},
    kernel: {},
    strategy: {},
    gravity: {},
    withoutEnlargement: { type: "bool" },
    withoutReduction: { type: "bool" },
    fastShrinkOnLoad: { type: "bool" },
};

const add = async (rc, name, opts, image) => {
    const meta = await image.metadata();
    logger.debug("add:", name, opts, meta);
    rc[name] = Object.assign(opts, { meta });
    rc[name].buffer = await image.toBuffer();
}

function render(req, res)
{
    const schema = {};
    for (const p in req.body) {
        schema[p] = { type: "json", params };
    }
    const query = api.toParams(req, schema);
    if (typeof query == "string") return api.sendReply(res, 400, query);

    for (const p in query) {
        if (req.files[p]?.path) query[p].file = req.files[p]?.path;
    }

    mod.compose(query).then(rc => {
        req.res.header("pragma", "no-cache");
        res.setHeader("cache-control", "max-age=0, no-cache, no-store");
        res.type("image/png");
        res.send(rc.$.buffer);
    }).catch(err => api.sendReply(res, 400, err));
}

mod.compose = async function(options)
{
    logger.debug("compose:", mod.name, options);

    // Render the first image as background
    const bg = Object.keys(options).find(x => (options[x].file));
    const bgopts = Object.assign({ name: bg }, options[bg]);
    const bgimage = await files.image.create(bgopts);

    const rc = Object.keys(options).
               filter(name => (name != bg && (options[name]?.text || options[name]?.file))).
               reduce((a, b) => { a[b] = ""; return a }, {});

    // Render all elements individually, preseve the order
    await Promise.all(Object.keys(rc).
        map(async (name) => {
            const opts = Object.assign({ name }, options[name]);

            // Autodetect text color from the background
            if (opts.text && !opts.color) {
                const stats = await files.image.stats(bgimage, opts);
                opts.color = stats.color;
                logger.debug("compose:", "dominant:", name, opts, stats);
            }

            return files.image.create(opts).then(async (image) => {
                await add(rc, name, opts, image);
            });
        }));

    // Composite all elements onto the background
    const buffers = Object.keys(rc).map(x => ({
        input: rc[x].buffer,
        gravity: rc[x].gravity,
        top: rc[x].top,
        left: rc[x].left
    }));

    bgimage.composite(buffers).jpeg();

    await add(rc, "$", bgopts, bgimage);

    return rc;
}

