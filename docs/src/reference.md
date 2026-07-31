# Reference

Below are described major concepts and components of the backendjs library.

The backendjs library is a regular NPM package, exposes sub-modules and classes to be used in the applications.

```js
const bkjs = require("backendjs");
> Object.keys(bkjs)
[
  'modules',    'logger',    'lib',
  'metrics',    'app',       'cache',
  'queue',      'ipc',       'aws',
  'db',         'sql',       'push',
  'api',        'jobs',      'events',
  'stats',      'sendmail',  'files',
  'DbPool',     'DbRequest', 'shell',
  'middleware'
]
```

## Modules

The primary way to add functionality to the backend is via external modules specific to the backend,
these modules are loaded on startup from the local subdirectory **modules/** where the backendjs was started.

The format is the same as for regular Node.js modules and only top level .js files are loaded on the backend startup, but can be configured to
go deeper with **app-modules-depth** config.

Once loaded they have the same access to the backend as the rest of the code, the only difference is that they reside in the backend home and
can be shipped regardless of the npm, node modules and other env setup.

All modules are exposed in the top level {@link module:modules} except files that start with undescore.

This is how to access modules by name without involving Javascript import/export, also this allows
dynamically detect module at runtime, the app can be bundled with subset of modules only to implement a service,
this way allows not to hardcode imports in the code.

By having module names contain dots it is possible to create a module hierarchy, for example
modules with names billing.invoice, billing.stripe can be accessed like this:

```js
// modules/billing_invoice.js
module.exports = {
    name: "billing.invoice",

    process(options) {

    }
};
```

```js
// modules/billing_stripe.js
module.exports = {
    name: "billing.stripe",

    request(options) {

    }
};
```

```js
// index.js
const { modules } = require("backendjs");
modules.billing.invoice.process({...})
modules.billing.stripe.request({...})
```

## NPM packages as modules

Such modules will NOT be loaded via **require()** but by the backendjs {@link module:app.loadModules} machinery,
the NPM packages are just to keep different modules separate from each other and distribute in established ways.

The config parameter **app-import** can be used to specify NPM package names to be loaded separated by comma, as with the default
application structure all subfolders inside each NPM package will be added to the core:

  - modules will be loaded from the **modules/** folder
  - files in the **web/** folder will be added to the static search path

If there is a config file present specified by {@link module:app.config}, it will be loaded as well, this way each package can maintain its default config parameters if necessary without touching other or global configuration.

Although such config files will not be reloaded on changes, when NPM installs or updates packages it moves files around so watching the old config is no point because the updated config file will be different.

## Message passing

Another reason modules are exposed in **modules** module is ability to "send" messages to modules, or "run methods" how it is
called in the backendjs via {@link module:app.runMethods} function. This is a simple way to pass messages between modules without knowing
who will receive.

This is for in-process messaging only, backendjs has the ability to pass messages via Redis pub/sub {@link module:ipc.broadcast} between processes which then
can be forwarded to modules.

All such methods must be defined as a function ***(options, callback)*** where the options is a generic object with whatever
convention by each method and the callback must be called in order to pass control to other methods.

### Example

Below is an example of a simple inter-module messaging, reusing modules from the above example let's make the invoice module react on
invoice events from the stripe module. If other billing implementation beside Stripe will send invoices it will process them the same way.

```js
// modules/billing_invoice.js
module.exports = {
    name: "billing.invoice",

    onInvoiceEvent(options, callback) {
        if (options?.invoice?.amount_paid) {
            ....
        }
        callback();
    }
};
```

And below the Stripe module will define a route to handle incoming webhooks using predefined **confgureWeb** hook(see below) and on receiving invoices
it will broadcast it, only modules with **onInvoiceEvent** method will receive it.

```js
// modules/billing_stripe.js
const { app, api, logger } = require("backendjs");

module.exports = {
    name: "billing.stripe",

    configureMiddleware(options, callback) {

        api.app.post("/webhook/stripe", onWebhook);

        callback();
    }
};

function onWebhook(context)
{
    const body = context.body;

    if (body?.type == "invoice.payment_succeeded") {

        app.runMethods("onInvoiceEvent", { invoice: body.data.object }, (err) => {
            if (err) logger.error("onWebhook:", this.name, err);
        }
    }

    context.send(200);
}
```

### Default methods

There are several predefined/reserved methods which backendjs uses for its own purposes and provide a known protocol for module lifecycle.

```js
function configure(options, callback)
```

Called after all config files are loaded and command line args are parsed, home directory is set but before the db is initialized,
the primary purpose of this early call is to setup environment before connecting to the database.

This is called regardless of the server started and intended to initialize the common environment before the database and other subsystems are initialized.

```js
function configureModule(options, callback)
```

Called after the {@link module:app.init} has been initialized successfully, this can be defined in the modules to add additional
init steps that all processes require to have. All database pools and other confugration is ready at this point.

This method is called regardless of what kind of server is about to start, it is always called before starting a server or shell.

```js
function configureMiddleware(options, callback)
```

Called during the server initialization. This is a chance to install custom middleware.

NOTE: **api.app** refers to the router instance.

```js
function configureWebServer(options, callback)
```

Called during the Web server startup to create additional servers like websocket in addition to the default HTTP(s) servers.

This is only called in the server process.

```js
function configureWebsocketUpgrade(req, callback)
```

Called during WebSocket upgrade after the request is authenticated but before making actual HTTP upgrade.

```js
function configureWebsocketRequest(req, callback)
```

Called before processing a request via WebSocket connection.

```js
function configureServer(options, callback)
```

Called during the server process startup, this is the process that monitors the worker jobs and performs jobs scheduling.

```js
function configureWorker(options, callback)
```

Called on job worker process startup after the tables are intialized and it is ready to process jobs.

```js
function shutdownWorker(options, callback)
```

 Perform last minute operations inside a worker process before exit, the callback must be called eventually which will exit the process.
 This method can be overrided to implement custom worker shutdown procedure in order to finish pending tasks like network calls.

```js
function configureShell(options, callback)
```

Called by the shell process to setup additional command or to execute a command which is not
supported by the standard shell. Setting options.done to 1 will stop the shell, this is a signal that command has already
been processed.

```js
function configureCollectStats(options, callback)
```

Called by the {@link module:stats} module during collection phase.
Each module can add its own telemtry data to the **options.stats** object.


```js
function configureJob(options, callback)
```

Called before executing a job, options is { queue, message }, returning an error will stop job processing.

```js
function finishJob(options, callback)
```

Called after a job is finished to possibly perform cleanup.


## Dependencies

Only core required dependencies are required but there are many modules which require a module to work correctly.

The command below will install minimal dependencies to serve API and worker jobs

```shell
npm install --save backendjs
```

All optional dependencies are listed in the package.json under "peerDependencies", only manual install of required modules is supported or
it is possible to install all optional dependencies for development purposes.

Here is the list of modules for each peer feature:

- unix-dgram - for Linux to use local syslog via Unix domain
- web-push - for Web push notifications
- sharp - scaling images in uploads using VPS imaging

For example if Redis will be used run inside your project

```shell
npm install --save sharp
```

## Middleware

A middleware is a function that takes {@link RequestContext} and either responds back or passes the control to next middleware.

Implementing middleware is as simpe as this:

```js
function meMiddleware(context, next) {
    if (context.user?.id) {
        return context.json({ name: context.user.name });
    }
    next();
}

api.app.use("GET", "/me", myMiddleware);

```

Initializing middleware can be done at any time but mostly it is done inside a module `configureMiddleware`
hook which is called by the backend after the API server is initialized.

Default middleware modules are initialized in the order shown below by default, see each module for config parameters:

- {@link module:middleware/proxy middleware.proxy: Proxy request using httpproxy}
- {@link module:middleware/routing middleware.routing: Reroute requests internally to different path}
- {@link module:middleware/csrf middleware.csrf: CSRF protection}
- {@link module:middleware/xray middleware.xray: AWS X-ray tracing support}
- {@link module:middleware/limiter middleware.limiter: Rate limiter of requests by path}
- {@link module:middleware/cors middleware.cors: CORS permissions}
- {@link module:middleware/body middleware.body: Body parser for JSON, XML, Formdata}
- {@link module:middleware/multipart middleware.multipart: Body parser for multipart uploads}
- {@link module:middleware/users middleware.users: User authentication/authorization}
- {@link module:middleware/validate middleware.validate: Validate and rate limit requests by query/body parameters}
- {@link module:middleware/static middleware.static: Serve static assets}

Each module supports special config paramater `priority` that may change the place of a module in the router execution list,
see module documentation for details.

To dump all routes to check the order of middleware use command like:

`bksh -app-config tests/bkjs.conf -app-roles users -run-api -dump-api -exit`

## Configuration

Almost everything in the backend is configurable using config files or a config database, see {@tutorial config}.

The whole principle behind it is that once deployed in production, sometimes even quick restarts are impossible to do so
there should be a way to push config changes to the processes without restarting.

Every module has a set of config parameters that defines the behavior of the code, due to the single threaded
nature of the Node.js it is simple to update any config parameter to a new value so the code can operate differently.

To achieve this the code must be written in a special way, like driven by configuration which can be changed at
any time.

All configuration goes through the configuration process that checks all inputs and produces valid output which
is applied to the module variables. Config file or database table with configuration can be loaded on demand or
periodically, for example all local config files can be watched for modification and reloaded automatically, the
config database is loaded periodically which is defined by another config parameter {@link module:db.configMap}.

Including files and filters is supported in the config allowing to apply different config parameters based on the environment,
see {@link module:lib.configParse} and {@link module:app.parseConfig} for more details.

For a quick overview, assume the following bkjs.conf:

```
# default db pool
db-pool=sqlite
db-sqlite-pool=/tmp/myapp

[roles=pg]
db-pool=pg
db-pg-pool=default

[roles=dynamodb]
db-pool=dynamodb
db-dynamodb-pool=default
```

Now, by default it uses Sqlite but to use a different database it is about passing a role:

```
npm run start -- -app-roles dynamodb

npm run start -- -app-roles pg

```

## Config sources

All sources provide plain text where each line contains one config parameter.

 - `file`: using {@link module:app.config} parameter (`app-config`) to point initial confi gfile to load, config files support `include ...` directive to includee other config files
 - `DB`: using {@link module:db.config} parameter `db-config` to point to the database pool with bk_config table
 - `S3`: using parameter `aws-config-s3-file` to point to a file in a S3 bucket
 - `AWS Secrets Manager`: using parameter `aws-config-secrets` with a list of secrets to pull from AWS Secrets Manager
 - `AWS Systems Manager Parameters`: using parameter `aws-config-parameters` with a path for all parameters from AWS System Manager parameters store

# Backend runtime

When the backendjs server starts in server or watch mode it spawns several processes that perform different tasks.

There are 2 major tasks of the backend that can be run at the same time or in any combination:
- a Web server (server) with Web workers (web) and/or job workers (worker)

This is the typical output from the ps command on Linux server:

```shell
ec2-user    899  0.0  0.6 1073844 52892 ?  Sl   14:33   0:01 bkjs: server
ec2-user    917  0.0  0.7 1072820 59008 ?  Sl   14:33   0:01 bkjs: web
ec2-user    919  0.0  0.7 1072820 60792 ?  Sl   14:33   0:02 bkjs: web
ec2-user    921  0.0  0.7 1072120 40721 ?  Sl   14:33   0:02 bkjs: worker
```

To enable any task a command line parameter must be provided, it cannot be specified in the config file. The __bkjs__ utility supports several
commands that simplify running the backend in different modes.

- __bkjs start__ - this command is supposed to be run at the server startup as a service, it runs in the background and the monitors all tasks,
   the env variable __BKJS_SERVER__ must be set in the profile to __server__ to start the server
- __bkjs watch__ - runs the server and Web server in wather mode checking all source files for changes, this is the common command to be used
   in development, it passes the command line switches: __-watch -server__
- __bkjs server__ - this command is supposed to be run at the server startup, it runs in the background and the monitors all processes,
   the command line parameters are: __-daemon -server -syslog__, web server and workers are started by default
- __bkjs run__ - this command runs without other parameters, all additional parameters can be added in the command line, this command
   is a barebone helper to be used with any other custom settings.
- __bkjs run -api__ - this command runs a single process as web server, sutable for Docker
- __bkjs run -worker__ - this command runs a single process worker, suatable for Docker
- __bkjs shell__ or __bksh__ - start backendjs shell, no API or Web server is initialized, only the database pools


## Environment variables

On startup some env variable will be used for initial configuration:

  - BKJS_HOME - home directory where to cd and find files, __-app-home__ config parameter overrides it
  - BKJS_CONFIG - config file to use instead of 'etc/config', __-app-config__ overrides it
  - BKJS_IMPORT - packags to import on start, __-app-import__ overrieds it
  - BKJS_DB_POOL - default db pool, __-db-pool__ overrides it
  - BKJS_DB_CONFIG - config db pool, __-db-config__ overrides it
  - BKJS_ROLES - additonal roles to use for config, __-app-roles__ overrides it
  - BKJS_VERSION - default app name and version, __-app-version__ overrides it
  - BKJS_TAG - initial instance tag, __-app-env-tag__ overrides it, it may be also overridden by AWS instance tag
  - BKJS_LOG_OPTIONS - logger options, __-app-log-options__ overrides it
  - BKJS_PORT - port for web server, __-api-port__ overrides it
  - BKJS_WSPORT - port for web sockets, __api-ws-port__ overrides it


## Backend library development (Mac OS X, developers)

* __git clone https://github.com/vseryakov/backendjs.git__

* cd backendjs

* if Node.js is already installed skip to the next section

    * to install binary release run the command, it will install it into current dir as ./nodejs

        `bin/bkjs install-node`

* `npm install`

* now run local server on port 8000 run command:

    `bin/bkjs watch -app-log info`

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to Node.js REPL functionality. All modules are accessible from the command line.

    ```
    $ bin/bksh
    > app.version
    'bkjs/0.0'
    > logger.setLevel('info')
    ```


