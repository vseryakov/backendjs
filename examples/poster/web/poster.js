
app.components.poster = class extends app.AlpineComponent {

    profiles = [];
    profile = {
        items: [],
        defaults: {}
    };

    onCreate() {
        try {
            var profile = JSON.parse(localStorage.poster || "");
            if (profile?.items?.length) {
                this.profiles.push(this.setProfile(profile))
            } else {
                profile = {
                    defaults: {

                    },
                    items: [

                    ]
                }
            }
        } catch (e) {}
    }

    setProfile(profile) {
        profile.defaults ??= {};
        profile.items ??= [];
        this.profile.name = profile.name;
        this.profile.items = profile.items;
        for (const p in this.profile.defaults) delete this.profile.defaults[p];
        Object.assign(this.profile.defaults, profile.defaults);
        return profile;
    }

    save() {
        localStorage.poster = JSON.stringify(this.profile);
    }

    download() {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([ JSON.stringify(this.profile) ], { type: "application/json" }))
        link.download = this.profile.name.replace(/[^a-z0-9_.-]/ig, "-") + '-poster.json';
        setTimeout(() => { link.click() }, 100);
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
        setTimeout(() => { file.click() }, 100);
    }

    create() {
        var popup = app.bootpopup({
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
