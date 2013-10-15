# Backend for node.js

## Installation

  Default settings are to be run on Linux instance with /data as the root for
  backend config and all other files

 - run bin/rc.backend init-backend to initialize environment for the backend development

 - install node.js and required modules with command bin/rc.backend build-dev

 - run make to compile the binary module

## Configuration

 - etc/config may contain any config parameter, same as specified in the command line

## Running for development

 - make run 
   will run on port 8000

 - make repl
   start command line shell with the backend loaded and confidured, in the shell all 
   available command and functions can be directly executed

# Author
  Vlad Seryakov

