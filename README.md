# Backend framework for node.js

General purpose backend framework.

Features:

* Exposes a set of Web service APIs over HTTP(S) using Express framework.
* Supports Sqlite, PostgreSQL, DynamoDB, Cassandra databases, easily extendable to support any kind of database.
* Provides accounts, connections, locations, messaging and icons APIs with basic functionality for a qucik start.
* Supports crontab-like and on-demand scheduling for local and remote(AWS) jobs.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Runs web server as separate processes to utilize multiple CPU cores.
* Supports several cache modes(Redis, memcached, local cache) for the database operations.
* Supports common database operations (Get, Put, Del, Update, Select) for all databases using the same DB API. 
* ImageMagick is compiled as C++ module for in-process image scaling.
* nanomsg interface for messaging between processes and servers.
* REPL(command line) interface for debugging and looking into server internals.
* Geohash based location searches supported by all databases drivers.

# Installation

        npm install node-backend

  
# Quick start

* Run default backend without any custom extensions, by default it will use embedded Sqlite database and listen on port 8000

        rc.backend run-backend
       
     
* Now go to http://localhost:8000/api.html for the Web console to test API requests, cancel the login popup after the
  page is loaded, we do not have yet any account credentials.
  For this example let's create couple of accounts, type and execute the following URLs in the Web console
  
        /account/add?name=test1&secret=test1&email=test1@test.com
        /account/add?name=test2&secret=test2&email=test2@test.com
        /account/add?name=test3&secret=test3&email=test3@test.com
      

* Now login with any of the accounts above, refresh the api.html and enter email and secret in the login popup dialog.
* If no error message appeared after the login, try to get your current account details:
  
        /account/get
      
     
* To see all public fields for accounts just execute

        /account/search
      
* Shutdown the backend by pressing Ctrl-C
* To make custom Web app run the following command:

        rc.backend init-app

* By default app.js file is created with 2 additional API endpoints /test/add and /test/[0-9] to show the simplest way
  of adding new tables and API commands.
* Run new application now:

        rc.backend run-app
      
 
* Go to http://localhost:8000/api.html and issue /test/add?id=1&name=1 and then /test/1 commands in the console to see it in action

      
# API endpoints provided by the backend

## Security
All requests to the API server must be signed with account email/secret pair. 

- The algorithm how to sign HTTP requests (Version 1, 2):
    * Split url to path and query parameters with "?"
    * Split query parameters with "&"
    * '''ignore parameters with empty names'''
    * '''Sort''' list of parameters alphabetically
    * Join sorted list of parameters with "&"
    * Form canonical string to be signed as the following:
        - Line1: The HTTP method(GET), followed by a newline.
        - Line2: the host, followed by a newline.
        - Line3: The request URI (/), followed by a newline.
        - Line4: The sorted and joined query parameters as one string, followed by a newline.
        - Line5: The expires value or empty string, followed by a newline.
        - Line6: The checksum or empty string, followed by a newline.
    * Computed HMAC-SHA1 digest from the canonical string and encode it as BASE64 string, preserve trailing = if any
    * Form B-Signature HTTP header as the following:
        - The header string consist of multiple fields separated by pipe |
            - Field1: Signature version, 1,2,3,4, the difference is what kind of secret is used for signing the canonical string:
              for version 1, the original secret is used, for version 2 the the secret is HMAC-SHA1 digest calculated from email using the original secret
            - Field2: Application version or other ap specific data
            - Field3: account email
            - Field4: HMAC-SHA1 digest from the canonical string
            - Field5: expiration value in milliseconds or empty string
            - Field6: checksum or empty string
            - Field7: empty, reserved for future use

The resulting signature is sent as HTTP header b-signature: string
See web/js/backend.js for function Backend.sign or core.js function signRequest for the Javascript implementation.
      
## Accounts
## Connections
## Locations
## Messages
## Icons
## Counters
## History

# Backend configuration and directory structure

When the backend server starts and no -home argument passed in the command line the backend setups required 
environment in the ~/.backend directory.
 
The backend directory structure is the following:

* etc/config - config parameters, same as specified in the command line but without leading -, each config parameter per line:
  Example:

        debug=1
        db-pool=dynamodb
        db-dynamodb-pool=http://localhost:9000
        db-pgsql-pool=postgresql://postgres@127.0.0.1/backend


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

# The backend provisioning utility: rc.backend

The purpose of the rc.backend shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems.
Running without arguments will bring help screen with description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed. In addition
it supports symlinks with different name and uses it as a command to execute, for example:

        ln -s rc.backend ntp
        ./ntp is now the same as rc.backend ntp


On startup the rc.backend tries to load and source the following config files:
  
        /data/etc/profile
        /etc/backendrc
        /usr/local/etc/backendrc
        $HOME/.backend/etc/profile
        $HOME/.backencrc


Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory or 
customize the running environment, these should be regular shell scripts using bash syntax.

# Backend framework development (Mac OS X, developers only)

* git clone https://[your username]@bitbucket.org/vseryakov/backend.git
* SSH alternative so you don't have to constantly enter your BitBucket password: git clone git@bitbucket.org:vseryakov/backend.git
* cd backend
* to initialize environment for the backend development it needs to set permissions for $PREFIX(default is /opt/local)
  to the current user, this is required to support global NPM modules. 

* If $PREFIX needs to be changed, create ~/.backend/etc/profile file and assign PREFIX=path, for example:

        echo "PREFIX=$HOME/local" > ~/.backendrc
   

* **Important**: Add NODE_PATH=$PREFIX/lib/node_modules to your environment in .profile or .bash_profile so
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

