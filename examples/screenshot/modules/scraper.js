
const puppeteer = require('puppeteer');
const { db, api, files, jobs, logger } = require('backendjs');

const mod =

module.exports = {
    name: "scraper",

    args: [
        { name: "width", type: "int", descr: "Screenshot image width" },
        { name: "height", type: "int", descr: "Screenshot image height" },
    ],

    width: 1280,
    height: 1024,

    tables: {

        // Database table definition
        scraper: {
            id: { type: "uuid", primary: 1 },
            status: { dflt: "pending" },
            url: {},
            title: {},
            error: {},
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" },
        }
    },

    // Setup all routes
    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.express.Router().
                get("/list", list).
                get("/png/:id", assets).
                get("/html/:id", assets).
                post("/submit", submit).
                put("/resubmit/:id", resubmit).
                delete("/del/:id", del));


        callback();
    },

    // This is a job method that is run by a worker to do the actual scraping, once done it notifies
    // web page about the status via websocket
    job(options, callback)
    {
        scrape(options).then(() => {
            const row = { id: options.id, status: "done", title: options.title };
            db.update("scraper", row, callback);

            api.ws.notify({}, { event: "scraper:status", data: row });

        }).catch((err) => {
            logger.trace("job:", mod.name, options, err);
            const row = { id: options.id, status: "error", title: options.title, error: err.message };
            db.update("scraper", row, callback);

            api.ws.notify({}, { event: "scraper:status", data: row });
        });
    }

}

// Return a list of all jobs submitted
function list(req, res)
{
    var query = api.toParams(req, {
        start: { type: "int" },
        count: { type: "int", dflt: 10 },
    });
    if (typeof query == "string") return api.sendReply(res, 400, query);

    const opts = {
        start: query.start,
        count: query.count,
        sort: "ctime",
        desc: true,
    };

    db.select("scraper", {}, opts, (err, rows, info) => {
        api.sendJSON(req, err, api.getResultPage(req, rows, info));
    });
}

// Return image or html content
function assets(req, res)
{
    db.get("scraper", { id: req.params.id }, (err, row) => {
        if (!row) return api.sendReply(res, 404, "no record found");
        var file = `${row.id}.${req.options.apath.at(-2)}`;
        files.send(req, file);
    });
}

// Submit a new scrape job
function submit(req, res)
{
    var query = api.toParams(req, {
        url: { type: "url", required: 1 },
        status: { value: "pending" },
    })
    if (typeof query == "string") return api.sendReply(res, 400, query)


    db.put("scraper", query, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return api.sendJSON(req, err, row);
        api.ws.notify({}, { event: "scraper:status", data: row });

        jobs.submitJob({ job: { "scraper.job": row } }, (err) => {
            api.sendJSON(req, err, row);
        });
    });
}

// Resubmit a scrape job
function resubmit(req, res)
{
    db.update("scraper", { id: req.params.id, status: "pending" }, { returning: "*", first: 1 }, (err, row) => {
        if (!row) return api.sendReply(res, 404, "no record found");

        api.ws.notify({}, { event: "scraper:status", data: row });

        jobs.submitJob({ job: { "scraper.job": row } }, (err) => {
            api.sendJSON(req, err, row);
        });
    });
}

// Delete a job by id
function del(req, res)
{
    const id = req.params.id
    db.del("scraper", { id }, (err, row, info) => {
        if (!err && info.affected_rows) {
            files.del(`${id}.png`);
            files.del(`${id}.html`);
        }
        api.sendJSON(req, err);
    });
}

// Scrape the url and save the image and html
async function scrape(options)
{
    logger.info("scrape:", mod.name, options);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: mod.width, height: mod.height });

    await page.goto(options.url, { waitUntil: 'networkidle0' });

    await page.evaluate(async (mod) => {
        await new Promise((resolve, reject) => {
            let height = 0;
            const timer = setInterval(() => {
                window.scrollBy(0, mod.height);
                height += mod.height;
                if (height >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 500);
        });
    }, mod);

    options.title = await page.title();

    const image = await page.screenshot({ fullPage: true });
    files.store(Buffer.from(image), `${options.id}.png`);

    const html = await page.content();
    files.store(Buffer.from(html), `${options.id}.html`);

    await browser.close();
}

