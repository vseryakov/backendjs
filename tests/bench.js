//
// Benchmark from https://github.com/SaltyAom/bun-http-framework-benchmark
//
//  (cd tests && node bench.js)
//

const { app, api, lib, db } = require("backendjs");

const mod = {
    name: "bench",

    configureWeb(options, callback)
    {
        api.app.
        get('/', (req, res) => {
            res.setHeader('content-type', 'text/plain').
            send('Hi')
        }).
        post('/json', ({ body }, res) => {
            res.json(body)
        }).
        get('/id/:id', ({ params: { id }, query: { name } }, res) => {
            res.setHeader('x-powered-by', 'benchmark').
                setHeader('content-type', 'text/plain').
                send(`${id} ${name}`)
        }).
        get('/error/:id', (req, res) => {
            lib.series([
                function(next) {
                    db.get("bk_user", { login: req.params.id }, (err, row) => {
                        if (req.params.id == "found") throw new Error("found");
                        next();
                    });
                },
                function(next) {
                    throw new Error("series");
                },
            ], (err) => {
                api.sendReply(res, err);
            });
        });

        callback();
    },

}
app.addModule(mod);

app.start({ api: 1, roles: "bench" });
