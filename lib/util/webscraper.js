/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

/* global window document */

const { lib, file, logger, image } = require('backendjs');

const mod =

/**
 * Scrape the url and extract details using Puppeteer
 *
 * @module webscraper
 */

module.exports = {
    name: "webscraper",

    run,
    getDetails,
    getExtra,
    getLogos,
    getMeta,
    getScreenshot,
    autoScroll,
    acceptCookies,
    ldjsonParse,
    icalParse,
    cookieRx,
};

var puppeteer;

class Scraper {
    browser;
    context;

    async create(options) {
        if (!puppeteer) puppeteer = lib.tryRequire('puppeteer');

        try {
            this.browser = await puppeteer.launch({ dumpio: !!options.debug });
            this.context = await this.browser.createBrowserContext();

            const page = await this.context.newPage();
            page.on('console', msg => logger.debug("browser:", mod.name, msg.text()));

            await page.setViewport({ width: options.width || 1280, height: options.height || 1280 });

            return page;
        } catch (e) {
            logger.trace("create:", mod.name, e)
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
            logger.trace("close:", mod.name, e)
        }
    }


    async open(options) {
        logger.info("open:", mod.name, options);
        if (!options.url) return;

        const page = await this.create(options);
        if (!page) return;

        try {
            await page.goto(options.url);
        } catch (e) {
            logger.trace("goto:", mod.name, e);
            return;
        }

        try {
            await page.waitForNetworkIdle({ idleTime: options.idleTime || 5000, concurrency: options.idleConcurrency || 1 });
        } catch (e) {
            logger.trace("wait:", mod.name, e);
        }

        return page;
    }
}
mod.Scraper = Scraper;

/**
 * Runs the scraper for given url, extracts details
 *
 * Properties set in the options:
 * - {string} title - page title
 * - {string} logo - first logo
 * - {object} meta - meta tags
 * - {object} event - from LD+JSON
 * - {object} webpage - from LD+JSON
 * - {object} company - company from LD+JSON
 * - {object} ical - first event
 * - {string[]} logos - first 5 detected logos
 *
 * Files stored under options.root
 * - {file} page.png - first page screenshot
 * - {file} scroll.png - full page scrolled screenshot
 * - {file} full.png - screenshots of the first and fully scrolled down pages
 * - {file} page.html - HTML content
 * - {file} page.txt  - body innerText
 * - {file} logo.png - downloaded logo
 *
 * Different sources of information are supported:
 * - DOM
 * - meta tags
 * - LD+JSON scripts
 * - iCal links
 *
 * @param {object} options
 * @param {string} options.url
 * @memberof module:webscraper
 * @async
 */
async function run(options)
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
            await Promise.allSettled([
                getDetails(options, page),
                getMeta(options, page),
                getExtra(options, page),
                getLogos(options, page),
            ]);
        }
    }

    _scraper.close();
}

