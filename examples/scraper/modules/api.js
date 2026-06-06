//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2025
//

const { db, api, modules, files, jobs, lib, logger } = require('backendjs');
const image = require('backendjs/dist/image')
const webscraper = require('backendjs/dist/webscraper')

const mod =

module.exports = {
    name: "scraper",

    prompt: `
      - only use the image for information
      - return in json format only
      - extract main event name and store in the **name** property, keep empty if cannot be reliably found
      - extract dates only of event and store in the **date** property, keep empty if cannot be reliably found
      - extract venue and address of the event and store in the **venue** and **location** properties, keep empty if cannot be reliably found
      - extract number of attendees and store in the **attendees** property, keep empty if cannot be reliably found
      - extract number of exibitors and store in the **exibitors** property, keep empty if cannot be reliably found
      - extract main brand color and font and store int the **color** and **font** properties, keep empty if cannot be reliably found
      - describe the image in poetic artistic terms to use for painting, use the brand color appropriately, store it in the **descr** property
      - describe the the place of event in poetic artistic terms to use for painting, use the brand color appropriately, store it in the **place** property
    `,

    variants: {
        descr: [
          "taking the description below create an abstract non real life representation of it, make it not busy, no text or logos",
          "taking the description below create a modern style representation of it, make it not busy, no text or logos",
          "taking the description below create a cartoon representation of it, make it not busy, no text or logos",
        ],

        place: [
          "taking the description below create a modern style representation of it, make it not busy, no text or logos",
          "taking the description below create a cartoon representation of it, make it not busy, no text or logos",
      ]
    },

    defaults: {
        padding: 0.05,
        "bg.width": 1376,
        "bg.height": 768,
        "bg.blur_sigma": "auto",
        "logo.width": 0.1,
        "avatar.radius": 2,
        "avatar.border_alpha": 50,
        "avatar.border": 20,
        "avatar.width": 0.25,
        "title.dpi": 600,
        "title.size": 0.12,
        "title.width": 0.7,
        "title.text": "I am going to\n",
        "location.width": 0.4,
        "location.text": "Jan 1-10 2026\nMy location, USA",
        "name.font": "'Didot', serif",
        "name.text": "My Name\n<i>CEO, Company</i>",
        "text.dpi": 250,
        "text.size": 0.07,
        "text.font": "'Roboto Slab', serif",
        "text.weight": "bold",
    },

    profiles: [
        {
            name: "1",
            defaults: {
                "name.align": "right",
                "name.gradient": 0,
                "text.gradient": "1",
            },
            items: [
                { id: "bg", type: "image" },
                { id: "logo", type: "image", gravity: "northeast" },
                { id: "avatar", type: "image", gravity: "east" },
                { id: "title", type: "text", gravity: "northwest" },
                { id: "location", type: "text", gravity: "southwest" },
                { id: "name", type: "text", gravity: "southeast" }
            ],
        },

        {
            name: "2",
            defaults: {
                "title.wrap": 1.5,
                "title.width": 0.95,
                "text.stroke_width": 4,
                "text.shadow_width": 3,
            },
            items: [
                { id: "bg", type: "image" },
                { id: "logo", type: "image", gravity: "northeast" },
                { id: "avatar", type: "image", gravity: "south" },
                { id: "title", type: "text", gravity: "northwest" },
                { id: "location", type: "text", gravity: "southwest" },
                { id: "name", type: "text", gravity: "southeast" }
            ],
        },

        {
            name: "3",
            defaults: {
                "title.wrap": 1.5,
                "title.stroke_width": 4,
                "title.shadow_width": 3,
                "location.gradient": 1,
                "avatar.radius": 5,
                "name.stroke_width": 4,
                "name.dilate_radius": 5,
                "name.dilate_alpha": 15,
                "text.text_auto": "softlight",
            },
            items: [
                { id: "bg", type: "image" },
                { id: "logo", type: "image", gravity: "northeast" },
                { id: "avatar", type: "image", gravity: "east" },
                { id: "title", type: "text", gravity: "northwest" },
                { id: "location", type: "text", gravity: "southwest" },
                { id: "name", type: "text", gravity: "southeast" }
            ],
        },
    ],

    tables: {

        /**
         * Database table definition
         */
        scraper: {
            id: { primary: 1 },
            status: { dflt: "pending" },
            flags: { type: "list" },
            url: {},
            title: {},
            logo: {},
            logos: { type: "list" },
            meta: { type: "obj" },
            webpage: { type: "obj" },
            event: { type: "obj" },
            ical: { type: "obj" },
            company: { type: "obj" },
            describe: { type: "obj" },
            profiles: { type: "array" },
            variants: { type: "int" },
            error: {},
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" },
        }
    },

    /**
     * Setup all routes
     */
    configureMiddleware(options, callback)
    {
        api.app.
            post("/api/render/:id", render).
            get("/api/list", list).
            get("/api/asset/:id/:file", assets).
            post("/api/submit", submit).
            post("/api/resubmit/:id", resubmit).
            delete("/api/del/:id", del);

        callback();
    },

    job,
    update,
    submit,
    resubmit,
    scrape,
    describe,
    genVariants,
    genSamples,
}

