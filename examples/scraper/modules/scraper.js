
/* global window document */

const puppeteer = require('puppeteer');

const { lib, file, logger, image } = require('backendjs');

// Scrape the url and save the image and html

class Scraper {
    browser;
    context;

    async create(options) {
        try {
            this.browser = await puppeteer.launch({ dumpio: true });
            this.context = await this.browser.createBrowserContext();

            const page = await this.context.newPage();
            page.on('console', msg => logger.debug('scraper:', msg.text()));
            await page.setViewport({ width: options.width || 1280, height: options.height || 1280 });

            return page;
        } catch (e) {
            logger.trace(" create:", "scraper:", e)
            this.close()
        }
    }

    async close() {
        try {
            if (this.context) {
                await this.context.close();
                this.context = null;
            }
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        } catch (e) {
            logger.trace("close:", "scraper:", e)
        }
    }


    async open(options) {
        logger.info("scraper:", "open:", options);

        const page = await this.create(options);
        if (!page) return;

        try {
            await page.goto(options.url);
        } catch (e) {
            logger.trace('scraper:', e);
            return;
        }

        try {
            await page.waitForNetworkIdle({ idleTime: options.idleTime || 1000, concurrency: options.idleConcurrency || 1 });
        } catch (e) {
            logger.debug('scraper:', e);
            return;
        }

        if (options.cookieRx) {
            await lib.sleep(options.idleDelay || 3000);
            try {
                await acceptCookies(page, options.cookieRx);
            } catch (e) {
                logger.trace('scraper:', e);
            }
        }

        return page;
    }
}

async function scraper(options)
{
    const _scraper = new Scraper();

    const page = await _scraper.open(options);
    if (!page) return _scraper.close();

    try {
        await getDetails(options, page);

        const image1 = await page.screenshot({});
        file.store(Buffer.from(image1), `${options.root}/page.png`);

        if (!options.noScroll) {
            await autoScroll(page, options);

            if (options.scrollTop !== undefined) {
                await page.evaluate(() => { window.scrollTo({ top: options.scrollTop }) });
                await lib.sleep(1000);
            }

            const image2 = await page.screenshot({ fullPage: true });
            file.store(Buffer.from(image2), `${options.root}/scroll.png`);

            await tileImages(`${options.root}/full.png`, image1, image2);
        }
    } catch (e) {
        logger.trace("scraper:", e);
        _scraper.close();
    }
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

async function acceptCookies(page, rx)
{
    var clicked = 0, tree = [];

    const links = [
        ...await page.$$('a, button'),
        ...await page.$$('>>> a'),
        ...await page.$$('>>> button')
    ];
    links.forEach(async node => {
        const a = await node.evaluate(el => [el.localName, el.id, el.className, el.textContent?.trim()]);
        if (!a.at(-1)) return;
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
            if (el.role == "link" || el.role == "button" && (el.name || el.description)) {
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

    tree.forEach(x => logger.debug("scraper:", "acceptCookies:", x));

    await lib.sleep(1000);
    return tree;
}

async function tileImages(path, image1, image2)
{
    const stats1 = await image.stats(Buffer.from(image1));
    const stats2 = await image.stats(Buffer.from(image2));

    const items = [
        {
            width: Math.max(stats1.meta.width, stats2.meta.width),
            height: stats1.meta.height + stats2.meta.height + 20,
            background: "#FFFFFF",
        },
        {
            data: stats1._image,
            gravity: "north"
        },
        {
            data: stats2._image,
            gravity: "south"
        },
    ]

    await image.composite(items);

    file.store(items[0]._buffer, path);

    return items;
}

// Parse known schemas: Event
function parseSchema(options, obj)
{
    switch (obj?.["@type"]) {
    case "Event":
        if (options.name) break;
        if (obj.name) {
            options.name = obj.name;
        }
        if (obj.description) {
            options.descr = obj.description;
        }
        if (obj.startDate) {
            const date = lib.split(lib.strftime(lib.toDate(obj.startDate), "%b,%d,%Y"))
            if (obj.endDate) {
                const edate = lib.split(lib.strftime(lib.toDate(obj.startDate), "%b,%d,%Y"))
                if (date[0] == edate[0]) {
                    date[1] += "-" + edate[1];
                } else
                if (date[2] == edate[2]) {
                    date[0] = date[0] + " " + date[1] + " -";
                    date[1] = edate[0] + " " + edate[1];
                }
            }
            options.date = date.join(" ");
        }
        if (obj.location?.["@type"] == "Place") {
            options.venue = obj.location.name;
            if (obj.location.address) {
                const address = obj.location.address;
                if (lib.isString(address)) {
                    options.location = address;
                } else {
                    let location = "";
                    for (const p of ["addressLocality", "addressRegion", "addressCountry"]) {
                        if (address[p]) location += p + " ";
                    }
                    options.location = location.trim();
                }
            }
        }
        break;

    case "Organization":
        if (options.company) break;
        options.company = obj.name;
        break;
    }

    for (const p in obj) {
        if (typeof obj[p] == "object" && obj[p]) {
            parseSchema(options, obj[p]);
        }
    }
    return options;
}

async function getDetails(options, page)
{
    options.title = await page.title();

    const html = await page.content();
    file.store(Buffer.from(html), `${options.root}/page.html`);

    var ldjson = html.match(/type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/i);
    if (ldjson) {
        ldjson = lib.jsonParse(ldjson[1]);
        if (ldjson) {
            parseSchema(options, ldjson);

            ldjson = lib.stringify(ldjson, null, 2);
            file.store(Buffer.from(ldjson), `${options.root}/ld.json`);
        }
    }

    const meta = await page.$$eval("meta", elements => (elements.map(el => [el.name || el.getAttribute('property'), el.getAttribute('content')])));
    for (const [name, value] of meta) {
        switch (name) {
        case "og:site_name":
            if (!options.name) options.name = value;
            break;

        case "description":
        case "og:description":
        case "schema:description":
            if (!options.descr) options.descr = value;
            break;

        case "og:image":
        case "schema:image":
            if (!options.logo) options.logo = value;
            break;
        }
    }

    if (!options.logo) {
        const images = await page.$$eval("img", elements => (elements.map(el => [el.src, el.alt])));
        options.logo = images.find(x => /logo/i.test(x[1]) || /logo/i.test(x[0])).map(x => x[0]);
    }

    if (options.logo) {
        const { err, data } = await lib.afetch({ url: options.logo, binary: 1, retryCount: 3, retryOnError: 1 });
        if (!err) file.store(data, `${options.root}/logo.png`);
    }
}

module.exports = {
    scraper,
    parseSchema,
    getDetails,
    autoScroll,
    acceptCookies,
    tileImages,
    Scraper,
};
