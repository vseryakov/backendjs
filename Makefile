#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

all: 
	bin/rc.backend build-backend

run:
	bin/rc.backend run-dev

put:
	bin/rc.backend put

repl:
	bin/rc.backend repl

clean:
	bin/rc.backend clean-dev
	
