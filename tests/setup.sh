#!/bin/sh

bksh -db-create-tables -app-config tests/bkjs.conf -app-roles dbqueue -queue-dbqueue db://

nats stream add --subjects 'nats,nats@*' --defaults nats
