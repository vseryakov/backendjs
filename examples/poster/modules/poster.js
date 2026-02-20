//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const sharp = require("sharp");
const { api } = require('backendjs');

const { properties, defaults } = require("./schema");

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
                post("/render", api.handleMultipart, this.render));

        callback();
    },

    render(req, res) {
        const schema = Object.keys(defaults).reduce((a, b) => {
            a[b] = { type: "obj", params: properties }
            return a;
        }, {});
        const query = api.toParams(req, schema);
        if (typeof query == "string") return api.sendReply(res, 400, query);

        for (const p in query) {
            if (query[p].file && req.files[p]) {
                query[p].file = req.files[p].path;
            }
        }

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

const hex = (n) => ("" + ((n/16) & 0xff) + (n % 16))

mod.compose = async function(options)
{
    const rc = {};

    // Render the main background image
    const imgopts = Object.assign({}, defaults.image, options.image);
    const input = imgopts.file || { create: { width: imgopts.width, height: imgopts.height, channels: 4, background: imgopts.background } };
    const image = sharp(input).resize(imgopts);

    applyOps(imgopts, image);

    const buffer = await image.toBuffer();

    const regions = {};

    // Render all elements first
    await Promise.all(Object.keys(defaults).
        filter(name => (name != "image" && (options[name]?.text || options[name]?.file))).
        map(async (name) => {
            const opts = Object.assign({}, defaults[name], options[name]);

            // Autodetect text color if not given from the background
            if (opts.text && !opts.color && opts.gravity) {
                if (!regions[opts.gravity]) {
                    const region = api.images.getGravityRegion(opts.gravity, imgopts.width, imgopts.height);
                    const stats = await sharp(buffer).extract(region).stats();
                    regions[opts.gravity] = `#${hex(255 - stats.dominant.r)}${hex(255 - stats.dominant.g)}${hex(255 - stats.dominant.b)}`;
                }
                opts.color = regions[opts.gravity];
            }

            return api.images.createImage(opts).then(async (image) => {
                applyOps(opts, image);
                await add(rc, name, opts, image);
            });
        }));

    // Composite all elements into the background
    const buffers = Object.keys(rc).map(x => ({ input: rc[x].buffer, gravity: rc[x].gravity }));
    image.composite(buffers).png();

    await add(rc, "image", imgopts, image);

    return rc;
}

