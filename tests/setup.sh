#!/bin/sh

bksh -db-create-tables -app-config tests/bkjs.conf -app-roles dbqueue,sqlite -queue-dbqueue db://

nats stream add --subjects 'nats,nats.*' --defaults nats
