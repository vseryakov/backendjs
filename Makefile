#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

TEST=db

run:
	./bkjs run-backend

shell:
	./bkjs run-shell

tests:
	for d in sqlite pgsql mysql dynamodb mongodb cassandra redis lmdb leveldb; do (node tests.js -test-cmd $(TEST) -db-pool $$d -log log); done

pages:
	git-new-workdir `pwd` ./pages gh-pages

publish:
	npm pack
	npm publish `ls backendjs-*tgz`
	rm -rf backendjs*tgz

start-servers:
	-bkjs run-pgsql
	-bkjs run-dynamodb
	-bkjs run-mongodb
	-bkjs run-cassandra
	-bkjs run-mysql
	-redis-server /opt/local/etc/redis.conf
	-memcached -d -L

stop-servers:
	-bkjs stop-pgsql
	-bkjs stop-dynamodb
	-bkjs stop-mongodb
	-bkjs stop-cassandra
	-bkjs stop-mysql
	killall redis-server
	killall memcached

doc:
	node doc.js > web/doc.html
	-git commit -a -m "Updated docs, minor bugfixes"
	-git push
	-if [ -d pages ]; then cp bkjs pages; fi
	-if [ -d pages ]; then cp web/doc.html pages/; fi
	-if [ -d pages ]; then cd pages && git commit -a -m docs && git push; fi
	-if [ -d pages/site ]; then cp bkjs pages/site; fi
	-if [ -d pages/site ]; then cd pages/site && git commit -a -m updates && git push; fi

