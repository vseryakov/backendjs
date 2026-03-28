
/* global window document */

const puppeteer = require('puppeteer');

const { lib, file, logger, image } = require('backendjs');

// Scrape the url and save the image and html

const cookieRx = /^(Close[a-z ,-]*|Okay|Ok|Agree|Agree to all|Accept|Accept [a-z ,-]* cookies|Accept all|Allow|Allow all|Allow [a-z ,-]* cookies)$/i;

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
            logger.trace(" create:", "scraper:", "create:", e)
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
            logger.trace("close:", "scraper:", "close:", e)
        }
    }


    async open(options) {
        logger.info("scraper:", "open:", options);

        const page = await this.create(options);
        if (!page) return;

        try {
            await page.goto(options.url);
        } catch (e) {
            logger.trace('scraper:', "goto:", e);
            return;
        }

        try {
            await page.waitForNetworkIdle({ idleTime: options.idleTime || 1000, concurrency: options.idleConcurrency || 1 });
        } catch (e) {
            logger.debug('scraper:', "wait:", e);
        }

        return page;
    }
}

module.exports = {
    scraper,
    ldjsonParse,
    icalParse,
    getDetails,
    autoScroll,
    acceptCookies,
    tileImages,
    getScreenshot,
    Scraper,
    cookieRx,
};

async function scraper(options)
{
    const _scraper = new Scraper();

    const page = await _scraper.open(options);

    if (page) {

        if (!options.nocookies) {
            await acceptCookies(options, page);
        }

        if (!options.noscreenshots) {
            await getScreenshot(options, page);
        }

        if (!options.nodetails) {
            await getDetails(options, page);
        }
    }

    return _scraper.close();
}

