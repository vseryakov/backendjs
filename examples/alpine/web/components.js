/*!
 *  bkjs client
 *  Vlad Seryakov vseryakov@gmail.com 2024
 */

bkjs.debug = 1;

bkjs.templates.test = `<div class="py-3 border">Rendering just text templates</div>`;

bkjs.components.index = class Index extends bkjs.AlpineComponent {
    toggle() {
        this.template = !this.template ? "config" : this.template == "config" ? "test" : "";
    }
};

bkjs.components.config = class Config extends bkjs.AlpineComponent {

    visible = true;
    title = "System Config";
    rows = [];
    types = [];
    query = "";
    refreshed = "";

    onInit() {
        console.log("init", this.$key)

        this.show();
    }

    onDestroy() {
        console.log("destroy", this.$key)
    }

    canDestroy() {
        console.log("beforeDestroy:", this.params.$nohistory, this.refreshed)
        if (!this.params.$nohistory && !this.refreshed) {
            this.refreshed = "(click Refresh)";
            return false;
        }
    }

    onEvent(name, data) {
        console.log("event:", this.$key, name, data)
    }

    onRefreshed(name, data) {
        console.log("refreshed:", this.$key, name, data, this.refreshed)
        this.refreshed = "(refreshed)";
    }

    refresh() {
        bkjs.emit("component:event", "refreshed")
    }

    close() {
        if (this.params.$nohistory) return this.$show("none", { $target: "#section" })
        this.$render("index")
    }

    filter() {
        var list = this.rows, q = this.query;
        if (q) list = this.rows.filter((x) => (x.type.includes(q) || x.name.includes(q) || x.value.includes(q)));
        list.sort((a,b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : bkjs.toNumber(a.sort) - bkjs.toNumber(b.sort) || (a.ctime - b.ctime)));

        var types = {};
        list.forEach((x) => {
            x.icon = x.status == "ok" ? "fa-check" : "fa-ban";
            x.text = x.name + " = " + bkjs.textToXml(x.value);
            x.mtime = x.mtime ? bkjs.strftime(x.mtime, "%m/%d/%Y %I:%M:%S %p") : "";
            x.stime = x.stime ? bkjs.strftime(x.stime, "%m/%d/%Y %I:%M %p %z") : "";
            x.etime = x.etime ? bkjs.strftime(x.etime, "%m/%d/%Y %I:%M %p %z") : "";
            if (!types[x.type]) types[x.type] = [];
            types[x.type].push(x);
        });
        return Object.keys(types).map(x => ({ type: x, rows: types[x], q }));
    }

    show() {
        bkjs.send({ url: '/data/scan/bk_config', data: { _count: 1000 } }, (rc) => {
            this.rows = bkjs.isArray(rc.data, []);
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
            tabs: { gen: "General", adv: "Advanced" },
            content: [
                { input: { name: "type", label: "Type:", value: data.type, tab_id: "gen" } },
                { input: { name: "name", label: "Name:", value: data.name, } },
                { textarea: { name: "value", class: "form-control", label: "Value:", rows: 5, value: bkjs.textToXml(data.value) } },

                { select: { name: "status", label: "Status:", value: data.status, options: ["ok","hidden"], tab_id: "adv" } },
                { input: { name: "version", class: "form-control", label: "Version:", value: data.version, placeholder: ">=1.2, <2.0, 1.0 - 2.1" } },
                { input: { name: "stime", class: "form-control", label: "Start Time:", value: data.stime, placeholder: "mm/dd/YYYY HH:MM Z" } },
                { input: { name: "etime", class: "form-control", label: "End Time:", value: data.etime, placeholder: "mm/dd/YYYY HH:MM Z" } },
                { number: { name: "sort", class: "form-control", label: "Sorting Order:", value: data.sort, placeholder: "1,2,...." } },
                data.ctime ? { div: { class: "text-muted", text: `Created: ${bkjs.strftime(data.ctime)}` } } : null,
                data.mtime ? { div: { class: "text-muted", text: `Updated: ${data.mtime} ${data.uname ? " by " + data.uname : ""}` } } : null,
                ],
            buttons: ["cancel", "Save", data.name && "Copy", data.name && "Delete"],
            Save: function(d) {
                d.value = bkjs.unicode2Ascii(d.value, "qs");
                if (!d.type || !d.name || !d.value) return popup.showAlert("Type, name and value are required");
                d.ctime = data.ctime;
                bkjs.sendRequest({ url: `/data/${d.ctime ? "update" : "put"}/bk_config`, data: d, self: this }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },
            Copy: function(d) {
                bkjs.sendRequest({ url: '/data/put/bk_config', data: d, self: this }, (err) => {
                    if (err) return popup.showAlert(err);
                    this.show();
                    popup.close();
                });
                return null;
            },
            Delete: function(d) {
                bkjs.showConfirm.call(this, "Delete this parameter?", () => {
                    bkjs.sendRequest({ url: '/data/del/bk_config', data: { ctime: data.ctime, name: data.name }, self: this }, (err) => {
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


bkjs.templates.config2 = "#config";
bkjs.components.config2 = class extends bkjs.components.config {

    title = "System Config2"

    onInit() {
        super.onInit();
        console.log("init2", this.$key)

        this.show();
    }

    onRefreshed(name, data) {
        console.log("refreshed2:", this.$key, name, data, this.refreshed)
        this.refreshed = "(refreshed2)";
    }
}

bkjs.ready(() => {
    bkjs.setColorScheme();
    bkjs.restoreComponent(bkjs.param("path"), "index");
});

