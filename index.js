const { db, app, api } = require('./');

const counter = {
    name: "counter",

    tables: {
        counter: {
            id: { type: "int", primary: 1 },
            value: { type: "counter" },
            mtime: { type: "now" },
        }
    },

    configureWeb(options, callback)
    {
        api.app.get("/counter", (req, res) => {

            db.incr("counter", { id: 1, value: 1 }, { returning: "*", first: 1 }, (err, row) => {
                if (err) {
                    return api.sendReply(res, err);
                }
                api.sendJSON(req, row);
            });
        });
        callback();
    }

}
app.addModule(counter);

app.start({ api: 1 });

