#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

TEST=db

run:
	./bkjs run-backend

shell:
	./bkjs run-shell

pages:
	git-new-workdir `pwd` ./pages gh-pages

publish:
	npm pack
	npm publish `ls backendjs-*tgz`
	rm -rf backendjs*tgz

doc:
	node doc.js > web/doc.html
	-git commit -a -m "Updated docs, minor bugfixes"
	-git push
	-if [ -d pages ]; then cp bkjs pages; fi
	-if [ -d pages ]; then cp web/doc.html pages/; fi
	-if [ -d pages ]; then cd pages && git commit -a -m docs && git push; fi
	-if [ -d pages/site ]; then cp bkjs pages/site; fi
	-if [ -d pages/site ]; then cd pages/site && git commit -a -m updates && git push; fi

