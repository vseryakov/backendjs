# Reference

# Dependencies

Only core required dependencies are installed but there are many modules which require a module to work correctly.

All optional dependencies are listed in the package.json under "peerDependencies", only manual install of required modules is supported or
it is possible to install all optional dependencies for development purposes.

Here is the list of modules for each peer feature:

- pg - PostgreSQL database access
- redis - for Redis queue and cache driver
- unix-dgram - for Linux to use local syslog via Unix domain
- web-push - for Web push notifications
- sharp - scaling images in uploads using VPS imaging
- nats - NATS driver for queue and events
- croner - to support jobs via a cronfile or DB
- nodemailer - to support sending emails

The command below will install all dependencies

```shell
npm install --include=peer
```

# Configuration

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


# Environment variables

On startup some env variable will be used for initial configuration:

  - BKJS_HOME - home directory where to cd and find files, __-app-home__ config parameter overrides it
  - BKJS_RUNMODE - initial run mode, __-app-run-mode__ overrides it
  - BKJS_CONFIG - config file to use instead of 'etc/config', __-app-config__ overrides it
  - BKJS_PACKAGES - packags to use, __-app-import-packages__ overrieds it
  - BKJS_DB_POOL - default db pool, __-db-pool__ overrides it
  - BKJS_DB_CONFIG - config db pool, __-db-config__ overrides it
  - BKJS_ROLES - additonal roles to use for config, __-app-instance-roles__ overrides it
  - BKJS_VERSION - default app name and version, __-app-version__ overrides it
  - BKJS_TAG - initial instance tag, __-app-instance-tag__ overrides it, it may be also overridden by AWS instance tag
  - BKJS_LOG_OPTIONS - logger options, __-app-log-options__ overrides it
  - BKJS_PORT - port for web server, __-api-port__ overrides it
  - BKJS_WSPORT - port for web sockets, __api-ws-port__ overrides it


# Backend library development (Mac OS X, developers)

* __git clone https://github.com/vseryakov/backendjs.git__

* cd backendjs

* if Node.js is already installed skip to the next section

    * to install binary release run the command, it will install it into ./nodejs

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


