#!/bin/sh

bksh -db-create-tables -app-config tests/bkjs.conf -app-roles ${1:-sqlite},dbqueue -queue-dbqueue db:// -db-config ${1:-sqlite} -app-no-dbconf

bksh -app-roles users -user-add login test name test secret test

nats stream add --subjects 'nats,nats.*' --defaults nats