/**
 * Return a list of all jobs submitted
 */
function list(context)
{
    var query = api.validate(context, {
        start: { type: "int" },
        count: { type: "int", dflt: 10 },
    });
    if (typeof query == "string") return context.reply({ status: 400, message: query });

    const opts = {
        start: query.start,
        count: query.count,
        sort: "ctime",
        desc: true,
    };

    db.select("scraper", {}, opts, (err, rows, info) => {
        context.reply(err, db.paginateResult(rows, info));
    });
}

/**
 * Return image or html content
 */
function assets(context)
{
    db.get("scraper", context.params.id, (err, row) => {
        if (!row) return context.reply({ status: 404, message: "no record found" });
        context.setHeader("cache-control", "max-age=0, no-cache, no-store");
        files.send(context, context.params.id + "/" + context.params.file);
    });
}

/**
 * Render new image for given parameters
 */
async function render(context)
{
    const { data } = await db.aget("scraper", { id: context.params.id });
    if (!data) return context.reply({ status: 404, message: "no record found" });

    const body = context.body;
    for (const i in body?.items) {
        const item = body.items[i];
        if (!item.file) continue;
        if (item.file.startsWith("web/")) continue;
        item.file = files.root + "/" + context.params.id + "/" + item.file;
    }

    image.composite(body.items, body.defaults).then(rc => {
        context.setHeader("cache-control", "max-age=0, no-cache, no-store").
                send(200, rc[0]._buffer, "image/png");
    }).catch(err => {
        logger.trace("render:", err);
        context.reply(err)
    });
}

/**
 * Create/replace a scraper record, notify about it via websocket
 */
function update(options, callback)
{
    options.error = options.error || null;
    options.status = options.error ? "error" : "done";
    logger.debug("update:", mod.name, options);

    db.update("scraper", options, { result_query: 1, first: 1 }, (err, data) => {
        api.ws.notify({}, { event: "scraper:status", data });
        lib.tryCall(callback, err, data);
    });
}

/**
 * Submit a new scrape job
 */
function submit(context)
{
    var query = api.validate(context, {
        url: { type: "url", required: 1 },
        status: { value: "pending" },
    })
    if (typeof query == "string") return context.reply({ status: 400, message: query })

    query.id = query.url.replace(/^https?:\/\//, "").
                         replace(/[^a-z0-9-]/gi, "-").
                         replace(/-{2,}/g, "-").
                         replace(/^-+|-+$/g, "");

    db.put("scraper", query, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return context.reply(err, row);

        api.ws.notify({}, { event: "scraper:status", data: row });

        jobs.submitJob({ job: { "scraper.job": { id: row.id } } }, { noWait: 1 }, (err) => {
            context.reply(err, row);
        });
    });
}

/**
 * Resubmit a scrape job
 */
function resubmit(context)
{
    db.get("scraper", context.params.id, (err, row) => {
        if (!row) return context.reply({ status: 404, message: "no record found" });

        jobs.submitJob({ job: { "scraper.job": { id: row.id, mode: context.body.mode } } }, { noWait: 1 }, (err) => {
            context.reply(err, row);
        });
    });
}

/**
 * Delete a job by id
 */
function del(context)
{
    const id = context.params.id
    db.del("scraper", { id }, (err, row, info) => {
        if (!err && info.affected_rows) {
            files.del(`${id}.png`);
            files.del(`${id}.html`);
        }
        context.reply(err);
    });
}

/**
 * This is a job method that is run by a worker to do the actual scraping, once done it notifies
 * web page about the status via websocket
 */
function job(options, callback)
{
    logger.info("scraper:", "job", options);

    lib.series([
        function(next) {
            if (options.mode && options.mode != "scrape") return next();
            scrape(options, next);
        },

        function(next) {
            if (options.error) return next(options.error)
            if (options.mode && options.mode != "describe") return next();
            describe(options, next);
        },

        function(next) {
            if (options.error) return next(options.error)
            if (options.mode && options.mode != "variants") return next();
            genVariants(options, next);
        },

        function(next) {
            if (options.error) return next(options.error)
            if (options.mode && !["variants","samples"].includes(options.mode)) return next();
            genSamples(options, next);
        },
    ], callback);
}