async function getScreenshot(options, page)
{
    let image1;
    const root = options.root || ".";

    try {
        image1 = await page.screenshot({});
        file.store(Buffer.from(image1), `${root}/page.png`);
    } catch (e) {
        logger.trace("screnshot:", "scraper:", e);
    }

    if (options.noscroll) return;

    try {
        await autoScroll(page, options);

        const image2 = await page.screenshot({ fullPage: true });
        file.store(Buffer.from(image2), `${root}/scroll.png`);

        await tileImages(`${root}/full.png`, image1, image2);

    } catch (e) {
        logger.trace("screenshot:", "scraper:", e);
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

async function acceptCookies(options, page)
{
    var rx = options.cookieRx || cookieRx;

    await lib.sleep(options.idleDelay || 3000);

    const clicked = [];

    const matches = [];

    function findMatches(el) {
        if (el.role == "link" || el.role == "button" && (el.name || el.description)) {
            if (rx.test(el.name) || rx.test(el.description)) {
                matches.push(el);
            }
            logger.debug("acceptCookies:", "scraper:", el.role, el.name, el.description);
        }
        for (const child of el.children || []) findMatches(child);
    }

    try {
        const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
        findMatches(snapshot);
    } catch (e) {
        logger.trace("acceptCookies:", "scraper:", e)
    }

    for (const el of matches) {
        logger.debug("acceptCookies:", "scraper:", "click:", el.role, el.name, el.description);
        try {
            const h = await el.elementHandle();
            await h.click();
        } catch (e) {
            logger.trace("acceptCookies:", "scraper:", el.role, el.name, el.description, e);
        }
        clicked.push(`${el.role},${el.name},${el.description}`);
    }

    if (clicked.length) {
        await lib.sleep(1000);
    }

    var results = await Promise.allSettled([ page.$$('a, button'), page.$$('>>> a'), page.$$('>>> button') ]);
    for (const res of results) {
        if (!res.value?.length) continue;

        for (const link of res.value) {
            let item;
            try {
                item = await link.evaluate(el => [el.textContent?.trim(), el.localName, el.className, el.getAttribute('id')]);
            } catch (e) {
                logger.trace("acceptCookies:", "scraper:", e, link)
                continue;
            }

            if (!rx.test(item[0])) {
                logger.debug("acceptCookies:", "scraper:", item);
                continue;
            }
            item = item.join(",");
            if (clicked.includes(item)) continue;

            logger.debug("acceptCookies:", "scraper:", "click:", item);
            try {
                await link.click();
                await link.evaluate(el => {
                    try { el.click() } catch (e) { console.log("click:", e.message, el) }
                });
            } catch (e) {
                logger.trace("acceptCookies:", "scraper:", e, link);
            }
            clicked.push(item);
        }
    }

    if (clicked.length) {
        try {
            await page.waitForNavigation({ timeout: 5000 });
        } catch (e) {}
    }
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

async function getDetails(options, page)
{
    try {
        const html = await page.content();
        file.store(Buffer.from(html), `${options.root}/page.html`);

        options.title = await page.title();

    } catch (e) {
        logger.trace("getDetails:", "scraper:", e);
    }

    try {
        const links = await page.$$eval("link, script",
                                 elements => (elements.filter(el => ["application/ld+json", "text/calendar"].includes(el.type)).
                                                       map(el => [el.type, el.href, el.textContent])));
        for (const link of links) {
            logger.debug("getDetails:", "scraper:", link)

            if (link[0] == "text/calendar") {
                const { data } = await lib.afetch({ url: link[1], retryCount: 3, retryOnError: 1 });
                options.ical = icalParse(data)[0];
                if (options.ical) {
                    file.store(Buffer.from(data), `${options.root}/ld.ical`);
                }
            } else

            if (link[0] == "application/ld+json") {
                const data = lib.jsonParse(link[2]);
                options.ldjson = ldjsonParse({}, data);
                if (options.ldjson) {
                    file.store(Buffer.from(lib.stringify(data, null, 2)), `${options.root}/ld.json`);
                }
            }

        }
    } catch (e) {
        logger.trace("getDetails:", "scraper:", e);
    }

    try {
        const meta = await page.$$eval("meta",
                                elements => (elements.map(el => [el.name || el.getAttribute('property'), el.getAttribute('content')])));
        for (const [name, value] of meta) {
            switch (name) {
            case "og:site_name":
                if (!options.name) options.name = value;
                break;

            case "description":
            case "og:description":
            case "schema:description":
                if (!options.description) options.description = value;
                break;

            case "og:image":
            case "schema:image":
                if (!options.logo) options.logo = value;
                break;
            }
        }
    } catch (e) {
        logger.trace("getDetails:", "scraper:", e);
    }

    if (!options.logo) {
        try {
            const images = await page.$$eval("img",
                                      elements => (elements.filter(el => (/logo/i.test(el.alt) ||
                                                                          /logo/i.test(el.src) ||
                                                                          /logo/i.test(el.parentElement?.className) ||
                                                                          /logo/i.test(el.parentElement?.parentElement?.className))).
                                                            map(el => [el.src, el.alt])));
            logger.debug("getDetails:", "scraper:", images);
            if (images.length) options.logo = images?.[0][0];
        } catch (e) {
            logger.trace("getDetails:", "scraper:", e);
        }
    }

    if (options.logo) {
        const { err, data } = await lib.afetch({ url: options.logo, binary: 1, retryCount: 3, retryOnError: 1 });
        if (!err) file.store(data, `${options.root}/logo.png`);
    }
}

function dateRange(s, e)
{
    s = lib.split(s)
    e = lib.split(e)

    if (s[0] == e[0]) {
        s[1] += "-" + e[1];
    } else

    if (s[2] == e[2]) {
        s[0] = s[0] + " " + s[1] + " -";
        s[1] = e[0] + " " + e[1];
    }
    return s.join(" ");
}

// Parse known schemas: Event
function ldjsonParse(options, obj)
{
    switch (obj?.["@type"]) {
    case "Event":
        if (options.name) break;
        if (obj.startDate) {
            const sdate = lib.toDate(obj.startDate);
            if (sdate < Date.now()) break;
            obj.sdate = lib.strftime(sdate, "%b,%d,%Y")
        }
        if (obj.endDate) {
            obj.edate = lib.strftime(lib.toDate(obj.startDate), "%b,%d,%Y")
        }
        options.date = dateRange(obj.sdate, obj.edate);

        if (obj.name) {
            options.name = obj.name;
        }
        if (obj.description) {
            options.description = obj.description;
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
            ldjsonParse(options, obj[p]);
        }
    }
    return options;
}

function icalParse(data)
{
    var events = [], event = {}, lines = lib.split(data, "\n");
    for (var i = 0; i < lines.length; i++) {
        const d = lines[i].trim().match(/^([^:]+):(.+)/);
        if (!d) continue;
        var attr = d[1].split(";");
        var value = lib.unescape(lib.entityToText(d[2]));
        while (i + 1 < lines.length && lines[i + 1][0] == " ") {
            value += lib.unescape(lib.entityToText(lines[i + 1])).trim();
            i++;
        }
        switch (attr[0]) {
        case "BEGIN":
            if (value != "VEVENT") break;
            event = {};
            break;

        case "DTSTART":
            value = value.split("T")[0];
            value = value.substr(0, 4) + "-" + value.substr(4, 2) + "-" + value.substr(7, 2);
            event.sdate = lib.strftime(lib.toDate(value), "%b,%d,%Y")
            event.date = dateRange(event.sdate, event.edate);
            break;

        case "DTEND":
            value = value.split("T")[0];
            value = value.substr(0, 4) + "-" + value.substr(4, 2) + "-" + value.substr(7, 2);
            event.edate = lib.strftime(lib.toDate(value), "%b,%d,%Y")
            event.date = dateRange(event.sdate, event.edate);
            break;

        case "SUMMARY":
            event.name = value;
            break;

        case "URL":
        case "DESCRIPTION":
            event[attr[0].toLowerCase()] = value;
            break;

        case "LOCATION":
            if (value.includes("|")) {
                value = lib.split(value, "|");
                event.venue = value[0];
                value = value[1];
            }
            event.location = value;
            break;

        case "END":
            if (value != "VEVENT") break;
            if (event) events.push(event);
            break;

        }
    }
    return events;
}
