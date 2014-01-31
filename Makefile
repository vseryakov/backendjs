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

test-db:
	for d in sqlite pgsql mysql dynamodb cassandra; do node tests.js -cmd db -db-pool $$d -log log; done

doc:
	node doc.js > web/doc.html
