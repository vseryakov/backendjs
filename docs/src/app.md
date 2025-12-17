# Applications

An example structure of a generic single file application, app.js

```javascript
    const { core, api, db, server } = require("backendjs");

    const mymod = {
        name: "mymod",
        args: [
            { name: "types", type: "list", descr: "Types allowed" },
            { name: "size", type: "int", descr: "Records in one page" },
        ],
        tables: {
            mytable: {
                id: { type: "int", primary: 1 },
                name: { primary: 2 },
                type: { type: "list" },
                descr: {}
            }
        }
    };
    exports.module = mymod;
    app.addModule(mymod);

    mymod.configureWeb = function(options, callback)
    {
        api.app.all("/listTypes", async (req, res) => {
            var query = api.getQuery(req, {
                id: { required: 1 },
                type: { required: 1, values: mod.types },
            });
            if (typeof query == "string") return api.sendReply(res, 400, query);

            const rows = await db.aselect("mymod", query, { ops: { type: "in" }, count: mod.size });
            api.sendJSON(req, null, rows);
        });
    }

    server.start();
```

To run it:

        node app.js -api -mymod-size 20 -mymod-types t1,t2,t3


As with any Node.js application, node modules are the way to build and extend the functionality, backendjs does not restrict how
the application is structured but has predefined conventions to make it easy.

## Modules


# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other
specific usage can be achieved by using SQL directly or other query language supported by any particular database.

The database operations supported in the unified way provide simple actions like `db.get, db.put, db.update, db.del, db.select`.
The `db.query` method provides generic access to the database driver and executes given query directly by the db driver,
it can be SQL or other driver specific query request.

Before the tables can be queried the schema must be defined and created, the backend db layer provides simple functions to do it:

- first the table needs to be described, this is achieved by creating a JavaScript object with properties describing each column, multiple tables can be described
  at the same time, for example lets define album table and make sure it exists when we run our application:

```javascript
        db.describeTables({
           album: {
               id: { primary: 1 },                         // Primary key for an album
               name: { pub: 1 },                           // Album name, public column
               mtime: { type: "now" },                     // Modification timestamp
           },
           photo: {
               album_id: { primary: 1 },                   // Combined primary key
               id: { primary: 1 },                         // consisting of album and photo id
               name: { pub: 1, index: 1 },                 // Photo name or description, public column with the index for faster search
               mtime: { type: "now" }
           }
        });
```

- the system will automatically create the album and photos tables, this definition must remain in the app source code
  and be called on every app startup. This allows 1) to see the db schema while working with the app and 2) easily maintain it by adding new columns if
  necessary, all new columns will be detected and the database tables updated accordingly. And it is all JavaScript, no need to learn one more language or syntax
  to maintain database tables.

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hiding all specifics,
it just provides the same API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range
key, so when creating table to be used with DynamoDB, only one or two columns can be marked with primary property while for SQL
databases the composite primary key can consist of more than 2 columns.

The backendjs always creates several tables in the configured database pools by default, these tables are required to support
default API functionality and some are required for backend operations. Refer below for the JavaScript modules documentation
that described which tables are created by default. In the custom applications the `db.describeTables` method can modify columns
in the default table and add more columns if needed.

The cleanup of the public columns is done by the `api.cleanupResult` inside `api.sendJSON` which is used by all API routes when ready to send data back
to the client. If any post-process hooks are registered and return data itself then it is the hook responsibility to cleanup non-public columns.

```javascript
    db.describeTables({
        bk_user: {
            birthday: { pub: 1 },
            occupation: { pub: 1 },
        });

    app.configureWeb = function(options, callback)
    {
        db.setProcessRow("post", "bk_user", (req, row, options) => {
            if (row.birthday) {
                row.age = Math.floor((Date.now() - lib.toDate(row.birthday))/(86400000*365));
            }
        }
        ...
        callback();
    }
```

To define tables inside a module just provide a `tables` property in the module object, it will be picked up by database initialization automatically.

