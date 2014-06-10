# Backend platform for node.js

General purpose backend framework. The primary goal is to have a scalable platform for running and managing node.js
servers for Web services implementation. This framework only covers the lower portion of the Web services system:
node.js processes, HTTP servers, basic API functinality, database access, caching, messaging between processes,
metrics and monitoring, a library of tools for developing node.js servers.
For the UI and presentation layer there is no restrictions what to use as long as it can run on top of the Express server.

Features:

* Exposes a set of Web service APIs over HTTP(S) using Express framework.
* Simple database API that supports Sqlite, PostgreSQL, MySQL, DynamoDB, Cassandra, LevelDB, MongoDB, LMDB,
  easily extendable to support any kind of database, provides a database driver on top of Redis with all supported methods.
* Provides accounts, connections, locations, messaging and icons APIs with basic functionality for a qucik start.
* Supports crontab-like and on-demand scheduling for local and remote(AWS) jobs.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Runs web server as separate processes to utilize multiple CPU cores.
* Local jobs are executed by spawned processes
* Supports socket.io/WebSockets connections and process them with the same Express routes as HTTP requests
* Supports several cache modes(Redis, memcached, LRU) for the database operations.
* Supports several PUB/SUB modes of operations using nanomsg, Redis, RabbitMQ.
* Supports common database operations (Get, Put, Del, Update, Select) for all databases using the same DB API.
* ImageMagick is compiled as C++ module for in-process image scaling.
* nanomsg interface for messaging between processes and servers.
* REPL(command line) interface for debugging and looking into server internals.
* Geohash based location searches supported by all databases drivers.
* Supports HTTP(S) reverse proxy mode where multiple Web workers are load-balanced by the proxy
  server in front of them instead of relying on the OS scheduling between procsses listening on the same port.
