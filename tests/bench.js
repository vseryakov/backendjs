//
// Benchmark from https://github.com/SaltyAom/bun-http-framework-benchmark
//
//  (cd tests && node bench.js)
//

const { app, api, lib, db, middleware } = require("backendjs");

const mod = {
    name: "bench",

    configureMiddleware(options, callback)
    {
        api.app.
        get('/', (context) => {
            context.send(200, 'Hi')
        }).
        post('/json', middleware.body, (context) => {
            context.json(context.body)
        }).
        get('/id/:id', (context) => {
            context.setHeader('x-powered-by', 'benchmark');
            context.send(200, `${context.params.id} ${context.query.name}`)
        }).
        get('/error/:id', (context) => {
            lib.series([
                function(next) {
                    db.get("bk_user", { login: context.params.id }, (err, row) => {
                        if (context.params.id == "found") throw new Error("found");
                        next();
                    });
                },
                function(next) {
                    throw new Error("series");
                },
            ], (err) => {
                context.reply(err);
            });
        });

        callback();
    },

}
app.addModule(mod);

app.start({ api: 1, roles: "bench" });
