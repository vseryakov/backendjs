
app.components.poster = class extends app.AlpineComponent {

    profiles = [];
    profile = {
        items: [],
        defaults: {}
    };

    onCreate() {
        try {
            var profile = JSON.parse(localStorage.poster || "")
        } catch (e) {}

        if (!profile?.items?.length) {
            profile = {
                name: "poster",
                defaults: {
                    padding: "0.05",
                    size: 0.07,
                    font: "'Roboto Slab', serif",
                    weight: "bold",
                    text_auto: "luminance"
                },
                items: [
                    { id: "bg", type: "image", file: "web/bg.jpg", filters: [ { name: "blur", value: "sigma:1" } ], width: 1376, height: 768 },
                    { id: "avatar", type: "image", file: "web/man.jpg", width: 0.3, border: 20, gravity: "east", radius: 2 },
                    { id: "logo", type: "image", gravity: "south" },
                    { id: "title", type: "text", text: "Nice weather\noutdoors", gravity: "northwest", dpi: 650, font: "'Montserrat', sans-serif", stroke_width: 4, size: 0.17, shadow_width: 3 },
                    { id: "location", type: "text", text: "Aug 15, 2024\nVail, CO", gravity: "southwest", width: 600, gradient: 1 },
                    { id: "name", type: "text", text: "My Name\n<small><i>Freelancer</i></small>", gravity: "southeast", font: "'Futura', sans-serif", stroke_width: 4, dilate_radius: 5, dilate_alpha: 15, padding_right: 0.1 },
                ],
            }
        }
        this.profiles.push(this.setProfile(profile))
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
        localStorage.poster = JSON.stringify(this.profile, (k,v) => (k[0] == "_" || v === "" || v === 0 || v?.length === 0 ? undefined : v));
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
