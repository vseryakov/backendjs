
const { db, api, file, jobs, lib, logger } = require('backendjs');
const { scrape } = require("./scrape");

const mod =

module.exports = {
    name: "scraper",

    args: [
        { name: "width", type: "int", descr: "Screenshot image width" },
        { name: "height", type: "int", descr: "Screenshot image height" },
        { name: "cookie-rx", type: "regexp", descr: "Accept cookies popups patterns" },
    ],

    width: 1280,
    height: 1280,

    cookieRx: /^(Okay|Ok|Agree|Agree to all|Accept|Accept [a-z ,-]* cookies|Accept all|Allow|Allow all|Allow [a-z ,-]* cookies)$/gi,

    tables: {

        /**
         * Database table definition
         */
        scraper: {
            id: { primary: 1 },
            status: { dflt: "pending" },
            url: {},
            name: {},
            title: {},
            logo: {},
            date: {},
            venue: {},
            location: {},
            descr: {},
            company: {},
            error: {},
            ctime: { type: "now", readonly: 1 },
            mtime: { type: "now" },
        }
    },

    /**
     * Setup all routes
     */
    configureWeb(options, callback)
    {
        api.app.use("/api",
            api.express.Router().
                get("/list", list).
                get("/asset/:id", assets).
                post("/submit", submit).
                put("/resubmit/:id", resubmit).
                delete("/del/:id", del));

        callback();
    },

    job,
    update,
    submit,
    resubmit,

}

/**
 * Return a list of all jobs submitted
 */
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

/**
 * Return image or html content, png can support suffixes like id-2
 */
function assets(req, res)
{
    const [id] = req.params.id.split(/[._]/);
    db.get("scraper", { id }, (err, row) => {
        if (!row) return api.sendReply(res, 404, "no record found");
        file.send(req, req.params.id);
    });
}

/**
 * This is a job method that is run by a worker to do the actual scraping, once done it notifies
 * web page about the status via websocket
 */
function job(options, callback)
{
    const opts = {
        ...options,
        width: mod.width,
        height: mod.height,
        cookieRx: mod.cookieRx
    }
    scrape(opts).then(() => {
        mod.update(opts, callback);
    }).catch((err) => {
        logger.trace("job:", mod.name, opts, err);
        update(Object.assign(opts, { error: err.message }), callback);
    });
}

/**
 * Create/replace a scraper record, notify about it via websocket
 */
function update(options, callback)
{
    options.error = options.error || null;
    options.status = options.error ? "error" : "done";
    db.update("scraper", options, { result_query: 1, first: 1 }, (err, data) => {
        api.ws.notify({}, { event: "scraper:status", data });
        lib.tryCall(callback, err, data);
    });
}

/**
 * Submit a new scrape job
 */
function submit(req, res)
{
    var query = api.toParams(req, {
        url: { type: "url", required: 1 },
        status: { value: "pending" },
    })
    if (typeof query == "string") return api.sendReply(res, 400, query)

    query.id = query.url.replace(/^https?:\/\//, "").
                         replace(/[^a-z0-9-]/gi, "-").
                         replace(/-{2,}/g, "-").
                         replace(/^-+|-+$/g, "");

    db.put("scraper", query, { result_query: 1, first: 1 }, (err, row) => {
        if (err) return api.sendJSON(req, err, row);

        api.ws.notify({}, { event: "scraper:status", data: row });

        jobs.submitJob({ job: { "scraper.job": { id: row.id, url: row.url } } }, (err) => {
            api.sendJSON(req, err, row);
        });
    });
}

/**
 * Resubmit a scrape job
 */
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

/**
 * Delete a job by id
 */
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
