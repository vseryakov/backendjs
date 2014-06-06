#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

TEST=db

all:
	npm build . 

force:
	npm build . --backend_nanomsg --backend_imagemagick

run:
	./bkjs run-backend

shell:
	./bkjs run-shell

clean:
	./bkjs clean-backend

distclean: clean
	./bkjs clean-deps

tests:
	for d in sqlite pgsql mysql dynamodb mongodb cassandra redis lmdb leveldb; do (node tests.js -test-cmd $(TEST) -db-pool $$d -log log); done

pages:
	git-new-workdir `pwd` ./pages gh-pages

publish:
	npm pack
	npm publish `ls backendjs-*tgz`
	rm -rf backendjs*tgz

doc:
	node doc.js > web/doc.html
	-git commit -a -m "Updated docs, minor bugfixes" && git push
	-if [ -d pages ]; then cp web/doc.html pages/index.html; fi
	-if [ -d pages ]; then cd pages && git commit -a -m docs; fi
	-if [ -d pages ]; then cd pages && git push; fi

