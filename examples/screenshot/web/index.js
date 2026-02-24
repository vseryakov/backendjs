
app.debug = 1

app.components.index = class extends app.AlpineComponent {
    list = [];
    next_token = "";

    onCreate() {
        this.refresh()
    }

    async refresh(force) {
        const { err, data } = await app.afetch("/api/list", { body: { start: this.next_token } });
        if (err) return app.showToast("error", err);

        if (force) this.list = [];

        this.next_token = data?.next_token || "";
        this.list.push(...data.data);
    }

    submit() {
        var popup = bootpopup({
            title: "Website URFL",
            alert: 1,
            debug: 1,
            content: [
                { text: { name: "url", label: "URL" } },
            ],
            buttons: ["cancel", "Submit"],
            Submit: async (d) => {
                if (!d.url) return popup.showAlert("url is required")

                const { err } = await app.afetch("/api/submit", { post: 1, body: d });
                if (err) return popup.showAlert(err);
                setTimeout(this.refresh.bind(this, 1), 500);
            }
        })
    }

    async resubmit(body) {
        const { err } = await app.afetch('/api/submit', { post: 1, body });
        if (err) app.showToast("error", err);
    }

    async del(row) {
        const { err } = await app.afetch("/api/del/" + row.id, { method: "DELETE" });
        if (err) return app.showToast("error", err);
        setTimeout(this.refresh.bind(this, 1), 500);
    }
};

app.$ready(() => {
    app.start();
});
