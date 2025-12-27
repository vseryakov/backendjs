# Modules

The primary way to add functionality to the backend is via external modules specific to the backend,
these modules are loaded on startup from the local subdirectory **modules/** where the backendjs was started.

The format is the same as for regular Node.js modules and only top level .js files are loaded on the backend startup, but can be configured to
go deeper with **app-modules-depth** config.

Once loaded they have the same access to the backend as the rest of the code, the only difference is that they reside in the backend home and
can be shipped regardless of the npm, node modules and other env setup.

All modules are exposed in the top level {@link module:modules}.

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
  - all templates from **views/** folder will be used for rendering via Express render

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

    configureWeb(options, callback) {

        api.app.post("/webhook/stripe", onWebhook);

        callback();
    }
};

function onWebhook(req, res)
{
    if (req.body?.type == "invoice.payment_succeeded") {

        app.runMethods("onInvoiceEvent", { invoice: req.body.data.object }, (err) => {
            if (err) logger.error("onWebhook:", this.name, err);
        }
    }

    res.sendStatus(200);
}
```

## Default methods

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

Called during the Express server initialization just after the security middleware. This is a chance to install custom middleware before
routes.

NOTE: **api.app** refers to the Express instance.

```js
function configureWeb(options, callback)
```

 Called after the Express server has been setup and middleware is initialized but the Web server
 is not ready for incoming requests yet.

 This hook is intended for defining application routes.

 NOTE: **api.app** refers to the Express instance

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
function configureStaticWeb(options, callback)
```

Called before configuring static Express paths after API routes.

```js
function shutdownWeb(options, callback)
```

 Perform shutdown sequence when a Web process is about to exit.

 NOTE: **api.app** refers to the Express instance

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


