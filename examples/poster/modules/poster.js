//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const sharp = require("sharp");
const { api, logger } = require('backendjs');

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
    style: { type: "bool" },
    width: { type: "int" },
    height: { type: "int" },
    background: {},
    color: {},
    gravity: {},
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
    withoutEnlargement: { type: "bool" },
    withoutReduction: { type: "bool" },
    fastShrinkOnLoad: { type: "bool" },
};

const ops = [
    "autoOrient", "rotate", "flip", "flop", "affine", "sharpen", "erode",
    "dilate", "median", "blur", "flatten", "unflatten", "gamma", "negate", "normalise",
    "normalize", "clahe", "convolve", "threshold", "boolean", "linear", "recomb", "modulate"
];

const add = async (rc, name, opts, image) => {
    rc[name] = Object.assign(opts, {
        buffer: await image.toBuffer(),
        meta: await image.metadata(),
        gravity: opts.gravity
    });
}

const applyOps = (opts, image) => {
    for (const op in opts) {
        if (ops.includes(op)) image[op](opts[op]);
    }
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
        query[p].file = req.files[p]?.path;
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

    const rc = {};

    // Render the first image as background
    const bg = Object.keys(options).find(x => (options[x].file));
    const bgopts = Object.assign({}, options[bg]);
    const bginput = bgopts.file || {
        create: {
            width: bgopts.width || 1280,
            height: bgopts.height || 1024,
            channels: 4,
            background: bgopts.background || "#FFFFFF",
        }
    };
    const bgimage = sharp(bginput).resize(bgopts).png();

    applyOps(bgopts, bgimage);
    await add(rc, bg, bgopts, bgimage);

    const buffer = await bgimage.toBuffer();

    const regions = {};

    // Render all elements individually
    await Promise.all(Object.keys(options).
        filter(name => (name != bg && (options[name]?.text || options[name]?.file))).
        map(async (name) => {
            const opts = Object.assign({}, options[name]);

            // Autodetect text color if not given from the background
            if (opts.text && !opts.color && opts.gravity) {
                if (!regions[opts.gravity]) {
                    regions[opts.gravity] = await api.images.getDominantColor(buffer, opts.gravity);
                }
                opts.color = regions[opts.gravity];
            }

            return api.images.createImage(opts).then(async (image) => {
                applyOps(opts, image);
                await add(rc, name, opts, image);
            });
        }));

    // Composite all elements onto the background
    const buffers = Object.keys(rc).map(x => ({ input: rc[x].buffer, gravity: rc[x].gravity }));
    bgimage.composite(buffers).png();

    await add(rc, "$", bgopts, bgimage);

    return rc;
}

