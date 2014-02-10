# Backend framework for node.js

General purpose backend framework.

Features:

* Exposes a set of Web service APIs over HTTP(S) using Express framework.
* Supports Sqlite, PostgreSQL, MySQL, DynamoDB, Cassandra databases, easily extendable to support any kind of database.
* Provides accounts, connections, locations, messaging and icons APIs with basic functionality for a qucik start.
* Supports crontab-like and on-demand scheduling for local and remote(AWS) jobs.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Runs web server as separate processes to utilize multiple CPU cores.
* Local jobs are executed by spawned processes
* Supports several cache modes(Redis, memcached, local cache) for the database operations.
* Supports common database operations (Get, Put, Del, Update, Select) for all databases using the same DB API.
* ImageMagick is compiled as C++ module for in-process image scaling.
* nanomsg interface for messaging between processes and servers.
* REPL(command line) interface for debugging and looking into server internals.
* Geohash based location searches supported by all databases drivers.

Check out the [Wiki](https://github.com/vseryakov/backend/wiki) for more documentation.

# Installation

        npm install node-backend

This may take some time because of compiling required dependencies like ImageMagick, nanomsg and LevelDB. They are not required in all
applications but still part of the core of the system to be available once needed.

# Quick start

* Run default backend without any custom extensions, by default it will use embedded Sqlite database and listen on port 8000

        rc.backend run-backend

* Documentation is always available when the backend Web server is running at http://localhost:8000/doc.html

* Go to http://localhost:8000/api.html for the Web console to test API requests, cancel the login popup after the
  page is loaded, we do not have yet any account credentials.
  For this example let's create couple of accounts, type and execute the following URLs in the Web console

        /account/add?name=test1&secret=test1&login=test1@test.com
        /account/add?name=test2&secret=test2&login=test2@test.com
        /account/add?name=test3&secret=test3&login=test3@test.com


* Now login with any of the accounts above, refresh the api.html and enter email and secret in the login popup dialog.
* If no error message appeared after the login, try to get your current account details:

        /account/get


* To see all public fields for all accounts just execute

        /account/search

* Shutdown the backend by pressing Ctrl-C
* To make custom Web app run the following command:

        rc.backend init-app

* The app.js file is created with 2 additional API endpoints /test/add and /test/[0-9] to show the simplest way
  of adding new tables and API commands.
* The app.sh script is created for convenience, it specifies common arguments and can be customized as needed
* Run new application now, it will start the Web server on port 8000:

        ./app.sh


* Go to http://localhost:8000/api.html and issue /test/add?id=1&name=1 and then /test/1 commands in the console to see it in action
* Change in any of the source files will make the server restart automatically letting you focus on the source code and not server management, this mode
  is only enabled by default in development mode, check app.sh for parameters before running it in te production.

# Database schema definition

The backend support multiple databases and provides the same db layer for access. Common operations are supported and all other specific usage can be achieved by
using SQL directly or other query language supported by any particular database.
The database operations supported in the unified way provide simple actions like get, put, update, delete, select, the query method provides generic
access to the databe driver and executes given query directly.

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

Each database may restrict how the schema is defined and used, the db layer does not provide an artificial layer hidning all specific, it just provides the same
API and syntax, for example, DynamoDB tables must have only hash primary key or combined hash and range key, so when creating table to be used with DynamoDB, only
one or two columns can be marked with primary property while for SQL databases the composite primary key can conisist more than 2 columns.

# API endpoints provided by the backend

## Accounts
The accounts API manages accounts and authentication, it provides basic user account features with common fields like email, name, address.

- `/account/get`

  Returns information about current account or other accounts, all account columns are returned for the current account and only public columns
  returned for other accounts. This ensures that no private fields ever be exposed to other API clients. This call also can used to login into the service or
  verifying if the given login and secret are valid, there is no special login API call because each call must be signed and all calls are stateless and independent.

  Parameters:

    - no id is given, return only one current account record as JSON
    - id=id,id,... - return information about given account(s), the id parameter can be a single account id or list of ids separated by comma,
      return list of account records as JSON
    - _session - after successful login setup a session with cookies so the Web app can perform requests without signing

- `/account/add`

  Add new account, all parameters are the columns from the `bk_account` table, required columns are: **name, secret, login**

  Example:
            /account/add?name=test&login=test@test.com&secret=test123&gender=f&phone=1234567

- `/account/search`

  Return list of accounts by the given condition, calls `db.select` for bk_account table. Parameters are the column values to be matched and
  all parameters starting with underscore are control parameters that goes into options of the `db.select` call with underscore removed. This will work for SQL
  databases only because DynamoDB or Cassandta will not search by non primary keys.

  Example:
            /account/search?email=test&_ops=email,begins_with
            /account/search?name=test&_keys=name

- `/account/del`

  Delete current account

- `/account/update`

  Update current account with new values, the parameters are columns of the table `bk_account`, only columns with non empty values will be updated.

- `/account/put/secret`

  Change account secret for the current account

  Parameters:
    - secret - new secret for the account

- `/account/get/icon`

  Return account icon

  Parameters:
    - type - a number from 0 to 9 which defines which icon to return, if not specified 0 is used

- `/account/put/icon`

  Upload account icon

  Parameters:

    - type - icon type, a number between 0 and 9, if not specified 0 is used
    - icon - can be passed as base64 encoded image in the query,
    - icon - can be passed as base64 encoded string in the body as JSON
    - icon - can be passed in multipart form as a part name

- `/account/del/icon`

  Delete account icon

  Parameters:

    - type - what icon to delet, if not specified 0 is used

## Connections
The connections API maintains two tables `bk_connection` and `bk_reference` for links between accounts of any type. bk_connection table maintains my
links, i.e. when i make explicit connection to other account, and bk_reference table is automatically updated with reference for that other account that i made
a connection with it. No direct operations on bk_reference is allowed.

- `/connection/add`
  Create a connection between two accounts, required parameters are:
    - `id` - id of account to connect to
    - `type` - type of connection, like,dislike,....

  This call automatically creates a record in the bk_reference table which is recersed connection for easy access to information like
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
  Delete existing connection, `id` and `type` must be specified, mass-deletion is not supported only one conection by one.

  Example:

        /connection/del?type=invite&id=12345

- `/connection/get`
  Receive all my connections of the given type, i.e. connection(s) i made, if `id` is given only one record for the specified connection will be returned

  Example:

        /connection/get?type=invite             - return all accounts who i invited
        /connection/get?type=invite&id=12345

- `/reference/get`
  Receive all references that connected with my account, i.e. connections made by somebody else with me, works the same way as for connection query call

  Example:

        /reference/get?type=invite              - return all accounts who invited me

## Locations
The location API maintains a table `bk_location` with geolocation coordinates for accounts and allows searching it by distance.

- `/location/put`
  Store currenct location for current account, latitude and longitude parameters must be given, this call will update the bk_accout table as well with
  these coordinates

  Example:

        /location/put?latitude=-188.23232&longitude=23.4545454

- `/location/get`
  Return matched accounts within the distance specified by `distance=` parameter in kilometers and current position specified by latitude/longitude paraemeters. This
  call returns results in chunks and requires navigation through all pages to receive all matched records. Records returned will start with the closest to the current
  point. If there are more matched records than specified by the `_count`, the `next_token` property is set with the token to be used in the subsequent call,
  it must be passed as is as `_token=` parameter with all original query parameters.
  By default only locations with account ids will be returned, specifying `_details=1` will return public account columns like name as well.

  Example:

            /location/get?distance=10&latitude=-118.23434&longitude=23.45665656&_count=25
            /location/get?distance=10&latitude=-118.23434&longitude=23.45665656&_count=25&_token=FGTHTRHRTHRTHTTR.....

## Messages
The messaging API allows sending and recieving messages between accounts, it supports text and images. The typical usage of this API is to
poll the counter record using `/counter/get` from time to time and check for `msg_count` and `msg_read` counters, once `msg_count` is greater than `msg_read` this means
there is a new message arrived. Then call `/message/get` to retrieve all or only new messages arrived after some point in time and store the mtime
from the last messages received so the next time we will use this time to get only new messages.

- `/message/image`
  Return the image data for the given message, the required parameters are:
    - sender - id of the sender returned in the by `/message/get` reply results for every message
    - mtime - exact timestamp of the message

- `/message/get`
  Receive messages, the parameter `mtime` defines which mesages to get, if omitted all messages will be returned. By `mtime` it is possible to
  specify that only messages received since that time to return, it must be in milliseconds since midnight GMT on January 1, 1970, this is what
  Date.now() return in Javascript. The images are not returned, only link to the image in `icon` property of reach record,
  the actual image data must be retrieved separately.

  Example:

        /message/get
        /message/get?mtime=123475658690

- `/message/add`
  Send a message to an account, the following parametrrs must be specified:
    - `id` - account id of the receiver
    - `msg` - text of the message, can be empty if `icon` property exists
    - `icon` - icon of the message, it can be base64 encoded image in the query or JSON string if the whole message is posted as JSON or
      can be a multipart file upload if submitted via browser, can be omitted if `msg/connection/get?type=invite&id=12345` property exists.

  After successful post the message counters of the destination account will be updated: msg_count will be increased automatically

  Example:

        /message/add?id=12345&msg=Hello
        /message/add?id=12345&msg=this%2Bis%2Bthe%2Bpic&icon=KHFHTDDKH7676758JFGHFDRDEDET....TGJNK%2D

- `/message/read`
  Mark a message as read, this will update account counter `msg_read` automatically. The required query parameters are `sender` and `mtime`.

  Example:

        /message/read?sender=12345&mtime=12366676434

- `/message/del`
  Delete the message by `sender` and `mtime` which must be passed as query parameters.

  Example:

        /message/del?sender=12345&mtime=124345656567676

## Icons
The icons API provides ability to an account to store icons of different types. Each account keeps its own icons separate form other
accounts, within the account icons can be separated by `prefix` which is just a name assigned to the icons set, for example to keep messages
icons separate from albums, or use prefix for each separate album. Within the prefix icons can be assigned with unique id which can be any string.

- `/icon/get/prefix`
- `/icon/get/prefix/id`

   Return icon for the current account in the given prefix, icons are kept on the local disk in the directory
   configured by -api-images-dir parameter(default is images/ in the backend directory). Current account id is used to keep icons
   separate from other accounts. If `id` is used to specify any unique icon cerated with such id.

- `/icon/put/prefix`
- `/icon/put/prefix/id`

  Upload new icon for the given account in the folder prefix, if id is specified it creates an icons for this id to separate
  multiple icons for the same icon. `id` can be any string consisting from alpha and digits characters.

- `/icon/del/prefix`
- `/icon/del/prefix/id`

   Delete the default icon for the current account in the folder prefix or by id

## Counters
The counters API maintains realtime counters for every account records, the counters record may contain many different counter columns for different purposes and
is always cached with whatever cache service is used, by default it is cached by the Web server process on every machine. Web worker processes ask the master Web server
process for the cached records thus only one copy of the cache per machine even in the case of multiple CPU cores.

- `/counter/get`
  Return counter record for current account with all available columns of if `id=` is given return public columns for given account, it works with `bk_counter` table
  which by default defines some common columns:
    - like0 - how many i liked, how many time i liked someone, i.e. made a new record in bk_connection table with type 'like'
    - like1 - how many liked me, reverse counter, who connected to me with type 'like'
    - dislike0 - how many i disliked
    - dislike1 - how many disliked me
    - follow0 - how many i follow
    - follow1 - how many follows me
    - invite0 - how many i invited
    - invite1 - how many invited me
    - msg_count - how messages i received via messaging API
    - msg_read - how many messages i read using messaging API, these counters allow to keep track of new messages, as soon as msg_count greater than msg_read
    it means i have a new message
  More columns can be added to the bk_counter table.

- `/counter/put`
  Replace my counters record, all values if not specified will be set to 0

- `/counter/incr`
  Increase one or more counter fields, each column can provide a numeric value and it will be added to the existing value, negative values will be substracted.

  Example:

        /counter/incr?msg_read=5&

## History
The history API maintains one table for all application specific logging records. All operations deal with current account only.

- `/history/add`
  Add a record to the `bk_history` table for current account, timestamp is added automatically, all other fields are optional but by default
  this table contains only 2 columns: `type` and `data` for genetic logging, it can to be extended to support any other application logic if needed.

- `/history/get`
  Return history record for current account, if mtime is not specified all records from the beginning will be returned, use `_count` and `_start` parameters to paginate through
  all available records or specify `mtime=` with the timestamp in milliseconds to start with particular time.

## Data
The data API is a generic way to access any table in the database with common operations, as oppose to the any specific APIs above this API only deals with
one table and one record without maintaining any other features like auto counters, cache...

# Backend configuration and directory structure

When the backend server starts and no -home argument passed in the command line the backend makes its home environment in the ~/.backend directory.

The backend directory structure is the following:

* `etc` - configuration directory, all config files are there
    * `etc/config` - config parameters, same as specified in the command line but without leading -, each config parameter per line:

        Example:

            debug=1
            db-pool=dynamodb
            db-dynamodb-pool=http://localhost:9000
            db-pgsql-pool=postgresql://postgres@127.0.0.1/backend

            To specify other config file: rc.backend run-app -config-file file

    * `etc/crontab` - jobs to be run with intervals, local or remote, JSON file with a list of cron jobs objects:

        Example:

        1. Create file in ~/.backend/etc/crontab with the following contents:

                [ { "type": "local", "cron": "0 1 1 * * 1,3", "job": { "api.cleanSessions": { "interval": 3600000 } } } ]

        2. Define the funtion that the cron will call with the options specified, callback must be called at the end, create this app.js file

                var backend = require("backend");
                backend.api.cleanSessions = function(options, callback) {
                     backend.db.del("session", { mtime: options.interval + Date.now() }, { ops: "le", keys: [ "mtime" ] }, callback);
                }
                backend.server.start()

        3. Start the scheduler and the web server at once

                rc.backend run-app -master -web

    * `etc/proxy` - HTTP proxy config file, from http-proxy (https://github.com/nodejitsu/node-http-proxy)

        Example:

        1. Create file ~/.backend/etc/proxy with the following contents:

                { "target" : { "host": "localhost", "port": 8001 } }

        2. Start the proxy

                rc.backend -proxy

        3. Now all requests will be sent to localhost:8001

    * `etc/profile` - shell script loaded by the rc.backend utility to customize env variables
* `images` - all images to be served by the API server, every subfolder represent naming space with lots of subfolders for images
* `var` - database files created by the server
* `tmp` - temporary files
* `web` - Web pages served by the static Express middleware

# The backend provisioning utility: rc.backend

The purpose of the rc.backend shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Running without arguments will bring help screen with description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.
On startup the rc.backend tries to load and source the following config files:

        /etc/backendrc
        /usr/local/etc/backendrc
        ~/.backend/etc/profile

Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

Most common used commands are:
- rc.backend run-backend - run the backend or the app for development purposes
- rc.backend run-shell - start REPL shell with the backend module loaded and available for use, all submodules are availablein the shell as well like core, db, api
- rc.backend init-app - create the app skeleton
- rc.backend run-app - run the local app in dev mode
- rc.backend put-app path [-host host] - sync sources of the app with the remote site, uses BACKEND_MASTER env variable for host if not specified in the command line
- rc.backend setup-server [-root path] - initialize Amazon instance for backend use, optional -root can be specified where the backend home will be instead of ~/.backend

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

See web/js/backend.js for function Backend.sign or function core.signRequest in the core.js for the Javascript implementation.

# Backend framework development (Mac OS X, developers)

* `git clone https://github.com/vseryakov/backend.git` or `git clone git@bitbucket.org:vseryakov/backend.git`
* cd backend
* to initialize environment for the backend development it needs to set permissions for $BACKEND_PREFIX(default is /opt/local)
  to the current user, this is required to support global NPM modules.

* If $BACKEND_PREFIX needs to be changed, create ~/.backend/etc/profile file, for example:

        mkdir -p ~/.backend/etc
        echo "BACKEND_PREFIX=$HOME/local" > ~/.backend/etc/profile


* **Important**: Add NODE_PATH=$BACKEND_PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
   node can find global modules, replace $BACKEND_PREFIX with the actual path unless this variable is also set in the .profile

* to install node.js in $BACKEND_PREFIX/bin if not installed already run command:

        ./rc.backend build-node

- once node.js is installed, make sure all required modules are installed, this is required because we did not install the
  backend via npm with all dependencies:

        ./rc.backend npm-deps

* now run the init command to prepare the environment, rc.backend will source .backendrc

        ./rc.backend init-backend

* to compile the binary module and all required dependencies just type ```make```
    * to see the actual compiler setting during compile the following helps:

            make V=1

* to run local server on port 8000 run command:

        ./rc.backend run-backend

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to node.js REPL functionality. All modules are accessible from the command line.

        $ ./rc.backend run-shell
        > core.version
         '2013.10.20.0'
        > logger.setDebug(2)

# Author
  Vlad Seryakov

