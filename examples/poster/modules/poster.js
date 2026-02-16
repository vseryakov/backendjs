//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { api } = require('../../../lib/index');

const { schema, defaults } = require("./schema");

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
        api.app.use("/poster",
            api.express.Router().
                post("/render", api.handleMultipart, this.render));

        callback();
    },

    render(req, res) {
        const query = api.toParams(req, schema.schema);
        if (typeof query == "string") return api.sendReply(res, 400, query);

        this.compose(query).then(rc => {
            req.res.header("pragma", "no-cache");
            res.setHeader("cache-control", "max-age=0, no-cache, no-store");
            res.type("image/png");
            res.send(rc.image.buffer);
        }).catch(err => api.sendReply(res, err));
    },
};

const add = async (rc, name, opts, image) => {
    rc[name] = Object.assign(opts, {
        buffer: await image.toBuffer(),
        meta: await image.metadata(),
        gravity: opts.gravity
    });
}

const ops = [
    "autoOrient", "rotate", "flip", "flop", "affine", "sharpen", "erode",
    "dilate", "median", "blur", "flatten", "unflatten", "gamma", "negate", "normalise",
    "normalize", "clahe", "convolve", "threshold", "boolean", "linear", "recomb", "modulate"
];

const applyOps = (opts, image) => {
    for (const op in opts) {
        if (ops.includes(op)) image[op](opts[op]);
    }
}

mod.compose = async function(options)
{
    const rc = {};

    if (options.avatar?.file) {
        const opts = Object.assign({}, defaults.avatar, options.avatar);

        const image = await api.images.createAvatar(opts);
        applyOps(opts, image);
        await add(rc, "avatar", opts, image);
    }

    if (options.logo?.file) {
        const opts = Object.assign({}, defaults.logo, options.logo);

        const image = await api.images.sharp(opts.file).
            resize(opts).
            extend(Object.assign({
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }, api.images.toPadding(opts))).
            png();

        applyOps(opts, image);
        await add(rc, "logo", opts, image);
    }

    // Render all text elements
    const promises = ["title", "subtitle", "name" ].
        filter(name => options[name]?.text).
        map(name => {
            const opts = Object.assign({}, defaults[name], options[name]);
            return api.images.createText(opts).then(async (image) => {
                applyOps(opts, image);
                await add(rc, name, opts, image);
            });
        });

    await Promise.all(promises);

    // Render the main background image
    const opts = Object.assign({}, defaults.image, options.image);
    const input = opts.file || { create: { width: opts.width, height: opts.height, channels: 4, background: opts.background } };
    const image = api.images.sharp(input);

    image.resize(opts);

    applyOps(opts, image);

    // Composite all elements into the background
    const buffers = Object.keys(rc).map(x => ({ input: rc[x].buffer, gravity: rc[x].gravity }));
    image.composite(buffers).
        png();

    await add(rc, "image", opts, image);

    return rc;
}

