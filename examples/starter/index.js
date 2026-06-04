
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

    getCounter(context)
    {
        db.incr("counter", { id: 1, value: 1 }, { returning: "*", first: 1 }, (err, row) => {
            context.reply(err, row);
        });
    }

}
app.addModule(mod);

app.start({ api: 1 });
console.log('Server running on http://%s:%s', api.bind, api.port);
