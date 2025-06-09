//
// Legacy Konckout component
//

app.koRegister("kotest");
app.templates.kotest = `<div class="py-3 border">Registered custom tag: <span data-bind="text:$parent.query"></span></div>`;

app.templates.config3 = "#config3";
app.components.config3 = class extends app.KoComponent {

    onCreate(params) {
        this.rows = [];
        this.types = ko.observableArray();

        this.query = ko.observable("");
        this.subscribe(this.query, 500, this.filter.bind(this));
        this.refreshed = ko.observable();

        this.show();
    }

    onPrepareDelete(event) {
        console.log("prepareDelete:", this.$_id, this.refreshed())
        if (!this.refreshed()) {
            this.refreshed("(click Close again)");
            event.stop = 1;
        }
    }

    close() {
        app.render({ name: "index", render: "ko" })
    }

    edit() {
        app.showAlert("error", "no edit in this mode")
    }

    filter() {
        var list = this.rows, q = this.query();
        if (q) list = this.rows.filter((x) => (x.type.includes(q) || x.name.includes(q) || x.value.includes(q)));
        list.sort((a,b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : app.toNumber(a.sort) - app.toNumber(b.sort) || (a.ctime - b.ctime)));

        var types = {};
        list.forEach((x) => {
            x.icon = x.status == "ok" ? "fa-check" : "fa-ban";
            x.text = x.name + " = " + app.textToXml(x.value);
            x.mtime = x.mtime ? app.strftime(x.mtime, "%m/%d/%Y %I:%M:%S %p") : "";
            x.stime = x.stime ? app.strftime(x.stime, "%m/%d/%Y %I:%M %p %z") : "";
            x.etime = x.etime ? app.strftime(x.etime, "%m/%d/%Y %I:%M %p %z") : "";
            if (!types[x.type]) types[x.type] = [];
            types[x.type].push(x);
        });
        this.types(Object.keys(types).map(x => ({ type: x, rows: types[x], q })));
    }

    show() {
        app.send({ url: '/data/scan/bk_config', data: { _count: 1000 }, self: this }, (rc) => {
            this.rows = app.isArray(rc.data, []);
            this.filter();
        });
    }


}
