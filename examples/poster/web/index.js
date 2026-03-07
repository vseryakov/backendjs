
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    profiles = [];
    profile = {};

    filters = [
        { name: "affine", descr: "" },
        { name: "autoOrient", descr: "" },
        { name: "blur", descr: "" },
        { name: "boolean", descr: "" },
        { name: "clahe", descr: "" },
        { name: "convolve", descr: "" },
        { name: "dilate", descr: "" },
        { name: "erode", descr: "" },
        { name: "flatten", descr: "" },
        { name: "flip", descr: "" },
        { name: "flop", descr: "" },
        { name: "gamma", descr: "" },
        { name: "linear", descr: "" },
        { name: "median", descr: "" },
        { name: "negate", descr: "" },
        { name: "normalise", descr: "" },
        { name: "normalize", descr: "" },
        { name: "modulate", descr: "" },
        { name: "rotate", descr: "" },
        { name: "recomb", descr: "" },
        { name: "sharpen", descr: "" },
        { name: "threshold", descr: "" },
        { name: "trim", descr: "" },
        { name: "unflatten", descr: "" },
    ]


    onCreate() {
        try {
            this.profile = JSON.parse(localStorage.poster || "")
        } catch (e) {}
    }

    onFileDropped(event, item) {
        const reader = new FileReader();
        reader.addEventListener("load", () => { item.data = reader.result });

        switch (event.type) {
        case "change":
            if (!event.target.files?.[0]) break;
            item.file = event.target.value.split("/").pop();
            reader.readAsDataURL(event.target.files[0]);
            break;

        default:
            if (!event.file?.name) break;
            item = event.target;
            item.file = event.file.name.split("/").pop();
            reader.readAsDataURL(event.file);
        }
    }

    prepareItem(item) {
        item.file = item.file || "";
        item.data = item.data || "";
        item.filters = item.filters || [];
        item._dragging = false;
        return item;
    }

    addItem() {
        var popup = bootpopup({
            title: "Add Element",
            alert: 1,
            debug: 1,
            content: [
                { text: { name: "id", label: "Element name" } },
                { radio: { name: "type", label: "Text", value: "text", checked: 1, switch: 1 } },
                { radio: { name: "type", label: "Image", value: "image", switch: 1 } },
            ],
            buttons: ["cancel", "Add"],
            Add: (d) => {
                if (!d.id || !d.type) return popup.showAlert("name and type required")
                d.id = d.id.replace(/[^a-z0-9]/ig, "_");
                this.profile.items.push(this.prepareItem(d));
            }
        })
    }

    async render() {
        const body = { items: this.profile.items, defaults: this.profile.item };

        const { err, data } = await app.fetch("/api/render", { post: 1, body });
        if (err) return app.showToast("error", err);

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            app.$("#poster").src = reader.result
        });
        reader.readAsDataURL(data);
        app.$("body").click()
    }

    save() {
        localStorage.poster = JSON.stringify(this.profile);
    }

    download() {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([ JSON.stringify(this.profile) ], { type: "application/json" }))
        link.download = this.profile.name.replace(/[^a-z0-9_.-]/ig, "-") + '-poster.json';
        setTimeout(() => { link.click(); }, 100);
    }

    load() {
        const file = app.$elem('input', {
            type: "file",
            accept: ".json,application/json",
            change: (event) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    var profile = JSON.parse(reader.result);
                    if (profile?.name && profile.items) {
                        this.profiles.push(this.profile = profile);
                        this.render()
                    }
                });
                reader.readAsText(event.target.files[0]);
            },
        });
        setTimeout(() => { file.click(); }, 100);
    }

    create() {
        var popup = bootpopup({
            title: "Create a Poster",
            alert: 1,
            debug: 1,
            content: [
                { text: { name: "name", label: "Name" } },
                { checkbox: { name: "clone", label: "Clone current", value: "1", switch: 1 } },
            ],
            buttons: ["cancel", "Create"],
            Add: (d) => {
                if (!d.name) return popup.showAlert("name is required")
                this.profiles.push(this.profile = {
                    name: d.name,
                    items: d.clone ? this.profile.items.map(x => Object.assign({}, x)) : []
                });
            }
        })
    }
};

app.$ready(() => {
    app.start();
});
