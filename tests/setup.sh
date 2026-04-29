#!/bin/sh

bksh -db-create-tables -app-config tests/bkjs.conf -app-roles ${1:-sqlite},dbqueue -queue-dbqueue db:// -db-config ${1:-sqlite} -app-no-dbconf

nats stream add --subjects 'nats,nats.*' --defaults nats
