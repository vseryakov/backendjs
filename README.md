# Backend for node.js

## Installation

  Default settings are to be run on Linux instance with /data as the root for
  backend config and all other files
  
## Development environment (Mac OS X)  

 - git clone https://vseryakov@bitbucket.org/vseryakov/backend.git
 - cd backend
 - to initialize environment for the backend development run  
    command:
   
        bin/rc.backend init-backend
   
 - to install node.js and required software run  
    command:
   
        bin/rc.backend build-src


    it will create src/ in the current directory and install the following packages:
     - node.js in $PREFIX/bin
     - npm modules in $PREFIX/lib/node
     - nanomsg library in $PREFIX/lib
     - leveldb library in $PREFIX/lib
     - ImageMagick in $PREFIX/lib
     
     By default $PREFIX point to /opt/local, it can be changed in .backendrc file
     
 - to compile the binary module just type ```make```
 - to run local server on port 8000 run  
    command:
   
        make run
 
 - to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.   
   This command line access allows you to test and run all functions from all modules of the backend without running full server 
   similar to node.js REPL functionality. All modules are accessible from the command line.
   
       $ make repl
   
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

## The backend utility: rc.backend

  The purpose of the rc.backend shell script is to act as a helper tool in configuring and managing the backend environment 
  and as well to be used in operations on production systems.  
  
  The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed. In addition
  it supports symlinks with different name and uses it as a command to execute, for example:
  
        ln -s rc.backend ntp
        ./ntp is now the same as rc.backend ntp
        
  Running without arguments will bring help screen with description of all available commands. 
  To make configuration management flexible the utility supports several config files which are read during execution for additional environment variables.  
  By default the utility is configured to be used on live Linux sytems in production without any config files, the default backend root directory is /data.
  Under this root are all required directories required by the backend code and described above. 
   
  For development purposes and to be able to use the backend in regular user home directories the utility is trying to read the following config files:  
    - /etc/backend/profile
    - $ROOT/etc/profile
    - $HOME/.backendrc
    - .backendrc
  
  The required environment variables required by the tool are (with default values): 
   - PREFIX=/usr/local
   - ROOT=/data
   - DOMAIN=localhost

  Any of the following config files can redefine any environmnt variable thus pointing to the correct backend environment directory.
  
  
# Author
  Vlad Seryakov