* Can be used with any MVC or other types of frameworks that work on top or with the Express server.
* Hosted on [github](https://github.com/vseryakov/backendjs), http://backendjs.io or http://vseryakov.github.io/backendjs, BSD licensed.

Check out the [Documentation](http://backendjs.io) for more details.

# Requirements and dependencies

The module supports several databases and includes ImageMagick interface so in order for such interfaces to be compiled the software must be installed
on the system before installing the backendjs. Not everything is required, if not available the interface will be skipped.

The optional packages that the backendjs uses if available(resolving packages is done with *pkg-config*):
- nanomsg - messaging, caching and pub/sub services
- ImageMagick - image manipulation
- libpq - PostgreSQL database driver
- libmysql - MySQL database driver

Installing dependencies on CentOS:

        yum -y install libpng-devel libjpeg-turbo-devel postgresql-devel mysql-devel

Installing dependencies on Mac OS X using macports:

        port install libpng jpeg tiff mysql56 postgresql93

# Installation

To install the module with all optional dependencies if they are available in the system

Note: if for example ImageMagick is not istalled it will be skipped, same goes to all database drivers(PostgreSQL, MySQL) and nanomsg.

        npm install backendjs

To force internal nanomsg and ImageMagick to be compiled in the module the following command must be used:

        npm install backendjs --backend_nanomsg --backend_imagemagick

This may take some time because of compiling required dependencies like ImageMagick, nanomsg. They are not required in all
applications but still part of the core of the system to be available once needed.

# Quick start

* Simplest way of using the backendjs, it will start the server listening on port 8000

        # node
        > var bk = require('backendjs')
        > bk.server.start()

* Same but using the helper tool, by default it will use embedded Sqlite database and listen on port 8000

        bkjs run-backend

* To start the server and connect to the DynamoDB (command line parameters can be saved in the etc/config file, see below about config files)

        bkjs run-backend -db-pool dynamodb -db-dynamodb-pool default -aws-key XXXX -aws-secret XXXX

* or to the PostgreSQL server, database backend

        bkjs run-backend -db-pool pgsql -db-pgsql-pool postgresql://postgres@127.0.0.1/backend

* All commands above will behave exactly the same, all required tables will be automatically created

* While the local backendjs is runnning the documentation is always available when the backend Web server is running at http://localhost:8000/doc.html

* Go to http://localhost:8000/api.html for the Web console to test API requests.
  For this example let's create a couple of accounts, type and execute the following URLs in the Web console

        /account/add?name=test1&secret=test1&login=test1@test.com
        /account/add?name=test2&secret=test2&login=test2@test.com&gender=m&alias=Test%20User&birthday=1980-01-01


* Now login with any of the accounts above, click on *Login* at the top-right corner and enter 'test1' as login and 'test1' as secret in the login popup dialog.
* If no error message appeared after the login, try to get your current account details:

        /account/get

* To see all public fields for all accounts just execute

        /account/select

* Shutdown the backend by pressing Ctrl-C
* To make your own custom Web app, create a new directory (somewhere else) to store your project and run the following command from that directory:

        bkjs init-app

* The app.js file is created in your project directory with 2 additional API endpoints `/test/add` and `/test/[0-9]` to show the simplest way
  of adding new tables and API commands.
* The app.sh script is created for convenience in the development process, it specifies common arguments and can be customized as needed.
* Run new application now, it will start the Web server on port 8000:

        ./app.sh


* Go to http://localhost:8000/api.html and issue command `/test/add?id=1&name=1` and then `/test/1` commands in the console to see it in action
* Change in any of the source files will make the server restart automatically letting you focus on the source code and not server management, this mode
  is only enabled by default in development mode, check app.sh for parameters before running it in the production.

* To start node.js shell with backendjs loaded and initialized, all command line parameters apply to the shell as well

        bksh

* To access the database while in the shell

        > db.select("bk_account", {}, function(err, rows) { console.log(rows) });
        > db.select("bk_account", {}, db.showResult);
        > db.add("bk_account", { login: 'test2', secret: 'test2', name' Test 2 name', gender: 'f' }, db.showResult);
        > db.select("bk_account", { gender: 'm' }, db.showResult);

* To add users from the command line

        bksh -add-user login test sectet test name TestUser email test@test.com


# Backend runtime
When the backendjs server starts it spawns several processes the perform different tasks.

There are 2 major tasks of the backend that can be run at the same time or in any combination:
- a Web server (server) with Web workers (web)
- a job scheduler (master)

These features can be run standalone or under the guard of the monitor which tracks all running processes and restarted any failed one.

This is the typical output from the ps command on Linux server:

            root       891  0.0  0.6 1071632 49504 ?       Ssl  14:33   0:01 backend: monitor
            backend    899  0.0  0.6 1073844 52892 ?       Sl   14:33   0:01 backend: master
            root       908  0.0  0.8 1081020 68780 ?       Sl   14:33   0:02 backend: server
            backend    917  0.0  0.7 1072820 59008 ?       Sl   14:33   0:01 backend: web
            backend    919  0.0  0.7 1072820 60792 ?       Sl   14:33   0:02 backend: web


To enable any task a command line parameter must be provided, it cannot be specified in the config file. The `bkjs` utility supports several
commands that simplify running the backend in different modes.

- `bkjs run-backend` - runs the Web server and the jobs scheduler in debug mode with watching source files for changes, this is the common command to be used
   in development, it passes the command line switches: `-debug -watch -web -master`
- `bkjs run-server` - this command is supposed to be run at the server startup, it runs in the backgroud and the monitors all tasks,
   the command line parameters are: `-daemon -monitor -master -syslog`
- `bkjs run` - this command runs the Web server and the job scheduler without any other parameters, all aditional parameters can be added in the command line, this command
   is a barebone elper to be used with any other custom settings.
- `bkjs run-shell` or `bksh` - start backendjs shell, no API or Web server is initialized, only the database pools


# Application structure
The main puspose of the backendjs is to provide API to access the data, the data can be stored in the database or some other way
but the access to that data will be over HTTP and returned back as JSON. This is default functionality but any custom application
may return data in whatever format is required.

Basically the backendjs is a Web server with ability to perform data processing using local or remote jobs which can be scheduled similar to Unix cron.

The principle behind the system is that nowadays the API services just return data which Web apps or mobiles apps can render to
the user without the backend involved. It does not mean this is simple gateway between the database, in many cases it is but if special
processing of the data is needed before sending it to the user, it is possible to do and backendjs provides many convenient helpers and tools for it.

When the API layer is initialized, the api module contains `app` object which is Express application. The `api.initMiddleware` method which is supposed to be overridden
is called with `this` pointing to the api module and Express server `this.app` created and initialized with security middleware but not any other routes or templates.

The typical structure of a backendjs application is the following (created by the bkjs init-app command:

            var backend = require('backendjs');
            var api = backend.api;
            var db = backend.db;

            // Describe the tables or data model
            api.describeTables({
                ...
            });

            // Optionally customize the Express environment, setup MVC routes or else, this.app is the Express server
            api.initMiddleware = function()
            {
                ...
            }

            // Register API endpoints, i.e. url callbacks
            api.initApplication = function(callback)
            {
                this.app.get('/some/api/endpoint', function(req, res) { ... });
                ...
            }

            // Optionally register post processing of the returned data from the default calls
            api.registerPostProcess('', /^\/account\/([a-z\/]+)$/, function(req, res, rows) { ... });
            ...

            // Optionally register access permissions callbacks
            api.registerAccessCheck('', /^\/test\/list$/, function(req, status, callback) { ...  });
            api.registerPreProcess('', /^\/test\/list$/, function(req, status, callback) { ...  });
            ...

            backend.server.start();

Except the `api.initApplication` and `server.start()` all other functions are optional, they are here for the sake of completness of the example. Also
because running the backend involves more than just running web server many things can be setup using the configuration options like common access permissions,
configuration of the cron jobs so the amount of code to be written to have fully functionaning production API server is not that much, basically only
request endpoint callbacks must be provided in the application.

# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other specific usage can be achieved by
using SQL directly or other query language supported by any particular database.
The database operations supported in the unified way provide simple actions like `db.get, db.put, db.update, db.del, db.select`. The `db.query` method provides generic
access to the database driver and executes given query directly by the db driver, it can be SQL or other driver specific query request.

Before the tables can be queried the schema must be defined and created, the backend db layer provides simple functions to do it:

- first the table needs to be described, this is achieved by creating a Javascript object with properties describing each column, multiple tables can be described
  at the same time, for example lets define album table and make sure it exists when we run our application:

            api.describeTables({
                album: {
                    id: { primary: 1 },                         // Primary key for an album
                    name: { pub: 1 },                           // Album name, public column
                    mtime: { type: "bigint" },                  // Modification timestamp
                },
                photo: {
                    album_id: { primary: 1 },                   // Combined primary key
                    id: { primary: 1 },                         // consiting of album and photo id
                    name: { pub: 1, index: 1 },                 // Photo name or description, public column with the index for faster search
                    mtime: { type: "bigint" }
                }
             });

- the system will automatically create the album and photos tables, this definition must remain in the app source code
  and be called on every app startup. This allows 1) to see the db schema while working with the app and 2) easily maintain it by adding new columns if
  necessary, all new columns will be detected and the database tables updated accordingly. And it is all Javascript, no need to learn one more language or syntax
  to maintain database tables.

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hiding all specifics, it just provides the same
API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range key, so when creating table to be used with DynamoDB, only
one or two columns can be marked with primary property while for SQL databases the composite primary key can conisit of more than 2 columns.

The backendjs always creates several tables in the configured database pools by default, these tables are required to support default API functionality and some
are required for backend opertions. Refer below for the Javascript modules documenttion that described which tables are created by default. In the custom applications
same `api.describeTables` method can modify columns in the default table and add more columns if needed.

For example, to make age and some other columns in the accounts table public and visible by other users with additional columns the following can be
done in the `api.initApplication` method. It will extend the bk_account table and the application can use new columns the same way as the already existing columns.
Making the birthday semipub will make 'age' property automatically calculated and visible in the result, this is done by the internal method `api.processAccountRow` which
is registered as post process callback for the bk_account table.

            api.describeTables({
                    bk_account: {
                           gender: { pub: 1 },
                           birthday: { semipub: 1 },
                           ssn: {},
                           salary: { type: "int" },
                           occupation: {},
                           home_phone: {},
                           work_phone: {},
            });

            api.initApplication = function(callback)
            {
                db.setProcessRow("bk_account", self.processAccountRow);
                ...
            }
            api.processAccountRow = function(row, options, cols)
            {
                if (row.birthday) row.age = Math.floor((Date.now() - core.toDate(row.birthday))/(86400000*365));
                return row;
            }


# API endpoints provided by the backend

## Accounts
The accounts API manages accounts and authentication, it provides basic user account features with common fields like email, name, address.

- `/account/get`

  Returns information about current account or other accounts, all account columns are returned for the current account and only public columns
  returned for other accounts. This ensures that no private fields ever be exposed to other API clients. This call also can used to login into the service or
  verifying if the given login and secret are valid, there is no special login API call because each call must be signed and all calls are stateless and independent.

  Parameters:

    - no id is given, return only one current account record as JSON
    - id=id,id,... - return information about given account(s), the id parameter can be a single account id or list of ids separated by comma
    - _session - after successful login setup a session with cookies so the Web app can perform requests without signing every request anymore

  Note: When retrieving current account, all properties will be present including the location, for other accounts only the properties marked as `pub` in the
  `bk_account` table will be returned.

  Response:

            { "id": "57d07a4e28fc4f33bdca9f6c8e04d6c3",
              "alias": "Test User",
              "name": "Real Name",
              "mtime": 1391824028,
              "latitude": 34,
              "longitude": -118,
              "geohash": "9qh1",
              "login": "testuser",
            }


- `/account/add`

  Add new account, all parameters are the columns from the `bk_account` table, required columns are: **name, secret, login**.

  By default, this URL is in the list of allowed paths that do not need authentication, this means that anybody can add an account. For the real
  application this may not be a good choice so the simplest way to disable it to add api-disallow-path=^/account/add$ to the config file or
  specify in the command line. More complex ways to perform registration will require adding pre and.or post callbacks to handle account registration
  for example with invitation codes....

  In the table `bk_auth`, the column type is used to distinguish between account roles, by default only account with type `admin` can
  add other accounts with this type specified, this column can also be used in account permissions implementations. Because it is in the bk_auth table,
  all columns of this table are available as `req.account` object after the successful authentication where req is Express request object used in the middleware
  parameters.

  *Note: secret and login can be anything, the backend does not require any specific formats so one simple trick which is done by the
  backend Web client is to scramble login/secret using HMAC-SHA1 and keep them in the local storage, this way the real login and secret is never exposed but
  the login popup will still asking for real name, see backend.js in the web/js folder for more details.*

  Example:

            /account/add?name=test&login=test@test.com&secret=test123&gender=f&phone=1234567


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
                          "alias": "Test User1",
                          "name": "User1",
                          "mtime": 1391824028,
                          "login": "test1",
                        },
                        {
                          "id": "57d07a4e2824fc43bd669f6c8e04d6c3",
                          "alias": "Test User2",
                          "name": "User2",
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

            /account/update?name=New%2BName&alias=Hidden%2BName&gender=m

- `/account/put/secret`

  Change account secret for the current account, no columns except the secret will be updated and expected.

  Parameters:
    - secret - new secret for the account

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
            Backend.send({ url: "/account/subscribe", complete: poll }, function(data) {
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

## Public Images endpoint
This endpoint can server any icon uploaded to the server for any account, it is supposed to be a non-secure method, i.e. no authentication will be performed and no signagture
will be needed once it is confgiured which prefix can be public using `api-allow` or `api-allow-path` config parameters.

The format of the endpoint is:

    /image/prefix/id/type

    Example:

        # Configure accounts icons to be public in the etc/config
        api-allow-path=/image/account/

        # Or pass in the command line
        ./app.sh -api-allow-path /image/account/

        # Make requests
        /image/account/12345/0
        /image/account/12345/1

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


- `/icon/get/prefix`
- `/icon/get/prefix/type`

   Return icon for the current account in the given prefix, icons are kept on the local disk in the directory
   configured by -api-images-dir parameter(default is images/ in the backend directory). Current account id is used to keep icons
   separate from other accounts. `type` is used to specify unique icon created with such type which can be any string.

- `/icon/put/prefix`
- `/icon/put/prefix/type`

  Upload new icon for the given account in the folder prefix, if type is specified it creates an icons for this type to separate
  multiple icons for the same prefix. `type` can be any string consisting from alpha and digits characters.

  The following parameters can be used:
    - descr - optional description of the icon
    - latitude, longitude - optional coordinates for the icon
    - acl_allow - allow access permissions, see `/account/put/icon` for the format and usage
    - _width - desired width of the stored icon, if negative this means do not upscale, if th eimage width is less than given keep it as is
    - _height - height of the icon, same rules apply as for the width above
    - _ext - image file format, default is jpg, supports: gif, png, jpg

- `/icon/del/prefix`
- `/icon/del/prefix/type`

   Delete the default icon for the current account in the folder prefix or by type

- `/icon/select/prefix`
- `/icon/select/prefix/type`
  Return list of available icons for the given prefix adn type, all icons starting with prefix/type will be returned,
  the `url` property will provide full URL to retrieve the icon contents

  Example:

        /icon/select/album/me
        /icon/select/album/12345

  Responses:

        [ { id: 'b3dcfd1e63394e769658973f0deaa81a', type: 'me-1', icon: '/icon/get/album/me1' },
          { id: 'b3dcfd1e63394e769658973f0deaa81a', type: 'me-2', icon: '/icon/get/album/me2' } ]

        [ { id: 'b3dcfd1e63394e769658973f0deaa81a', type: '12345-f0deaa81a', icon: '/icon/get/album/12345-f0deaa81a' } ]

## Connections
The connections API maintains two tables `bk_connection` and `bk_reference` for links between accounts of any type. bk_connection table maintains my
links, i.e. when i make explicit connection to other account, and bk_reference table is automatically updated with reference for that other account that i made
a connection with it. No direct operations on bk_reference is allowed.

- `/connection/add`
- `/connection/put`
  Create or replace a connection between two accounts, required parameters are:
    - `id` - id of account to connect to
    - `type` - type of connection, like,dislike,....
    - _connected - the reply will contain a property `connected` set to 1 if the other side of our connection is connected to us as well

  This call automatically creates a record in the bk_reference table which is reversed connection for easy access to information like
  ''who is connected to me'' and auto-increment like0, like1 counters for both accounts in the bk_counter table.

  Also, this call updates the counters in the `bk_counter` table for my account which match the connection type, for example if the type of
  connection is 'invite' and the `bk_counter` table contain 2 columns `invite0` and `invite1`, then both counters will be increased.

  Example:

        /connection/add?id=12345&type=invite&state=sent

- `/connection/update`
  Update other properties of the existing connection, for connections that may take more than i step or if a connection has other data associated with it beside
  the type of the connection.

  Example:

        /connection/update?id=12345&type=invite&state=accepted

- `/connection/del`
  Delete existing connection(s), `id` and/or `type` may be be specified, if not all existing connections will be deleted.

  Example:

        /connection/del?type=invite&id=12345

- `/connection/get`
  Receive all my connections of the given type, i.e. connection(s) i made, if `id` is given only one record for the specified connection will be returned. Supports special
  query parameters `_select,_ops,_desc`, see docs about `db.select` for more info. All `db.select` options can be passed in the query with prepended underscore.

  Example:

        # Return all accounts who i invited
        /connection/get?type=invite
        # Return connection for specific type and account id
        /connection/get?type=invite&id=12345
        # Return accounts who i invited me after specified mtime
        /connection/get?type=invite&_ops=mtime,gt&mtime=12334312543
        # Return accounts who i invited before specified mtime
        /connection/get?type=invite&_ops=mtime,le&_desc=1&mtime=12334312543

  Response:

        { "data": [ { "id": "12345",
                      "type": "invite",
                      "status": "",
                      "mtime": "12334312543"
                  }],
          "next_token": ""
        }

- `/reference/get`
  Receive all references that connected with my account, i.e. connections made by somebody else with me, works the same way as for connection query call

  Example:

        # Return all accounts who invited me
        /reference/get?type=invite
        # Return accounts who invited me after specified mtime
        /reference/get?type=invite&_ops=mtime,gt&mtime=12334312543

  Response:

        { "data": [ { "id": "57d07a4e28fc4f33bdca9f6c8e04d6c3",
                      "type": "invite",
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

  By default only locations with account ids will be returned, specifying `_details=1` will return public account columns like name as well.

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
The messaging API allows sending and recieving messages between accounts, it supports text and images. All new messages arrive into the bk_messsage table, the inbox. The client
may keep messages there as new, delete or archive them. Archiving means transfering messages into the bk_archive table. All sent messages are kept in the bk_sent table.

- `/message/get`
  Read all new messages, i.e. the messages that never been read or issued `/message/archive` call.

  Parameters:
   - `_archive` - if set to 1, all returned messages will be archived automatically, so no individual /message/read call needed
   - `_delete` - if set to 1, all returned messages will be deleted, not archived

  Example:

        # Get all new messages
        /message/get

        # Get all new messages and archive them
        /message/get?_archive=1

        # Get all new messages from the specific sender
        /message/get?sender=12345

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

        /message/get/sent?id=123
        /message/get/sent?id=123&mtime=123475658690&_ops=mtime,le

- `/message/add`
  Send a message to an account, the following parameters must be specified:
    - `id` - account id of the receiver
    - `msg` - text of the message, can be empty if `icon` property exists
    - `icon` - icon of the message, it can be base64 encoded image in the query or JSON string if the whole message is posted as JSON or
      can be a multipart file upload if submitted via browser, can be omitted if `msg/connection/get?type=invite&id=12345` property exists.
    - _nosent - do not save this message in my sent messages

  Example:

        /message/add?id=12345&msg=Hello
        /message/add?id=12345&msg=this%2Bis%2Bthe%2Bpic&icon=KHFHTDDKH7676758JFGHFDRDEDET....TGJNK%2D

- `/message/archive`
  Move a new message to the archive. The required query parameters are `sender` and `mtime`.

  Example:

        /message/read?sender=12345&mtime=12366676434

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

## Status
The status API maintains account status with the timestamp to be used for presence or any other purposes. This table can be cached with any available
caching system like Redis, memcache, nanomsg to be very fast presence state system.

- `/status/put`
  Set the status of the current account, requires status parameter, automatically updates the timestamp

  Example:

        /status/put?status=online

- `/status/get`
  Return status for the account by id, if no id is psecified return statrus for the current account

  Example:

        /status/get?id=12345

- `/status/del`
  Delete current account status, mostly for clearing the cache or marking offline status

## Data
The data API is a generic way to access any table in the database with common operations, as oppose to the any specific APIs above this API only deals with
one table and one record without maintaining any other features like auto counters, cache...

*Because it exposes the whole database to anybody who has a login it is a good idea to disable this endpoint in the production or provide access callback that verifies
who can access it.*
  - To disable this endpoint completely in the config: api-disable=data
  - To allow admins to access it only:

        api.registerPreProcess('GET', '/data', function(req, status, cb) { if (req.account.type != "admin") return cb({ status: 401, message: 'access denied' }; cb(status)); });

- `/data/columns`
- `/data/columns/TABLE`
  Return columns for all tables or the specific TABLE

- `/data/keys/TABLE`
  Return primary keys for the given TABLE

- `/data/(select|search|list|get|add|put|update|del|incr|replace)/TABLE`
  Perform database operation on the given TABLE, all options for the `db` functiobns are passed as query parametrrs prepended with underscore,
  regular parameters are the table columns.

  Example:

        /data/get/bk_account?id=12345
        /data/put/bk_counter?id=12345&like0=1
        /data/select/bk_account?name=john&_ops=name,gt&_select=name,alias,email

## System API
The system API returns information about the backend statistics, allows provisioning and configuration commands and other internal maintenance functions. By
default is is open for access to all users but same security considerations apply here as for the Data API.

- `/system/restart`
    Perform restart of the Web processes, this will be done gracefully, only one Web worker process will be restarting while the other processes will keep
    serving requests. The intention is to allow code updates on live systems without service interruption.

- `/system/cache/(init|stats|keys|get|set|put|incr|del|clear)`
    Access to the caching functions

- `/system/msg/(msg)`
    Access to the messaging functions

- `/system/stats`
  Database pool statistics and other diagnostics
  - latency - how long a pending request waits in queue at this moment
  - busy - how many busy error responses have been returned so far
  - pool - database metrics
    - response - stats about how long it takes between issuing the db request and till the final moment all records are ready to be sent to the client
    - queue - stats about db requests at any given moment queued for the execution
    - cache - db cache response time and metrics
    - rate - req/sec rates
  - api - Web requests metrics, same structure as for the db pool metrics

  Individual sub-objects:
  - rate or meter - Things that are measured as events / interval.
     - mean: The average rate since the meter was started.
     - count: The total of all values added to the meter.
     - currentRate: The rate of the meter since the last toJSON() call.
     - 1MinuteRate: The rate of the meter biased towards the last 1 minute.
     - 5MinuteRate: The rate of the meter biased towards the last 5 minutes.
     - 15MinuteRate: The rate of the meter biased towards the last 15 minutes.
  - queue or histogram - Keeps a resevoir of statistically relevant values biased towards the last 5 minutes to explore their distribution
      - min: The lowest observed value.
      - max: The highest observed value.
      - sum: The sum of all observed values.
      - variance: The variance of all observed values.
      - mean: The average of all observed values.
      - stddev: The stddev of all observed values.
      - count: The number of observed values.
      - median: 50% of all values in the resevoir are at or below this value.
      - p75: See median, 75% percentile.
      - p95: See median, 95% percentile.
      - p99: See median, 99% percentile.
      - p999: See median, 99.9% percentile.

  Response:

         {
            "latency": 0,
            "busy": 0,
            "pool": {
                "queue": {
                    "min": 1,
                    "max": 1,
                    "sum": 65,
                    "variance": 0,
                    "mean": 1,
                    "stddev": 0,
                    "count": 65,
                    "median": 1,
                    "p75": 1,
                    "p95": 1,
                    "p99": 1,
                    "p999": 1
                },
                "count": 0,
                "rate": {
                    "mean": 0.0011948946746301802,
                    "count": 65,
                    "currentRate": 0.0011948946746301802,
                    "1MinuteRate": 2.413646785930864e-158,
                    "5MinuteRate": 1.2021442332952544e-33,
                    "15MinuteRate": 7.127940837162242e-13
                },
                "response": {
                    "meter": {
                        "mean": 0.0011948947405274121,
                        "count": 65,
                        "currentRate": 0.0011948947405274121,
                        "1MinuteRate": 2.413646785930864e-158,
                        "5MinuteRate": 1.2021442332952544e-33,
                        "15MinuteRate": 7.127940837162242e-13
                    },
                    "histogram": {
                        "min": 0,
                        "max": 2,
                        "sum": 65,
                        "variance": 0.12500000000000003,
                        "mean": 1,
                        "stddev": 0.3535533905932738,
                        "count": 65,
                        "median": 1,
                        "p75": 1,
                        "p95": 2,
                        "p99": 2,
                        "p999": 2
                    }
                },
                "misses": 3,
                "hits": 50
            },
            "api": {
             "rss": {
                "min": 77926400,
                "max": 145408000,
                "sum": 23414882304,
                "variance": 234721528417225.16,
                "mean": 128653199.47252747,
                "stddev": 15320624.282881724,
                "count": 182,
                "median": 124903424,
                "p75": 144999424,
                "p95": 145408000,
                "p99": 145408000,
                "p999": 145408000
            },
            "heap": {
                "min": 14755896,
                "max": 31551408,
                "sum": 4174830592,
                "variance": 19213862445722.168,
                "mean": 22938629.626373626,
                "stddev": 4383362.002586846,
                "count": 182,
                "median": 22453472,
                "p75": 26436622,
                "p95": 30530277.599999998,
                "p99": 31331225.599999998,
                "p999": 31551408
            },
            "loadavg": {
                "min": 0,
                "max": 0.14208984375,
                "sum": 8.33349609375,
                "variance": 0.0013957310299007465,
                "mean": 0.04578844007554945,
                "stddev": 0.03735948380131538,
                "count": 182,
                "median": 0.043701171875,
                "p75": 0.0806884765625,
                "p95": 0.103857421875,
                "p99": 0.13803710937499994,
                "p999": 0.14208984375
            },
            "freemem": {
                "min": 1731198976,
                "max": 1815724032,
                "sum": 319208222720,
                "variance": 335910913486664.44,
                "mean": 1753891333.6263735,
                "stddev": 18327872.584854588,
                "count": 182,
                "median": 1757151232,
                "p75": 1763340288,
                "p95": 1785729638.4,
                "p99": 1798348267.5199997,
                "p999": 1815724032
            },
            "rate": {
                "mean": 0.005091340673514894,
                "count": 277,
                "currentRate": 0.005091340673514894,
                "1MinuteRate": 0.014712537947741827,
                "5MinuteRate": 0.003251074139103506,
                "15MinuteRate": 0.0011131541240945431
            },
            "response": {
                "meter": {
                    "mean": 0.005072961780912493,
                    "count": 276,
                    "currentRate": 0.005072961780912493,
                    "1MinuteRate": 0.014712537947741827,
                    "5MinuteRate": 0.003251074139103506,
                    "15MinuteRate": 0.0011131541240946244
                },
                "histogram": {
                    "min": 1,
                    "max": 11847,
                    "sum": 13614,
                    "variance": 508182.2787351782,
                    "mean": 49.32608695652174,
                    "stddev": 712.8690473959282,
                    "count": 276,
                    "median": 2,
                    "p75": 5.75,
                    "p95": 27.149999999999977,
                    "p99": 122.99000000000024,
                    "p999": 11847
                }
            },
            "queue": {
                "min": 1,
                "max": 2,
                "sum": 286,
                "variance": 0.03154920734578558,
                "mean": 1.032490974729242,
                "stddev": 0.17762096538918368,
                "count": 277,
                "median": 1,
                "p75": 1,
                "p95": 1,
                "p99": 2,
                "p999": 2
            },
            "count": 1
            }
        }


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

    * some config parameters can be condigured in DNS as TXT records, the backend on startup will try to resolve such records and use the value if not empty.
      All params that  marked with DNS TXT can be configured in the DNS server for the domain where the backend is running, the config parameter name is
      concatenated with the domain and queried for the TXT record, for example: `cache-host` parameter will be queried for cache-host.domain.name for TXT record type.

    * `etc/crontab` - jobs to be run with intervals, local or remote, JSON file with a list of cron jobs objects:

        Example:

        1. Create file in ~/.backend/etc/crontab with the following contents:

                [ { "type": "local", "cron": "0 1 1 * * 1,3", "job": { "api.cleanSessions": { "interval": 3600000 } } } ]

        2. Define the function that the cron will call with the options specified, callback must be called at the end, create this app.js file

                var backend = require("backendjs");
                backend.api.cleanSessions = function(options, callback) {
                     backend.db.delAll("session", { mtime: options.interval + Date.now() }, { ops: "le" }, callback);
                }
                backend.server.start()

        3. Start the scheduler and the web server at once

                bkjs run-backend -master -web

* `images` - all images to be served by the API server, every subfolder represent naming space with lots of subfolders for images
* `var` - database files created by the server
* `tmp` - temporary files
* `web` - Web pages served by the static Express middleware

# Internal backend functions

The backend includes internal C++ module which provide some useful functions available in the Javascript. The module is exposed as "backend" submodule, to see
all functions for example run the below:

    var backend = require('backendjs');
    console.log(backend.backend)

List of available functions:
- rungc() - run V8 garbage collector on demand
- setsegv() - install SEGV signal handler to show crash backtrace
- setbacktrace() - install special V8-aware backtrace handler
- backtrace() - show V8 backtrace from current position
- heapSnapshot(file) - dump current memory heap snapshot into a file
- splitArray(str) - split a string into an array separated by commas, supports double quotes
- logging([level]) - set or return logging level, this is internal C++ logging facility
- loggingChannel(channelname) - redirect logging into stdout or stderr, this is internal C++ logging
- countWords(word, text) - return how many time word appers in the text, uses Knuth-Morris-Pratt algorithm
- countAllWords(list, text) - return an object with counters for each word from the list, i.e. how many times each word appears in the text, uses Aho-Corasick algorithm
- countWordsInit() - clears word counting cache
- resizeImage(source, options, callback) - resize image using ImageMagick,
   - source can be a Buffer or file name
   - options can have the following properties:
     - width - output image width, if negative and the original image width is smaller than the specified, nothing happens
     - height - output image height, if negative and the original image height is smaller this the specified, nothing happens
     - quality - 0 -99
     - out - output file name
     - ext - image extention

- resizeImageSync(name,width,height,format,filter,quality,outfile) - resize an image synchronically
- snappyCompress(str) - compress a string
- snappyUncompress(str) - decompress a string
- Geohash support
   - geoDistance(lat1, lon1, lat2, lon2) - return distance between 2 coordinates in km
   - geoBoundingBox(lat, lon, distance) - return bounding box geohash for given point around distance
   - geoHashEncode(lat, lon, len) - return geohash for given coordinate, len defines number of bytesin geohash
   - geoHashDecode(hash) - return coordinates for given geohash
   - geoHashAdjacent()
   - geoHashGrid()
   - geoHashRow()
- Generic cache outside of V8 memory pool
   - cacheSave() - general purpose caching functions that have no memory limits and do not use V8 heap
   - cachePut()
   - cacheGet()
   - cacheDel()
   - cacheKeys()
   - cacheClear()
   - cacheNames()
   - cacheSize()
   - cacheEach()
   - cacheForEach()
   - cacheForEachNext()
   - cacheBegin()
   - cacheNext()
- LRU internal cache
   - lruInit(max) - init LRU cache with max number of keys, this is in-memory cache which evicts older keys
   - lruStats() - return statistics about the LRU cache
   - lruSize() - return size of the current LRU cache
   - lruCount() - number of keys in the LRU cache
   - lruPut(name, val) - set/replace value by name
   - lruGet(name) - return value by name
   - lruIncr(name, val) - increase value by given number, non existent items assumed to be 0
   - lruDel(name) - delete by name
   - lruKeys() - return all cache key names
   - lruClear() - clear LRU cache
   - lruServer()
- Syslog support
   - syslogInit(name, priority, facility) - initialize syslog client, used by the logger module
   - syslogSend(level, text)
   - syslogClose()
- NNSocket() - nanomsg socket object with the methods:
    - subscribe
    - bind
    - close
    - setOption
    - connect
    - unsubscribe
    - send
    - recv
    - setCallback
    - setProxy
    - setForward

# Cache configurations
Database layer support caching of the responses using `db.getCached` call, it retrieves exactly one record from the configured cache, if no record exists it
will pull it from the database and on success will store it in the cache before returning to the client. When dealing with cached records, there is a special option
that must be passed to all put/update/del database methods in order to clear local cache, so next time the record will be retrieved with new changes from the database
and refresh the cache, that is `{ cached: true }` can be passed in the options parameter for the db methods that may modify records with cached contents. In any case
it is required to clear cache manually there is `db.clearCache` method for that.
Also there is a configuration option `-db-caching` to make any table automatically cached for all requests.

## nanomsg

For cache management signaling, all servers maintain local cache per machine, it is called `LRU` cache. This cache is maintained in the master Web process and
serves all local Web worker processes via IPC channel. Every Web master process if compiled with nanomsg library can accept cache messages on a TCP port (`cache-port=20194/20195`)
from other backend nodes. Every time any Web worker updates the local cache, its master process re-broadcasts the same request to other connected Web master
processes on other nodes thus keeping in sync caches on all nodes.

In case of a single machine even with multiple CPUs there is nothing to configure, it is enabled by default. In case of multiple servers in the cluster
it requires one or multiple cache coordinators to be configured. It can be any node(s) in the cluster. The coordinator's role is to broadcast
cache requests to all nodes in the cluster.

For very frequent items there is no point using local cache but for items reasonable static with not so often changes this cache model will work reliably and similar to
what `memcached` or `Redis` servers would do as well.

The benefits of this approach is not to run any separate servers and dealing with its own configuration and support, using nanomsg
internal backend cache system is self contained and does not need additional external resources, any node can be LRU server whose only role is to make sure all other
nodes flush their caches if needed. Using redundant coordinators servers makes sure cache requests reach all nodes in the cluster and there is no single point of failure.

Essentually, setting `cache-host` to the list of any node(s) in the network is what needs to be done to support distributed cache with nanomsg sockets.

## memcached
Setting `cache-type=memcache` and pointing `memcache-host` to one or more hosts running memcached servers is what needs to be done only, the rest of the
system works similar to the internal nanomsg caching but using memcache client instead. The great benefit using memcache is to configure more than one
server in `memcache-host` separated by comma which makes it more reliable and eliminates single point of failure if one of the memcache servers goes down.

## Redis
Set `cache-type=redis` and point `redis-host` to the server running Redis server. Only single Redis server can be specified.

# PUB/SUB configurations

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

## nanomsg
To use publish/subcribe with nanomsg, first nanomsg must be compiled in the backend module. Usually this is done when explicitely installed with `--backend_nanomsg`
options to the npm install, see above how to install the package.

All nodes must have the same configuration, similar to the LRU cache otherwise some unexpected behaviour may happen.
The config parameter `msg-host` defines where to publish messages and from where messages can be retrieved. Having more than one hosts listed will ensure
better reliability of delivering messages, publishing will be load-balanced between all configured hosts.

## Redis
To configure the backend to use Redis for messaging set `msg-type=redis` and `redis-host=HOST` where HOST is IP address or hostname of the single Redis server.

## RabbitMQ
To configure the backend to use RabbitMQ for messaging set `msg-type=amqp` and `amqp-host=HOST` and optionally `amqp-options=JSON` with options to the amqp module.

# Security configurations

## API only
This is default setup of the backend when all API requests except `/account/add` must provide valid signature and all HTML, Javascript, CSS and image files
are available to everyone. This mode assumes that Web developmnt will be based on 'single-page' design when only data is requested from the Web server and all
rendering is done using Javascript. This is how the `api.html` develpers console is implemented, using JQuery-UI and Knockout.js.

To see current default config parameters run any of the following commands:

        bkjs run-backend -help | grep api-allow

        node -e 'require("backendjs").core.showHelp()'

To disable open registration in this mode just add config parameter `api-disallow-path=^/account/add$` or if developing an application add this in the initMiddleware

        api.initMiddleware = function(callback) {
            this.allow.splice(this.allow.indexOf('^/account/add$'), 1);
        }

## Secure Web site, client verification
This is a mode when the whole Web site is secure by default, even access to the HTML files must be authenticated. In this mode the pages must defined 'Backend.session = true'
during the initialization on every html page, it will enable Web sessions for the site and then no need to sign every API reauest.

The typical client Javascript verification for the html page may look like this, it will redirect to login page if needed,
this assumes the default path '/public' still allowed without the signature:

        <link href="/styles/jquery-ui.css" rel="stylesheet" type="text/css" />
        <script src="/js/jquery.js" type="text/javascript"></script>
        <script src="/js/jquery-ui.js" type="text/javascript"></script>
        <script src="/js/knockout.js" type="text/javascript"></script>
        <script src="/js/crypto.js" type="text/javascript"></script>
        <script src="js/backend.js" type="text/javascript"></script>
        <script src="js/backend-jquery-ui.js" type="text/javascript"></script>
        <script>
        $(function () {
            Backend.session = true;
            Backend.scramble = true;
            ko.applyBindings(Backend);

            Backend.login(function(err, data) {
                if (err) window.location='/public/index.html';
            });
        });
        </script>

## Secure Web site, backend verification
On the backend side in your application app.js it needs more secure settings defined i.e. no html except /public will be accessible and
in case of error will be redirected to the login page by the server. Note, in the login page `Backend.session` must be set to true for all
html pages to work after login without singing every API request.

First we disable all allowed paths to the html and registration:

        api.initMiddleware = function(callback) {
            self.allow.splice(self.allow.indexOf('^/$'), 1);
            self.allow.splice(self.allow.indexOf('\\.html$'), 1);
            self.allow.splice(self.allow.indexOf('^/account/add$'), 1);
        }


Second we define auth callback in the app and redirect to login if the reauest has no valid signature, we check all html pages, all allowed html pages from the /public
will never end up in this callback because it is called after the signature check but allowed pages are served before that:

        api.registerPreProcess('', /^\/$|\.html$/, function(req, status, callback) {
            if (status.status != 200) {
                status.status = 302;
                status.url = '/public/index.html';
            }
            callback(status);
        });

# socket.io connections

The backend can be configured to accept socket.io connections and process requests with the same HTTP routes registered by Express server.

To start listening for socket.io, the port must be set, the config parameter `socketio-port`, via command line or config file.

After that on the client side socket.io.js file is available from the backend via HTTP port or /socket.io/socket.io.js via socket port.

Example on the server side:

        ./app.js -socketio-port 8001

Example on the client side in the browser, connect to the http://localhost:8000 to get a html file:

        <script src="/js/crypto.js"></script>
        <script src="/js/backend.js"></scropt>
        <script src="socket.io.js"></script>
        <script>
           Backend.ioConnect("http://localhost:8001", function(obj) {
              console.log(obj)
           });
           Backend.ioSend(socket, "/account/get");
        </script>

# WebSockets connections

The simplest way is to configure `ws-port` to the same value as the HTTP port. This will run WebSockets server along the regular Web server.
As with socket.io connections, all requests must be properly signed or not Web requests with all parameters encoded as for GET requests.

Example:

        wscat --connect ws://localhost:8000
        connected (press CTRL+C to quit)
        > /account/get
        < {
            "status": 400,
            "message": "Invalid request: no host provided"
          }
        >

# The backend provisioning utility: bkjs

The purpose of the `bkjs` shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Running without arguments will bring help screen with description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.
On startup the bkjs tries to load and source the following config files:

        /etc/backendrc
        /usr/local/etc/backendrc
        ~/.backend/etc/profile

Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

Most common used commands are:
- bkjs run-backend - run the backend or the app for development purposes, uses local app.js if exists otherwise runs generic server
- bkjs run-shell - start REPL shell with the backend module loaded and available for use, all submodules are availablein the shell as well like core, db, api
- bkjs init-app - create the app skeleton
- bkjs put-backend [-path path] [-host host] [-user user] - sync sources of the app with the remote site, uses BACKEND_HOST env variable for host if not specified in the command line, this is for developent version of the backend only
- bkjs init-server [-root path] [-user user] [-hostname name] [-domain domain] - initialize Linux instance(Amazon,CentOS) for backend use, optional -root can be specified where the backend
   home will be instead of ~/.backend, optional -user tells to use existing user instead of creating user `backend`.

# Deployment use cases

## Custom AWS instance setup

Here is the example how to setup new custom AWS server, it is not required and completely optional but bkjs provies some helpful commands that may simplify
new image configuration.

- start new AWS instance via AWS console, use Amazon Linux or CentOS 6
- login as `ec2-user`
- install commands

        curl -o /tmp/bkjs https://raw.githubusercontent.com/vseryakov/backendjs/master/bkjs && chmod 755 /tmp/bkjs
        sudo /tmp/bkjs init-server -root /home/backend

- NOTE: global system-wide options will be defined in the `/etc/backendrc` like BACKEND_ARGS, BACKEND_NAME, BACKEND_HOME env variables
- reboot
- login as `backend` user using the same AWS keypair private key
- install the backendjs and node:

        /tmp/bkjs build-node
        npm install backendjs --backend_nanomsg --backend_imagemagick

- reboot and login into the server
- run `ps agx`, it should show several backend processes running
- try to access the instance via HTTP port for the API console or documentation

## Custom AWS instance with existing user

Run the backendjs on the AWS instance as user ec2-user with the backend in the user home

- start new AWS instance via AWS console, use Amazon Linux or CentOS 6
- login as `ec2-user`
- install commands

        curl -o /tmp/bkjs https://raw.githubusercontent.com/vseryakov/backendjs/master/bkjs && chmod 755 /tmp/bkjs
        sudo /tmp/bkjs init-server -root $HOME -user $(whoami) -prefix $HOME
        /tmp/bkjs build-node -prefix $HOME
        npm install backendjs --backend_nanomsg --backend_imagemagick
        sudo bkjs restart

- run `ps agx`, it should show several backend processes running
- try to access the instance via HTTP port for the API console or documentation

## Existing AWS instance, minimal install

In case of existing properly setup AWS instance running Linux with Amazon AMI or CentOS, and only needed to start the backendjs as a service, assuming
node.js is already installed:

        sudo npm install backendjs -g
        sudo bkjs init-service

After that the backend will be started by the system on the next reboot or force the start by `sudo service backendjs start`

Note: To install all system packages required for the backend `sudo bkjs init-packages`

## AWS Beanstalk deployment

As with any node.js module, the backendjs app can be packaged into zip file according to AWS docs and deployed the same way as any other node.js app.
Inside the app package etc/config file can be setup for any external connections.

## Configure HTTP port

The first thing when deploying the backend into production is to change API HTTP port, by default is is 8000, but we would want port 80 so regardless
how the environment is setup it is ultimatley 2 ways to specify the port for HTTP server to use:

- config file

  The config file is always located in the etc/ folder in the backend home directory, how the home is specified depends on the system but basically it can be
  defined via command line arguments as `-home` or via environment variables when using bkjs. See bkjs documentation but on AWS instances created with bkjs
  `init-server` command, for non-standard home use `/etc/backendrc` profile, specify `BACKEND_HOME=/home/backend` there and the rest will be taken care of

- command line arguments

  When running node scripts which use the backend, just specify `-home` command line argument with the directory where yor backend should be and the backend will use it

  Example:

        node app.js -home $HOME -port 80

- config database

  If `-db-config` is specified in the command line or `db-config=` in the local config file, this will trigger loading additional
  config parameters from the specified databae pool, it will load all records from tbe bk_config table on that db pool. `db-config` defines the
  configuration group or type to load, by default the config group is 'core', so even if ther is only one config group it must be specified in the `db-config`
  parameter. Using the database to store configuration make it easier to maintain dynamic environment for example in case of auto scaling or lanching on demand, this way
  a new instance will query current config from the database and this eliminates supporting text files and distributing them to all instances.

- DNS records
  Some config options may be kept in the DNS TXT records and every time a instance is started it will query the local DNS for such parameters. Only a small subset of
  all config parameters support DNS store. To see which parmeteres can be stored in the DNS run `bkjs show-help` and look for 'DNS TXT configurable'.

# Security
All requests to the API server must be signed with account login/secret pair.

- The algorithm how to sign HTTP requests (Version 1, 2):
    * Split url to path and query parameters with "?"
    * Split query parameters with "&"
    * '''ignore parameters with empty names'''
    * '''Sort''' list of parameters alphabetically
    * Join sorted list of parameters with "&"
        - Make sure all + are encoded as %2B
    * Form canonical string to be signed as the following:
        - Line1: The HTTP method(GET), followed by a newline.
        - Line2: the host, lowercase, followed by a newline.
        - Line3: The request URI (/), followed by a newline.
        - Line4: The sorted and joined query parameters as one string, followed by a newline.
        - Line5: The expiration value in milliseconds, required, followed by a newline
        - Line6: The Content-Type HTTP header, lowercase, followed by a newline
    * Computed HMAC-SHA1 digest from the canonical string and encode it as BASE64 string, preserve trailing = if any
    * Form BK-Signature HTTP header as the following:
        - The header string consist of multiple fields separated by pipe |
            - Field1: Signature version:
                - version 1, normal signature
                - version 2, only used in session cookies, not headers
                - version 3, same as 1 but uses SHA256
            - Field2: Application version or other app specific data
            - Field3: account login or whatever it might be in the login column
            - Field4: HMAC-SHA digest from the canonical string, version 1 o 3 defines SHA1 or SHA256
            - Field5: expiration value in milliseconds, same as in the canonical string
            - Field6: SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query paremeters
            - Field7: empty, reserved for future use

The resulting signature is sent as HTTP header bk-signature: string

For JSON content type, the method must be POST and no query parameters specified, instead everything should be inside the JSON object
which is placed in the body of the request. For additional safety, SHA1 checksum of the JSON paylod can be calculated and passed in the signature,
this is the only way to ensure the body is not modified when not using query parameters.

See web/js/backend.js for function Backend.sign or function core.signRequest in the core.js for the Javascript implementation.

# Backend framework development (Mac OS X, developers)

* for DB drivers and ImageMagick to work propely it needs some dependencies to be installed:

        port install libpng jpeg tiff lcms2 mysql56 postgresql93

* make sure there is no openjpeg15 installed, it will conflict with ImageMagick jp2 codec

* `git clone https://github.com/vseryakov/backendjs.git` or `git clone git@github.com:vseryakov/backendjs.git`

* cd backendjs

* if node.js is already installed skip to the next section

    * node.js can be compiled by the bkjs and installed into default location, on Darwin it is /opt/local

    * to install node.js in $BACKEND_PREFIX/bin run command:

            ./bkjs build-node

    * to specify a different install path for the node run

            ./bksj build-node -prefix $HOME

    * **Important**: Add NODE_PATH=$BACKEND_PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
      node can find global modules, replace $BACKEND_PREFIX with the actual path unless this variable is also set in the .profile

* to compile the binary module and all required dependencies just type `make` or `npm build .`

    * to see the actual compiler settings during compilation the following helps:

            make V=1

    * to compile with internal nanomsg and ImageMagick use:

            make force V=1

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
            > logger.setDebug(2)

# Author
  Vlad Seryakov

Check out the [Documentation](http://backendjs.io) for more details.

