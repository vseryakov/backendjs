#!/bin/bash

exec bkjs web -watch `pwd` -log debug -etc-dir `pwd`/etc -web-path `pwd`/web $@

