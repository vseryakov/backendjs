/*!
 *  bkjs client
 *  Vlad Seryakov vseryakov@gmail.com 2024
 */

app.debug = 1;

app.templates.empty = `<div class="py-3 border">Empty</div>`;

app.templates.test = `<div class="py-3 border">Rendering just text templates: <span x-text=template></span> <span x-text=title></span></div>`;

app.components.index = class extends app.AlpineComponent {
    title = "Index"
    toggle() {
        this.template = !this.template ? "config" : this.template == "config" ? "empty" : "";
    }
};

app.components.config = class Config extends app.AlpineComponent {

    visible = true;
    title = "System Config";
    rows = [];
    types = [];
    query = "";
    refreshed = "";

    onCreate() {
        console.log("create", this.$_id, this.params.param)

        if (app.$param("quiet")) this.params.$nohistory = 1;

        this.query = this.params.param;

        this.show();

        app.$("input", this.$el).focus();
    }

    onDelete() {
        console.log("delete", this.$_id)
    }

    beforeDelete() {
        console.log("beforeDelete:", this.params.$nohistory, this.refreshed)
        if (!this.params.$nohistory && !this.refreshed) {
            this.refreshed = "(click Close again)";
            return false;
        }
    }

    onEvent(name, data) {
        console.log("event:", this.$_id, name, data)
    }

    onRefreshed(name, data) {
        console.log("refreshed:", this.$_id, name, data, this.refreshed)
        this.refreshed = "(refreshed)";
    }

    refresh() {
        app.emit("component:event", "refreshed")
    }

    close() {
        if (this.params.$nohistory) return app.render("none?$target=#section")
        app.render("index")
    }

    filter() {
        var list = this.rows, q = this.query;
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
        return Object.keys(types).map(x => ({ type: x, rows: types[x], q }));
    }

    show() {
        app.send({ url: '/data/scan/bk_config', data: { _count: 1000 } }, (rc) => {
            this.rows = app.isArray(rc.data, []);
        });
    }

    edit(data) {
        var popup;
        popup = bootpopup({
            self: this,
            data: this,
            title: "Config Details",
            horizontal: 1,
            backdrop: false,
            keyboard: false,
            alert: 1,
            empty: 1,
            size: "xlarge",
            size_label: "col-sm-3",
            size_input: "col-sm-9",
            class_content: "modal-content border-3 border-blue bg-light min-vh-70",
            content: [
                { input: { name: "type", label: "Type:", value: data.type } },
                { input: { name: "name", label: "Name:", value: data.name, } },
                { textarea: { name: "value", class: "form-control", label: "Value:", rows: 5, value: app.textToXml(data.value) } },
            ],
            buttons: ["cancel", "Save", data.name && "Copy", data.name && "Delete"],
            Save: function(d) {
                d.value = app.unicode2Ascii(d.value, "qs");
                if (!d.type || !d.name || !d.value) return popup.showAlert("Type, name and value are required");
                d.ctime = data.ctime;
                app.sendRequest({ url: `/data/${d.ctime ? "update" : "put"}/bk_config`, data: d, self: this }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },
            Copy: function(d) {
                app.sendRequest({ url: '/data/put/bk_config', data: d, self: this }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },
            Delete: function(d) {
                app.showConfirm.call(this, "Delete this parameter?", () => {
                    app.sendRequest({ url: '/data/del/bk_config', data: { ctime: data.ctime, name: data.name }, self: this }, (err) => {
                        if (err) return popup.showAlert(err);
                        this.show();
                        popup.close();
                    });
                });
                return null;
            },
        });
    }
}


app.templates.config2 = "#config";
app.components.config2 = class extends app.components.config {

    title = "System Config2"

    onCreate() {
        super.onCreate();
        console.log("init2", this.$_id)

        this.show();
    }

    onRefreshed(name, data) {
        console.log("refreshed2:", this.$_id, name, data, this.refreshed)
        this.refreshed = "(refreshed2)";
    }
}

app.koReg("kotest");
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

    beforeDelete() {
        console.log("beforeDestroy:", this.$_id, this.refreshed())
        if (!this.refreshed()) {
            this.refreshed("(click Close again)");
            return false;
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

app.$ready(() => {
    app.setColorScheme();
    ko.applyBindings(app);
    app.restorePath();
});

