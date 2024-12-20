#!/bin/bash

exec node app.js -api -watch $(pwd) -web -log debug -etc-dir $(pwd)/etc -web-path $(pwd)/web -modules-path $(pwd)/modules $@

