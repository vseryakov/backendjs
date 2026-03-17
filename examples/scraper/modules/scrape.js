
const puppeteer = require('puppeteer');

const { lib, file, logger, image } = require('backendjs');

// Scrape the url and save the image and html
module.exports =

async function scrape(options)
{
    logger.info("scrape:", options);

    const browser = await puppeteer.launch({ dumpio: true });
    const context = await browser.createBrowserContext();

    const page = await context.newPage();
    page.on('console', msg => logger.debug('scrape:', msg.text()));

    await page.setViewport({ width: options.width, height: options.height });

    await page.goto(options.url, { waitUntil: 'networkidle0' });
    await lib.sleep(5000);

    if (options.cookieRx) {
        await acceptCookies(page, options.cookieRx);
    }

    await getDetails(options, page);

    const image1 = await page.screenshot({});
    file.store(Buffer.from(image1), `${options.id}.png`);

    if (!options.noScroll) {
        await autoScroll(page);

        if (options.scrollTop !== undefined) {
            await page.evaluate(() => { window.scrollTo({ top: options.scrollTop }) });
            await lib.sleep(1000);
        }

        const image2 = await page.screenshot({ fullPage: true });
        await tileImages(`${options.id}_full.png`, image1, image2);
    }

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

    tree.forEach(x => logger.debug("scrape:", "acceptCookies:", x));

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
            height: stats1.meta.height + stats2.meta.height + 20
        },
        {
            data: stats1.image,
            gravity: "north"
        },
        {
            data: stats2.image,
            gravity: "south"
        },
    ]

    await image.composite(items);

    file.store(items[0].buffer, path);

    return items;
}

async function getDetails(options, page)
{
    options.title = await page.title();

    const html = await page.content();
    file.store(Buffer.from(html), `${options.id}.html`);

    var ldjson = html.match(/type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/i);
    if (ldjson) {
        ldjson = lib.jsonParse(ldjson[1]);
        if (ldjson) {
            ldjson = lib.stringify(ldjson, null, 2);
            file.store(Buffer.from(ldjson), `${options.id}_ld.json`);
        }
    }

    const meta = await page.$$eval("meta", elements => (elements.map(el => [el.name || el.getAttribute('property'), el.getAttribute('content')])));
    for (const [name, value] of meta) {
        switch (name) {
        case "og:site_name":
            options.name = value;
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
        if (!err) file.store(data, `${options.id}_logo.png`);
    }
}

