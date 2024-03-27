# Backend library for Node.js

General purpose backend library. The primary goal is to have a scalable platform for running and managing Node.js
servers for Web services implementation.

This project only covers the lower portion of the Web services ecosystem:
Node.js processes, HTTP servers, basic API functionality, database access, caching, messaging between processes,
metrics and monitoring, a library of tools for developing Node.js servers.

For the UI and presentation layer there are no restrictions what to use as long as it can run on top of the Express server.

Features:

* Exposes a set of Web service APIs over HTTP(S) using Express framework.
* Database API supports SQLite, PostreSQL, DynamoDB, ElasticSearch with all basic operations behaving the
  same way allowing you to switch databases without changing the code.
* Database operations (Get, Put, Del, Update, Select) for all supported databases using the same DB API.
* Experimental database drivers for MySQL, Cassandra, Riak, CouchDB
* Experimental DynamoDB Streams processing in background worker processes
* Easily extensible to support any kind of database, provides an experimental database driver on top of Redis with all supported methods as an example.
* Supports crontab and queue job processing by separate worker processes.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Runs web server as separate processes to utilize multiple CPU cores.
* Supports WebSockets connections and process them with the same Express routes as HTTP requests
* Supports several cache modes(Redis, Memcache, Hazelcast, LRU) for the database operations, multiple hosts support
  in the clients for failover.
* Supports several PUB/SUB modes of operations using Redis, NATS, RabbitMQ, Hazelcast.
* Supports async jobs processing using several work queue implementations on top of SQS, Redis, NATS, DB, RabbitMQ, Hazelcast.
* REPL (command line) interface for debugging and looking into server internals.
* Supports push notifications via Webpush, APN and FCM.
  server running in the master process instead of relying on the OS scheduling between processes listening on the same port.
