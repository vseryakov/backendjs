#
#  Author: Vlad Seryakov vseryakov@gmail.com
#  Sep 2013
#

pages:
	git-new-workdir backendjs bkjs-pages gh-pages

doc:
	(cd ../backendjs && npm run doc)
	cp ../backendjs/web/doc.html .
	git commit -a -m docs && git push

