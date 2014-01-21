# Backend framework for node.js

- General purpose backend framework based on the Express web server.
- Supports Sqlite, PostgreSQL, DynamoDB, Cassandra databases.
- Provides accounts, connections, locations, messaging and icons API over HTTP, aka Web services
- Supports crontab-like scheduling for local and remote(AWS) jobs
- Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests
- Runs web server as separate processes to utilize multiple CPU cores
- Supports several cache modes(Redis, memcached, local cache) for the database operations
- Supports common database operations (Get, Put, Del, Update, Select) for all databases using the same DB API 
- ImageMagick is compiled as C++ module for in-process image scaling
- nanomsg interface for messaging between processes and servers
- REPL(command line) interface for debugging and looking into server internals
- Geohash based location searches supported by all databases 

## Installation

### Requirements

These libraries must be installed using your system package management or other tools

 - PostgresSQL client libraries
 - PCRE regexp library

Refer to your distribution package manager for exact names, some examples are:

 - On Mac: port install postgresql93 pcre
 - On Linux: apt-get install postgresql pcre or yum install postgresql pcre

### NPM installation
``` 
   npm install node-backend
```
  
## Usage

The backend framework is a tool, not a turn-key solution but it provides hooks and easy to use
functions for common operations. And of course this is node.js, all Javascript functions are available.

Once the server started, it creates all required tables in the default database confgured by the -db-pool
config parameter or sqlite by default and listens on the configured port or port 80 by default. There is
the Web console available for testing the API. All requests must be signed, the core module and 
Javascript module based on jQuery(web/js/backend.js) can be used to make API requests, see the API
endpoints section below for details.

- To see all command line arguments for the server you can run the following command:
```
node -e "require('backend').core.help()"
```

- Create file main.js with the following contents:
```javascript
  var backend = require('node-backend');

  // Customize the API server with additional tables, endpoints or other features
  backend.api.onInit = function() {
      // Add more properties/columns to the base account table (optional)
      this.initTables("account", [{ name: "facebook_id", type: "int" },
                                  { name: "facebook_email" } ]);

      // Register custom API endpoint
      this.app.get('/test', function(req, res) { res.json({ msg: "Test" }); });
  };
  // Start the server
  backend.server.start();
```

- run the file as 
```
  node main.js -port 8000 -web -console
```     
- go to http://localhost:8000/test to test new endpoint

- go to http://localhost:8000/api.html for the Web console to test API requests

## API endpoints provided by the backend

### Accounts
### Connections
### Locations
### Messages
### Icons
### Counters
### History

# Backend framework development (Mac OS X, developers only)

 - git clone https://[your username]@bitbucket.org/vseryakov/backend.git
 - SSH alternative so you don't have to constantly enter your BitBucket password: git clone git@bitbucket.org:vseryakov/backend.git
 - cd backend
 - to initialize environment for the backend development it needs to set permissions for $PREFIX(default is /opt/local)
   to the current user, this is required to support global NPM modules. 

 - If $PREFIX needs to be changed, create .backendrc file and assing PREFIX=path, for example
```
   echo "PREFIX=$HOME/local" > .backendrc
```   

 - __Important__: Add NODE_PATH=$PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
   node can find global modules, replace $PREFIX with the actual path unless this variable is also set in the .profile
     
 - now run the init command to prepare the environment, bin/rc.backend will source .backendrc
```
   rc.backend init-backend
```

 - to install node.js in $PREFIX/bin if not installed already run command:
```
   rc.backend build-node
```

- if node.js is installed, make sure all required modules are installed, thi sis required because we did not installed the 
  backend via npm with all dependencies:
```
  rc.backend npm-deps
``` 

 - If you would like to be able to generate documentation with `make doc`, you will need to install the Docco module:
```
   npm install -g docco
```
   
 - to compile the binary module and all required dependencies just type ```make```
 
 - to run local server on port 8000 run command:
``` 
   make run
```
 - to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to node.js REPL functionality. All modules are accessible from the command line.
```
   $ make shell

   > core.version
    '2013.10.20.0'
   > logger.setDebug(2)
```
## Backend configuration

 The backend directory structure is the following:

 - data/ - root directory for the backend
   - etc
      - config - config parameters, same as specified in the command line but without leading -, each config parameter per line:
        Example:
        - debug=1
        - db-pool=ddb
        - db-ddb-pool=http://localhost:9000
        - db-pg-pool=postgresql://postgres@127.0.0.1/backend

      - crontab - jobs to be run with intervals, local or remote, JSON file with a list of cron jobs objects:
        Example:

           [ { "type": "local", "cron": "0 0 0,8 * * *", "job": "reports.create" },
             { "type": "remote", "cron": "0 1 1 * * 1,3", "args": { "-log": "debug" }, "job": { "scraper.run": { "url": "http://www.site.com" } } } ]


   - images - all images to be served by the API server
     - account - account images
     - message - message icons
   - var - runtime files and db files
     - backend.db - generic sqlite database, always created and opened by the backend
   - tmp - temporary files
   - web - public files to be served by the web servers

## The backend utility: rc.backend

  The purpose of the rc.backend shell script is to act as a helper tool in configuring and managing the backend environment
  and as well to be used in operations on production systems.


  The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed. In addition
  it supports symlinks with different name and uses it as a command to execute, for example:
```
  ln -s rc.backend ntp
  ./ntp is now the same as rc.backend ntp
```

  Running without arguments will bring help screen with description of all available commands.
  To make configuration management flexible the utility supports several config files which are read during execution for additional environment variables.

  
  By default the utility is configured to be used on live Linux sytems in production without any config files, the default backend root directory is /data.
  Under this root are all required directories required by the backend code and described above.


  For development purposes and to be able to use the backend in regular user home directories the utility is trying to read the following config files:
  
    /etc/backend/profile
    $ROOT/etc/profile
    $HOME/.backendrc
    .backendrc


  The required environment variables required by the tool are (with default values):
  
    PREFIX=/usr/local
    ROOT=/data
    DOMAIN=localhost


  Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory.


# Author
  Vlad Seryakov

