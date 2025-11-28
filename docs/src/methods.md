# Module lifecycle

## Default module methods

```configure(options, callback)```

Called after all config files are loaded and command line args are parsed, home directory is set but before the db is initialized,
the primary purpose of this early call is to setup environment before connecting to the database. This is called regardless of the server
to be started and intended to initialize the common environment before the database and other subsystems are initialized.

```configureModule(options, callback)```

Called after the {@link module:app.init} has been initialized successfully, this can be redefined in the applications to add additional
init steps that all processes require to have. All database pools and other confugration is ready at this point. This hook is
called regardless of what kind of server is about to start, it is always called before starting a server or shell.

```configureMiddleware(options, callback)```

Called during the Express server initialization just after the security middleware.
NOTE: `api.app` refers to the Express instance.

```configureWeb(options, callback)```

 Called after the Express server has been setup and all default API endpoints initialized but the Web server
 is not ready for incoming requests yet. This handler can setup additional API endpoints, add/modify table descriptions.

 NOTE: `api.app` refers to the Express instance

```configureWebServer(options, callback)```

Called during the Web server startup to create additional servers like websocket in addition to the default HTTP(s) servers

```configureWebsocketUpgrade(req, callback)```

Called during WebSocket upgrade after the request is authenticated but before making actual HTTP upgrade.

```configureWebsocketRequest(req, callback)```

Called before processing a request via WebSocket connection

```configureStaticWeb(options, callback)```

Called before configuring static Express paths


```shutdownWeb(options, callback)```

 Perform shutdown sequence when a Web process is about to exit

 NOTE: `api.app` refers to the Express instance

```configureServer(options, callback)```

Called during the server server startup, this is the process that monitors the worker jobs and performs jobs scheduling

```configureWorker(options, callback)```

Called on job worker instance startup after the tables are intialized and it is ready to process the job

```shutdownWorker(options, callback)```

 Perform last minute operations inside a worker process before exit, the callback must be called eventually which will exit the process.
 This method can be overrided to implement custom worker shutdown procedure in order to finish pending tasks like network calls.

```configureShell(options, callback)```

Called by the shell process to setup additional command or to execute a command which is not
supported by the standard shell. Setting options.done to 1 will stop the shell, this is a signal that command has already
been processed.

```configureCollectStats(options, callback)```

Called by the {@link module:stats} module during collection phase.
Each module can add its own telemtry data to the `options.stats` object.

