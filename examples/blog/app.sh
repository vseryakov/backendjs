#!/bin/bash

exec /opt/local/bin/node app.js -watch `pwd` -web -debug -etc-dir `pwd`/etc -web-dir `pwd`/web $@