async function getScreenshot(options, page)
{
    let image1;
    const root = options.root || ".";

    try {
        image1 = Buffer.from(await page.screenshot({}));
        file.store(image1, `${root}/page.png`);
    } catch (e) {
        logger.trace("screnshot:", mod.name, e);
    }

    if (options.noscroll) return;

    try {
        await autoScroll(page, options);

        const image2 = Buffer.from(await page.screenshot({ fullPage: true }));
        file.store(image2, `${root}/scroll.png`);

        const image3 = await image.stitch([image1, image2]);
        file.store(await image3.png().toBuffer(), `${root}/full.png`);

    } catch (e) {
        logger.trace("screenshot:", mod.name, e);
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

var cookieRx = /^(Close[a-z ,-]*|Okay|Ok|Agree|Agree to all|Accept|Accept [a-z ,-]* cookies|Accept all|Allow|Allow all|Allow [a-z ,-]* cookies)$/i;

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
            logger.debug("acceptCookies:", mod.name, el.role, el.name, el.description);
        }
        for (const child of el.children || []) findMatches(child);
    }

    try {
        const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
        findMatches(snapshot);
    } catch (e) {
        logger.trace("acceptCookies:", mod.name, e)
    }

    for (const el of matches) {
        logger.debug("acceptCookies:", mod.name, "click:", el.role, el.name, el.description);
        try {
            const h = await el.elementHandle();
            await h.click();
        } catch (e) {
            logger.trace("acceptCookies:", mod.name, el.role, el.name, el.description, e);
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
                logger.trace("acceptCookies:", mod.name, e, link)
                continue;
            }

            if (!rx.test(item[0])) {
                logger.debug("acceptCookies:", mod.name, item);
                continue;
            }
            item = item.join(",");
            if (clicked.includes(item)) continue;

            logger.debug("acceptCookies:", mod.name, "click:", item);
            try {
                await link.click();
                await link.evaluate(el => {
                    try { el.click() } catch (e) { console.log("click:", e.message, el) }
                });
            } catch (e) {
                logger.trace("acceptCookies:", mod.name, e, link);
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

async function getDetails(options, page)
{
    try {
        const html = await page.content();
        file.store(Buffer.from(html), `${options.root}/page.html`);

        const text = await page.$eval("body", (elements => elements.innerText));
        file.store(Buffer.from(text), `${options.root}/page.txt`);

        options.title = await page.title();

    } catch (e) {
        logger.trace("getDetails:", mod.name, e);
    }
}

async function getMeta(options, page)
{
    try {
        const meta = await page.$$eval("meta",
                                elements => (elements.map(el => [el.name || el.getAttribute('property'), el.getAttribute('content')])));

        for (const [name, value] of meta) {
            if (!options.meta) options.meta = {};
            switch (name) {
            case "og:site_name":
                options.meta.name = value;
                break;

            case "description":
            case "og:description":
            case "schema:description":
                options.meta.description = value;
                break;

            case "og:image":
            case "schema:image":
                options.meta.ogimage = value;
                break;
            }
        }
    } catch (e) {
        logger.trace("getMeta:", mod.name, e);
    }
}

async function getExtra(options, page)
{
    try {
        const links = await page.$$eval("link, script",
                                 elements => (elements.filter(el => ["application/ld+json", "text/calendar"].includes(el.type)).
                                                       map(el => [el.type, el.href, el.textContent])));
        for (const link of links) {
            logger.debug("getExtra:", mod.name, link)

            if (link[0] == "text/calendar") {
                const { data } = await lib.afetch({ url: link[1], retryCount: 3, retryOnError: 1 });
                options.ical = icalParse(data)[0];
                if (options.ical) {
                    file.store(Buffer.from(data), `${options.root}/ld.ical`);
                }
            } else

            if (link[0] == "application/ld+json") {
                const data = lib.jsonParse(link[2]);
                if (data) {
                    ldjsonParse(options, data);
                    file.store(Buffer.from(lib.stringify(data, null, 2)), `${options.root}/ld.json`);
                }
            }

        }
    } catch (e) {
        logger.trace("getExtra:", mod.name, e);
    }
}

async function getLogos(options, page)
{
    let logos = [];

    try {
        logos = await page.$$eval(`link[rel*="icon"], img`,
                        elements => {
                            const rx = /apple-touch-icon|logo|brand|favicon/i;
                            return elements.filter(el => (/\.(png|jpg|jpeg)/.test(el.src || el.href) &&
                                                     (rx.test(el.alt) ||
                                                      rx.test(el.src || el.href) ||
                                                      rx.test(el.className) ||
                                                      rx.test(el.parentElement?.className) ||
                                                      rx.test(el.parentElement?.parentElement?.className)))).
                                            map(el => ({
                                                rel: el.rel || el.localName,
                                                src: el.src || el.href,
                                                alt: el.alt,
                                                class1: el.className,
                                                class2: el.parentElement?.className,
                                                class3: el.parentElement?.parentElement?.className,
                                                sizes: el.sizes,
                                            }))
                            });
    } catch (e) {
        logger.trace("getLogos:", mod.name, e);
        return;
    }

    // Rank logos by priority, prefer Apple icon, then explicit logos, favicons and brands
    logos.forEach((x, i) => {
        x.sort = 0;
        switch (x.rel) {
        case "apple-touch-icon":
            x.sort = 999999;
            break;

        case "img":
            if (/^logo|logo$/i.test(x.alt) || /^logo|logo$/i.test(x.class1)) {
                x.sort = 3000 - i*100;
            } else
            if (/logo/i.test(x.src)) {
                x.sort = 2000;
            } else
            if (/brand/i.test(x.src) || /logo|brand/i.test(x.class2) || /logo|brand/i.test(x.class3)) {
                x.sort = 500;
            }
            break;

        case "favicon":
            if (x.sizes) {
                x.sort = lib.split(x.sizes, /[ ,x]/).map(x => lib.toNumber(x, { max: 300, mult: 10 })).filter(x => x).sort().pop();
            }
            break;
        }
    });

    logos = logos.sort((a, b) => (b.sort - a.sort)).
                  reduce((a, b) => {
                    if (!a.includes(b.src)) a.push(b);
                    return a;
                }, []);

    logger.debug("getLogos:", mod.name, logos);

    options.logos = logos.slice(0, 5).map(x => x.src);
    options.logo = logos[0]?.src;

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

// Parse known schemas: Event, WebPage
function ldjsonParse(options, obj)
{
    switch (obj?.["@type"]) {
    case "Event":
        if (options.event) break;
        options.event = {};
        if (obj.name) {
            options.event.name = obj.name;
        }
        if (obj.description) {
            options.event.description = obj.description;
        }
        if (obj.startDate) {
            const sdate = lib.toDate(obj.startDate);
            if (sdate < Date.now()) break;
            obj.sdate = lib.strftime(sdate, "%b,%d,%Y")
        }
        if (obj.endDate) {
            obj.edate = lib.strftime(lib.toDate(obj.startDate), "%b,%d,%Y")
        }
        options.event.date = dateRange(obj.sdate, obj.edate);

        options.event.logo = obj.image?.["@id"];

        if (obj.location?.["@type"] == "Place") {
            options.event.venue = obj.location.name;
            if (obj.location.address) {
                const address = obj.location.address;
                if (lib.isString(address)) {
                    options.event.location = address;
                } else {
                    let location = "";
                    for (const p of ["addressLocality", "addressRegion", "addressCountry"]) {
                        if (address[p]) location += p + " ";
                    }
                    options.event.location = location.trim();
                }
            }
        }
        break;

    case "Organization":
        if (options.company) break;
        options.company = {
            name: obj.name,
            url: obj.url,
            logo: lib.isString(obj.logo) || obj.logo?.url || obj.image?.["@id"],
        };
        break;

    case "WebPage":
        if (options.webpage) break;
        options.webpage = {
            name: obj.name,
            description: obj.description,
            url: obj.url,
            logo: obj.thumbnailUrl || obj.image?.["@id"],
        }
        break;

    case "ImageObject":
        for (const p of ["event", "company", "webpage"]) {
            if (obj["@id"] == options[p]?.logo) {
                options[p].logo = obj.url;
            }
        }
        break;
    }

    for (const p in obj) {
        if (typeof obj[p] == "object" && obj[p]) {
            ldjsonParse(options, obj[p]);
        }
    }
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
