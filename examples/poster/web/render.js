
app.components.render = class extends app.AlpineComponent {

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

    _item;

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
        var popup = app.bootpopup({
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
                this.items.push(this.prepareItem(d));
            }
        })
    }

    edit(item) {
        if (this._item === item) {
            this._item = undefined;
        } else
        if (this._item) {
            this._item = null;
            setTimeout(() => { this._item = item }, 100);
        } else {
            this._item = item;
        }
    }

    async render() {
        const body = { items: this.items, defaults: this.defaults };

        const { err, data } = await app.fetch("/api/render/", { post: 1, body });
        if (err) return app.showToast("error", err);

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            app.$("#poster").src = reader.result
        });
        reader.readAsDataURL(data);
        app.$("body").click()

        this._item = undefined;
    }

};

