#!/bin/bash

exec node app.js -watch $(pwd) -watch $(pwd)/modules -web -log debug -etc-dir $(pwd)/etc -web-dir $(pwd)/web -views-dir $(pwd)/views -modules-dir $(pwd)/modules $@

