
app.components.scraper = class extends app.AlpineComponent {
    list = [];
    next_token = "";
    defaults = {}
    editing;

    onCreate() {
        this.refresh()
    }

    async refresh(force) {
        const { err, data } = await app.fetch("/api/list", { body: { start: this.next_token } });
        if (err) return app.showToast("error", err);

        if (force) this.list = [];

        this.next_token = data?.next_token || "";
        this.list.push(...data.data);
    }

    // This is websocket event sent by the backend jobs
    onScraperStatus(event) {
        const row = this.list.find(x => x.id == event.data.id);
        if (row) Object.assign(row, event.data);
    }

    submit() {
        var popup = app.bootpopup({
            title: "Website URL",
            alert: 1,
            debug: 1,
            content: [
                { text: { name: "url", label: "URL" } },
            ],
            buttons: ["cancel", "Submit"],
            Submit: async (d) => {
                if (!d.url) return popup.showAlert("url is required")

                const { err } = await app.fetch("/api/submit", { post: 1, body: d });
                if (err) return popup.showAlert(err);
                setTimeout(this.refresh.bind(this, 1), 500);
            }
        })
    }

    resubmit(body) {
        var popup = app.bootpopup({
            title: "Resubmit",
            alert: 1,
            debug: 1,
            content: [
                { radio: { name: "mode", label: "Everything", value: "all" } },
                { radio: { name: "mode", label: "Web Scrape", value: "scrape" } },
                { radio: { name: "mode", label: "AI Scraper", value: "describe" } },
                { radio: { name: "mode", label: "Generate Variants", value: "variants" } },
                { radio: { name: "mode", label: "Generate Samples", value: "samples" } },
            ],
            buttons: ["cancel", "Submit"],
            Submit: async (d) => {
                if (!d.mode) return popup.showAlert("Select mode");
                if (d.mode == "all") delete d.mode;
                const { err } = await app.fetch('/api/resubmit/' + body.id, { post: 1, body: d });
                if (err) return popup.showAlert(err);
            }
        })
    }

    del(row) {
        app.bootpopup.confirm("Delete this site?", async (ok) => {
            if (!ok) return;
            const { err } = await app.fetch("/api/del/" + row.id, { method: "DELETE" });
            if (err) return app.showToast("error", err);
            setTimeout(this.refresh.bind(this, 1), 500);
        });
    }

    edit(row, profile) {
        app.bootpopup({
            title: `Profile: ${profile.name}`,
            size: "xxl",
            scroll: 1,
            data: { id: row.id, name: profile.name, items: profile.items, defaults: this.defaults },
            content: [
                { div: { "x-template": `'/render.html?id=${row.id}&src=/api/asset/${row.id}/profile-${profile.name}.png'` } },
            ],
            buttons: ["Render", "JSON", "close"],
            class_Render: "btn btn-primary",
            title_JSON: "Download profile rendering JSON",
            Render: () => {
                app.emit(app.event, "render");
                return null;
            },
            JSON: () => {
                this.download(profile);
                return null;
            }
        })
    }

    download(profile) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([ JSON.stringify(profile) ], { type: "application/json" }))
        link.download = profile.name.replace(/[^a-z0-9_.-]/ig, "-") + '-poster.json';
        setTimeout(() => { link.click() }, 100);
    }

    async show(row, file) {
        var content = [];

        if (file == "logos") {
            if (row.meta?.ogimage) {
                content.push({ h3: { class: "py-3 border-bottom", text: row.meta?.ogimage } },
                             { img: { src: row.meta?.ogimage } });
            }
            for (const i in row.logos) {
                content.push({ h3: { class: "py-3 border-bottom", text: row.logos[i] } },
                             { img: { src: row.logos[i] } });
            }
        } else

        if (/(png|jpg)$/.test(file)) {
            content.push({ img: { src: "/api/asset/" + row.id + "/" + file } });

        } else {
            const { err, data } = await app.fetch("/api/asset/" + row.id + "/" + file, { dataType: "text" });
            if (err) return app.showToast("error", err);

            content.push({ textarea: { readonly: true, rows: 30, value: data } });
        }
        app.bootpopup({
            title: `File: ${file}`,
            show_footer: false,
            scroll: 1,
            horizontal: 0,
            size: "xl",
            content,
        })
    }

};

app.debug = 1
app.$ready(async () => {
    app.ws = new app.WS({ path: "/ping" });
    app.ws.connect();

    app.start();
});
