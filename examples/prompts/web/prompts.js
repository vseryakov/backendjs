/* global app */

app.components.prompts = class extends app.AlpineComponent {
    prompts = [];
    next_token = "";
    models = [];

    onCreate() {
        this.refresh()
    }

    async refresh(force) {
        this.getModels();

        const { err, data } = await app.fetch("/api/prompts", { body: { start: this.next_token } });
        if (err) return app.showToast("error", err);

        if (force) this.prompts = [];

        this.next_token = data?.next_token || "";
        this.prompts.push(...data.data);
    }

    // This is websocket event sent by the backend jobs
    onPromptsStatus(event) {
        const row = this.prompts.find(x => x.id == event.prompt.id);
        if (row) Object.assign(row, event.prompt);
    }

    submit(row) {
        var popup = app.bootpopup({
            title: "Submit Prompt",
            alert: true,
            debug: true,
            size: "xl",
            size_label: "col-sm-2",
            size_input: "col-sm-10",
            content: [
                { textarea: { name: "prompt", label: "Prompt*", rows: 15, value: row?.prompt } },
                { hr: {} },
                { checkboxes: { label: "Models", inline: true,
                                options: this.models.map(x => ({ name: x.id, label: `${x.id}: ${x.type}`, value: x.id })),
                                text_suffix: "optional, subset of models, if empty all will be used"
                } },
            ],
            buttons: ["cancel", "Submit"],
            Submit: async (d) => {
                if (!d.prompt) return popup.showAlert("prompt is required")

                const models = Object.keys(d).filter(x => x !== "prompt" && d[x] == x);
                const body = { id: row?.id, prompt: d.prompt, models };

                const { err, data } = await app.fetch("/api/prompt", { post: true, body });
                if (err) return popup.showAlert(err);

                this.prompts.unshift(data);
            }
        })
    }

    del(row) {
        app.bootpopup.confirm("Delete this prompt?", async (ok) => {
            if (!ok) return;

            const { err } = await app.fetch("/api/prompt/" + row.id, { method: "DELETE" });
            if (err) return app.showToast("error", err);

            const i = this.prompts.findIndex(x => x.id === row.id);
            if (i > -1) this.prompts.splice(i, 1);
        });
    }

    show(row, result) {
        if (result.show) {
            return result.show = 0;
        }
        var i = row.results.findIndex(x => x.model == result.model);
        row.results.splice(i, 1);
        row.results.unshift(result);
        result.show = 1;
    }

    getModels() {
        app.fetch("/api/models", (err, data) => {
            if (!err) this.models = data.data;
        });
    }

    editModels(data) {
        var popup = app.bootpopup({
            title: "Manage Models",
            alert: true,
            debug: true,
            scroll: true,
            size: "xl",
            data: {
                models: this.models,

                id: "",
                type: "",
                token: "",

                edit(row) {
                    this.id = row.id
                    this.type = row.type
                },

                del(row) {
                    app.bootpopup.confirm("Delete this model?", async (ok) => {
                        if (!ok) return;

                        const { err } = await app.fetch("/api/model/" + row.id, { method: "DELETE" });
                        if (err) return app.showToast("error", err);

                        const i = this.models.findIndex(x => x.id === row.id);
                        if (i > -1) this.models.splice(i, 1);
                    });
                },
            },
            content: [
                { div: { "x-template": "'/models.html'" } },
            ],
            buttons: ["cancel", "Save"],
            Save: async (body) => {
                if (!body.id || !body.type) return popup.showAlert("id and type are required")
                if (!body.token && !/ollama/.test(body.type)) return popup.showAlert("token is required")

                const { err } = await app.fetch("/api/model/", { post: true, body });
                if (err) return app.showToast("error", err);

                this.getModels();
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
