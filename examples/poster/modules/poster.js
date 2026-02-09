//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const fs = require("fs")
const { app, api, lib } = require('../../../lib/index');

//
// A demo module that implements a CRUD app to create social poster images
//
const mod =

module.exports = {
    name: "poster",

    // Defaults by element name
    defaults: {
        image: {
            width: 1280,
            height: 1280,
            bgcolor: "#000",
            fit: "cover",
        },

        title: {
            gravity: "northwest",
            padding: 70,
            width: 700,
            dpi: 500,
            font: "Roboto Bold",
            color: "#fff",
        },

        subtitle: {
            gravity: "west",
            padding: 70,
            width: 700,
            dpi: 300,
            font: "Sans Serif Bold Italic",
            color: "#fff",
        },

        name: {
            gravity: "southeast",
            padding: 70,
            dpi: 300,
            font: "Montserrat, Helvetica Neue, Arial, Sans Serif",
        },

        logo: {
            gravity: "northeast",
            width: 200,
            padding: 20,
            fit: "cover",
        },

        avatar: {
            gravity: "east",
            padding: 70,
            width: 400,
            fit: "outside",
        }
    },

    //
    // Default hook to initialize our Express routes
    //
    configureWeb(options, callback)
    {
        api.app.use("/poster",
            api.express.Router().
                post("/render", this.render));

        callback();
    },

    render(req, res) {
        var options = {};
        this.compose(options, (err, rc) => {
            if (err) return api.sendReply(res, err);
            req.res.header("pragma", "no-cache");
            res.setHeader("cache-control", "max-age=0, no-cache, no-store");
            res.type("image/png");
            res.send(rc.image.buffer);
        });
    },
};

mod.compose = async function(options)
{
    const rc = {}, buffers = [];

    const add = async (name, opts, image) => {
        rc[name] = Object.assign(opts, {
            buffer: await image.toBuffer(),
            meta: await image.metadata(),
        });

        buffers.push({
            input: rc[name].buffer,
            gravity: opts.gravity,
        });
    }

    if (options.avatar?.file) {
        const opts = Object.assign({}, mod.defaults.avatar, options.avatar);

        const image = await api.images.createAvatar(opts);
        await add("avatar", opts, image);
    }

    if (options.logo?.file) {
        const opts = Object.assign({}, mod.defaults.logo, options.logo);

        const image = await api.images.sharp(opts.file).
            resize(opts.width, opts.height, { fit: opts.fit }).
            extend(Object.assign({
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }, api.images.toPadding(opts))).
            png();
        await add("logo", opts, image);
    }

    const promises = ["title", "subtitle", "name" ].
        filter(name => options[name]?.text).
        map(name => {
            const opts = Object.assign({}, mod.defaults[name], options[name]);
            return api.images.createText(opts).then(async (image) => {
                await add(name, opts, image);
            });
        });

    await Promise.all(promises);

    const opts = Object.assign({}, mod.defaults.image, options.image);
    const input = opts.file || { create: { width: opts.width, height: opts.height, channels: 4, background: opts.bgcolor } };
    const image = api.images.sharp(input).
        resize(opts.width, opts.height, { fit: opts.fit }).
        composite(buffers).
        png();

    await add("image", opts, image);

    return rc;
}


mod.sample = async function(options)
{
    if (options?.cwd) process.chdir(options.cwd);

    const rc = await mod.compose(Object.assign({
        image: {
            file: "bg2.jpg",
        },
        logo: {
            file: "salesforce.png",
        },
        avatar: {
            file: "files/vlad4.jpg",
            color: "#F093DC",
            gravity: "northwest",
            radius: 5,
        },
        title: {
            text: "Join me to learn about programming",
            gravity: "east",
            color: "#F8F82A",
            width: 900,
        },
        subtitle: {
            text: "Feb 23 1PM Developers Cafe\n<small>Town Center</small>",
            gravity: "southwest",
        },
        name: {
            text: "My Name\n<small>Programmer</small>",
            gravity: "north",
            color: "#fff"
        }
    }, options));

    for (const file in rc) {
        fs.writeFileSync(file + ".png", rc[file].buffer);
    }
    process.chdir(app.cwd);
    return rc;
}

