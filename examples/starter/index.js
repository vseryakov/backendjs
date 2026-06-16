
const { db, app, api } = require('../../');

const mod = {
    name: "counter",

    tables: {
        counter: {
            id: { type: "int", primary: 1 },
            value: { type: "counter" },
            mtime: { type: "now" },
        }
    },

    configureMiddleware(options, callback)
    {
        api.app.get("/counter", this.getCounter);

        callback();
    },

    async getCounter(context)
    {
        const { err, data } = await db.aincr("counter", { id: 1, value: 1 }, { returning: "*", first: 1 });
        context.reply(err, data);
    }

}
app.addModule(mod);

app.start({ api: 1 });
console.log('Server running on http://%s:%s/counter', api.bind, api.port);
