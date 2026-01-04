
app.components.config = class extends app.AlpineComponent {

    rows = [];
    types = [];
    query = "";

    onCreate() {
        this.show();

        app.$("input", this.$el)?.focus();
    }

    refresh() {
        this.show();
    }

    async close() {
        await app.afetch("/logout", { post: 1 });
        app.user.id = "";
        app.render("index")
    }

    filter() {
        var list = this.rows, q = this.query;
        if (q) list = this.rows.filter((x) => (x.type.includes(q) || x.name.includes(q) || x.value.includes(q)));
        list.sort((a,b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : parseInt(a.sort) - parseInt(b.sort) || (a.ctime - b.ctime)));

        var types = {};
        list.forEach((x) => {
            x.icon = x.status == "ok" ? "fa-check" : "fa-ban";
            x.text = x.name + " = " + x.value;
            if (!types[x.type]) types[x.type] = [];
            types[x.type].push(x);
        });
        return Object.keys(types).map(x => ({ type: x, rows: types[x], q }));
    }

    async show() {
        const { err, data } = await app.afetch('/config/list')
        if (err) return app.emit("alert", "error", err);
        this.rows = data.data;
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
                app.fetch({ url: `/config/${d.ctime ? "update" : "put"}`, body: d, method: d.ctime ? "PUT" : "POST" }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },

            Copy: async (d) => {
                app.fetch({ url: '/config/put', body: d, post: 1 }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },

            Delete: (d) => {
                bootpopup.confirm("Delete this parameter?", () => {
                    app.fetch({ url: '/config/del', body: { ctime: data?.ctime, name: data?.name }, post: 1 }, (err) => {
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
