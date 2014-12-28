#!/bin/bash

exec node app.js -watch `pwd` -web -debug -etc-dir `pwd`/etc -web-dir `pwd`/web -spool-dir `pwd`/var $@

