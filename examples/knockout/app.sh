#!/bin/bash

exec ../../bkjs run -api -watch $(pwd) -etc-dir $(pwd)/etc -web-path ~~$(pwd)/web -modules-path ~~$(pwd)/modules $@