* Can be used with any MVC, MVVC or other types of frameworks that work on top of, or with, the Express server.
* AWS support is very well integrated including EC2, S3, DynamoDB, SQS and more.
* Includes simple log watcher to monitor the log files including system errors.
* Supports i18n hooks for request/response objects, easily overriden with any real i18n implementation.
* Integrated very light unit testing facility which can be used to test modules and API requests
* Support runtime metrics about the timing on database, requests, cache, memory and request rate limit control
* Full implementation of SRP6a protocol in the server and client
* Hosted on [github](https://github.com/vseryakov/backendjs), BSD licensed.

Check out the [Documentation](http://bkjs.io) for more details.

# Installation

To install the module with all optional dependencies if they are available in the system

    npm install backendjs

To install from the git

     npm install git+https://github.com/vseryakov/backendjs.git

or simply

     npm install vseryakov/backendjs

# Dependencies

Only core required dependencies are installed but there are many modules which require a module to work correctly.

All optional dependencies are listed in the package.json under "modDependencies" so npm cannot use it, only manual install of required modules is supported or
it is possible to install all optional dependencies for development purposes.

Here is the list of modules required for each internal feature:

- `pg` - PostgreSQL database access
- `argon2` or `bcrypt` - for user password hashing
- `mmmagic` - file detection in uploads, only used when `allow` is passed to the `api.putFile`
- `redis` - for Redis queue and cache driver
- `unix-dgram` - for syslog on Linux to use local syslog
- `bkjs-sqlite` - to use SQLite database driver
- `web-push` - for Web push notifications
- `@parse/node-apn` - for Apple push notifications
- `sharp` - scaling images in uploads using VPS imaging
- `nats` - NATS driver for queue and events
- `amqplib` - RabbitMQ driver for queue and events (alpha)

The command below will show all core and optional dependencies, `npm install` will install only the core dependencies

     bkjs deps -dry-run -mods

# Quick start and introduction

* Simplest way of using the backendjs, it will start the server listening on port 8000

        $ node
        > const bkjs = require('backendjs')
        > bkjs.server.start()

* Access is allowed only with valid signature except urls that are explicitly allowed without it (see `api-allow` config parameter below)
* Same but using the helper tool, by default no database driver are enablked so here we use embedded SQLite database and listen on port 8000.

        bkjs web -db-pool sqlite -db-sqlite-pool default

* or to the PostgreSQL server, database backend

        bkjs web -db-pool pg -db-pg-pool postgresql://postgres@localhost/backend

* If running on EC2 instance with IAM profile no need to specify AWS credentials:

        bkjs web -db-pool dynamodb -db-dynamodb-pool default

* To start the server and connect to the DynamoDB (command line parameters can be saved in the `etc/config file`, see below about config files)

        bkjs web -db-pool dynamodb -db-dynamodb-pool default -aws-key XXXX -aws-secret XXXX

* or to the ElasticSearch server, database backend

        bkjs web -db-pool elasticsearch -db-elasticsearch-pool http://127.0.0.1:9200

* All commands above will behave exactly the same

* **Tables are not created by default**, in order to initialize the database, run the server or the shell with `-db-create-tables` flag,
  it is called only inside a master process, a worker never creates tables on start

  - prepare the tables in the shell

        bksh -db-pool dynamodb -db-dynamodb-pool default -db-create-tables

  - run the server and create tables on start, run Elasticsearch locally first on the local machine

        bkjs get-elasticsearch
        bkjs run-elasticsearch

        bkjs web -db-pool elasticsearch -db-elasticsearch-pool http://127.0.0.1:9200 -db-create-tables

* While the local backendjs is runnning, the documentation is always available at http://localhost:8000/doc.html (or whatever port is the server using)

* To add users from the command line

        bksh -user-add login test secret test name TestUser email test@test.com

* To start Node.js shell with backendjs loaded and initialized, all command line parameters apply to the shell as well

        bkjs shell

* To access the database while in the shell using callbacks

        > db.select("bk_user", {}, lib.log);
        > db.add("bk_user", { id: 'test2', login: 'test2', secret: 'test2', name' Test 2 name' }, lib.log);
        > db.select("bk_user", { id: 'test2' }, lib.log);
        > db.select("bk_user", { id: ['test1','test2'] }, { ops: { id: "in" } }, lib.log);

or the same using async/await, same methods with `a` prepended to the name

        > await db.aselect("bk_user", {});
        > await db.aadd("bk_user", { id: 'test2', login: 'test2', secret: 'test2', name' Test 2 name' });
        > await db.aselect("bk_user", { id: 'test2' });

* To search using Elasticsearch (assuming it runs on EC2 and it is synced with DynamoDB using streams)

        > await db.select("bk_user", { q: 'test' }, { pool: "elasticsearch" });

## To run an example

* The library is packaged with copies of Bootstrap, jQuery, Knockout.js for quick Web development
in web/js and web/css directories, all scripts are available from the browser with /js or /css paths. To use all at once as a bundle
run the following command:

        cd node_modules/backendjs && npm run devbuild


* Go to `examples/api` directory:
* Run the application, it will start the Web server on port 8000:

        ./app.sh

* Now log in with the new account,
* Go to http://localhost:8000/api.html and click on *Login* at the top-right corner, then enter 'test' as login and 'test' as secret in the login popup dialog.
* To see your account details run the command in the console `/account/get`
* To see current metrics run the command in the console `/system/stats/get`

* When the web server is started with `-watch` parameter or as `bkjs watch` then any change in the source files will make the server restart automatically
  letting you focus on the source code and not server management, this mode is only enabled by default in development mode,
  check `app.sh` for parameters before running it in production.


# Configuration

Almost everything in the backend is configurable using config files, a config database or DNS.
The whole principle behind it is that once deployed in production, even quick restarts are impossible to do so
there should be a way to push config changes to the processes without restarting.

Every module defines a set of config parameters that defines the behavior of the code, due to the single threaded
nature of the Node.js. It is simple to update any config parameter to a new value so the code can operate differently.
To achieve this the code must be written in a special way, like driven by configuration which can be changed at
any time.

All configuration goes through the configuration process that checks all inputs and produces valid output which
is applied to the module variables. Config file or database table with configuration can be loaded on demand or
periodically, for example all local config files are watched for modification and reloaded automatically, the
config database is loaded periodically which is defined by another config parameter.

# Backend runtime

When the backendjs server starts it spawns several processes that perform different tasks.

There are 2 major tasks of the backend that can be run at the same time or in any combination:
- a Web server (server) with Web workers (web)
- a job scheduler (master)

These features can be run standalone or under the guard of the monitor which tracks all running processes and restarted any failed ones.

This is the typical output from the ps command on Linux server:

    ec2-user    891  0.0  0.6 1071632 49504 ?  Ssl  14:33   0:01 bkjs: monitor
    ec2-user    899  0.0  0.6 1073844 52892 ?  Sl   14:33   0:01 bkjs: master
    ec2-user    908  0.0  0.8 1081020 68780 ?  Sl   14:33   0:02 bkjs: server
    ec2-user    917  0.0  0.7 1072820 59008 ?  Sl   14:33   0:01 bkjs: web
    ec2-user    919  0.0  0.7 1072820 60792 ?  Sl   14:33   0:02 bkjs: web
    ec2-user    921  0.0  0.7 1072120 40721 ?  Sl   14:33   0:02 bkjs: worker

To enable any task a command line parameter must be provided, it cannot be specified in the config file. The `bkjs` utility supports several
commands that simplify running the backend in different modes.

- `bkjs start` - this command is supposed to be run at the server startup as a service, it runs in the background and the monitors all tasks,
   the env variable `BKJS_SERVER` must be set in the profile to one of the `master or monitor` to define which run mode to use
- `bkjs start-instance` - this command is supposed to be run at the server startup to perform system adjustments, it is run in `bkjs start`
- `bkjs watch` - runs the master and Web server in wather mode checking all source files for changes, this is the common command to be used
   in development, it passes the command line switches: `-watch -master`
- `bkjs monitor` - this command is supposed to be run at the server startup, it runs in the background and the monitors all processes,
   the command line parameters are: `-daemon -monitor -master -syslog`
- `bkjs master` - this command is supposed to be run at the server startup, it runs in the background and the monitors all processes,
   the command line parameters are: `-daemon -monitor -master -syslog`, web server and workers are started by default
- `bkjs web` - this command runs just web server process with child processes as web workers
- `bkjs run` - this command runs without other parameters, all additional parameters can be added in the command line, this command
   is a barebone helper to be used with any other custom settings.
- `bkjs run -api` - this command runs a single process as web server, sutable for Docker
- `bkjs run -worker` - this command runs a single process worker, suatable for Docker
- `bkjs shell` or `bksh` - start backendjs shell, no API or Web server is initialized, only the database pools


# Application structure

The main purpose of the backendjs is to provide API to access the data, the data can be stored in the database or some other way
but the access to that data will be over HTTP and returned back as JSON. This is default functionality but any custom application
may return data in whatever format is required.

Basically the backendjs is a Web server with ability to perform data processing using local or remote jobs which can be scheduled similar to Unix cron.

The principle behind the system is that nowadays the API services just return data which Web apps or mobiles apps can render to
the user without the backend involved. It does not mean this is simple gateway between the database, in many cases it is but if special
processing of the data is needed before sending it to the user, it is possible to do and backendjs provides many convenient helpers and tools for it.

When the API layer is initialized, the api module contains `app` object which is an Express server.

Special module/namespace `app` is designated to be used for application development/extension. This module is available in the same way as `api` and `core`
which makes it easy to refer and extend with additional methods and structures.

The typical structure of a single file backendjs application is the following:

```javascript
    const bkjs = require('backendjs');
    const api = bkjs.api;
    const app = bkjs.app;
    const db = bkjs.db;

    app.listArg = [];

    // Define the module config parameters
    core.describeArgs('app', [
        { name: "list-arg", array: 1, type: "list", descr: "List of words" },
        { name: "int-arg", type: "int", descr: "An integer parameter" },
     ]);

    // Describe the tables or data models, all DB pools will use it, the master or shell
    // process only creates new tables, workers just use the existing tables
    db.describeTables({
         ...
    });

     // Optionally customize the Express environment, setup MVC routes or else, `api.app` is the Express server
    app.configureMiddleware = function(options, callback)
    {
       ...
       callback()
    }

    // Register API endpoints, i.e. url callbacks
    app.configureWeb = function(options, callback)
    {
        api.app.get('/some/api/endpoint', (req, res) => {
          // to return an error, the message will be translated with internal i18n module if locales
          // are loaded and the request requires it
          api.sendReply(res, err);

          // or with custom status and message, explicitely translated
          api.sendReply(res, 404, res.__({ phrase: "not found", locale: "fr" }));

          // with config check
          if (app.intArg > 5) ...
          if (app.listArg.indexOf(req.query.name) > -1) ...

          // to send data back with optional postprocessing hooks
          api.sendJSON(req, err, data);
          // or simply
          res.json(data);
        });
        ...
        callback();
    }

    // Optionally register post processing of the returned data from the default calls
    api.registerPostProcess('', /^\/account\/([a-z\/]+)$/, (req, res, rows) => { ... });
     ...

    // Optionally register access permissions callbacks
    api.registerAccessCheck('', /^\/test\/list$/, (req, status, callback) => { ...  });
    api.registerPreProcess('', /^\/test\/list$/, (req, status, callback) => { ...  });
     ...
    bkjs.server.start();
```

Another probably easier way to create single file apps is to use your namespace instead of `app`:

```javascript
    const bkjs = require("backendjs");
    const api = bkjs.api;
    const db = bkjs.db;

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
    bkjs.core.addModule(mymod);

    mymod.configureWeb = function(options, callback)
    {
        api.app.all("/mymod", async function(req, res) {
            if (!req.query.id) return api.sendReply(res, 400, "id is required");
            req.query.type = mod.types;

            const rows = await db.aselect("mymod", req.query, { ops: { type: "in" }, count: mod.size });
            api.sendJSON(req, null, rows);
        });
    }

    bkjs.server.start();
```

Except the `app.configureWeb` and `server.start()` all other functions are optional, they are here for the sake of completeness of the example. Also
because running the backend involves more than just running web server many things can be setup using the configuration options like common access permissions,
configuration of the cron jobs so the amount of code to be written to have fully functioning production API server is not that much, basically only
request endpoint callbacks must be provided in the application.

As with any Node.js application, node modules are the way to build and extend the functionality, backendjs does not restrict how
the application is structured.

## Modules

*By default no system modules are loaded except `bk_user`, it must be configured by the `-preload-modules` config parameter to
preload modules from the backendjs/modules/.*

Another way to add functionality to the backend is via external modules specific to the backend, these modules are loaded on startup from the backend
home subdirectory `modules/`. The format is the same as for regular Node.js modules and only top level .js files are loaded on the backend startup.

Once loaded they have the same access to the backend as the rest of the code, the only difference is that they reside in the backend home and
can be shipped regardless of the npm, node modules and other env setup. These modules are exposed in the `core.modules` the same way as all other core submodules
methods.

Let's assume the `modules/` contains file facebook.js which implements custom FB logic:

```javascript
    const bkjs = require("backendjs");
    const core = bkjs.core;
    const mod = {
        name: "facebook",
        args: [
            { name: "token", descr: "API token" },
        ]
    }
    module.exports = mod;

    mod.configureWeb = function(options, callback) {
       ...
    }

    mod.makeRequest = function(options, callback) {
         core.sendRequest({ url: options.path, query: { access_token: fb.token } }, callback);
    }
```

This is the main app code:

```javascript
    const bkjs = require("backendjs");
    const core = bkjs.core;

    // Using facebook module in the main app
    api.app.get("/me", (req, res) => {

       core.modules.facebook.makeRequest({ path: "/me" }, (err, data) => {
          bkjs.api.sendJSON(req, err, data);
       });
    });

    bkj.server.start();
```

## NPM packages as modules

In case different modules is better keep separately for maintenance or development purposes they can be split into
separate NPM packages, the structure is the same, modules must be in the modules/ folder and the package must be loadable
via require as usual. In most cases just empty index.js is enough. Such modules will not be loaded via require though but
by the backendjs `core.loadModule` machinery, the NPM packages are just keep different module directories separate from each other.

The config parameter `preload-packages` can be used to specify NPM package names to be loaded separated by comma, as with the default
application structure all subfolders inside each NPM package will be added to the core:

  - modules will be loaded from the modules/ folder
  - locales from the locales/ folder
  - files in the web/ folder will be added to the static search path
  - all templates from views/ folder will be used for rendering

If there is a config file present as `etc/config` it will be loaded as well, this way each package can maintain its default config parameters if necessary
without touching other or global configuration. Although such config files will not be reloaded on changes, when NPM installs or updates packages it
moves files around so watching the old config is no point because the updated config file will be different.

# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other specific usage can be achieved by
using SQL directly or other query language supported by any particular database.
The database operations supported in the unified way provide simple actions like `db.get, db.put, db.update, db.del, db.select`. The `db.query` method provides generic
access to the database driver and executes given query directly by the db driver, it can be SQL or other driver specific query request.

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

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hiding all specifics, it just provides the same
API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range key, so when creating table to be used with DynamoDB, only
one or two columns can be marked with primary property while for SQL databases the composite primary key can consist of more than 2 columns.

The backendjs always creates several tables in the configured database pools by default, these tables are required to support default API functionality and some
are required for backend operations. Refer below for the JavaScript modules documentation that described which tables are created by default. In the custom applications
the `db.describeTables` method can modify columns in the default table and add more columns if needed.

For example, to make age and some other columns in the accounts table public and visible by other users with additional columns the following can be
done in the `api.initApplication` method. It will extend the bk_user table and the application can use new columns the same way as the already existing columns.
Using the birthday column we make 'age' property automatically calculated and visible in the result, this is done by the internal method `api.processAccountRow` which
is registered as post process callback for the bk_user table. The computed property `age` will be returned because it is not present in the table definition
and all properties not defined and configured are passed as is.

The cleanup of the public columns is done by the `api.sendJSON` which is used by all API routes when ready to send data back to the client. If any post-process
hooks are registered and return data itself then it is the hook responsibility to cleanup non-public columns.

```javascript
    db.describeTables({
        bk_user: {
            birthday: {},
            ssn: {},
            salary: { type: "int" },
            occupation: {},
            home_phone: {},
            work_phone: {},
        });

    app.configureWeb = function(options, callback)
    {
       db.setProcessRow("post", "bk_user", this.processAccountRow);
       ...
       callback();
    }
    app.processAccountRow = function(req, row, options)
    {
       if (row.birthday) row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
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



# API requests handling

All methods will put input parameters in the `req.query`, GET or POST.

One way to verify input values is to use `lib.toParams`, only specified parameters will be returned and converted according to
the type or ignored.

Example:

```javascript
   var params = {
      test1: { id: { type: "text" },
               count: { type: "int" },
               email: { regexp: /^[^@]+@[^@]+$/ }
      }
   };

   api.app.all("/endpoint/test1", function(req, res) {
      const query = lib.toParams(req.query, params.test1);
      if (typeof query == "string") return api.sendReply(res, 400, query);
      ...
   });
```

# Example of TODO application

Here is an example how to create simple TODO application using any database supported by the backend. It supports basic
operations like add/update/delete a record, show all records.

Create a file named `app.js` with the code below.

```javascript
    const bkjs = require('backendjs');
    const api = bkjs.api;
    const lib = bkjs.lib;
    const app = bkjs.app;
    const db = bkjs.db;

    // Describe the table to store todo records
    db.describeTables({
       todo: {
           id: { type: "uuid", primary: 1 },  // Store unique task id
           due: {},                           // Due date
           name: {},                          // Short task name
           descr: {},                         // Full description
           mtime: { type: "now" }             // Last update time in ms
       }
    });

    // API routes
    app.configureWeb = function(options, callback)
    {
        api.app.get(/^\/todo\/([a-z]+)$/, async function(req, res) {
           var options = api.getOptions(req);
           switch (req.params[0]) {
             case "get":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                const rows = await db.aget("todo", { id: req.query.id }, options);
                api.sendJSON(req, null, rows);
                break;

             case "select":
                options.noscan = 0; // Allow empty scan of the whole table if no query is given, disabled by default
                const rows = await db.aselect("todo", req.query, options);
                api.sendJSON(req, null, rows);
                break;

            case "add":
                if (!req.query.name) return api.sendReply(res, 400, "name is required");
                // By default due date is tomorrow
                if (req.query.due) req.query.due = lib.toDate(req.query.due, Date.now() + 86400000).toISOString();
                db.add("todo", req.query, options, (err, rows) => {
                    api.sendJSON(req, err, rows);
                });
                break;

            case "update":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                const rows = await db.aupdate("todo", req.query, options);
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
     bkjs.server.start();
```

Now run it with an option to allow API access without an account:

    node app.js -log debug -web -api-allow-path /todo -db-create-tables

To use a different database, for example PostgresSQL(running localy) or DynamoDB(assuming EC2 instance),
all config parametetrs can be stored in the etc/config as well

    node app.js -log debug -web -api-allow-path /todo -db-pool dynamodb -db-dynamodb-pool default -db-create-tables
    node app.js -log debug -web -api-allow-path /todo -db-pool pg -db-pg-pool default -db-create-tables

API commands can be executed in the browser or using `curl`:

    curl 'http://localhost:8000/todo?name=TestTask1&descr=Descr1&due=2015-01-01`
    curl 'http://localhost:8000/todo/select'

# Backend directory structure

When the backend server starts and no -home argument passed in the command line the backend makes its home environment in the `~/.bkjs` directory.
It is also possible to set the default home using BKJS_HOME environment variable.

The backend directory structure is the following:

* `etc` - configuration directory, all config files are there
    * `etc/profile` - shell script loaded by the bkjs utility to customize env variables

    * `etc/config` - config parameters, same as specified in the command line but without leading -, each config parameter per line:

        Example:

            debug=1
            db-pool=dynamodb
            db-dynamodb-pool=http://localhost:9000
            db-pg-pool=postgresql://postgres@127.0.0.1/backend

            To specify other config file: bkjs shell -config-file file

    * `etc/config.local` - same as the config but for the cases when local environment is different than the production or for dev specific parameters

    * on startup the following local config files will be loaded if present: `etc/config.runMode` and `etc/config.instance.tag`. These will be loaded after the main config but before config.local. The runMode is set to `dev` by default and can be changed with `-run-mode` config parameter, the instance tag is set with `-instance-tag` config parameter.

    * config files support sections that can be used for conditions, see `lib.configParse` description for details

    * `etc/crontab` - jobs to be run with intervals, JSON file with a list of cron jobs objects:

        Example:

        1. Create file in ~/.backend/etc/crontab with the following contents:

                [ { "cron": "0 1 1 * * 1,3", "job": { "app.cleanSessions": { "interval": 3600000 } } } ]

        2. Define the function that the cron will call with the options specified, callback must be called at the end, create this app.js file

                var bkjs = require("backendjs");
                bkjs.app.cleanSessions = function(options, callback) {
                     bkjs.db.delAll("session", { mtime: options.interval + Date.now() }, { ops: "le" }, callback);
                }
                bkjs.server.start()

        3. Start the jobs queue and the web server at once

                bkjs master -jobs-workers 1 -jobs-cron

    * etc/crontab.local - additional local crontab that is read after the main one, for local or dev environment

    * `run-mode` and `db-pool` config parameters can be configured in DNS as TXT records, the backend on startup will try to resolve such records and use the value if not empty.
      All params that  marked with DNS TXT can be configured in the DNS server for the domain where the backend is running, the config parameter name is
      concatenated with the domain and queried for the TXT record, for example: `run-mode` parameter will be queried for run-mode.domain.name for TXT record type.

* `modules` - loadable modules with specific functionality
* `images` - all images to be served by the API server, every subfolder represent naming space with lots of subfolders for images
* `var` - database files created by the server
* `tmp` - temporary files
* `web` - Web pages served by the static Express middleware

# Environment variables

On startup some env variable will be used for initial configuration:

  - BKJS_HOME - home directory where to cd and find files, `-home` config parameter overrides it
  - BKJS_RUNMODE - initial run mode, `-run-mode` overrides it
  - BKJS_CONFFILE - config file to use instead of 'config', `-conf-file` overrides it
  - BKJS_PACKAGES - packags to preload, `-preload-packages` overrieds it
  - BKJS_CONFIG_ROLES - config roles to use, `-config-roles` overrides it
  - BKJS_DB_POOL - default db pool, `-db-pool` overrides it
  - BKJS_DB_CONFIG - config db pool, `-db-config` overrides it
  - BKJS_APPNAME - default app name
  - BKJS_TAG - initial instance tag, `-instance-tag` overrides it, it may be also overridden by AWS instance tag
  - BKJS_PORT - port for web server
  - BKJS_WSPORT - port for web sockets

# Cache configurations
Database layer support caching of the responses using `db.getCached` call, it retrieves exactly one record from the configured cache, if no record exists it
will pull it from the database and on success will store it in the cache before returning to the client. When dealing with cached records, there is a special option
that must be passed to all put/update/del database methods in order to clear local cache, so next time the record will be retrieved with new changes from the database
and refresh the cache, that is `{ cached: true }` can be passed in the options parameter for the db methods that may modify records with cached contents. In any case
it is required to clear cache manually there is `db.clearCache` method for that.

Also there is a configuration option `-db-caching` to make any table automatically cached for all requests.

## Local
If no cache is configured the local driver is used, it keeps the cache on the master process in the LRU pool and any worker or Web process
communicate with it via internal messaging provided by the `cluster` module. This works only for a single server.

## Redis
Set `ipc-client=redis://HOST[:PORT]` that points to the server running Redis server.

The config option `max_attempts` defines maximum number of times to reconnect before giving up. Any other `node-redis` module parameter can be passed as well in
the options or url, the system supports special parameters that start with `bk-`, it will extract them into options automatically.

For example:

    ipc-client=redis://host1?bk-max_attempts=3
    ipc-client-backup=redis://host2
    ipc-client-backup-options-max_attempts=3


# PUB/SUB or Queue configurations

## Redis system bus

If configured all processes subscribe to it and listen for system messages, it must support PUB/SUB and does not need to be reliable. Websockets
in the API server also use the system bus to send broadcasts between multiple api instances.

    ipc-client-system=redis://
    ipc-system-queue=system


## Redis Queue
To configure the backend to use Redis for job processing set `ipc-queue=redis://HOST` where HOST is IP address or hostname of the single Redis server.
This driver implements reliable Redis queue, with `visibilityTimeout` config option works similar to AWS SQS.

Once configured, then all calls to `jobs.submitJob` will push jobs to be executed to the Redis queue, starting somewhere a backend master
process with `-jobs-workers 2` will launch 2 worker processes which will start pulling jobs from the queue and execute.

The naming convention is that any function defined as `function(options, callback)` can be used as a job to be executed in one of the worker processes.

An example of how to perform jobs in the API routes:

```javascript

    core.describeArgs('app', [
        { name: "queue", descr: "Queue for jobs" },
    ]);
    app.queue = "somequeue";

    app.processAccounts = function(options, callback) {
        db.select("bk_user", { type: options.type || "user" }, (err, rows) => {
          ...
          callback();
        });
    }

    api.all("/process/accounts", (req, res) => {
        jobs.submitJob({ job: { "app.processAccounts": { type: req.query.type } } }, { queueName: app.queue }, (err) => {
            api.sendReply(res, err);
        });
    });

```

## SQS
To use AWS SQS for job processing set `ipc-queue=https://sqs.amazonaws.com....`, this queue system will poll SQS for new messages on a worker
and after successful execution will delete the message. For long running jobs it will automatically extend visibility timeout if it is configured.

## Local
The local queue is implemented on the master process as a list, communication is done via local sockets between the master and workers.
This is intended for a single server development purposes only.

## NATS
To use NATS (https://nats.io) configure a queue like ipc-queue-nats=nats://HOST:PORT, it supports broadcasts and job queues only, visibility timeout is
supported as well.

## RabbitMQ
To configure the backend to use RabbitMQ for messaging set `ipc-queue=amqp://HOST` and optionally `amqp-options=JSON` with options to the amqp module.
Additional objects from the config JSON are used for specific AMQP functions: { queueParams: {}, subscribeParams: {}, publishParams: {} }. These
will be passed to the corresponding AMQP methods: `amqp.queue, amqp.queue.subcribe, amqp.publish`. See AMQP Node.js module for more info.

# Security configurations

## API only
This is default setup of the backend when all API requests except must provide valid signature and all HTML, JavaScript, CSS and image files
are available to everyone. This mode assumes that Web development will be based on 'single-page' design when only data is requested from the Web server and all
rendering is done using JavaScript. This is how the `examples/api/api.html` developers console is implemented, using JQuery-UI and Knockout.js.

To see current default config parameters run any of the following commands:

        bkjs bkhelp | grep api-allow

        node -e 'require("backendjs").core.showHelp()'

## Secure Web site, client verification

This is a mode when the whole Web site is secure by default, even access to the HTML files must be authenticated. In this mode the pages must defined 'Backend.session = true'
during the initialization on every html page, it will enable Web sessions for the site and then no need to sign every API request.

The typical client JavaScript verification for the html page may look like this, it will redirect to login page if needed,
this assumes the default path '/public' still allowed without the signature:

```javascript
   <link href="/css/bkjs.bundle.css" rel="stylesheet">
   <script src="/js/bkjs.bundle.js" type="text/javascript"></script>
   <script>
    $(function () {
       bkjs.session = true;
       $(bkjs).on("bkjs.nologin", function() { window.location='/public/index.html'; });
       bkjs.koInit();
   });
   </script>
```

## Secure Web site, backend verification
On the backend side in your application app.js it needs more secure settings defined i.e. no html except /public will be accessible and
in case of error will be redirected to the login page by the server. Note, in the login page `bkjs.session` must be set to true for all
html pages to work after login without singing every API request.

1. We disable all allowed paths to the html and registration:

```javascript
   app.configureMiddleware = function(options, callback) {
       this.allow.splice(this.allow.indexOf('^/$'), 1);
       this.allow.splice(this.allow.indexOf('\\.html$'), 1);
       callback();
   }
```

2. We define an auth callback in the app and redirect to login if the request has no valid signature, we check all html pages, all allowed html pages from the /public
will never end up in this callback because it is called after the signature check but allowed pages are served before that:

```javascript
   api.registerPreProcess('', /^\/$|\.html$/, (req, status, callback) => {
       if (status.status != 200) {
           status.status = 302;
           status.url = '/public/index.html';
       }
       callback(status);
   });
```

# WebSockets connections

The simplest way is to configure `ws-port` to the same value as the HTTP port. This will run WebSockets server along the regular Web server.

In the browser the connection config is stored in the `bkjs.wsconf` and by default it connects to the local server on port 8000.

There are two ways to send messages via Websockets to the server from a browser:

- as urls, eg. ```bkjs.wsSend('/project/update?id=1&name=Test2')```

  In this case the url will be parsed and checked for access and authorization before letting it pass via Express routes. This method allows to
  share the same route handlers between HTTP and Websockets requests, the handlers will use the same code and all responses will be sent back,
  only in the Websockets case the response will arrived in the message listener (see an example below)

```javascript
    bkjs.wsConnect({ path: "/project/ws?id=1" });

    $(bkjs).on("bkjs.ws.message", (msg) => {
        switch (msg.op) {
        case "/account/update":
            bkjs.wsSend("/account/ws/account");
            break;

        case "/project/update":
            for (const p in msg.project) app.project[p] = msg.project[p];
            break;

        case "/message/new":
            bkjs.showAlert("info", `New message: ${msg.msg}`);
            break;
        }
    });
````

- as JSON objects, eg. ```bkjs.wsSend({ op: "/project/update", project: { id: 1, name: "Test2" } })```

    In this case the server still have to check for access so it treats all JSON messages as coming from the path which was used during the connect,
    i.e. the one stored in the `bkjs.wsconf.path`. The Express route handler for this path will receive all messages from Websocket clients, the response will be
    received in the event listener the same way as for the first use case.

```javascript
    // Notify all clients who is using the project being updated
    api.app.all("/project/ws", (req, res) => {
        switch (req.query.op) {
        case "/project/update":
           //  some code ....
           api.wsNotify({ query: { id: req.query.project.id } }, { op: "/project/update", project: req.query.project });
           break;
       }
       res.send("");
    });
````

In any case all Websocket messages sent from the server will arrive in the event handler and must be formatted properly in order to distinguish what is what, this is
the application logic. If the server needs to send a message to all or some specific clients for example due to some updates in the DB, it must use the
`api.wsNotify` function.

```javascript
    // Received a new message for a user from external API service, notify all websocket clients by account id
    api.app.post("/api/message", (req, res) => {
        ....
        ... processing logic
        ....
        api.wsNotify({ account_id: req.query.uid }, { op: "/message/new", msg: req.query.msg });
    });
```

# Versioning

There is no ready to use support for different versions of API because there is no just one solution that satisfies all applications. But there are
tools ready to use that will allow to implement such versioning system in the backend. Some examples are provided below:

- Fixed versions
  This is similar to AWS version system when versions are fixed and changed not very often. A client can specify the core version
  using `bk-version` header. When a request is parsed and the version is provided it will be set in the request options object as `apiVersion`.

  All API routes are defined using Express middleware and one of the possible ways of dealing with different versions can look like this, by
  appending version to the command it is very simple to call only changed API code.

```javascript
    api.all(/\/domain\/(get|put|del)/, function(req, res) {
        var options = api.getOptions(req);
        var cmd = req.params[0];
        if (options.apiVersion) cmd += "/" + options.apiVersion;
        switch (cmd) {
        case "get":
            break;

        case "get/2015-01-01":
            break;

        case "put":
            break;

        case "put/2015-02-01":
            break;

        case "del"
            break;
        }
    });
```

- Application semver support
  For cases when applications support Semver kind of versioning and it may be too many releases the method above still can be used while the number of versions is
  small, once too many different versions with different minor/patch numbers, it is easier to support greater/less comparisons.

  The application version `bk-app` can be supplied in the query or as a header or in the user-agent HTTP header which is the easiest case for mobile apps.
  In the middlware, the code can look like this:

```javascript
    var options = api.getOptions(req);
    var version = lib.toVersion(options.appVersion);
    switch (req.params[0]) {
    case "get":
        if (version < lib.toVersion("1.2.5")) {
            res.json({ id: 1, name: "name", description: "descr" });
            break;
        }
        if (version < lib.toVersion("1.1")) {
            res.json([id, name]);
            break;
        }
        res.json({ id: 1, name: "name", descr: "descr" });
        break;
    }
```

The actual implementation can be modularized, split into functions, controllers.... there are no restrictions how to build the working backend code,
the backend just provides all necessary information for the middleware modules.

# The backend tool: bkjs

The purpose of the `bkjs` shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Run `bkjs help` to see description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.

On Linux, when started the bkjs tries to load and source the following global config files:

        /etc/conf.d/bkjs
        /etc/sysconfig/bkjs

Then it try to source all local config files:

        $HOME/.env
        $BKJS_HOME/etc/profile
        $BKJS_HOME/etc/profile.local

Any of the following config files can redefine any environment variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

To check all env variables inside bkjs just run the command `bkjs env`

The tool provides some simple functions to parse comamndline arguments,
the convention is that argument name must start with a single dash followed by a value.

- `get_arg(name, dflt)` - returns the value for the arg `name` or default value if specified
- `get_flag(name, dflt)` - returns 1 if there is a command lione arg with the `name` or default value
  Example:

      bkjs shell -log debug

- `concat_arg(name, value)` - returns concatenated value from the arg and provided value, to combine values from multiple sources
  Example:

      ssh=$(concat_arg -ssh $BKJS_SSH_ARGS)


- `get_json(file, name, dflt, realpath)` - returns a value from the json file, `name` can be path deep into object, `realpath` flag if nonempty will treat all values as paths and convert each into actual real path (this is used by the internal web bundler)
- `get_json_flat` - similar to get_json but property names are flattened for deep access
  Example:

      $(get_json package.json config.sync.path)
      $(get_json package.json name)

- `get_all_args(except)` - returns all args not present in the `except` list, this is to pass all arguments to other script, for command development
   Example:

      The script is called: `bkjs cmd1 -skip 1 -filter 2 -log 3`

      Your command handler process -skip but must pass all other args to another except -skip

      cmd1)
        skip=$(get_arg -skip)
        ...
        other_script $(get_all_args "-skip")
        ;;


## Extending bkjs

The utility is extended via external scripts that reside in the `tools/` folders.

When bkjs is running it treats the first arg as a command:

- `$BKJS_CMD` set to the whole comamnd
- `$BKJS_MODULE` set to the first part of the command split by dash, i.e. command module

if no internal commands match it starts loading external scripts that start with `bkjs-$BKJS_MODULE` from the following directories:

- via `-tools` command line argument if provided
- $(pwd)/tools
- `$BKJS_TOOLS`,
- `$BKJS_HOME/tools`
- `$BKJS_DIR/tools`

`BKJS_DIR` always points to the backendjs installation directory, thus internal backendjs commands will be checked first.

`BLKJS_TOOLS` env variable may contain a list of directories separated by `spaces`, this variable or command line arg `-tools` is the way to add
custom commands to bkjs. BKJS_TOOLS var is usually set in one of the profile config files mentioned above.

Example of a typical bkjs command:

We need to set BKJS_TOOLS to point to our package(s), on Darwin add it to ~/.bkjs/etc/profile as

    BKJS_TOOLS="$HOME/src/node-pkg/tools"


Create a file `/Users/user/src/node-pkg/tools/bkjs-cmd`

    #!/bin/sh

    case "$BKJS_CMD" in
      cmd)
       arg1=$(get_arg -arg1)
       arg2=$(get_arg -arg1 1)
       [ -z $arg1 ] && echo "-arg1 is required" && exit 1
       ...
       exit

      cmd-all)
       ...
       exit
       ;;

      help)
       echo ""
       echo "$0 cmd -arg1 ARG -arg2 ARG ..."
       echo "$0 cmd-all ...."
       ;;
    esac

Now calling `bkjs cmd` or `bkjs cmd-all` will use the new bkjs-cmd file

# Web development notes

Then run the dev build script to produce web/js/bkjs.bundle.js and web/css/bkjs.bundle.css

    cd node_modules/backendjs && npm run devbuild

Now instead of including a bunch of .js or css files in the html pages it only needs /js/bkjs.bundle.js and /css/bkjs.bundle.css. The configuration is in the
package.json file.

The list of files to be used in bundles is in the package.json under `config.bundles`.

To enable auto bundler in your project just add to the local config `~/.bkjs/etc/config.local` a list of directories to be
watched for changes. For example adding these lines to the local config will enable the watcher and bundle support

    watch-web=web/js,web/css,$HOME/src/js,$HOME/src/css
    watch-ignore=.bundle.(js|css)$
    watch-build=bkjs bundle -dev


The simple script below allows to build the bundle and refresh Chrome tab automatically, saves several clicks:

    #!/bin/sh
    bkjs bundle -dev -file $2
    [ "$?" != "0" ] && exit
    osascript -e "tell application \"Google Chrome\" to reload (tabs of window 1 whose URL contains \"$1\")"


To use it call this script instead in the config.local:

    watch-build=bundle.sh /website

NOTE: Because the rebuild happens while the watcher is running there are cases like the server is restarting or pulling a large update from the
repository when the bundle build may not be called or called too early. To force rebuild run the command:

    bkjs bundle -dev -all -force

# Deployment use cases

## AWS instance setup with node and backendjs

- start new AWS instance via AWS console, use Alpine 3.19 or later
- login as `alpine`
- install commands

        doas apk add git
        git clone --depth=1 https://github.com/vseryakov/backendjs.git
        doas backendjs/bkjs setup-ec2
        doas reboot

- now login as `ec2-user`

NOTE: if running behind a Load balancer and actual IP address is needed set Express option in the command line `-api-express-options {"trust%20proxy":1}`. In the config file
replacing spaces with %20 is not required.

## AWS Provisioning examples

### Make an AMI

On the running machine which will be used for an image:

    bksh -aws-create-image -no-reboot

Use an instance by tag for an image:

    bksh -aws-create-image -no-reboot -instance-id `bkjs ec2-show -tag api -fmt id | head -1`

### Update Route53 with all IPs from running instances

    bksh -aws-set-route53 -name elasticsearch.ec-internal -filter elasticsearch

## Configure HTTP port

The first thing when deploying the backend into production is to change API HTTP port, by default is is 8000, but we would want port 80 so regardless
how the environment is setup it is ultimately 2 ways to specify the port for HTTP server to use:

- config file

  The config file is always located in the etc/ folder in the backend home directory, how the home is specified depends on the system but basically it can be
  defined via command line arguments as `-home` or via environment variables when using bkjs. See bkjs documentation but on AWS instances created with bkjs
  `setup-server` command, for non-standard home use `/etc/sysconfig/bkjs` profile, specify `BKJS_HOME=/home/backend` there and the rest will be taken care of

- command line arguments

  When running node scripts which use the backend, just specify `-home` command line argument with the directory where your backend should be and the backend will use it

  Example:

        node app.js -home $HOME -port 80

- config database

  If `-db-config` is specified in the command line or `db-config=` in the local config file, this will trigger loading additional
  config parameters from the specified database pool, it will load all records from the `bk_config` table on that db pool. Using the database to store
  configuration make it easier to maintain dynamic environment for example in case of auto scaling or launching on demand, this way
  a new instance will query current config from the database and this eliminates supporting text files and distributing them to all instances.

  The config database is refreshed from time to time acording to the `db-config-interval` parameter, also all records with `ttl` property in the bk_config
  will be pulled every ttl interval and updated in place.

- DNS records
  Some config options may be kept in the DNS TXT records and every time a instance is started it will query the local DNS for such parameters. Only a small subset of
  all config parameters support DNS store. To see which parameters can be stored in the DNS run `bkjs show-help` and look for 'DNS TXT configurable'.

# Backend library development (Mac OS X, developers)

* `git clone https://github.com/vseryakov/backendjs.git` or `git clone git@github.com:vseryakov/backendjs.git`

* cd backendjs

* if Node.js is already installed skip to the next section

    * to install binary release run the command, it will install it into ~/.bkjs on Darwin

        ```
        bkjs install-node
        # To install into different path
        bkjs install-node -home ~/.local
        ```

    * **Important**: Add NODE_PATH=$BKJS_HOME/lib/node_modules to your environment in .profile or .bash_profile so
      node can find global modules, replace $BKJS_HOME with the actual path unless this variable is also set in the .profile

* to install all dependencies and make backendjs module and bkjs globally available:

    ```npm link backendjs```

* to run local server on port 8000 run command:

    ```bkjs web```

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to Node.js REPL functionality. All modules are accessible from the command line.

    ```
    $ ./bkjs shell
    > core.version
    '0.70.0'
    > logger.setLevel('info')
    ```

# Simple testing facility

Included a simple testing tool, it is used for internal bkjs testing but can be used for other applications as well.

The convention is to create a test file in the tests/ folder, each test file can define one or more test
functions named in the form `tests.test_NAME` where NAME is any custom name for the test, for example:

File `tests/example.js`:

```javascript
tests.test_example = function(callback)
{
    expect(1 == 2, "expect 1 eq 2")

    callback();
}
```

Then to run all tests

    bkjs test-all

More details are in the documentation or `doc.html`

# Design considerations

While creating Backendjs there were many questions and issues to be considered, some I was able to implement, some still not. Below are the thoughts that
might be useful when designing, developing or choosing the API platform:

- purpose of the API:
  - to expose some parts of the existing system to external apps, users...
  - to make it the only way to access services
  - to complement another system
- scalability considerations:
  - unlimited/uncontrolled access like mobile, web, more users the better
  - enterprise level, controlled growth
  - not to be horizontally scalable, just vertically
- security:
  - support authentication, users, accounts, profiles...
  - just for robots, limited by api key only
  - signed requests only
  - support all access, web, mobile, desktop
  - user access controls, how to distinguish users, grant access to only parts of the API
  - ability to run custom/specific filters during processing API requests, independently and ability to extend the app without rewriting/rebuilding the whole system
  - third party authentication, OAUTH, user mapping
- platform/framework:
  - one for all, same language/SDK/framework to cover all aspects
  - multiple languages/frameworks for different tasks, then how to integrate, how to communicate, share code
  - availability of the third party modules, libraries
  - support, forums, docs, how easy to learn for new developers
  - modularity, ability to develop by multiple developers, teams
  - flexibility in extending, how simple/easy to add custom stuff
  - maintenance, support,how easy to scale, change, replace parts
- database layer:
  - one central database for everything
  - multiple database for different parts of the system according to scalability/other requirements
  - switch databases behind the scene in order to scale, adding to features, easier to maintain
  - caching, needs to be independent from other parts and easily enabled/disabled for different components preferably via config
  - to have or not ORM
- process management, easy to deploy, monitor
- logging, metrics, profiling
- agnostic to the frontends or to be included with some kind of MVC/server based tools
- ability to support simple Web development for simple web pages without installing/supporting general purpose tools like Apache/PHP/nginx

# API endpoints provided by the backend

All API endpoints are optional and can be disabled or replaced easily. By default the naming convention is:

     /namespace/command[/subname[/subcommand]]

Any HTTP methods can be used because its the command in the URL that defines the operation. The payload can be url-encoded query
parameters or JSON or any other format supported by any particular endpoint. This makes the backend universal and usable with any
environment, not just a Web browser. Request signature can be passed in the query so it does not require HTTP headers at all.

## Authentication and sessions

### Signature

All requests to the API server must be signed with account login/secret pair.

- The algorithm how to sign HTTP requests (Version 1, 2):
    * Split url to path and query parameters with "?"
    * Split query parameters with "&"
    * '''ignore parameters with empty names'''
    * '''Sort''' list of parameters alphabetically
    * Join sorted list of parameters with "&"
        - Make sure all + are encoded as %2B
    * Form canonical string to be signed as the following:
        - Line1: The signature version
        - Line2: The application tag or other opaque data
        - Line3: The login name
        - Line4: The HTTP method(GET), followed by a newline.
        - Line5: The host name, lowercase, followed by a newline.
        - Line6: The request URI (/), followed by a newline.
        - Line7: The sorted and joined query parameters as one string, followed by a newline.
        - Line8: The expiration value in milliseconds, required, followed by a newline
        - Line9: The Content-Type HTTP header, lowercase, optional, followed by a newline
        - Line10: The SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
    * Computed HMAC-SHA1 digest from the canonical string and encode it as BASE64 string, preserve trailing = if any
    * Form the signature HTTP header as the following:
        - The header string consist of multiple fields separated by pipe |
            - Field1: Signature version:
                - version 1, obsolete, do not use first 3 lines in the canonical string
                - version 2,3 to be used in session cookies only
                - version 4
            - Field2: Application tag or other app specific data
            - Field3: account login or whatever it might be in the login column
            - Field4: HMAC-SHA digest from the canonical string, version 1 uses SHA1, other SHA256
            - Field5: expiration value in milliseconds, same as in the canonical string
            - Field6: SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
            - Field7: empty, reserved for future use

The resulting signature is sent as HTTP header `bk-signature` or in the header specified by the `api-signature-name` config parameter.

For JSON content type, the method must be POST and no query parameters specified, instead everything should be inside the JSON object
which is placed in the body of the request. For additional safety, SHA1 checksum of the JSON payload can be calculated and passed in the signature,
this is the only way to ensure the body is not modified when not using query parameters.

See [web/js/bkjs.js](https://github.com/vseryakov/backendjs/blob/master/web/js/bkjs.js) function `bkjs.createSignature` or
[api.js](https://github.com/vseryakov/backendjs/blob/master/api.js) function `api.createSignature` for the JavaScript implementations.

There is also native iOS implementation [Bkjs.m](https://raw.githubusercontent.com/vseryakov/backendjs-ios/master/BKjs.m).

### Authentication API

- `/auth`

   This API request returns the current user record from the `bk_user` table if the request is verified and the signature provided
   is valid. If no signature or it is invalid the result will be an error with the corresponding error code and message.

   By default this endpoint is secured, i.e. requires a valid signature.

   Parameters:

   - `_session=1` - if the call is authenticated a cookie with the session signature is returned, from now on
      all requests with such cookie will be authenticated, the primary use for this is Web apps

- `/login`

   Same as the /auth but it uses secret for user authentication, this request does not need a signature, just simple
   login and secret query parameters to be sent to the backend. This must be sent over SSL.

   Parameters:

     - `login` - account login
     - `secret` - account secret
     - `_session=1` - same as in /auth request

   On successful login, the result contains full account record including the secret, this is the only time when the secret is returned back

   Example:

```javascript
    $.ajax({ url: "/login?login=test123&secret=test123&_session=1",
        success: function(json, status, xhr) { console.log(json) }
    });

    > { id: "XXXX...", name: "Test User", login: "test123", ...}
```

- `/logout`

   Logout the current user, clear session cookies if exist. For pure API access with the signature this will not do anything on the backend side.

## Accounts
The accounts API manages accounts and authentication, it provides basic user account features with common fields like email, name, address.

- `/account/get`

  Returns information about the current account, all account columns are returned except the secret and other table columns with the property `priv`

  Response:

            { "id": "57d07a4e28fc4f33bdca9f6c8e04d6c3",
            "name": "Test User",
            "mtime": 1391824028,
            "login": "testuser",
            "type": ["user"],
            }

  How to make an account as admin

            # Run backend shell
            bkjs shell

            # Update record by login
            > db.update("bk_user", { login: 'login@name', type: 'admin' });

- `/account/update`

  Update current account with new values, the parameters are columns of the table `bk_user`, only columns with non empty values will be updated.

  Example:

            /account/update?name=New%2BName


### Health enquiry
When running with AWS load balancer there should be a url that a load balancer polls all the time and this must be very quick and lightweight request. For this
purpose there is an API endpoint `/ping` that just responds with status 200. It is open by default in the default `api-allow-path` config parameter.

## Data
The data API is a generic way to access any table in the database with common operations, as oppose to the any specific APIs above this API only deals with
one table and one record without maintaining any other features like auto counters, cache...

*Because it exposes the whole database to anybody who has a login it is a good idea to disable this endpoint in the production or provide access callback that verifies
who can access it.*
  - To disable this endpoint completely in the config: `deny-modules=bk_data`
  - To allow admins to access it only in the config: `api-allow-admin=^/data`
  - To allow admins to access it only:

        api.registerPreProcess('GET', '/data', function(req, status, cb) { if (req.account.type != "admin") return cb({ status: 401, message: 'access denied' }; cb(status)); });

This is implemented by the `data` module from the core.

- `/data/columns`
- `/data/columns/TABLE`
  Return columns for all tables or the specific TABLE

- `/data/keys/TABLE`
  Return primary keys for the given TABLE

- `/data/(select|search|list|get|add|put|update|del|incr|replace)/TABLE`
  Perform database operation on the given TABLE, all options for the `db` functiobns are passed as query parametrrs prepended with underscore,
  regular parameters are the table columns.

  By default the API does not allow table scans without a condition to avoid expensive and long queries, to enable a scan pass `_noscan=0`.
  For this to work the Data API must be configured as unsecure in the config file using the parameter `api-unsecure=data`.

  Some tables like messages and connections perform data convertion before returning the results, mostly splitting combined columns like type into
  separate fields. To return raw data pass the parameter `_noprocessrows=1`.

  Example:

        /data/get/bk_user?login=12345
        /data/update/bk_user?login=12345&name=Admin
        /data/select/bk_user?name=john&_ops=name,gt&_select=name,email
        /data/select/bk_user?_noscan=0&_noprocessrows=1

## System API
The system API returns information about the backend statistics, allows provisioning and configuration commands and other internal maintenance functions. By
default is is open for access to all users but same security considerations apply here as for the Data API.

This is implemented by the `system` module from the core. To enable this functionality specify `-preload-modules=bk_system`.

- `/system/restart`
    Perform restart of the Web processes, this will be done gracefully, only one Web worker process will be restarting while the other processes will keep
    serving requests. The intention is to allow code updates on live systems without service interruption.

- `/system/cache/(init|stats|keys|get|set|put|incr|del|clear)`
    Access to the caching functions

- `/system/config/(init)`
    Access to the config functions

- `/system/msg/(init|send)`
    Access to the messaging functions

- `/system/jobs/(send)`
    Access to the jobs functions

- `/system/queue/(init|publish)`
    Access to the queue functions

- `/system/params/get`
    Return all config parameters applied from the config file(s) or remote database.

- `/system/stats/get`
  Database pool statistics and other diagnostics
  - latency - how long a pending request waits in queue at this moment
  - busy - how many busy error responses have been returned so far
  - pool - database metrics
    - response - stats about how long it takes between issuing the db request and till the final moment all records are ready to be sent to the client
    - queue - stats about db requests at any given moment queued for the execution
    - cache - db cache response time and metrics
  - api - Web requests metrics, same structure as for the db pool metrics
  - url - metrics per url endpoints

  Individual sub-objects:
  - meter - Things that are measured as events / interval.
     - rmean: The average rate since the meter was started.
     - rcnt: The total of all values added to the meter.
     - rate: The rate of the meter since the last toJSON() call.
     - r1m: The rate of the meter biased towards the last 1 minute.
     - r5m: The rate of the meter biased towards the last 5 minutes.
     - r15m: The rate of the meter biased towards the last 15 minutes.
  - queue or histogram - Keeps a reservoir of statistically relevant values biased towards the last 5 minutes to explore their distribution
      - hmin: The lowest observed value.
      - mmax: The highest observed value.
      - hsum: The sum of all observed values.
      - hvar: The variance of all observed values.
      - hmean: The average of all observed values.
      - hdev: The standard deviation of all observed values.
      - hcnt: The number of observed values.
      - hmed: median, 50% of all values in the reservoir are at or below this value.
      - hp75: See median, 75% percentile.
      - hp95: See median, 95% percentile.
      - hp99: See median, 99% percentile.
      - hp999: See median, 99.9% percentile.


# Author
  Vlad Seryakov

Check out the [Documentation](http://bkjs.io) for more details.
