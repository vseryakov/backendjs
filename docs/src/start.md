# Getting started

* To start a bare-bone server

        npm run watch

  Now point your browser to http://localhost:8000/doc.html

  The server is running with default configuration, while no custom code is loaded it still can serve internal API requests
  described below and serve static assets from the web/ folder.

* Programmatic way to start the server

        $ node
        > const { server, api } = require('backendjs')
        > server.start({ api: 1 })

* By default access is allowed only with valid session or signature, to see all public urls type in the node shell above:

        > api.allowPath

  This property of the api module corresponds to the the `-api-allow-path` config parameter, see it in your browser
  at [docs](http://localhost:8000/doc.html#module-api).

* No database driver is enabled by default so here are examples to load local PostgreSQL, DynamoDB or ElasticSearch

        bkjs run -api -db-pool sqlite -db-sqlite-pool
        bkjs run -api -db-pool pg -db-pg-pool
        bkjs run -api -db-pool dynamodb -db-dynamodb-pool
        bkjs run -api -db-pool elasticsearch -db-elasticsearch-pool

* All command line parameters from the above can be saved in the `~.bkjs/etc/config.local` making pg the default database

        db-pool=sqlite
        db-sqlite-pool=default
        db-pg-pool=default
        db-dynamdb-pool=default
        db-elasticsearch-pool=default

* To start Node.js shell with backendjs loaded and initialized, all internal modules in shell are global for convenience

        bkjs shell

* Here is preview how the database can be accessed using internal DB methods with native Sqlite module:

        bkjs shell -db-sqlite-pool -db-pool sqlite -db-create-tables

        > db.select("bk_user", {}, lib.log);
        > db.add("bk_user", { login: 'test2', name: 'Test2 name' }, lib.log);
        > db.select("bk_user", { login: 'test2' }, lib.log);
        > db.select("bk_user", { login: ['test1','test2'] }, { ops: { login: "in" } }, lib.log);

or the same using async/await, same methods with `a` prepended to the name

        > await db.aselect("bk_user", {});
        > await db.aadd("bk_user", { login: 'test2', name: 'Test2 name' });
        > await db.aselect("bk_user", { login: 'test2' });

* To search using Elasticsearch full text capabilities

        > await db.aselect("bk_user", { q: 'test' }, { pool: "elasticsearch" });

## To run an example

* The library is packaged with copies of Bootstrap, jQuery, Knockout.js, Alpine.js for quick Web prototyping
in web/js and web/css directories, all scripts are available from the browser with /js or /css paths.

* Go to `examples` directory, it has several apps with README.md explaining how to run each.
* Go to an application directory and run:

        ./app.sh

* When the web server is started with `-watch` parameter or as `bkjs watch` then any change in the source files will make the server restart automatically
  letting you focus on the source code and not server management, this mode is only enabled by default in development mode,
  check `app.sh` for parameters before running it in production.


# Dependencies

Only core required dependencies are installed but there are many modules which require a module to work correctly.

All optional dependencies are listed in the package.json under "optionalDependencies" so npm cannot use it, only manual install of required modules is supported or
it is possible to install all optional dependencies for development purposes.

Here is the list of modules for each internal feature:

- `pg` - PostgreSQL database access
- `redis` - for Redis queue and cache driver
- `unix-dgram` - for Linux to use local syslog via Unix domain
- `web-push` - for Web push notifications
- `sharp` - scaling images in uploads using VPS imaging
- `nats` - NATS driver for queue and events

The command below will show all core and optional dependencies, `npm install` will install only the core dependencies

    npm install --include=optional

# Configuration

Almost everything in the backend is configurable using config files or a config database.
The whole principle behind it is that once deployed in production, sometimes even quick restarts are impossible to do so
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
- a job scheduler (server)

This is the typical output from the ps command on Linux server:

    ec2-user    899  0.0  0.6 1073844 52892 ?  Sl   14:33   0:01 bkjs: server
    ec2-user    917  0.0  0.7 1072820 59008 ?  Sl   14:33   0:01 bkjs: web
    ec2-user    919  0.0  0.7 1072820 60792 ?  Sl   14:33   0:02 bkjs: web
    ec2-user    921  0.0  0.7 1072120 40721 ?  Sl   14:33   0:02 bkjs: worker

To enable any task a command line parameter must be provided, it cannot be specified in the config file. The `bkjs` utility supports several
commands that simplify running the backend in different modes.

- `bkjs start` - this command is supposed to be run at the server startup as a service, it runs in the background and the monitors all tasks,
   the env variable `BKJS_SERVER` must be set in the profile to `server` to start the server
- `bkjs watch` - runs the server and Web server in wather mode checking all source files for changes, this is the common command to be used
   in development, it passes the command line switches: `-watch -server`
- `bkjs server` - this command is supposed to be run at the server startup, it runs in the background and the monitors all processes,
   the command line parameters are: `-daemon -server -syslog`, web server and workers are started by default
- `bkjs run` - this command runs without other parameters, all additional parameters can be added in the command line, this command
   is a barebone helper to be used with any other custom settings.
- `bkjs run -api` - this command runs a single process as web server, sutable for Docker
- `bkjs run -worker` - this command runs a single process worker, suatable for Docker
- `bkjs shell` or `bksh` - start backendjs shell, no API or Web server is initialized, only the database pools


# Backend directory structure

When the backend server starts and no -home argument passed in the command line the backend uses the current directory.
It is also possible to set the default home using BKJS_HOME environment variable.

The backend directory structure is the following:

* `etc` - configuration directory, all config files are there
    * `etc/bkjs.local` - shell script loaded by the bkjs utility to customize env variables

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

                const { app, db } = require("backendjs");
                app.cleanSessions = function(options, callback) {
                     db.delAll("session", { mtime: options.interval + Date.now() }, { ops: "le" }, callback);
                }
                server.start()

        3. Start the jobs queue and the web server at once

                node app.js -server -jobs-workers 1 -jobs-cron

    * etc/crontab.local - additional local crontab that is read after the main one, for local or dev environment

* `modules` - loadable modules with specific functionality
* `var` - database files created by the server
* `tmp` - temporary files
* `web` - Web pages served by the static Express middleware

# Environment variables

On startup some env variable will be used for initial configuration:

  - BKJS_HOME - home directory where to cd and find files, `-home` config parameter overrides it
  - BKJS_RUNMODE - initial run mode, `-run-mode` overrides it
  - BKJS_CONFIG - config file to use instead of 'etc/config', `-config` overrides it
  - BKJS_PACKAGES - packags to use, `-import-packages` overrieds it
  - BKJS_DB_POOL - default db pool, `-db-pool` overrides it
  - BKJS_DB_CONFIG - config db pool, `-db-config` overrides it
  - BKJS_ROLES - additonal roles to use for config, `-roles` overrides it
  - BKJS_APP_NAME - default app name
  - BKJS_APP_PACKAGE - default app package from preloaded packages
  - BKJS_TAG - initial instance tag, `-instance-tag` overrides it, it may be also overridden by AWS instance tag
  - BKJS_LOG_OPTIONS - logger options, `-log-options` overrides it
  - BKJS_PORT - port for web server
  - BKJS_WSPORT - port for web sockets

