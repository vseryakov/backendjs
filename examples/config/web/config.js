
app.components.config = class extends app.AlpineComponent {

    list = [];
    rows = [];
    types = [];
    query = "";

    onCreate() {
        this.show();

        app.$("input", this.$el)?.focus();

        this.$watch("query", () => {
            this.list = this.filter();
        });
    }

    refresh() {
        this.show();
    }

    async close() {
        await app.afetch("/logout", { post: 1 });
        app.user.id = "";
        app.render("index")
    }

    collapse(o) {
        this.list.forEach(x => { x.o = o })
    }

    filter() {
        var list = this.rows, q = this.query;
        if (q) {
            list = this.rows.filter((x) => (x.type.includes(q) || x.name.includes(q) || x.value.includes(q)));
        }
        list.sort((a,b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : parseInt(a.sort) - parseInt(b.sort) || (a.ctime - b.ctime)));

        var open = this.list.reduce((a, b) => { a[b.type] = b.o; return a }, {});

        var types = Object.groupBy(list, (x) => {
            x.icon = x.status == "ok" ? "fa-check" : "fa-ban";
            x.text = x.name + " = " + x.value;
            return x.type;
        });
        var keys = Object.keys(types);
        return keys.map((x, i) => ({ type: x, rows: types[x], q, o: open[x] || (q && types[x]?.length) || 0, e: i == keys.length - 1 }));
    }

    async show() {
        const { err, data } = await app.afetch('/config/list')
        if (err) return app.emit("alert", "error", err);
        this.rows = data.data;
        this.list = this.filter();
    }

    edit(data) {
        var popup;
        popup = bootpopup({
            title: "Config Details",
            horizontal: 1,
            backdrop: false,
            keyboard: false,
            alert: 1,
            empty: 1,
            class_content: "modal-content border-3 border-blue bg-light",
            content: [
                { input: { name: "type", label: "Type:", value: data?.type } },
                { input: { name: "name", label: "Name:", value: data?.name, } },
                { textarea: { name: "value", class: "form-control", label: "Value:", rows: 5, value: data?.value } },
            ],
            buttons: ["cancel", "Save", data?.name && "Copy", data?.name && "Delete"],

            Save: (d) => {
                if (!d.type || !d.name || !d.value) return popup.showAlert("Type, name and value are required");
                d.ctime = data?.ctime;
                app.fetch(`/config/${d.ctime ? "update" : "put"}`, { body: d, method: d.ctime ? "PUT" : "POST" }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },

            Copy: async (d) => {
                app.fetch('/config/put', { body: d, post: 1 }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },

            Delete: (d) => {
                bootpopup.confirm("Delete this parameter?", () => {
                    app.fetch('/config/del', { body: { ctime: data?.ctime, name: data?.name }, post: 1 }, (err) => {
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
