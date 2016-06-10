# Backend platform for node.js

General purpose backend framework. The primary goal is to have a scalable platform for running and managing node.js
servers for Web services implementation.

This framework only covers the lower portion of the Web services system:
node.js processes, HTTP servers, basic API functinality, database access, caching, messaging between processes,
metrics and monitoring, a library of tools for developing node.js servers.

For the UI and presentation layer there are no restrictions what to use as long as it can run on top of the Express server.

Features:

* Exposes a set of Web service APIs over HTTP(S) using Express framework.
* Database API supports Sqlite, PostgreSQL, MySQL, DynamoDB, Cassandra, MongoDB, Redis with all basic operations behaving the
  same way allowing to switch databases without changing the code.
* Database drivers for LevelDB, LMDB, CouchDB, Riak, ElasticSearch support only a subset of all database operations
* Easily extendable to support any kind of database, provides a database driver on top of Redis with all supported methods.
* Provides accounts, connections, locations, messaging and icons APIs with basic functionality for a qucik start.
* Supports crontab and queue job processing by seperate workers.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Runs web server as separate processes to utilize multiple CPU cores.
* Supports WebSockets connections and process them with the same Express routes as HTTP requests
* Supports several cache modes(Redis, memcached, LRU) for the database operations, multiple hosts support
  in the clients for failover.
* Supports several PUB/SUB modes of operations using Redis, RabbitMQ.
* Supports async jobs processing using several work queue implementations on top of SQS, Redis, DB, RabbitMQ
* Supports common database operations (Get, Put, Del, Update, Select) for all databases using the same DB API.
* ImageMagick is compiled as C++ module for in-process image scaling.
* REPL(command line) interface for debugging and looking into server internals.
* Geohash based location searches supported by all databases drivers.
* Supports push notifications for mobile devices, APN and GCM
* Supports HTTP(S) reverse proxy mode where multiple Web workers are load-balanced by the proxy
  server running in the master process instead of relying on the OS scheduling between processes listening on the same port.
* Can be used with any MVC, MVVC or other types of frameworks that work on top or with the Express server.
* AWS supports is very well integrated including EC2, S3, DynamoDB, SQS and more.
* Includes simple log watcher to monitor the log files including system errors.
* Supports i18n hooks for request/response objects, easily overriden with any real i18n implementation.
* Integrated very light unit testing facility which can be used to test modules and API requests
* Support runtime metrics about the timing on database, requests, cache, memory and request rate limit control
* Hosted on [github](https://github.com/vseryakov/backendjs), BSD licensed.

Check out the [Documentation](http://bkjs.io) for more details.

# Installation

To install the module with all optional dependencies if they are available in the system

    npm install backendjs

This may take some time because of downloading and compiling required dependencies like ImageMagick. They are not required in all
applications but still part of the core of the system to be available once needed.

To install from the git

     npm install git+https://github.com/vseryakov/backendjs.git

or simply

     npm install vseryakov/backendjs

# Quick start

* Simplest way of using the backendjs, it will start the server listening on port 8000

        $ node
        > var bkjs = require('backendjs')
        > bkjs.server.start()

* Access is allowed only with valid signature except urls that are exlicitely allowed without it (see `api-allow` config parameter below)
* Same but using the helper tool, by default it will use embedded Sqlite database and listen on port 8000.

        bkjs run

* To start the server and connect to the DynamoDB (command line parameters can be saved in the `etc/config file`, see below about config files)

        bkjs run -db-pool dynamodb -db-dynamodb-pool default -aws-key XXXX -aws-secret XXXX

* If running on EC2 instance with IAM profile then no need to specify AWS credentials:

        bkjs run -db-pool dynamodb -db-dynamodb-pool default

* or to the PostgreSQL server, database backend

        bkjs run -db-pool pgsql -db-pgsql-pool postgresql://postgres@127.0.0.1/backend

* All commands above will behave exactly the same

* **Tables are not created by default**, in order to initialize the database, run the server or the shell with `-db-create-tables` flag,
  it is called only inside a master process, a worker never creates tables on start

  - prepare the tables in the shell

        bksh -db-pool pgsql -db-pgsql-pool postgresql://postgres@127.0.0.1/backend -db-create-tables

  - run the server and create table son start

        bkjs run -db-pool pgsql -db-pgsql-pool postgresql://postgres@127.0.0.1/backend -db-create-tables

* While the local backendjs is runnning, the documentation is always available at http://localhost:8000/doc.html (or whatever port is the server using)

* By default no external modules are loaded so it needs the accounts module with a
  parameter `-allow-modules PATTERN`, this will load all modules that match the pattern, default modules start with `bk_`:

        bkjs run -allow-modules bk_

* Go to http://localhost:8000/api.html for the Web console to test API requests.
  For this example let's create an account.

* Type and execute the following URLs in the Web console:

        /account/add?name=test1&secret=test1&login=test1@test.com

* Now login with the new account, click on *Login* at the top-right corner and enter 'test1' as login and 'test1' as secret in the login popup dialog.
* If no error message appeared after the login, try to get your current account details:

        /account/get

* Shutdown the backend by pressing Ctrl-C
* To make your own custom Web app, create a new directory (somewhere else) to store your project and run the following command from that directory:

        bkjs init-app

* The `app.js` file is created in your project directory with 2 additional API endpoints `/test/add` and `/test/[0-9]` to show the simplest way
  of adding new tables and API commands.
* The `app.sh` script is created for convenience in the development process, it specifies common arguments and can be customized as needed.
* Run your new application now, it will start the Web server on port 8000:

        ./app.sh

* Go to http://localhost:8000/api.html and issue command `/test/add?id=1&name=1` and then `/test/1` commands in the console to see it in action
* Any change in the source files will make the server restart automatically letting you focus on the source code and not server management, this mode
  is only enabled by default in development mode, check `app.sh` for parameters before running it in the production.

* To start node.js shell with backendjs loaded and initialized, all command line parameters apply to the shell as well

        ./app.sh -shell

* To access the database while in the shell

        > db.select("bk_account", {}, function(err, rows, info) { console.log(err, rows) });
        > db.select("bk_account", {}, lib.log);
        > db.add("bk_account", { login: 'test2', secret: 'test2', name' Test 2 name', gender: 'f' }, lib.log);
        > db.select("bk_account", { gender: 'm' }, lib.log);

* To add users from the command line

        bksh -add-user login test secret test name TestUser email test@test.com

* To see current metrics run the command in the console '/system/stats/get'

* To see charts about accumulated metrics go to http://localhost:8000/metrics.html

# Configuration

Almost everything in the backend is configurable using a config files, config database or DNS.
The whole principle behind it that once deployed in production, even quick restart are impossible to do so
there should be a way to push config changes to the processes without restarting.

Every module defines a set of config parameters that defines the behavior of the code, due to single threaded
nature of the node.js, it is simple to update any config parameter to a new value so the code can operate differently.
To achieve this the code must be written in a special way, like driven by configuration which can be changed at
any time.

All configuration goes through the configuration process that checks all inputs and produces valid output which
is applied to the module variables. Config file or database table with configuration can be loaded on demand or
periodically, for example all local config files are watched for modification and reloaded automaticlaly, the
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

- `bkjs start` - this command is supposed to be run at the server startup as a service, it runs in the backgroud and the monitors all tasks,
   the env variable `BKJS_SERVER` can be set in the profile to one of the `master or monitor` to define which run mode to use, default mode is monitor
- `bkjs run-monitor` - this command is supposed to be run at the server startup, it runs in the backgroud and the monitors all processes,
   the command line parameters are: `-daemon -monitor -master -syslog`
- `bkjs run-master` - this command is supposed to be run at the server startup, it runs in the backgroud and the monitors all processes,
   the command line parameters are: `-daemon -monitor -master -syslog`
- `bkjs run-watcher` - runs the master and Web server in wather mode checking all source files for changes, this is the common command to be used
   in development, it passes the command line switches: `-watch -master`
- `bkjs run` - this command runs without other parameters, all aditional parameters can be added in the command line, this command
   is a barebone helper to be used with any other custom settings.
- `bkjs run-shell` or `bksh` - start backendjs shell, no API or Web server is initialized, only the database pools


# Application structure

The main puspose of the backendjs is to provide API to access the data, the data can be stored in the database or some other way
but the access to that data will be over HTTP and returned back as JSON. This is default functionality but any custom application
may return data in whatever format is required.

Basically the backendjs is a Web server with ability to perform data processing using local or remote jobs which can be scheduled similar to Unix cron.

The principle behind the system is that nowadays the API services just return data which Web apps or mobiles apps can render to
the user without the backend involved. It does not mean this is simple gateway between the database, in many cases it is but if special
processing of the data is needed before sending it to the user, it is possible to do and backendjs provides many convenient helpers and tools for it.

When the API layer is initialized, the api module contains `app` object which is an Express server.

Special module/namespace `app` is designated to be used for application development/extension. This module is available the same way as the `api` or `core`
which makes it easy to refer and extend with additional methods and structures.

The typical structure of a backendjs application is the following (created by the bkjs init-app command):

```javascript
    var bkjs = require('backendjs');
    var api = bkjs.api;
    var app = bkjs.app;
    var db = bkjs.db;

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
        api.app.get('/some/api/endpoint', function(req, res) {
          // to return an error, the message will be translated with internal i18n module if locales
          // are loaded and the request requires it
          api.sendReply(res, err);
          // or with custom status and message, explicitely translated
          api.sendReply(res, 404, res.__("not found"));

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
    api.registerPostProcess('', /^\/account\/([a-z\/]+)$/, function(req, res, rows) { ... });
     ...

    // Optionally register access permissions callbacks
    api.registerAccessCheck('', /^\/test\/list$/, function(req, status, callback) { ...  });
    api.registerPreProcess('', /^\/test\/list$/, function(req, status, callback) { ...  });
     ...
    bkjs.server.start();
```

Except the `app.configureWeb` and `server.start()` all other functions are optional, they are here for the sake of completness of the example. Also
because running the backend involves more than just running web server many things can be setup using the configuration options like common access permissions,
configuration of the cron jobs so the amount of code to be written to have fully functionaning production API server is not that much, basically only
request endpoint callbacks must be provided in the application.

As with any node.js application, node modules are the way to build and extend the functionality, backendjs does not restrict how
the application is structured.

## Modules

Another way to add functionality to the backend is via external modules specific to the backend, these modules are loaded on startup from the backend
home subdirectory `modules/` and from the backendjs package directory for core modules. The format is the same as for regular node.js modules and
only top level .js files are loaded on the backend startup.

*By default no modules are loaded except `bk_accounts|bk_icons`, it must be configured by the `-allow-modules` config parameter.*

The modules are managed per process role, by default `server` and `master` processes do not load any modules at all to keep them
small and because they monitor workers the less code they have the better.

The shell process loads all modules, it is configured with `.+`.

To enable any module to be loaded in any process it can be configured by using a role in the config parameter:

      // Global modules except server and master
      -allow-modules '.+'

      // Master modules
      -allow-modules-master 'bk_accounts|bk_debug'

Once loaded they have the same access to the backend as the rest of the code, the only difference is that they reside in the backend home and
can be shipped regardless of the npm, node modules and other env setup. These modules are exposed in the `core.modules` the same way as all other core submodules
methods.

Let's assume the modules/ contains file facebook.js which implements custom FB logic:

```javascript
     var bkjs = require("backendjs");
     var fb = {
     }
     module.exports = fb;

     fb.configureWeb = function(options, callback) {
       ...
     }

     fb.makeRequest = function(options, callback) {
       ...
     }
```

This is the main app code:

```javascript
    var bkjs = require("backendjs");
    var core = bkjs.core;

    // Using facebook module in the main app
    api.app.get("some url", function(req, res) {

       core.modules.facebook.makeRequest({}, function(err, data) {
          ...
       });
    });

    bkj.server.start()
```

# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other specific usage can be achieved by
using SQL directly or other query language supported by any particular database.
The database operations supported in the unified way provide simple actions like `db.get, db.put, db.update, db.del, db.select`. The `db.query` method provides generic
access to the database driver and executes given query directly by the db driver, it can be SQL or other driver specific query request.

Before the tables can be queried the schema must be defined and created, the backend db layer provides simple functions to do it:

- first the table needs to be described, this is achieved by creating a Javascript object with properties describing each column, multiple tables can be described
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
               id: { primary: 1 },                         // consiting of album and photo id
               name: { pub: 1, index: 1 },                 // Photo name or description, public column with the index for faster search
               mtime: { type: "now" }
           }
        });