function scrape(options, callback)
{
    db.get("scraper", options.id, (err, data) => {
        if (!data) return callback(err || "not found");

        api.ws.notify({}, { event: "scraper:status", data: { id: options.id, status: "scraping" } });

        Object.assign(options, {
            url: data.url,
            root: options.id,
        });

        webscraper.run(options).then(() => {
            update(options, callback);
        }).catch((err) => {
            logger.trace("scrape:", mod.name, options, err);
            options.error = err.message;
            update(options, callback);
        });
    });
}

function describe(options, callback)
{
    db.get("scraper", options.id, (err, data) => {
        if (!data) return callback(err || "not found");

        api.ws.notify({}, { event: "scraper:status", data: { id: options.id, status: "describing" } });

        const size = lib.statSync(files.root + "/" + options.id + "/full.png").size
        const screenshot = files.root + "/" + options.id + "/" + (size ? "full" : "page") + ".png";
        if (!lib.statSync(screenshot).size) {
            options.error = "no screenshot";
            logger.trace("describe:", mod.name, options);
            return update(options, callback);
        }

        const opts = {
            file: screenshot,
            prompt: mod.prompt,
        }
        modules.gemeni.fetch(opts).then(({ parts }) => {
            if (parts?.[0].obj) options.describe = parts[0].obj;
            update(options, callback);
        }).catch(err => {
            logger.trace("describe:", mod.name, options, err);
            options.error = err.message;
            update(options, callback);
        });
    });
}

function genVariants(options, callback)
{
    db.get("scraper", options.id, (err, data) => {
        if (!data) return callback(err || "not found");

        api.ws.notify({}, { event: "scraper:status", data: { id: options.id, status: "generating" } });

        options.variants = 0;

        var prompts = [];
        for (const p in mod.variants) {
            if (!data.describe?.[p]) continue;
            for (const v of mod.variants[p]) {
                prompts.push(v + "\n" + data.describe[p]);
            }
        }

        lib.forEachSeries(prompts, async (prompt, next) => {
            const { err, parts } = await modules.gemeni.fetch({ image: 1, prompt });
            if (err) return next(err);

            var data = parts.find(x => x.data);
            if (!data) return next();

            files.store(data.data, `${options.id}/bg-${options.variants++}.jpg`, next);
        }, (err) => {
            if (err) options.error = err.message;
            update(options, callback);
        })
    });
}

function genSamples(options, callback)
{
    db.get("scraper", options.id, (err, data) => {
        if (!data) return callback(err || "not found");

        api.ws.notify({}, { event: "scraper:status", data: { id: options.id, status: "sampling", profiles: [] } });

        const title = data.event?.name || data.describe?.name || data.meta?.name || data.title;
        const date = data.event?.date || data.describe?.date || data.meta?.date || "";
        const location = data.event?.location || data.describe?.location || data.meta?.location || "";

        const profiles = [];

        for (let i = 0; i < data.variants; i++) {
            for (const item of mod.profiles) {
                const profile = lib.extend({}, item);
                profile.name += "." + i;
                profile.defaults = Object.assign({}, mod.defaults, profile.defaults);
                profile.defaults["bg.file"] = files.root + "/" + options.id + "/bg-" + i + ".jpg";
                profile.defaults["avatar.file"] = i % 2 == 0 ? "web/woman.jpg" : "web/man.jpg";
                if (title) profile.defaults["title.text"] += lib.textToEntity(title);
                if (location) profile.defaults["location.text"] = `${date}\n${lib.textToEntity(location)}`;
                profiles.push(profile);
            }
        }

        options.profiles = [];

        lib.forEveryLimit(profiles, 3, (profile, next) => {

            image.composite(profile.items, profile.defaults).then(items => {
                if (!items.length) return next();
                files.store(items[0]._buffer, `${options.id}/profile-${profile.name}.png`);

                logger.debug("genSamples:", mod.name, "done:", items);
                items[0].file = profile.items[0].file.split("/").pop();
                items.forEach(item => {
                    for (const p in item) if (p[0] == "_") delete item[p];
                });
                options.profiles.push({ name: profile.name, items });
                api.ws.notify({}, { event: "scraper:status", data: { id: options.id, profiles: options.profiles } });
                next();
            }).catch(err => {
                logger.trace("genSamples:", mod.name, options.id, profile, err);
                next();
            });

        }, () => {
            options.profiles.sort((a, b) => (a.name.localeCompare(b.name)));
            update(options, callback);
        })
    });
}

