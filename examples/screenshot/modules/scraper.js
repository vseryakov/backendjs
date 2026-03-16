
const puppeteer = require('puppeteer');
const { db, api, lib, file, jobs, logger, image } = require('backendjs');

const mod =

module.exports = {
    name: "scraper",

    args: [
        { name: "width", type: "int", descr: "Screenshot image width" },
        { name: "height", type: "int", descr: "Screenshot image height" },
    ],

    width: 1280,
    height: 1280,

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
        scraper(options).then(() => {
            const row = { id: options.id, status: "done", title: options.title, error: null };
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
        file.send(req, `${row.id}.${req.options.apath.at(-2)}`);
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

        jobs.submitJob({ job: { "scraper.job": { id: row.id, url: row.url } } }, (err) => {
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

        jobs.submitJob({ job: { "scraper.job": { id: row.id, url: row.url } } }, (err) => {
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
            file.del(`${id}.png`);
            file.del(`${id}.html`);
        }
        api.sendJSON(req, err);
    });
}

// Scrape the url and save the image and html
async function scraper(options)
{
    logger.info("scraper:", mod.name, options);

    const browser = await puppeteer.launch({ dumpio: true });
    const context = await browser.createBrowserContext();

    const page = await context.newPage();
    page.on('console', msg => logger.debug('page:', mod.name, msg.text()));

    await page.setViewport({ width: mod.width, height: mod.height });

    await page.goto(options.url, { waitUntil: 'networkidle0' });
    await lib.sleep(5000);

    options.title = await page.title();

    await acceptCookies(page);

    const image1 = await page.screenshot({});

    file.store(Buffer.from(image1), `${options.id}-1.png`);

    await autoScroll(page);

    if (options.scrollTop !== undefined) {
        await page.evaluate(() => { window.scrollTo({ top: options.scrollTop }) });
        await lib.sleep(1000);
    }

    const html = await page.content();
    file.store(Buffer.from(html), `${options.id}.html`);

    const image2 = await page.screenshot({ fullPage: true });

    file.store(Buffer.from(image2), `${options.id}-2.png`);

    await saveScreenshot(options, image1, image2);

    await context.close();
    await browser.close();
}

async function autoScroll(page)
{
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            let height = 0;
            const distance = document.documentElement.clientHeight;

            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                height += distance;

                if (height >= document.body.scrollHeight) {
                  clearInterval(timer);
                  resolve();
              }
            }, 1000);
        });
    });
    await lib.sleep(500);
};

async function acceptCookies(page)
{
    const rx = /^(Okay|Ok|Agree|Agree to all|Accept|Accept [a-z ,-]* cookies|Accept all|Allow|Allow all|Allow [a-z ,-]* cookies)$/gi;

    var clicked = 0, tree = [];

    const links = [
        ...await page.$$('a, button'),
        ...await page.$$('>>> a'),
        ...await page.$$('>>> button')
    ];
    links.forEach(async node => {
        const a = await node.evaluate(el => [el.localName, el.id, el.className, el.textContent?.trim()]);
        tree.push(a);
        if (rx.test(a.at(-1))) {
            await node.evaluate(el => el.click());
            clicked++;
            a.push("click");
        }
    });

    if (!clicked) {
        const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
        async function findCookies(el) {
            if (el.role == "link" || el.role == "button") {
                var a = [el.role, el.name, el.description]
                if (rx.test(a[1]) || rx.test(a[2])) {
                    const h = await el.elementHandle();
                    h.click();
                    a.push("click");
                    clicked++;
                }
                tree.push(a);
            }
            for (const child of el.children || []) findCookies(child);
        }
        findCookies(snapshot);
    }

    if (clicked) {
        try {
            await page.waitForNavigation({ timeout: 5000 });
        } catch (e) {}
    }

    tree.forEach(x => logger.debug("acceptCookies:", x));

    await lib.sleep(1000);
    return tree;
}

async function saveScreenshot(options, image1, image2)
{
    const stats1 = await image.stats(Buffer.from(image1));
    const stats2 = await image.stats(Buffer.from(image2));

    const items = [
        { width: mod.width, height: stats1.meta.height + stats2.meta.height + 20 },
        { data: stats1.image, gravity: "north" },
        { data: stats2.image, gravity: "south" },
    ]

    await image.composite(items);

    file.store(items[0].buffer, `${options.id}.png`);

    await lib.sleep(100);
}

