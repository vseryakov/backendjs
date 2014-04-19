#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

all:
	./rc.backend build-backend

force:
	./rc.backend build-backend --backend_deps_force

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

pages:
	git-new-workdir `pwd` ./pages gh-pages

doc:
	node doc.js > web/doc.html
	-git commit -a -m "Updated docs, minor bugfixes" && git push
	-if [ -d pages ]; then cp web/doc.html pages/index.html; fi
	-if [ -d pages ]; then cd pages && git commit -a -m docs; fi
	-if [ -d pages ]; then cd pages && git push; fi

