# Backend for node.js

## Installation

  Default settings are to be run on Linux instance with /data as the root for
  backend config and all other files
  
## Development environment (Mac OS X)  

 - git clone https://vseryakov@bitbucket.org/vseryakov/backend.git
 
 - cd backend
 
 - to install node.js and required modules if it i snot installed
   - bin/rc.backend build-dev

 - to initialize environment for the backend development
   - bin/rc.backend init-backend
   
 - to compile the binary module
   - make

 - to run local server on port 8000
   - make run
 
 - to start the backend in command line mode, the backend environment is prepared and initialized including all database pools. 
   This command line access allows to test and run all functions from all modules of the backend without running full server 
   similar to node.js REPL functionality. All modules are accessible from the command line.
   - make repl
     > core.version
     '2013.10.20.0'
     > logger.setDebug(2)
     
## Configuration

 The backend directory structure is the following:
 
 - data/ - root directory for the backend
   - etc 
     - config - config parameters, same as specified in the command line but without leading -, each config parameter per line:
       Example:
         debug=1
         api-pool=ddb
         db-ddb-pool=http://localhost:9000
         db-pg-pool=postgresql://postgres@127.0.0.1/backend
     - crontab - jobs to be run with intervals, local or remote, JSON file with a list of cron jobs objects:
         Example:
           [ { "type": "local", "cron": "0 0 0,8 * * *", "job": "reports.create" },
             { "type": "remote", "cron": "0 1 1 * * 1,3", "args": { "-log": "debug" }, "job": { "scraper.run": { "url": "http://www.site.com" } } } ]
   - images - all images to be served by the API server
     - account - account specific images
   - var - runtime files and db files
     - backend.db - common sqlite database, always created and opened by the backend
   - tmp - temporary files
   - web - public files to be served by the web servers  

# Author
  Vlad Seryakov

