#!/bin/sh

bksh -db-create-tables -app-config tests/bkjs.conf -app-roles ${1:-sqlite},users,dbqueue -queue-dbqueue db:// -db-config ${1:-sqlite} -app-no-dbconf

bksh -app-config tests/bkjs.conf -app-roles ${1:-sqlite},users -user-add login test name test secret test roles test
bksh -app-config tests/bkjs.conf -app-roles ${1:-sqlite},users -user-add login admin name admin secret admin roles admin
bksh -app-config tests/bkjs.conf -app-roles ${1:-sqlite},users -user-add-token type api name api roles api id 00000000000000000000000000000000

nats stream add --subjects 'nats,nats.*' --defaults nats