```

- the system will automatically create the album and photos tables, this definition must remain in the app source code
  and be called on every app startup. This allows 1) to see the db schema while working with the app and 2) easily maintain it by adding new columns if
  necessary, all new columns will be detected and the database tables updated accordingly. And it is all Javascript, no need to learn one more language or syntax
  to maintain database tables.

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hiding all specifics, it just provides the same
API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range key, so when creating table to be used with DynamoDB, only
one or two columns can be marked with primary property while for SQL databases the composite primary key can consist of more than 2 columns.

The backendjs always creates several tables in the configured database pools by default, these tables are required to support default API functionality and some
are required for backend opertions. Refer below for the Javascript modules documenttion that described which tables are created by default. In the custom applications
the `db.describeTables` method can modify columns in the default table and add more columns if needed.

For example, to make age and some other columns in the accounts table public and visible by other users with additional columns the following can be
done in the `api.initApplication` method. It will extend the bk_account table and the application can use new columns the same way as the already existing columns.
Using the birthday column we make 'age' property automatically calculated and visible in the result, this is done by the internal method `api.processAccountRow` which
is registered as post process callback for the bk_account table. The computed property `age` will be returned because it is not present in the table definition
and all properties not defined and configured are passed as is.

The cleanup of the public columns is done by the `api.sendJSON` which is used by all API routes when ready to send data back to the client. If any postprocess
hooks are registered and return data itself then it is the hook responsibility to cleanup non-public columns.

```javascript
    db.describeTables({
        bk_account: {
            gender: { pub: 1 },
            birthday: {},
            ssn: {},
            salary: { type: "int" },
            occupation: {},
            home_phone: {},
            work_phone: {},
        });

    app.configureWeb = function(options, callback)
    {
       db.setProcessRow("post", "bk_account", this.processAccountRow);
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
var mod = {
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
      var query = lib.toParams(req.query, params.test1);
      ...
   });
```

# Example of TODO application

Here is an example how to create simple TODO application using any database supported by the backend. It supports basic
operations like add/update/delete a record, show all records.

Create a file named `app.js` with the code below.

```javascript
    var bkjs = require('backendjs');
    var api = bkjs.api;
    var lib = bkjs.lib;
    var app = bkjs.app;
    var db = bkjs.db;

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
        api.app.get(/^\/todo\/([a-z]+)$/, function(req, res) {
           var options = api.getOptions(req);
           switch (req.params[0]) {
             case "get":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                db.get("todo", { id: req.query.id }, options, function(err, rows) { api.sendJSON(req, err, rows); });
                break;
             case "select":
                options.noscan = 0; // Allow empty scan of the whole table if no query is given, disabled by default
                db.select("todo", req.query, options, function(err, rows) { api.sendJSON(req, err, rows); });
                break;
            case "add":
                if (!req.query.name) return api.sendReply(res, 400, "name is required");
                // By default due date is tomorrow
                if (req.query.due) req.query.due = lib.toDate(req.query.due, Date.now() + 86400000).toISOString();
                db.add("todo", req.query, options, function(err, rows) { api.sendJSON(req, err, rows); });
                break;
            case "update":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                db.update("todo", req.query, options, function(err, rows) { api.sendJSON(req, err, rows); });
                break;
            case "del":
                if (!req.query.id) return api.sendReply(res, 400, "id is required");
                db.del("todo", { id: req.query.id }, options, function(err, rows) { api.sendJSON(req, err, rows); });
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
    node app.js -log debug -web -api-allow-path /todo -db-pool pgsql -db-pgsql-pool default -db-create-tables

API commands can be executed in the browser or using `curl`:

    curl 'http://localhost:8000/todo?name=TestTask1&descr=Descr1&due=2015-01-01`
    curl 'http://localhost:8000/todo/select'

# Backend directory structure

When the backend server starts and no -home argument passed in the command line the backend makes its home environment in the ~/.backend directory.

The backend directory structure is the following:

* `etc` - configuration directory, all config files are there
    * `etc/profile` - shell script loaded by the bkjs utility to customize env variables
    * `etc/config` - config parameters, same as specified in the command line but without leading -, each config parameter per line:

        Example:

            debug=1
            db-pool=dynamodb
            db-dynamodb-pool=http://localhost:9000
            db-pgsql-pool=postgresql://postgres@127.0.0.1/backend

            To specify other config file: bkjs run-backend -config-file file

    * etc/config.local - same as the config but for the cases when local environment is different than the production or for dev specific parameters
    * some config parameters can be condigured in DNS as TXT records, the backend on startup will try to resolve such records and use the value if not empty.
      All params that  marked with DNS TXT can be configured in the DNS server for the domain where the backend is running, the config parameter name is
      concatenated with the domain and queried for the TXT record, for example: `cache-host` parameter will be queried for cache-host.domain.name for TXT record type.

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

                bkjs run-backend -master -web -jobs-workers 1 -jobs-cron

    * etc/crontab.local - additional local crontab that is read after the main one, for local or dev environment

* `modules` - loadable modules with specific functionality
* `images` - all images to be served by the API server, every subfolder represent naming space with lots of subfolders for images
* `var` - database files created by the server
* `tmp` - temporary files
* `web` - Web pages served by the static Express middleware

# Cache configurations
Database layer support caching of the responses using `db.getCached` call, it retrieves exactly one record from the configured cache, if no record exists it
will pull it from the database and on success will store it in the cache before returning to the client. When dealing with cached records, there is a special option
that must be passed to all put/update/del database methods in order to clear local cache, so next time the record will be retrieved with new changes from the database
and refresh the cache, that is `{ cached: true }` can be passed in the options parameter for the db methods that may modify records with cached contents. In any case
it is required to clear cache manually there is `db.clearCache` method for that.

Also there is a configuration option `-db-caching` to make any table automatically cached for all requests.

## Local
If no cache is configured the local driver is used, it keeps the cache on the master process in the LRU pool and any wroker or Web process
communicate with it via internal messaging provided by the `cluster` module. This works only for a single server.

## memcached
Set `ipc-cache=memcache://HOST[:PORT]` that points to the host running memcached. To support multiple servrs add the option
`ipc-cache-options-servers=10.1.1.1,10.2.2.1:5000`.

## Redis
Set `ipc-cache=redis://HOST[:PORT]` that points to the server running Redis server.

To support more than one master Redis server in the client add additional servers in the servers parameter,
`ipc-cache-options-servers=10.1.1.1,10.2.2.1:5000`, the client will reconnect automatically on every
disconnect. To support quick failover it needs a parameter for the `node-redis` module (which is used by the driver) `max_attempts` to be a
number how many attempts to reconnect before switching to another server like `ipc-cache-options-max_attempts=3`.
Any other `node-redis` module parameter can be passed as well.

Cache configurations also can be passed in the url, the system supports special parameters that start with `bk-`, it will extract them into options automatically.

For example:

    ipc-cache=redis://host1?bk-servers=host2,host3&bk-max_attempts=3
    ipc-cache-backup=redis://host2
    ipc-cache-backup-options-max_attempts=3


## Redis Sentinel

To enable Redis Sentinel pass in the option `-sentinel-servers`: `ipc-cache=redis://host1?bk-sentinel-servers=host1,host2`.

The system will connect to the sentinel, get the master cache server and connect the cache driver to it, also it will listen constantly on
sentinel events and failover to a new master autimatically. Sentinel use the regular redis module and supports all the same
parameters, to pass options to the sentinel driver prefix them with `sentinel-`:

    ipc-cache=redis://host1?bk-servers=host2,host3&bk-max_attempts=3&bk-sentinel-servers=host1,host2,host3
    ipc-cache-backup=redis://host2
    ipc-cache-backup-options-sentinel-servers=host1,host2
    ipc-cache-backup-options-sentinel-max_attempts=5


# PUB/SUB or Queue configurations

Publish/subscribe functionality allows clients to receive notifications without constantly polling for new events. A client can be anything but
the backend provides some partially implemented subscription notifications for Web clients using the Long Poll.
The Account API call `/account/subscribe` can use any pub/sub mode.

The flow of the pub/sub operations is the following:
- a HTTP client makes `/account/subscribe` API request, the connection is made and is kept open indefenitely or as long as configured using `api-subscribe-timeout`.
- the API backend receives this request, and runs the `api.subscribe` method with the key being the account id, this will subscribe to the events for the current
  account and registers a callback to be called if any events occured. The HTTP connection is kept open.
- some other client makes an API call that triggers an event like makes a connectiopn or sends a message, on such event the backend API handler
  always runs `ipc.publish` after the DB operation succedes. If the messaging is configured, it publishes the message for the account, the
  message being a JSON object with the request API path and mtime, other properties depend on the call made.
- the connection that initiated `/account/subscribe` receives an event

## Redis
To configure the backend to use Redis for PUB/SUB messaging set `ipc-queue=redis://HOST` where HOST is IP address or hostname of the single Redis server.
This will use native PUB/SUB Redis feature.

## Redis Queue
To configure the backend to use Redis for job processing set `ipc-queue=redisq://HOST` where HOST is IP address or hostname of the single Redis server.
This driver implements reliable Redis queue, with `visibilityTimeout` config option works similar to AWS SQS.

Once configured, then all calls to `jobs.submitJob` will push jobs to be executed to the Redis queue, starting somewhere a backend master
process with `-jobs-workers 2` will launch 2 worker processes which will start pulling jobs from the queue and execute.

An example of how to perform jobs in the API routes:

```javascript
   app.processAccounts = function(options, callback) {
       db.select("bk_account", { type: options.type || "user" }, function(err, rows) {
          ...
          callback();
       });
   }

   api.all("/process/accounts", function(req, res) {
       jobs.submitJob({ job: { "app.processAccounts": { type: req.query.type } } }, function(err) {
          api.sendReply(res, err);
       });
   });

```

## RabbitMQ
To configure the backend to use RabbitMQ for messaging set `ipc-queue=amqp://HOST` and optionally `amqp-options=JSON` with options to the amqp module.
Additional objects from the config JSON are used for specific AMQP functions: { queueParams: {}, subscribeParams: {}, publishParams: {} }. These
will be passed to the corresponding AMQP methods: `amqp.queue, amqp.queue.sibcribe, amqp.publish`. See AMQP node.js module for more info.

## DB
This is a simple queue implementation using the atomic UPDATE, it polls for new jobs in the table and updates the status, only who succeeds
with the update takes the job and executes it. It is not effective but can be used for simple and not busy systems for more or less long jobs.
The advantage is that it uses the same database and does not require additional servers.

## SQS
To use AWS SQS for job processing set `ipc-queue=https://sqs.amazonaws.com....`, this queue system will poll SQS for new messeges on a worker
and after succsesful execution will delete the message. For long running jobs it will automatically extend visibility timeout if it is configured.

## Local
The local queue is implemented on the master process as a list, communication is done via local sockets between the master and workers.
This is intended for a single server development pusposes only.

# Security configurations

## API only
This is default setup of the backend when all API requests except `/account/add` must provide valid signature and all HTML, Javascript, CSS and image files
are available to everyone. This mode assumes that Web development will be based on 'single-page' design when only data is requested from the Web server and all
rendering is done using Javascript. This is how the `api.html` develpers console is implemented, using JQuery-UI and Knockout.js.

To see current default config parameters run any of the following commands:

        bkjs run-backend -help | grep api-allow

        node -e 'require("backendjs").core.showHelp()'

To disable open registration in this mode just add config parameter `api-deny-path=^/account/add$` or if developing an application add this in the initMiddleware

        api.initMiddleware = function(callback) {
            this.allow.splice(this.allow.indexOf('^/account/add$'), 1);
        }

## Secure Web site, client verification

This is a mode when the whole Web site is secure by default, even access to the HTML files must be authenticated. In this mode the pages must defined 'Backend.session = true'
during the initialization on every html page, it will enable Web sessions for the site and then no need to sign every API reauest.

The typical client Javascript verification for the html page may look like this, it will redirect to login page if needed,
this assumes the default path '/public' still allowed without the signature:

```javascript
   <script src="/js/jquery.js"></script>
   <link href="/css/bootstrap.css" rel="stylesheet">
   <script src="/js/bootstrap.js"></script>
   <script src="/js/knockout.js" type="text/javascript"></script>
   <script src="/js/crypto.js" type="text/javascript"></script>
   <script src="/js/bkjs.js" type="text/javascript"></script>
   <script src="/js/bkjs-bootstrap.js" type="text/javascript"></script>
   <script src="/js/bkjs-ko.js" type="text/javascript"></script>
   <script>
    $(function () {
       Bkjs.session = true;
       $(Bkjs).on("nologin", function() { window.location='/public/index.html'; });
       Bkjs.koInit();
   });
   </script>
```

## Secure Web site, backend verification
On the backend side in your application app.js it needs more secure settings defined i.e. no html except /public will be accessible and
in case of error will be redirected to the login page by the server. Note, in the login page `Bkjs.session` must be set to true for all
html pages to work after login without singing every API request.

1. We disable all allowed paths to the html and registration:

```javascript
   app.configureMiddleware = function(options, callback) {
      this.allow.splice(this.allow.indexOf('^/$'), 1);
      this.allow.splice(this.allow.indexOf('\\.html$'), 1);
      this.allow.splice(this.allow.indexOf('^/account/add$'), 1);
      callback();
   }
```

2. We define an auth callback in the app and redirect to login if the reauest has no valid signature, we check all html pages, all allowed html pages from the /public
will never end up in this callback because it is called after the signature check but allowed pages are served before that:

```javascript
   api.registerPreProcess('', /^\/$|\.html$/, function(req, status, callback) {
      if (status.status != 200) {
          status.status = 302;
          status.url = '/public/index.html';
      }
      callback(status);
   });
```

# WebSockets connections

The simplest way is to configure `ws-port` to the same value as the HTTP port. This will run WebSockets server along the regular Web server.
All requests must be properly signed with all parameters encoded as for GET requests.

Example:

        wscat --connect ws://localhost:8000
        connected (press CTRL+C to quit)
        > /account/get
        < {
            "status": 400,
            "message": "Invalid request: no host provided"
          }
        >

# Versioning

There is no ready to use support for different versions of API at the same because there is no just one solution that satifies all applications. But there are
tools ready to use that will allow to implement such versioning system in the backend. Some examples are provided below:

- Fixed versions
  This is similar to AWS version system when versions are fixed and changed not very often. For such cases the backend exposes `core.version` which is
  supposed to be a core backend version. This version is returned with every backend reponse in the Verison: header. A client also can specify the core version
  using `bk-version` query parameter or a header. When a request is parsed and the version is provided it will be set in the request options object.

  All API routes are defined using Express middleware and one of the possible ways of dealing with different versions can look like this, by
  appending version to the command it is very simple to call only changed API code.

```javascript
          api.all(/\/domain\/(get|put|del)/, function(req, res) {
              var options = api.getOptions(req);
              var cmd = req.params[0];
              if (options.appBuild) cmd += "/" + options.appBuild;
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

# The backend provisioning utility: bkjs

The purpose of the `bkjs` shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Running without arguments will bring help screen with description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.
On Linux, when started the bkjs tries to load and source the following config files:

        /etc/sysconfig/bkjs
        $BKJS_HOME/etc/profile

Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

Most common used commands are:
- bkjs run-watcher - run the backend or the app for development purposes, uses local app.js if exists otherwise runs generic server
- bkjs run-shell - start REPL shell with the backend module loaded and available for use, all submodules are availablein the shell as well like core, db, api
- bkjs init-app - create the app skeleton
- bkjs put-backend [-path path] [-host host] [-user user] - sync sources of the app with the remote site, uses BKJS_HOST env variable for host if not specified in the command line, this is for developent version of the backend only
- bkjs init-server [-home path] [-user user] [-host name] [-domain name] - initialize Linux instance(Amazon,CentOS) for backend use, optional -home can be specified where the backend
   home will be instead of ~/.bkjs, optional -user tells to use existing user instead of the current user.

   **This command will create `/etc/sysconfig/bkjs` file with BKJS_HOME set to the home of the
   backendjs app which was pased in the command line. This makes the bkjs or bksh run globally regardless of the current directory.**

# Deployment use cases

## AWS instance setup with node and backendjs

Here is the example how to setup new custom AWS server, it is not required and completely optional but bkjs provies some helpful commands that may simplify
new image configuration.

- start new AWS instance via AWS console, use Amazon Linux
- login as `ec2-user`
- install commands

        yum-config-manager --enable epel
        sudo yum install npm
        npm install backendjs --backendjs_imagemagick
        sudo bkjs init-service
        bkjs restart

- try to access the instance via HTTP port 8000 for the API console or documentation
- after reboot the server will be started automatically

## AWS instance as an appliance

To make an API appliance by using the backendjs on the AWS instance as user ec2-user with the backend in the user home

- start new AWS instance via AWS console, use Amazon Linux or CentOS 6
- login as `ec2-user`
- install commands

        curl -L -o /tmp/bkjs http://bkjs.io/bkjs && chmod 755 /tmp/bkjs
        /tmp/bkjs install -user ec2-user -prefix ec2-user
        bkjs restart

- run `ps agx`, it should show several backend processes running
- try to access the instance via HTTP port for the API console or documentation

NOTE: if running behind a Load balancer and actual IP address is needed set Express option in the command line `-api-express-options {"trust%20proxy":1}`. In the config file
replacing spaces with %20 is not required.

## AWS Beanstalk deployment

As with any node.js module, the backendjs app can be packaged into zip file according to AWS docs and deployed the same way as any other node.js app.
Inside the app package etc/config file can be setup for any external connections.

## Proxy mode

By default the Web proceses spawned by the server are load balanced using default cluster module whihc relies on the OS to do scheduling. On Linux
this is proven not to work properly due to the kernel keeping the context switches to a minimum thus resulting in one process to be very busy while the others
idle.

For such case the Backendjs implements the proxy mode by setting `proxy-port` config paremeter to any number above 1000, this will be the initial
port for the web processes to listen for incoming requests, for example if use `-proxy-port 3000` and launch 2 web processes they will listen on ports
3000 and 3001. The main server process will start internal HTTP proxy and will perform round-robin load balancing the incoming requests between the web proceses by forwarding
them to the web processes over TCP and then returning the responses back to the clients.

## Configure HTTP port

The first thing when deploying the backend into production is to change API HTTP port, by default is is 8000, but we would want port 80 so regardless
how the environment is setup it is ultimatley 2 ways to specify the port for HTTP server to use:

- config file

  The config file is always located in the etc/ folder in the backend home directory, how the home is specified depends on the system but basically it can be
  defined via command line arguments as `-home` or via environment variables when using bkjs. See bkjs documentation but on AWS instances created with bkjs
  `init-server` command, for non-standard home use `/etc/sysconfig/bkjs` profile, specify `BKJS_HOME=/home/backend` there and the rest will be taken care of

- command line arguments

  When running node scripts which use the backend, just specify `-home` command line argument with the directory where yor backend should be and the backend will use it

  Example:

        node app.js -home $HOME -port 80

- config database

  If `-db-config` is specified in the command line or `db-config=` in the local config file, this will trigger loading additional
  config parameters from the specified database pool, it will load all records from tbe bk_config table on that db pool. `db-config-type` defines the
  configuration group or type to load, by default all records will be use for config parameters if not specified. Using the database to store
  configuration make it easier to maintain dynamic environment for example in case of auto scaling or lanching on demand, this way
  a new instance will query current config from the database and this eliminates supporting text files and distributing them to all instances.

- DNS records
  Some config options may be kept in the DNS TXT records and every time a instance is started it will query the local DNS for such parameters. Only a small subset of
  all config parameters support DNS store. To see which parmeteres can be stored in the DNS run `bkjs show-help` and look for 'DNS TXT configurable'.

# Backend framework development (Mac OS X, developers)

* for DB drivers and ImageMagick to work propely it needs some dependencies to be installed:

        port install libpng jpeg tiff lcms2 mysql56 postgresql93

* make sure there is no openjpeg15 installed, it will conflict with ImageMagick jp2 codec

* `git clone https://github.com/vseryakov/backendjs.git` or `git clone git@github.com:vseryakov/backendjs.git`

* cd backendjs

* if node.js is already installed skip to the next section

    * node.js can be compiled by the bkjs and installed into default location, on Darwin it is /opt/local

    * to install node.js in $BKJS_PREFIX/bin run command:

            ./bkjs build-node

    * to specify a different install path for the node run

            ./bksj build-node -prefix $HOME

    * **Important**: Add NODE_PATH=$BKJS_PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
      node can find global modules, replace $BKJS_PREFIX with the actual path unless this variable is also set in the .profile

* to install all dependencies and make backendjs module and bkjs globally available:

            npm link backendjs

* to run local server on port 8000 run command:

            ./bkjs run-backend

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to node.js REPL functionality. All modules are accessible from the command line.

            $ ./bkjs run-shell
            > core.version
            '2013.10.20.0'
            > logger.setLevel('info')

# Design considerations

While creating Backendjs there were many questions and issues to be considered, some i was able to implement, some still not. Below are the thoughts that
might be useful when desining, developing or choosing the API platform:

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

Any HTTP methods can be used because its the command in the URL that defines the operation. The payload can be urlencoded query
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
        - Line10: The SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query paremeters
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
            - Field6: SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query paremeters
            - Field7: empty, reserved for future use

The resulting signature is sent as HTTP header `bk-signature` or in the header specified by the `api-signature-name` config parameter.

For JSON content type, the method must be POST and no query parameters specified, instead everything should be inside the JSON object
which is placed in the body of the request. For additional safety, SHA1 checksum of the JSON paylod can be calculated and passed in the signature,
this is the only way to ensure the body is not modified when not using query parameters.

See [web/js/bkjs.js](https://github.com/vseryakov/backendjs/blob/master/web/js/bkjs.js) function `Bkjs.createSignature` or
[api.js](https://github.com/vseryakov/backendjs/blob/master/api.js) function `api.createSignature` for the Javascript implementations.

There is also native iOS implementation [Bkjs.m](https://raw.githubusercontent.com/vseryakov/backendjs-ios/master/BKjs.m).

### Authentication API

- `/auth`

   This API request returns the current user record from the `bk_auth` table if the request is verified and the signature provided
   is valid. If no signature or it is invalid the result will be an error with the corresponding error code and message.

   By default this endpoint is secured, i.e. requires a valid signature.

   Parameters:

   - `_session=1` - if the call is authenticated a cookie with the session signature is returned, from now on
      all requests with such cookie will be authenticated, the primary use for this is Web apps
   - `_accesstoken=1` - returns new access token to be used for subsequent requests without a signature for the current account,
      the token is short lived with expiration date returned as well. This access token can be used instead of a signature and
      is passed in the query as `bk-access-token=TOKEN`.

      Example:

              /auth?_accesstoken=1
              > { id: "XXXX...", name: "Test User", "bk-access-token": "XXXXX....", "bk-access-token-age": 604800000 }

              /account/get?bk-access-token=XXXXXX...
              > { id: "XXXX...", name: "Test User", ... }

- `/login`

   Same as the /auth but it uses cleartext password for user authentication, this request does not need a signature, just simple
   login and password query parameters to be sent to the backend.

   The intened usage is for Web sessions which use sessions cookies when sent with `_session=1` or to be used with access tokens when
   sent with `_accesstoken=1`.

   Parameters:

     - `login` - account login
     - `password` - cleartext password
     - `_session=1` - same as in /auth request
     - `_accesstoken=1` - same as in /auth reuest

   On successful login, the result contains full account record including the secret, this is the only time when the secret is returned back

   Example:

              $.ajax({ url: "/login?login=test123&password=test123&_session=1",
                       success: function(json, status, xhr) { console.log(json) }
              });

              > { id: "XXXX...", name: "Test User", login: "test123", ...}

- `/logout`

   Logout the current user, clear session cookies if exist. For pure API access with the signature this will not do anything on the backend side.

## Accounts
The accounts API manages accounts and authentication, it provides basic user account features with common fields like email, name, address.

This is implemented by the `accounts` module from the core. To enable accounts functionality specify `-allow-modules=bk_accounts`.

- `/account/get`

  Returns information about current account or other accounts, all account columns are returned for the current account and only public columns
  returned for other accounts. This ensures that no private fields ever be exposed to other API clients. This call also can used to login into the service or
  verifying if the given login and secret are valid, there is no special login API call because each call must be signed and all calls are stateless and independent.

  Parameters:

    - no id is given, return only one current account record as JSON
    - id=id,id,... - return information about given account(s), the id parameter can be a single account id or list of ids separated by comma
    - _session=1 - after successful login setup a session with cookies so the Web app can perform requests without signing every request anymore
    - _accesstoken=1 - after successful login, return new access token that ca be used to make requests without signing every request, it can be
       passed in the query or headers with the name `bk-access-token`

  Note: When retrieving current account, all properties will be present including the location, for other accounts only the properties marked as `pub` in the
  `bk_account` table will be returned.

  Response:

          { "id": "57d07a4e28fc4f33bdca9f6c8e04d6c3",
            "name": "Test User",
            "name": "Real Name",
            "mtime": 1391824028,
            "latitude": 34,
            "longitude": -118,
            "geohash": "9qh1",
            "login": "testuser",
          }


- `/account/add`

  Add new account, all parameters are the columns from the `bk_account` table, required columns are: **name, secret or password, login**.

  By default, this URL is in the list of allowed paths that do not need authentication, this means that anybody can add an account. For the real
  application this may not be a good choice so the simplest way to disable it to add api-deny-path=^/account/add$ to the config file or
  specify in the command line. More complex ways to perform registration will require adding pre and.or post callbacks to handle account registration
  for example with invitation codes....

  In the table `bk_auth`, the column `type` is used to distinguish between account roles, by default only account with type `admin` can
  add other accounts with this type specified, this column can also be used in account permissions implementations. Because it is in the bk_auth table,
  all columns of this table are available as `req.account` object after the successful authentication where `req` is an Express request object used in the middleware
  parameters.

  Secret and login can be anything, the backend does not require any specific formats and does not process the contents of the login/secret fields.

  There are several ways to create authenticated account:
    - API only access with signed signature, supply a login and secret which will be stord in the database as is, when making requests use the same login and secret to produce the signature.
      *In the Web client `web/js/bkjs.js`, if `Bkjs.scramble` is set to 1 then the secret is replaced by the BASE64_HMAC_SHA256(secret, login) automatically,
      no actual secret is ever saved or sent, only used in the login form. This is intended for Web apps not to store the actual secret anywhere in the memory or localStorage,
      for the backend this is still just a secret.*
    - password based authentication, send cleartext `password` instead of the `secret`, make sure to use https, the backend will store a salt and SHA256 hash of the password. This method is
      inteded for Web app and will require sessions or access tokens for subsequent requests, the account signature secret is never returned by the backend.

  Example:

            /account/add?name=test&login=test@test.com&secret=fc4f33bd07a4e6c8e&gender=f&phone=1234567
            /account/add?name=test&login=test@test.com&password=test123&gender=f&phone=1234567

  How to make an account as admin

            # Run backend shell
            bkjs run-shell

            # Update record by login
            > db.update("bk_auth", { login: 'login@name', type: 'admin' });

- `/account/select`

  Return list of accounts by the given condition, calls `db.select` for bk_account table. Parameters are the column values to be matched and
  all parameters starting with underscore are control parameters that goes into options of the `db.select` call with underscore removed. This will work for SQL
  databases only because DynamoDB or Cassandra will not search by non primary keys. In the DynamoDB case this will run ScanTable action which will be very expensive for
  large tables. Supports special query parameters `_select,_ops`, see docs about `db.select` for more info.

  Example:

            /account/search?email=test&_ops=email,begins_with
            /account/search?name=test

  Response:

            {  "data": [{
                          "id": "57d07a4e28fc4f33bdca9f6c8e04d6c3",
                          "name": "Test User1",
                          "mtime": 1391824028,
                          "login": "test1",
                        },
                        {
                          "id": "57d07a4e2824fc43bd669f6c8e04d6c3",
                          "name": "Test User2",
                          "mtime": 1391824028,
                          "login": "test2",
                        }],
                "next_token": ""
            }

- `/account/del`

  Delete current account, after this call no more requests will be authenticated with the current credentials

- `/account/update`

  Update current account with new values, the parameters are columns of the table `bk_account`, only columns with non empty values will be updated.

  Example:

            /account/update?name=New%2BName&gender=m

- `/account/put/secret`

  Change account secret for the current account, no columns except the secret will be updated and expected.

  Parameters:
    - secret - new secret for the account
    - token_secret - set to 1 to reset access token secret to a new value thus revoking access from all existing access tokens

  Example:

            /account/put/secret?secret=blahblahblah


- `/account/subcribe`

  Subscribe to account events delivered via HTTP Long Poll, a client makes the connection and waits for events to come, whenever
  somebody updates the account's counter or send a message or creates a connection to this account the event about it will be sent to this HTTP
  connection and delivered as JSON object. This is not a persistent queue so if not listening, all events will just be ignored, only events published
  since the connect will be delivered. To specify what kind of events needs to be delivered, `match` query parameter can be specified which is a
  RegExp of the whole event body string.

  *Note: On the server side there is a config parameter `api-subscribe-interval` which defines how often to deliver notifications, by default it is 5 seconds which means
  only every 5 seconds new events will be delivered to the Web client, if more than one event happened, they all accumulate and will be sent as a JSON list.*

  Example:

        /account/subscribe
        /account/subscribe?match=connection/add.*type:*like

        // To run in the browser:
        (function poll() {
            Bkjs.send({ url: "/account/subscribe", complete: poll }, function(data) {
                console.log("received event:", data);
             });
         })();

  Response:

        [ { "path": "/message/add", "mtime:" 1234566566, "type": "1" },
          { "path": "/counter/incr", "mtime:" 1234566566, "type": "like,invite" } },
          { "path": "/connection/add", "mtime": 1223345545, "type": "like" } ]

- `/account/select/icon`

  Return a list of available account icons, icons that have been uploaded previously with /account/put/icon calls. The `url` property is an URL to retrieve this particular icon.

  Parameters:
    - id - if specified then icons for the given account will be returned

  Example:

        /account/select/icon?id=12345

  Response:

        [ { id: '12345', type: '1', url: '/account/get/icon?id=12345&type=1' },
          { id: '12345', type: '2', url: '/account/get/icon?id=12345&type=2' } ]

- `/account/get/icon`

  Return an account icon, *the icon is returned in the body as binary BLOB*, if no icon with specified type exists, i.e. never been uploaded then 404 is returned.

  Parameters:
    - type - a number from 0 to 9 or any single letter a..z which defines which icon to return, if not specified 0 is used

  Example:

        /account/get/icon?type=2


- `/account/put/icon`

  Upload an account icon, once uploaded, the next `/account/get` call will return propertis in the format `iconN` wheer N is any of the
  type query parameters specified here, for example if we uploaded an icon with type 5, then /account/get will return property icon5 with the URL
  to retrieve this icon.
  *By default all icons uploaded only accessible for the account which uploaded them.*

  Parameters:

    - type - icon type, a number between 0 and 9 or any single letter a..z, if not specified 0 is used
    - icon - can be passed as base64 encoded image in the query,
        - can be passed as base64 encoded string in the body as JSON, like: { type: 0, icon: 'iVBORw0KGgoA...' },
          for JSON the Content-Type HTTP headers must be set to `application/json` and data should be sent with POST request
        - can be uploaded from the browser using regular multi-part form
    - acl_allow - icon access permissions:
      - "" (empty) - only own account can access
      - all - public, everybody can see this icon
      - auth - only authenticated users can see this icon
      - id,id.. - list of account ids that can see this account
    - _width - desired width of the stored icon, if negative this means do not upscale, if th eimage width is less than given keep it as is
    - _height - height of the icon, same rules apply as for the width above
    - _ext - image file format, default is jpg, supports: gif, png, jpg, jp2

  Example:

        /account/put/icon?type=1&icon=iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADs....

- `/account/del/icon`

  Delete account icon

  Parameters:

    - type - what icon to delete, if not specified 0 is used

  Example:

        /account/icon/del?type=1

- `/account/get/status
  Return status for the account by id, if no id is psecified return status for the current account.

  The system maintains account status with the timestamp to be used for presence or any other purposes. The bk_status table can be cached with any available
  caching system like Redis, memcache to be very fast presence state system.

  Example:

        /account/get/status?id=12345

- `/account/put/status`
  Set the status of the current account, requires status parameter, automatically updates the timestamp

  Example:

        /account/put/status?status=online

- `/account/del/status`
  Delete current account status, mostly for clearing the cache or marking offline status


### Health enquiry
When running with AWS load balancer there should be a url that a load balancer polls all the time and this must be very quick and lightweight request. For this
purpose there is an API endpoint `/ping` that just responds with status 200. It is not open by default, the `allow-path` or other way to allow non-authenticted access
needs to be configured. This is to be able to control how pinging can be perform in the apps in cae it is not simple open access.

## Public Images endpoint
This endpoint can server any icon uploaded to the server for any account, it is supposed to be a non-secure method, i.e. no authentication will be performed and no signagture
will be needed once it is confgiured which prefix can be public using `api-allow` or `api-allow-path` config parameters.

The format of the endpoint is:

- `/image/prefix/id/type[.png|.jpg]`

    Example:

        # Configure accounts icons to be public in the etc/config
        api-allow-path=/image/account/

        # Or pass in the command line
        ./app.sh -api-allow-path /image/account/

        # Make requests
        /image/account/12345/0
        /image/account/12345/1
        /image/account/12345/1.jpg

        #Return icons for account 12345 for types 0 and 1

## Icons
The icons API provides ability for an account to store icons of different types. Each account keeps its own icons separate form other
accounts, within the account icons can be separated by `prefix` which is just a namespace assigned to the icons set, for example to keep messages
icons separate from albums, or use prefix for each separate album. Within the prefix icons can be assigned with unique type which can be any string.

Prefix and type can consist from alphabetical characters and numbers, dots, underscores and dashes: [a-z0-9._-]. This means, they are identificators, not real titles or names,
a special mapping between prefix/type and album titles for example needs to be created separately.

The supposed usage for type is to concatenate common identifiers first with more specific to form unique icon type which later can be queried
by prefix or exactly by icon type. For example album id can be prefixed first, then sequential con number like album1:icon1, album1:icon2....
then retrieving all icons for an album would be only query with album1: prefix.

The is implemented by the `icons` module from the core. To enable this functionality specify `-allow-modules=bk_icons`.

- `/icon/get`

   Return icon for the current account in the given prefix, icons are kept on the local disk in the directory
   configured by `-api-images-dir` parameter(default is images/ in the backend directory). Current account id is used to keep icons
   separate from other accounts. Icon presense is checked in the bk_icon table before returning it and if any permissions are set in
   the `acl_allow` column it will be checked if this icon can be returned.

  The following parameters can be used:
  - `prefix` - must be specified, this defines the icons namespace
  - `type` is used to specify unique icon created with such type which can be any string.
  - `_ext` - image extension, like png or jpg if it was saved with it previously

- `/icon/put`

  Upload new icon for the given account in the folder prefix, if type is specified it creates an icons for this type to separate
  multiple icons for the same prefix. `type` can be any string consisting from alpha and digits characters. It creates a record in the bk_icon
  table with all the paramaters passed.

  The following parameters can be used:
    - prefix - prefix for the icons, requried
    - descr - optional description of the icon
    - latitude, longitude - optional coordinates for the icon
    - acl_allow - allow access permissions, see `/account/put/icon` for the format and usage
    - _width - desired width of the stored icon, if negative this means do not upscale, if th eimage width is less than given keep it as is
    - _height - height of the icon, same rules apply as for the width above
    - _ext - image file format, default is jpg, supports: gif, png, jpg

- `/icon/upload`

   Upload a new image and store on the server, no record is created in bk_icon table, just simple image upload,
   but all the same query parameters as for /icon/put are accepted. Returns an JSON object with url property being the full path
   to the uploaded image.

- `/icon/del`

   Delete the default icon for the current account in the folder prefix or by type

- `/icon/select`

  Return list of available icons for the given prefix adn type, all icons starting with prefix/type will be returned,
  the `url` property will provide full URL to retrieve the icon contents

  Example:

        /icon/select?prefix=album&type=me
        /icon/select?prefix=album&type=12345

  Responses:

        [ { id: 'b3dcfd1e63394e769658973f0deaa81a', type: 'me-1', icon: '/icon/get?prefix=album&type=me1' },
          { id: 'b3dcfd1e63394e769658973f0deaa81a', type: 'me-2', icon: '/icon/get?prefix=album&type=me2' } ]

        [ { id: 'b3dcfd1e63394e769658973f0deaa81a', type: '12345-f0deaa81a', icon: '/icon/get?prefix=album&type=12345-f0deaa81a' } ]

## File API

The file API provides ability to store and retrieve files. The operations are similar to the Icon API.

This is implemented by the `files` module from the core. To enable this functionality specify `-allow-modules=bk_files`.

- `/file/get`

    Return a file with given prefix and name, the contents are returned in the response body.

    The following parameters can be used:
    - `prefix` - must be provided, defines the namescape where the file is stored
    - `name` - name of the file, required

- `/file/put`

    Store a file on the backend, the file can be sent using form multipart upload or as JSON

    The following parameters can be used:
    - `prefix` - must be provided, defines the namescape where the file is stored
    - `name` - name of the file, required
    - `_name` - name of the property that contains the file contents, for use with JSON or defines the name of the file attribute for multipart upload
    - `_tm` - append the current timestamp to the file name
    - `_ext` - extention to be assign to the file, otherwise the actual extension from the file name is used

- `/file/del`

    Delete file, prefix and name must be given

## Connections

The connections API maintains two tables `bk_connection` and `bk_reference` for links between accounts of any type. bk_connection table maintains my
links, i.e. when i make explicit connection to other account, and bk_reference table is automatically updated with reference for that other account that i made
a connection with it. No direct operations on bk_reference is allowed.

This is implemented by the `connections` module from the core. To enable this functionality specify `-allow-modules=bk_connections`.

- `/connection/add`
- `/connection/put`
  Create or replace a connection between two accounts, required parameters are:
    - `peer` - id of account to connect to
    - `type` - type of connection, like,dislike,....
    - _connected - the reply will contain a connection record if the other side of our connection is connected to us as well

  This call automatically creates a record in the bk_reference table which is reversed connection for easy access to information like
  ''who is connected to me''.

  Example:

        /connection/add?peer=12345&type=invite&state=sent

- `/connection/update`
- `/connection/incr`
  Update other properties of the existing connection, for connections that may take more than i step or if a connection has other data associated with it beside
  the type of the connection.

  Example:

        /connection/update?peer=12345&type=invite&state=accepted

- `/connection/del`
  Delete existing connection(s), `id` and/or `type` may be be specified, if not all existing connections will be deleted.

  Example:

        /connection/del?type=invite&peer=12345

- `/connection/get`
  Return a single connection for given id

  Parameters:
  - peer - account id of the connection, required
  - type - connection type, required

  Example:

        /connection/get?peer=12345&type=like

  Response:

        { "id": "1111",
          "type: "like",
          "peer": "12345",
          "mtime": "2434343543543" }

- `/reference/get`
  Return a single reference record for given account id, works the same way as `/connection/get`


- `/connection/select`
  Receive all my connections of the given type, i.e. connection(s) i made, if `id` is given only one record for the specified connection will be returned. Supports special
  query parameters `_select,_ops,_desc`, see docs about `db.select` for more info.

  Example:

        # Return all accounts who i invited
        /connection/select?type=invite
        # Return connection for specific type and account id
        /connection/select?type=invite&peer=12345
        # Return accounts who i invited me after specified mtime
        /connection/select?type=invite&_ops=mtime,gt&mtime=12334312543
        # Return accounts who i invited before specified mtime
        /connection/select?type=invite&_ops=mtime,le&_desc=1&mtime=12334312543

  Response:

        { "data": [ { "id": "111",
                      "type": "invite",
                      "peer": "12345",
                      "status": "",
                      "mtime": "12334312543"
                  }],
          "next_token": ""
        }

- `/reference/select`
  Receive all references that connected with my account, i.e. connections made by somebody else with me, works the same way as for connection query call

  Example:

        # Return all accounts who invited me
        /reference/select?type=invite
        # Return accounts who invited me after specified mtime
        /reference/select?type=invite&_ops=mtime,gt&mtime=12334312543

  Response:

        { "data": [ { "id": "111",
                      "type": "invite",
                      "peer": "12345",
                      "status": "",
                      "mtime": "12334312543"
                  }],
          "next_token": ""
        }

## Locations
The location API maintains a table `bk_location` with geolocation coordinates for accounts and allows searching it by distance. The configuration parameter
`min-distance` defines the radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table. By default min-distance is 5 km
which means all geohashes in bk_location table will have geohash of size 4. Once min-distance is set it cannot be changed without rebuilding the bk_location table with new geohash size.

The location search is implemented by using geohash as a primary key in the bk_location table with the account id as the second part of the primary key, for DynamoDB this is the range key.
When request comes for all matches for the location for example 37.7, -122.4, the search that is executed looks like this:
- geohash for latitude 37.7 and longitude -122.4 and radius 10 km will be `9q8y`
- all neoghboring ares around this point within 10 km radius will be '9q8z', '9q8v', '9q8w', '9q8x', '9q8t', '9q9n', '9q9p', '9q9j'
- we start the search on the bk_location table by the primary key geohash with the value 9q8y
- filter out all records beyond our radius by calculating the difference between our point and the candidate record
- if total number of results expcted is still less than required, continue to the next neighbor area
- continue untill we visit all neighbors or received required number of macthed records
- on return the next_token opaque value will be provided if we want to continue the search for more matched for the same location

This is implemented by the `locations` module from the core. To enable this functionality specify `allow-modules=bk_locations`.

- `/location/put`
  Store currenct location for current account, latitude and longitude parameters must be given, this call will update the bk_account table as well with
  these coordinates

  Example:

        /location/put?latitude=-188.23232&longitude=23.4545454

- `/location/get`
  Return matched accounts within the distance(radius) specified by `distance=` parameter in kilometers and current position specified by latitude/longitude paraemeters. This
  call returns results in chunks and requires navigation through all pages to receive all matched records. Records returned will start with the closest to the current
  point. If there are more matched records than specified by the `_count`, the `next_token` property is set with the token to be used in the subsequent call,
  it must be passed as is as `_token=` parameter with all original query parameters.

  Note: The current account will not be present in the results  even if it is within the range, to know my own location use `/account/get` call.

  Example:

            /location/get?distance=10&latitude=-118.23434&longitude=23.45665656&_count=25
            /location/get?distance=10&latitude=-118.23434&longitude=23.45665656&_count=25&_token=FGTHTRHRTHRTHTTR.....

  Response:

           { "data": [ { "id": "12345",
                         "distance": 5,
                         "latitude": -118.123,
                         "longitude": 23.45
                         "mtime": "12334312543"
                       },
                       { "id": "45678",
                         "distance": 5,
                         "latitude": -118.133,
                         "longitude": 23.5
                         "mtime": "12334312543"
                       }],
             "next_token": ""
           }

## Messages
The messaging API allows sending and receiving messages between accounts, it supports text and images. All new messages arrive into the bk_messsage table, the inbox. The client
may keep messages there as new, delete or archive them. Archiving means transfering messages into the bk_archive table. All sent messages are kept in the bk_sent table.

This is implemented by the `messages` module from the core. To enable this functionality specify `-allow-modules=bk_messages`.

- `/message/get/unread`
   Return how many unread messages in the inbox, this is just a flag to signal about new messages, the actual number may not be up to date,
   it is cleared on messages read.

   Example:

       /message/get/unread

   Response:

      { count: 1 }

- `/message/get`
  Read all messages from the inbox.

  Parameters:
   - `_archive` - if set to 1, all returned messages will be archived automatically, so no individual /message/read call needed
   - `_trash` - if set to 1, all returned messages will be deleted, not archived
   - `_total` - if set to 1 then return how many messages in the inbox
     the unread flag with the actual number of unread messages.

  Example:

        # Get all new messages
        /message/get

        # Get all new messages and archive them
        /message/get?_archive=1

        # Get all new messages from the specific sender
        /message/get?sender=12345

        # How many new messages
        /message/get?_total=1

- `/message/get/archive`
  Receive archived messages. The images are not returned, only link to the image in `icon` property of reach record,
  the actual image data must be retrieved separately.

  Parameters:
   - `mtime` - if specified then only messages received since that time will be retirned, it must be in milliseconds since midnight GMT on January 1, 1970, this is what
     Date.now() return in Javascript.
  - `sender` - if specified then all messages from the given sender will be returned.

  NOTE: The `mtime` is when the backend server received the message, if client and the server clocks are off this may return wrong data or not return anything at all,
  also because the arrival order of the messages cannot be guaranteed, sending fast multiple messages may be received in different order by the backend and this will
  result in mtimes that do not correspond to actual times when the message has been sent.

  Example:

        # Get all messages
        /message/get/archive

        # Get all messages received after given mtime
        /message/get/archive?mtime=123475658690

        # Get all messages received before given mtime
        /message/get/archive?mtime=123475658690&_ops=mtime,lt

        # Get all messages with custom filter: if msg text contains Hi
        /message/get/archive?_ops=msg,iregexp&msg=Hi

        # Get all messages from the specific sender
        /message/get/archive?sender=12345

  Response:

        { "data": [ { "sender": "12345",
                      "msg": "Hi, how r u?",
                      "mtime": "12334312543"
                    },
                    { "sender": "45678",
                      "msg": "check this out!",
                      "icon": "/message/image?sender=45678&mtime=12334312543",
                      "mtime": "12334312543"
                    }],
             "next_token": ""
           }

- `/message/get/sent`
   Return all messages i sent out. All the same query rules apply as for the archived messages API call.

  Parameters:
   - `recipient` - id of the recipient where i have sent messages
   - `mtime` - time before or after messages sent, defined by _ops parametrs

  Example:

        /message/get/sent?recipient=123
        /message/get/sent?recipient=123&mtime=123475658690&_ops=mtime,le

- `/message/add`
  Send a message to an account, the following parameters must be specified:
    - `id` - recipient account id
    - `msg` - text of the message, can be empty if `icon` property exists
    - `icon` - icon of the message, it can be base64 encoded image in the query or JSON string if the whole message is posted as JSON or
      can be a multipart file upload if submitted via browser, can be omitted if `msg/connection/get?type=invite&id=12345` property exists.
    - _nosent - do not save this message in my sent messages

  Example:

        /message/add?id=12345&msg=Hello
        /message/add?id=12345&msg=this%2Bis%2Bthe%2Bpic&icon=KHFHTDDKH7676758JFGHFDRDEDET....TGJNK%2D

- `/message/read`
  Mark a message as read

  Example:

        /message/read?sender=12345&mtime=124345656567676

- `/message/archive`
  Move a new message to the archive. The required query parameters are `sender` and `mtime`.

  Example:

        /message/read?sender=12345&mtime=12366676434

- `/message/update`
  Update a message, can be used to keep track of read/unread status, etc...

  Example:

        /message/update?sender=12345&mtime=124345656567676&read=1

- `/message/update/archive`
  Update a message in the archive.


- `/message/del`
  Delete new message(s) by `sender` and/or `mtime` which must be passed as query parameters. If no mtime is given, all messages from the given sender will be deleted.

  Example:

        /message/del?sender=12345&mtime=124345656567676

- `/message/del/archive`
  Delete archived message(s) by `sender` and/or `mtime` which must be passed as query parameters. If no mtime is given, all messages from the given sender will be deleted.

  Example:

        /message/del/archive?sender=12345&mtime=124345656567676

- `/message/del/sent`
  Delete the message(s) by `recipient` and/or `mtime` which must be passed as query parameters. If no mtime is given, all messages to the given recipient will be deleted.

  Example:

        /message/del/sent?recipient=12345&mtime=124345656567676

- `/message/image`
  Return the image data for the given message, the required parameters are:
    - sender - id of the sender returned in the by `/message/get` reply results for every message
    - mtime - exact timestamp of the message


## Counters
The counters API maintains realtime counters for every account records, the counters record may contain many different counter columns for different purposes and
is always cached with whatever cache service is used, by default it is cached by the Web server process on every machine. Web worker processes ask the master Web server
process for the cached records thus only one copy of the cache per machine even in the case of multiple CPU cores.

This is implemented by the `counters` module from the core. To enable this functionality specify `-allow-modules=bk_counters|bk_accounts`.

- `/counter/get`
  Return counter record for current account with all available columns of if `id` is given return public columns for given account, it works with `bk_counter` table
  which by default defines some common columns:
    - ping - a counter for general use, can be used to send a notification event to any acount by increasing this counter for an account
    - like0 - how many i liked, how many time i liked someone, i.e. made a new record in bk_connection table with type 'like'
    - like1 - how many liked me, reverse counter, who connected to me with type 'like'
  More columns can be added to the bk_counter table.

  NOTE: The columns with suffixes 0 and 1 are special columns that support the Connections API, every time a new connection is created, the type of new connection
  is checked against any columns in the bk_counter table, if a property type0 exists and marked in the table descriptnio as `autoincr` then the corresponding
  counter property is increased, this is how every time new connectio like/dislike/invite/follow is added, the counters in the bk_counter table are increased.

- `/counter/put`
  Replace my counters record, all values if not specified will be set to 0

- `/counter/incr`
  Increase one or more counter fields, each column can provide a numeric value and it will be added to the existing value, negative values will be substracted.
  if `id` parameter is specified, only public columns will be increased for other account.

  Example:

        /counter/incr?msg_read=5&
        /counter/incr?id=12345&ping=1

## Data
The data API is a generic way to access any table in the database with common operations, as oppose to the any specific APIs above this API only deals with
one table and one record without maintaining any other features like auto counters, cache...

*Because it exposes the whole database to anybody who has a login it is a good idea to disable this endpoint in the production or provide access callback that verifies
who can access it.*
  - To disable this endpoint completely in the config: `deny-modules=data`
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

        /data/get/bk_account?id=12345
        /data/put/bk_counter?id=12345&like0=1
        /data/select/bk_account?name=john&_ops=name,gt&_select=name,email
        /data/select/bk_connection?_noscan=0&_noprocessrows=1

## Pages
The pages API provides a simple Wiki like system with Markdown formatting. It keeps all pages in the database table `bk_pages` and
exposes an API to manage and render pages.

The pages support public mode, all pages with `pub` set to true will be returning without an account, this must be enabled with `api-allow-path=^/pages/(get|select|show)`
to work.

All .md files will be rendered into html automatically if there is not _raw=1 query parameter and pages view exists (api-pages-view=pages.html by default).

This is implemented by the `pages` module from the core. To enable this functionality specify `-allow-modules=bk_accounts`.

- `/pages/get/ID`
  Return a page with given id or the main page if id is empty. If the query parameter `_render=1` is given, the content will be rendered into html from markdown, otherwie
  returns all data as is.

- `/pages/select`
  Return all pages or only ones which match the query criteria. This potentially scans the whole table to return all pages and
  is used to show pages index.

- `/pages/put`
  Replace or add a new page.

- `/pages/del`
  Delete a page from the database

- `/pages/show/ID`
  Render a page with given id, markdown is converted into html using `marked`. A view must be condfigured in order to render to work, by default pages.html view
  is provided to simply wrap the markdown in the page layout.

## System API
The system API returns information about the backend statistics, allows provisioning and configuration commands and other internal maintenance functions. By
default is is open for access to all users but same security considerations apply here as for the Data API.

This is implemented by the `system` module from the core. To enable this functionality specify `-allow-modules=accounts`.

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

- `/system/params`
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
  - queue or histogram - Keeps a resevoir of statistically relevant values biased towards the last 5 minutes to explore their distribution
      - hmin: The lowest observed value.
      - mmax: The highest observed value.
      - hsum: The sum of all observed values.
      - hvar: The variance of all observed values.
      - hmean: The average of all observed values.
      - hdev: The standard deviation of all observed values.
      - hcnt: The number of observed values.
      - hmed: median, 50% of all values in the resevoir are at or below this value.
      - hp75: See median, 75% percentile.
      - hp95: See median, 95% percentile.
      - hp99: See median, 99% percentile.
      - hp999: See median, 99.9% percentile.

  Response:

             {
                  "id": "172.31.31.85-25170",
                  "ip": "172.31.31.85",
                  "mtime": 1417500027321,
                  "ctime": 1416941754760,
                  "type": "",
                  "host": "",
                  "pid": 25170,
                  "instance": "i-d4c89eff",
                  "worker": 27,
                  "latency": 0,
                  "cpus": 4,
                  "mem": 15774367744,
                  "rss_hmin": 66879488,
                  "rss_hmax": 151891968,
                  "rss_hsum": 2451506479104,
                  "rss_hvar": 254812067010902.66,
                  "rss_hmean": 118895507.98312236,
                  "rss_hdev": 15962833.92793719,
                  "rss_hcnt": 20619,
                  "rss_hmed": 147644416,
                  "rss_h75p": 149262336,
                  "rss_h95p": 150834585.6,
                  "rss_h99p": 151550033.92000002,
                  "rss_h999p": 151886266.368,
                  "heap_hmin": 25790920,
                  "heap_hmax": 72316184,
                  "heap_hsum": 1029889929504,
                  "heap_hvar": 54374337037311.65,
                  "heap_hmean": 49948587.68630874,
                  "heap_hdev": 7373895.648658967,
                  "heap_hcnt": 20619,
                  "heap_hmed": 57480704,
                  "heap_h75p": 61934254,
                  "heap_h95p": 67752391.2,
                  "heap_h99p": 70544797.92,
                  "heap_h999p": 72315029.104,
                  "avg_hmin": 0.04541015625,
                  "avg_hmax": 0.06005859375,
                  "avg_hsum": 938.234375,
                  "avg_hvar": 4.491222722966496e-7,
                  "avg_hmean": 0.04550338886463941,
                  "avg_hdev": 0.0006701658543201448,
                  "avg_hcnt": 20619,
                  "avg_hmed": 0.04541015625,
                  "avg_h75p": 0.04541015625,
                  "avg_h95p": 0.04541015625,
                  "avg_h99p": 0.05078125,
                  "avg_h999p": 0.05997363281250001,
                  "free_hmin": 12879872000,
                  "free_hmax": 13228994560,
                  "free_hsum": 268429937405952,
                  "free_hvar": 5839592954606286,
                  "free_hmean": 13018572064.889277,
                  "free_hdev": 76417229.43555522,
                  "free_hcnt": 20619,
                  "free_hmed": 12908707840,
                  "free_h75p": 12915716096,
                  "free_h95p": 12919331430.4,
                  "free_h99p": 12922073088,
                  "free_h999p": 12922164563.968,
                  "util_hmin": 0.05905642141342145,
                  "util_hmax": 0.0607655708794173,
                  "util_hsum": 1230.6298386264643,
                  "util_hvar": 2.1530671850148948e-7,
                  "util_hmean": 0.059684263961708346,
                  "util_hdev": 0.0004640115499656118,
                  "util_hcnt": 20619,
                  "util_hmed": 0.05920415878947068,
                  "util_h75p": 0.059217278415661254,
                  "util_h95p": 0.05934395790869296,
                  "util_h99p": 0.059361851867105964,
                  "util_h999p": 0.0593659827984017,
                  "pool_name": "dynamodb",
                  "pool_que_rate": 0,
                  "pool_que_rcnt": 1989,
                  "pool_que_rmean": 0.0035627883554577716,
                  "pool_que_r1m": 0,
                  "pool_que_r5m": 0,
                  "pool_que_r15m": 0,
                  "pool_que_hmin": 0,
                  "pool_que_hmax": 230,
                  "pool_que_hsum": 45843,
                  "pool_que_hvar": 366.86587852909315,
                  "pool_que_hmean": 23.048265460030166,
                  "pool_que_hdev": 19.15374319889178,
                  "pool_que_hcnt": 1989,
                  "pool_que_hmed": 21,
                  "pool_que_h75p": 23,
                  "pool_que_h95p": 33,
                  "pool_que_h99p": 126.42000000000007,
                  "pool_que_h999p": 225.971,
                  "pool_req_hmin": 1,
                  "pool_req_hmax": 2,
                  "pool_req_hsum": 1991,
                  "pool_req_hvar": 0.001005024617286425,
                  "pool_req_hmean": 1.0010055304172951,
                  "pool_req_hdev": 0.03170212322994195,
                  "pool_req_hcnt": 1989,
                  "pool_req_hmed": 1,
                  "pool_req_h75p": 1,
                  "pool_req_h95p": 1,
                  "pool_req_h99p": 1,
                  "pool_req_h999p": 1.9710000000000036,
                  "pool_count": 0,
                  "pool_req_0": 2,
                  "pool_cache_rate": 0.1303780964797914,
                  "pool_cache_rcnt": 284,
                  "pool_cache_rmean": 0.0005087436344326025,
                  "pool_cache_r1m": 0,
                  "pool_cache_r5m": 0,
                  "pool_cache_r15m": 0,
                  "pool_cache_hmin": 0,
                  "pool_cache_hmax": 2,
                  "pool_cache_hsum": 70,
                  "pool_cache_hvar": 0.19345045538247163,
                  "pool_cache_hmean": 0.24647887323943662,
                  "pool_cache_hdev": 0.4398300301053483,
                  "pool_cache_hcnt": 284,
                  "pool_cache_hmed": 0,
                  "pool_cache_h75p": 0,
                  "pool_cache_h95p": 1,
                  "pool_cache_h99p": 1,
                  "pool_cache_h999p": 2,
                  "pool_hits": 239,
                  "pool_misses": 45,
                  "cache_inserted": 484,
                  "cache_deleted": 310,
                  "cache_cleanups": 0,
                  "cache_hits": 7642,
                  "cache_misses": 1411,
                  "cache_max": 1000000,
                  "cache_size": 61586,
                  "cache_count": 174,
                  "api_que_hmin": 1,
                  "api_que_hmax": 6,
                  "api_que_hsum": 13237,
                  "api_que_hvar": 0.005674280465987009,
                  "api_que_hmean": 1.0024992426537414,
                  "api_que_hdev": 0.07532782000022972,
                  "api_que_hcnt": 13204,
                  "api_que_hmed": 1,
                  "api_que_h75p": 1,
                  "api_que_h95p": 1,
                  "api_que_h99p": 1,
                  "api_que_h999p": 2,
                  "api_nreq": 1,
                  "api_req_rate": 0,
                  "api_req_rcnt": 13203,
                  "api_req_rmean": 0.02365120609256502,
                  "api_req_r1m": 0,
                  "api_req_r5m": 0,
                  "api_req_r15m": 0,
                  "api_req_hmin": 0,
                  "api_req_hmax": 536,
                  "api_req_hsum": 20115,
                  "api_req_hvar": 89.12554520926801,
                  "api_req_hmean": 1.5235173824130879,
                  "api_req_hdev": 9.440632669968046,
                  "api_req_hcnt": 13203,
                  "api_req_hmed": 1,
                  "api_req_h75p": 1,
                  "api_req_h95p": 1,
                  "api_req_h99p": 33.13000000000011,
                  "api_req_h999p": 99.36200000000008,
                  "url_message_get_rate": 0,
                  "url_message_get_rcnt": 24,
                  "url_message_get_rmean": 0.00004299242196761214,
                  "url_message_get_r1m": 0,
                  "url_message_get_r5m": 0,
                  "url_message_get_r15m": 0,
                  "url_message_get_hmin": 16,
                  "url_message_get_hmax": 71,
                  "url_message_get_hsum": 792,
                  "url_message_get_hvar": 208.34782608695653,
                  "url_message_get_hmean": 33,
                  "url_message_get_hdev": 14.434258764722092,
                  "url_message_get_hcnt": 24,
                  "url_message_get_hmed": 30.5,
                  "url_message_get_h75p": 40.75,
                  "url_message_get_h95p": 68,
                  "url_message_get_h99p": 71,
                  "url_message_get_h999p": 71,
                  "url_message_get_0": 0,
                  "api_req_0": 20,
                  "url_ping_rate": 0,
                  "url_ping_rcnt": 12407,
                  "url_ping_rmean": 0.022226981327796796,
                  "url_ping_r1m": 0,
                  "url_ping_r5m": 0,
                  "url_ping_r15m": 0,
                  "url_ping_hmin": 0,
                  "url_ping_hmax": 4,
                  "url_ping_hsum": 6915,
                  "url_ping_hvar": 0.25785489698686204,
                  "url_ping_hmean": 0.5573466591440316,
                  "url_ping_hdev": 0.5077941482400737,
                  "url_ping_hcnt": 12407,
                  "url_ping_hmed": 1,
                  "url_ping_h75p": 1,
                  "url_ping_h95p": 1,
                  "url_ping_h99p": 1,
                  "url_ping_h999p": 2,
                  "url_ping_0": 5,
                  "url_image_account_rate": 0,
                  "url_image_account_rcnt": 95,
                  "url_image_account_rmean": 0.00017084907295404685,
                  "url_image_account_r1m": 0,
                  "url_image_account_r5m": 0,
                  "url_image_account_r15m": 0,
                  "url_image_account_hmin": 17,
                  "url_image_account_hmax": 121,
                  "url_image_account_hsum": 4295,
                  "url_image_account_hvar": 372.42329227323637,
                  "url_image_account_hmean": 45.21052631578947,
                  "url_image_account_hdev": 19.29827174317007,
                  "url_image_account_hcnt": 95,
                  "url_image_account_hmed": 42,
                  "url_image_account_h75p": 51,
                  "url_image_account_h95p": 89.59999999999991,
                  "url_image_account_h99p": 121,
                  "url_image_account_h999p": 121,
                  "url_image_account_0": 0,
                  "incr_follow_0": 0,
                  "api_bad_0": 3,
                  "url_account_update_rate": 0,
                  "url_account_update_rcnt": 6,
                  "url_account_update_rmean": 0.000010813705805470248,
                  "url_account_update_r1m": 0,
                  "url_account_update_r5m": 0,
                  "url_account_update_r15m": 0,
                  "url_account_update_hmin": 53,
                  "url_account_update_hmax": 182,
                  "url_account_update_hsum": 573,
                  "url_account_update_hvar": 2041.5,
                  "url_account_update_hmean": 95.5,
                  "url_account_update_hdev": 45.18296139032943,
                  "url_account_update_hcnt": 6,
                  "url_account_update_hmed": 82,
                  "url_account_update_h75p": 120.5,
                  "url_account_update_h95p": 182,
                  "url_account_update_h99p": 182,
                  "url_account_update_h999p": 182,
                  "url_account_update_0": 0,
                  "auth_add_0": 0,
                  "url_account_get_rate": 0,
                  "url_account_get_rcnt": 9,
                  "url_account_get_rmean": 0.0001993511695335063,
                  "url_account_get_r1m": 0,
                  "url_account_get_r5m": 0,
                  "url_account_get_r15m": 0,
                  "url_account_get_hmin": 2,
                  "url_account_get_hmax": 100,
                  "url_account_get_hsum": 435,
                  "url_account_get_hvar": 844.0000000000001,
                  "url_account_get_hmean": 48.333333333333336,
                  "url_account_get_hdev": 29.051678092667903,
                  "url_account_get_hcnt": 9,
                  "url_account_get_hmed": 46,
                  "url_account_get_h75p": 67,
                  "url_account_get_h95p": 100,
                  "url_account_get_h99p": 100,
                  "url_account_get_h999p": 100,
                  "url_account_get_0": 1,
                  "url_system_stats_rate": 0,
                  "url_system_stats_rcnt": 1,
                  "url_system_stats_rmean": 0.04501665616278023,
                  "url_system_stats_r1m": 0,
                  "url_system_stats_r5m": 0,
                  "url_system_stats_r15m": 0,
                  "url_system_stats_hmin": 3,
                  "url_system_stats_hmax": 3,
                  "url_system_stats_hsum": 3,
                  "url_system_stats_hmean": 3,
                  "url_system_stats_hdev": 0,
                  "url_system_stats_hcnt": 1,
                  "url_system_stats_hmed": 3,
                  "url_system_stats_h75p": 3,
                  "url_system_stats_h95p": 3,
                  "url_system_stats_h99p": 3,
                  "url_system_stats_h999p": 3,
                  "url_system_stats_0": 2
              }

# Author
  Vlad Seryakov

Check out the [Documentation](http://bkjs.io) for more details.

