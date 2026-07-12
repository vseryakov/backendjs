// BigInt JSON serialization.
BigInt.prototype.toJSON = function() {
	return this.toString() + 'n';
}

module.exports = {
    plugins: ['plugins/markdown'],
    source: {
        include: [ "lib", "dist/image.js", "dist/color.js", "dist/webscraper.js", "dist/logwatcher.js" ],
        includePattern: ".+\\.js(doc|x)?$",
        excludePattern: "(^|\\/|\\\\)_"
    },
    templates: {
        default: {
          includeDate: false,
          outputSourceFiles: true
        }
    },
    opts: {
        template: "node_modules/dashjsdoc",
        destination: "./docs/web",
        recurse: true,
        readme: "README.md",
        tutorials: "docs/src"
    },
    markdown: {
        idInHeadings: true,
    },
    docdash: {
        sort: true,
        search: true,
        collapse: true,
        typedefs: true,
        meta: {
            title: "Backendjs Documentation",
            description: "A Node.js library to create Web backends with minimal dependencies.",
        },
        tutorialsOrder: ["start", "modules", "reference", "bkjs"]
    }
};
