# Backend for node.js

## Installation

 - node.js must be installed

 - npm install async emailjs generic-pool printf express

 - init the envronemnt 
   - run bin/rc.backend init-env for the backend development

   - or

   - run bin/rc.backend init-dev for application developen using the backend

 - run make to comple the binary module

## Configuration

 - etc/config may contain any config parameter, same as specified in the command line

## Platforms

 - Linux

   Default settings are to be run on Linux instance with /data as the root for
   backend config and all other files

 - Mac OS X

   To configure for local development .backendrc file must be created with the following:
   ROOT=./data
   PREFIX=/opt/local
   PG_PREFIX=$PREFIX/lib/postgresql93
   PG_DIR=$PREFIX/var/db/postgres

## Running

 - make run 
   will run on port 8000

 - make repl
   start command line shell with the backend loaded and confidured, in the shell all 
   available command and functions can be directly executed

# Author
  Vlad Seryakov

