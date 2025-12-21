# Modules

The primary way to add functionality to the backend is via external modules specific to the backend, these modules are loaded on startup from the backend
home subdirectory `modules/`. The format is the same as for regular Node.js modules and only top level .js files are loaded on the backend startup.

Once loaded they have the same access to the backend as the rest of the code, the only difference is that they reside in the backend home and
can be shipped regardless of the npm, node modules and other env setup.

All modules are exposed in the top level `modules` module. This is a way for global access to modules by name.

By having module names contain dots it is possible to create a module hierarchy, for example
modules with names `billing.invoices`, `billing.payable`, `billing.stripe` can be accessed like this:

      const { modules } = require("backendjs");
      modules.billing.invoices....
      modules.billing.payable...
      modules.billing.stripe...

Let's assume the `modules/` contains file facebook.js which implements custom FB logic:

```javascript
    const { core } = require("backendjs");

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
         app.fetch({ url: options.path, query: { access_token: fb.token } }, callback);
    }
```

This is the main app code:

```javascript
    const { api, modules, server } = require("backendjs");

    // Using facebook module in the main app
    api.app.get("/me", (req, res) => {

       modules.facebook.makeRequest({ path: "/me" }, (err, data) => {
          api.sendJSON(req, err, data);
       });
    });

    server.start();
```

To run:

        node app.js -api -modules-path $(pwd)/modules

## NPM packages as modules

In case different modules is better keep separately for maintenance or development purposes they can be split into
separate NPM packages, the structure is the same, modules must be in the `modules/` folder and the package must be loadable
via require as usual. In most cases just empty index.js is enough. Such modules will not be loaded via require though but
by the backendjs `app.loadModule` machinery, the NPM packages are just keep different module directories separate from each other.

The config parameter `import-packages` can be used to specify NPM package names to be loaded separated by comma, as with the default
application structure all subfolders inside each NPM package will be added to the core:

  - modules will be loaded from the modules/ folder
  - files in the web/ folder will be added to the static search path
  - all templates from views/ folder will be used for rendering

If there is a config file present as `etc/config` it will be loaded as well, this way each package can maintain its default config parameters if necessary
without touching other or global configuration. Although such config files will not be reloaded on changes, when NPM installs or updates packages it
moves files around so watching the old config is no point because the updated config file will be different.

# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other
specific usage can be achieved by using SQL directly or other query language supported by any particular database.

The database operations supported in the unified way provide simple actions like `db.get, db.put, db.update, db.del, db.select`.
The `db.query` method provides generic access to the database driver and executes given query directly by the db driver,
it can be SQL or other driver specific query request.

Before the tables can be queried the schema must be defined and created, the backend db layer provides simple functions to do it.

To define tables inside a module just provide a `tables` property in the module object, it will be picked up by database initialization automatically.

```javascript
exports.modules = {
    name: "mymodule",
    tables: {
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
 }
};
```

- the system will automatically create the album and photos tables, this definition must remain in the app source code
  and be called on every app startup. This allows 1) to see the db schema while working with the app and 2) easily maintain it by adding new columns if
  necessary, all new columns will be detected and the database tables updated accordingly. And it is all JavaScript, no need to learn one more language or syntax to maintain database tables, only schema definition conventions.

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hiding all specifics,
it just provides the same API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range
key, so when creating table to be used with DynamoDB, only one or two columns can be marked with primary property while for SQL
databases the composite primary key can consist of more than 2 columns.

The backendjs always creates several tables in the configured database pools by default, these tables are required to support
default API functionality and some are required for backend operations. Refer below for the JavaScript modules documentation
that described which tables are created by default. In the custom applications the `db.describeTables` method can modify columns
in the default table and add more columns if needed.

## Default methods

```js
function configure(options, callback)
```

Called after all config files are loaded and command line args are parsed, home directory is set but before the db is initialized,
the primary purpose of this early call is to setup environment before connecting to the database. This is called regardless of the server
to be started and intended to initialize the common environment before the database and other subsystems are initialized.

```js
function configureModule(options, callback)
```

Called after the {@link module:app.init} has been initialized successfully, this can be redefined in the applications to add additional
init steps that all processes require to have. All database pools and other confugration is ready at this point. This hook is
called regardless of what kind of server is about to start, it is always called before starting a server or shell.

```js
function configureMiddleware(options, callback)
```

Called during the Express server initialization just after the security middleware.
NOTE: `api.app` refers to the Express instance.

```js
function configureWeb(options, callback)
```

 Called after the Express server has been setup and all default API endpoints initialized but the Web server
 is not ready for incoming requests yet. This handler can setup additional API endpoints, add/modify table descriptions.

 NOTE: `api.app` refers to the Express instance

```js
function configureWebServer(options, callback)
```

Called during the Web server startup to create additional servers like websocket in addition to the default HTTP(s) servers

```js
function configureWebsocketUpgrade(req, callback)
```

Called during WebSocket upgrade after the request is authenticated but before making actual HTTP upgrade.

```js
function configureWebsocketRequest(req, callback)
```

Called before processing a request via WebSocket connection

```js
function configureStaticWeb(options, callback)
```

Called before configuring static Express paths

```js
function shutdownWeb(options, callback)
```

 Perform shutdown sequence when a Web process is about to exit

 NOTE: `api.app` refers to the Express instance

```js
function configureServer(options, callback)
```

Called during the server server startup, this is the process that monitors the worker jobs and performs jobs scheduling

```js
function configureWorker(options, callback)
```

Called on job worker instance startup after the tables are intialized and it is ready to process the job

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
Each module can add its own telemtry data to the `options.stats` object.


```js
function configureJob(options, callback)
```

Called before executing a job.

```js
function finishJob(options, callback)
```

Called after a job is finished to possibly perform clean
