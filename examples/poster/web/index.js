
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    profiles = [];
    profile = {};

    onCreate() {
        try {
            this.profiles = JSON.parse(localStorage.poster || "") || []
        } catch (e) {}

        if (this.profiles?.[0]?.name) {
            this.profile = this.profiles[0];
        }
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
                this.profile.items.push(d);
            }
        })
    }

    async render() {
        const body = { items: this.profile.items };
        const files = Array.from(app.$all("[type=file]")).reduce((a, b) => { a[b.id] = b; return a }, {});

        const { err, data } = await app.sendFile("/api/render", { files, body });
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
            this.profiles.unshift({ name, items: [] });
            this.profile = this.profiles[0];
        })
    }
};

app.$ready(() => {
    app.start();
});
