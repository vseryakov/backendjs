
app.components.poster = class extends app.AlpineComponent {

    profiles = [];
    profile = {};

    onCreate() {
        try {
            var profile = JSON.parse(localStorage.poster || "");
            if (profile?.items?.length) {
                this.profiles.push(this.setProfile(profile))
            }
        } catch (e) {}
    }

    setProfile(profile) {
        profile.defaults ??= {};
        profile.items ??= [];
        Object.assign(this.profile, profile);
        return profile;
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
                        this.profiles.push(this.setProfile(profile));
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
                this.profiles.push(this.setProfile({
                    name: d.name,
                    items: d.clone ? this.profile.items.map(x => Object.assign({}, x)) : []
                }));
            }
        })
    }
};

app.debug = 1;
app.$ready(app.start);
