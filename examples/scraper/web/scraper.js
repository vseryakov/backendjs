
app.components.scraper = class extends app.AlpineComponent {
    list = [];
    next_token = "";

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
            title: "Website URFL",
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
        app.bootpopup.confirm("Re-scraper this site?", async (ok) => {
            if (!ok) return;
            const { err } = await app.fetch('/api/resubmit/' + body.id, { method: "PUT" });
            if (err) app.showToast("error", err);
        });
    }

    del(row) {
        app.bootpopup.confirm("Delete this site?", async (ok) => {
            if (!ok) return;
            const { err } = await app.fetch("/api/del/" + row.id, { method: "DELETE" });
            if (err) return app.showToast("error", err);
            setTimeout(this.refresh.bind(this, 1), 500);
        });
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
