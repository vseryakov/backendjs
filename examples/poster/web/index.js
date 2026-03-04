
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    profiles = [];
    profile = {};

    onCreate() {
        try {
            this.profiles = JSON.parse(localStorage.poster || "") || []
        } catch (e) {}

        if (this.profiles?.[0]?.name) {
            this.profile = this.prepare(this.profiles[0]);
        }
    }

    onFileDropped(event, item) {
        const reader = new FileReader();
        reader.addEventListener("load", () => { item.data = reader.result });

        switch (event.type) {
        case "change":
            item.file = event.target.value;
            reader.readAsDataURL(event.target.files[0]);
            break;

        default:
            item = event.target;
            item.file = event.file.name;
            reader.readAsDataURL(event.file);
        }
    }

    prepare(profile) {
        profile.name = profile.name || "";
        profile.items = (profile.items || []).map(this.prepareItem);
        return profile;
    }

    prepareItem(item) {
        item.file = item.file || "";
        item.data = item.data || "";
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
        const body = { items: this.profile.items };

        const { err, data } = await app.fetch("/api/render", { post: 1, body });
        if (err) return app.showToast("error", err);

        const reader = new FileReader();
        reader.addEventListener("load", () => { app.$("#poster").src = reader.result });
        reader.readAsDataURL(data);
    }

    save() {
        localStorage.poster = JSON.stringify(this.profiles);
    }

    addProfile() {
        bootpopup.prompt("Add Profile", (name) => {
            if (!name) return;
            this.profiles.unshift(this.prepare({ name }));
            this.profile = this.profiles[0];
        })
    }
};

app.$ready(() => {
    app.start();
});
