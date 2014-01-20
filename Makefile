#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

all:
	./rc.backend build-backend

run:
	./rc.backend run-backend

put:
	./rc.backend put-backend

shell:
	./rc.backend run-shell

clean:
	./rc.backend clean-backend

doc:
	docco *.js
