#!/bin/bash

exec node app.js -watch $(pwd) -web -log debug -etc-dir $(pwd)/etc -web-dir $(pwd)/web -modules-dir $(pwd)/modules $@