```javascript
    const mod = {
        name: "billing",
        tables: {
            invoices: {
                id: { type: "int", primary: 1 },
                name: {},
                price: { type: "real" },
                mtime: { type: "now" }
            }
        }
    }
    module.exports = mod;

    // Run db setup once all the DB pools are configured, for example produce dynamic icon property
    // for each record retrieved
    mod.configureModule = function(options, callback)
    {
        db.setProcessRows("post", "invoices", function(req, row, opts) {
           if (row.id) row.icon = "/images/" + row.id + ".png";
        });

        callback();
    }
```

## Tables can have aliases

This is useful for easier naming conventions or switching to a different table name on the fly without changinbf the code,
access to the table by it is real name is always available.

For example:

    bksh -db-aliases-bk_user users

    > await db.aget("bk_user", { login: "u1" })
    > { login: "u1", name: "user", .... }

    > await db.aget("users", { login: "u1" })
    > { login: "u1", name: "user", .... }



# Example of TODO application

Here is an example how to create simple TODO application using any database supported by the backend. It supports basic
operations like add/update/delete a record, show all records.

Create a file named `app.js` with the code below.

```javascript
    const { api, lib, app, db, server } = require('backendjs');

    // Describe the table to store todo records
    db.describeTables({
       todo: {
           id: { type: "uuid", primary: 1 },  // Store unique task id
           due: { type: "mtime" },            // Due date
           name: { strip: lib.rxXss },        // Short task name
           descr: { strip: lib.rxXss },       // Full description
           mtime: { type: "now" }             // Last update time in ms
       }
    });

    // API routes
    app.configureWeb = function(options, callback)
    {
        api.app.get(/^\/todo\/([a-z]+)$/, async (req, res) => {
           var options = api.getOptions(req), query;

           switch (req.params[0]) {
             case "get":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                const row = await db.aget("todo", { id: req.query.id }, options);
                api.sendJSON(req, null, row);
                break;

             case "select":
                // Get input, use defaults to check size limits (see api.queryDefault)
                query = api.getQuery(req, {
                    id: {},
                    name: {},
                    due: {},
                });
                // Query condition by column
                options.ops = {
                    id: "in",
                    name: "contains",
                    due: "gt",
                }
                // Allow empty scan of the whole table if no query is given, disabled by default
                options.noscan = 0;

                const rows = await db.aselect("todo", query, options);
                api.sendJSON(req, null, rows);
                break;

            case "add":
                // By default due date is tomorrow
                query = api.getQuery(req, {
                    name: { required: 1 },
                    due: { type: "mtime", dflt: Date.now() + 86400000 },
                    descr: {}
                });
                if (typeof query == "string") return api.sendReply(res, 400, query);

                db.add("todo", query, options, (err, rows) => {
                    api.sendJSON(req, err, rows);
                });
                break;

            case "update":
                query = api.getQuery(req, {
                    id: { required: 1 },
                    due: { type: "mtime" },
                    name: {},
                    descr: {}
                });
                if (typeof query == "string") return api.sendReply(res, 400, query);

                const rows = await db.aupdate("todo", query, options);
                api.sendJSON(req, null, rows);
                break;

            case "del":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                db.del("todo", { id: req.query.id }, options, (err, rows) => {
                    api.sendJSON(req, err, rows);
                });
                break;
            }
        });

        callback();
     }

     server.start();
```

Now run it with an option to allow API access without a user:

    node app.js -log debug -api -api-allow-path /todo -db-create-tables

To use a different database, for example PostgresSQL(running localy) or DynamoDB(assuming EC2 instance),
all config parametetrs can be stored in the etc/config as well

    node app.js -log debug -api -api-allow-path /todo -db-pool dynamodb -db-dynamodb-pool default -db-create-tables
    node app.js -log debug -api -api-allow-path /todo -db-pool pg -db-pg-pool default -db-create-tables

API commands can be executed in the browser or using `curl`:

    curl 'http://localhost:8000/todo?name=TestTask1&descr=Descr1&due=2015-01-01`
    curl 'http://localhost:8000/todo/select'
