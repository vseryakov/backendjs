/* global app */

app.components.llm = class extends app.AlpineComponent {
    list = [];
    next_token = "";
    defaults = {}
    editing;

    onCreate() {
        this.refresh()
    }

    async refresh(force) {
        const { err, data } = await app.fetch("/api/models", { body: { start: this.next_token } });
        if (err) return app.showToast("error", err);

        if (force) this.list = [];

        this.next_token = data?.next_token || "";
        this.list.push(...data.data);
    }

    // This is websocket event sent by the backend jobs
    onJobStatus(event) {
        const row = this.list.find(x => x.id == event.data.id);
        if (row) Object.assign(row, event.data);
    }

    submit() {
        var popup = app.bootpopup({
            title: "LLM Prompt",
            alert: 1,
            debug: 1,
            content: [
                { select: { name: "model", label: "Model" } },
                { textarea: { name: "prompt", label: "Prompt" } },
            ],
            buttons: ["cancel", "Submit"],
            Submit: async (body) => {
                if (!body.model || !body.prompt) return popup.showAlert("model and prompt are required")

                const { err } = await app.fetch("/api/model", { post: true, body });
                if (err) return popup.showAlert(err);
                setTimeout(this.refresh.bind(this, 1), 500);
            }
        })
    }

    del(row) {
        app.bootpopup.confirm("Delete this prompt?", async (ok) => {
            if (!ok) return;
            const { err } = await app.fetch("/api/model/" + row.id, { method: "DELETE" });
            if (err) return app.showToast("error", err);
            setTimeout(this.refresh.bind(this, 1), 500);
        });
    }

    model(data) {
        app.bootpopup({
            title: "Add model",
            scroll: 1,
            data: { id: row.id, name: profile.name, items: profile.items, defaults: this.defaults },
            content: [
                { div: { "x-template": `'/render.html?id=${row.id}&src=/api/asset/${row.id}/profile-${profile.name}.png'` } },
            ],
            buttons: ["cancel", "Add"],
            Addr: () => {
                app.emit(app.event, "render");
                return null;
            },
        })
    }

};

app.debug = 1
app.$ready(async () => {
    app.ws = new app.WS({ path: "/ws" });
    app.ws.connect();

    app.start();
});
