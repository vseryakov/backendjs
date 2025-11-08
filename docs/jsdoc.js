// BigInt JSON serialization.
BigInt.prototype.toJSON = function() {
	return this.toString() + 'n';
}

module.exports = {
    plugins: ['plugins/markdown'],
    source: {
        include: [ "lib" ],
        includePattern: ".+\\.js(doc|x)?$",
        excludePattern: "(^|\\/|\\\\)_"
    },
    templates: {
        default: {
          includeDate: false,
          outputSourceFiles: false
        }
    },
    opts: {
        template: "node_modules/docdash",
        destination: "./docs/web",
        recurse: true,
        readme: "README.md",
        tutorials: "docs/src"
    },
    docdash: {
        search: true,
        collapse: true,
        typedefs: true,
    }
};
