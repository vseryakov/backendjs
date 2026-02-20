
const puppeteer = require('puppeteer');
const fs = require('fs');
const { db, api, jobs } = require('backendjs');

const mod =

module.exports = {
    name: "scraper",

    args: [
        { name: "dir", descr: "Path to store images" },
    ],

    tables: {
        scraper: {
            id: { type: "uuid", primary: 1 },
            status: { dflt: "pending" },
            url: {},
            error: {},
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" },
        }
    },

    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.express.Router().
                get("/jobs", list).
                post("/submit", submit));


        callback();
    },

    job(options, callback)
    {
        scrape(options).then(() => {
            db.update("scraper", { id: options.id, status: "done" }, callback);
        }).catch((err) => {
            db.update("scraper", { id: options.id, status: "error", error: err.message }, callback);
        });
    }

}

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

function submit(req, res)
{
    var query = api.toParams(req, {
        url: { type: "url", required: 1 }
    })
    if (typeof query == "string") return api.sendReply(res, 400, query)


    db.add("scraper", query, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return api.sendJSON(req, err, row);

        jobs.submitJob(row, (err) => {
            api.sendJSON(req, err, row);
        });
    });
}

async function scrape(options)
{
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: options.width || 2100, height: options.height || 1800 });

    await page.goto(options.url, { waitUntil: 'networkidle0' });

    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            let height = 0;
            const scroll = options.scroll || 250;

            const timer = setInterval(() => {
                window.scrollBy(0, scroll);
                height += scroll;
                if (height >= document.body.scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 500);
        });
    });

    const basename = `${mod.dir || "."}/${options.id}`

    await page.screenshot({ path: `${basename}.png`, fullPage: true });

    const html = await page.content();
    fs.writeFileSync(`${basename}.html`, html, 'utf-8');

    await browser.close();
}


