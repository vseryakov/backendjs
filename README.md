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
 
     npm install node-backend

  
## Quick start

* Run default backend without any custom extensions, by default it will use embedded Sqlite database and listen on port 8000

     rc.backend run-backend
     
* Now go to http://localhost:8000/api.html for the Web console to test API requests, cancel for login prompt on the first call.
  For this example let's create couple of accounts, type and execute the following URLs in the Web console
  
     /account/add?name=test1&secret=test1&email=test1@test.com
     /account/add?name=test2&secret=test2&email=test2@test.com
     /account/add?name=test3&secret=test3&email=test3@test.com

* Now login with any of the accounts, click on the Login link at the top right corner of the Web console.
  If not error messages appeared after login, try to get your current account details:
  
     /account/get
     
* To see all public fields for accounts just execute

     /account/search

* To make custom server just create file main.js with the following contents:

        var backend = require('backend');

        // Add more properties/columns to the base account table which we need to keep for our social site
        backend.api.registerTables({ account: { 
                                        facebook_id: { type: "int", pub: 1 } 
                                   } 
        });

        // Customize the API server with additional tables, endpoints or other features
        backend.api.onInit = function() {

            // Register custom API endpoint, return FB status 
            this.app.get('/fbstatus', function(req, res) { 
                
                // Retrieve our current account record, req.account contains our authenticated account id
                backend.db.get("account", { id: req.account.id }, function(err, rows) {
                
                    // Ask Facebook about us
                    var url = "https://graph.facebook.com/" + rows[0].facebook_id;
                    backend.core.httpGet(url, function(err, params) {
                        res.json(params.data);
                    })
                }); 
            });
        };
        // Start the server
        backend.server.start();

* Run the file now directly:

     node main.js -port 8000 -web -console

* Lets update our Facebook id

     /account/update?facebook_id=5
     
* Go to http://localhost:8000/fbstatus to see what Facebook tels about this user

## API endpoints provided by the backend

### Accounts
### Connections
### Locations
### Messages
### Icons
### Counters
### History

## Backend configuration and directory structure

When the backend server starts and no -home argument passed in the command line the backend setups required 
environment in the ~/.backend directory.
 
The backend directory structure is the following:

* etc/config - config parameters, same as specified in the command line but without leading -, each config parameter per line:
  Example:

        debug=1
        db-pool=ddb
        db-ddb-pool=http://localhost:9000
        db-pg-pool=postgresql://postgres@127.0.0.1/backend


* etc/crontab - jobs to be run with intervals, local or remote, JSON file with a list of cron jobs objects:
  Example:

         [ { "type": "local", "cron": "0 0 0,8 * * *", "job": "reports.create" },
           { "type": "remote", "cron": "0 1 1 * * 1,3", "args": { "-log": "debug" }, "job": { "scraper.run": { "url": "http://www.site.com" } } } ]


* etc/proxy - HTTP proxy config file, same format as in http-proxy npm package
  Example:
        
        { "target" : { "host": "localhost", "port": 8001 } }
            
* etc/profile - shell script loaded by the rc.backend utility to customize env variables  
            
* images - all images to be served by the API server, every subfolder represent naming space with lots of subfolders for images
* var - database files created by the server
* tmp - temporary files

## The backend provisioning utility: rc.backend

The purpose of the rc.backend shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems.
Running without arguments will bring help screen with description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed. In addition
it supports symlinks with different name and uses it as a command to execute, for example:

     ln -s rc.backend ntp
     ./ntp is now the same as rc.backend ntp

On startup the rc.backend tries to load and source the following config files:
  
      /data/etc/profile
      /etc/backend.profile
      /usr/local/etc/backend.profile
      $HOME/.backend/etc/profile

Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory or 
customize the running environment, these should be regular shell scripts using bash syntax.

# Backend framework development (Mac OS X, developers only)

* git clone https://[your username]@bitbucket.org/vseryakov/backend.git
* SSH alternative so you don't have to constantly enter your BitBucket password: git clone git@bitbucket.org:vseryakov/backend.git
* cd backend
* to initialize environment for the backend development it needs to set permissions for $PREFIX(default is /opt/local)
   to the current user, this is required to support global NPM modules. 

* If $PREFIX needs to be changed, create ~/.backend/etc/config file and assign PREFIX=path, for example:

     echo "PREFIX=$HOME/local" > .backendrc
   

* __Important__: Add NODE_PATH=$PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
   node can find global modules, replace $PREFIX with the actual path unless this variable is also set in the .profile
     
* now run the init command to prepare the environment, bin/rc.backend will source .backendrc

     rc.backend init-backend


* to install node.js in $PREFIX/bin if not installed already run command:

     rc.backend build-node


- if node.js is installed, make sure all required modules are installed, thi sis required because we did not installed the 
  backend via npm with all dependencies:

     rc.backend npm-deps
 

* If you would like to be able to generate documentation with `make doc`, you will need to install the Docco module:

     npm install -g docco

   
* to compile the binary module and all required dependencies just type ```make```
 
* to run local server on port 8000 run command:
 
     make run

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to node.js REPL functionality. All modules are accessible from the command line.

     $ make shell

     > core.version
      '2013.10.20.0'
     > logger.setDebug(2)


# Author
  Vlad Seryakov

