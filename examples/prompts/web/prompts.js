/* global app marked hljs */

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

    // This is websocket event sent from backend jobs
    onPromptsStatus(event) {
        const row = this.prompts.find(x => x.id == event.prompt.id);
        if (row) {
            Object.assign(row, event.prompt);
        } else {
            this.prompts.unshift(event.prompt);
        }
    }

    onItemDropped(event) {
        const results = event.scope[1].prompt.results;
        const item = results.findIndex(x => x.model == event.item.model)
        const target = results.findIndex(x => x.model == event.target.model)
        results.splice(item, 1);
        results.splice(target, 0, event.item);
    }

    submit(data) {
        app.bootpopup({
            title: "Submit Prompt",
            alert: true,
            debug: true,
            size: "xl",
            size_label: "col-sm-2",
            size_input: "col-sm-10",
            data,
            content: [
                { textarea: { name: "prompt", label: "Prompt*", rows: 15, value: data?.prompt } },
                { hr: {} },
                { checkboxes: { label: "Models*", inline: true,
                                options: this.models.map(x => ({ name: x.id, label: `${x.id}: ${x.type}`, value: x.id })),
                } },
                data ? { checkbox: { name: "force", label: "Start over with these models", value: 1 } } : null,
            ],
            buttons: ["cancel", "Submit"],
            Submit: this._submit
        })
    }

    async _submit(data, list, event, popup) {
        if (!data.prompt) return popup.showAlert("prompt is required")

        const models = Object.keys(data).filter(x => x !== "prompt" && data[x] == x);
        if (!models.length) return popup.showAlert("models are required");

        const id = popup.xdata?.id;
        const body = { id, prompt: data.prompt, force: data.force, models };

        const { err } = await app.fetch("/api/prompt", { method: id ? "PUT" : "POST", body });
        if (err) return popup.showAlert(err);
    }

    async cancel(row) {
        const ok = await app.bootpopup.aconfirm("Cancel this prompt?");
        if (!ok) return;

        const { err } = await app.fetch("/api/prompt/" + row.id, { method: "PATCH" });
        if (err) return app.showToast("error", err);
    }

    async del(row) {
        const ok = await app.bootpopup.aconfirm("Delete this prompt?");
        if (!ok) return;

        const { err } = await app.fetch("/api/prompt/" + row.id, { method: "DELETE" });
        if (err) return app.showToast("error", err);

        const i = this.prompts.findIndex(x => x.id === row.id);
        if (i > -1) this.prompts.splice(i, 1);
    }

    toggle(row, collapse) {
        row.results.filter(x => (collapse ? x.width : !x.width)).forEach(x => {
            this.show(row, x);
        });
    }

    show(row, result) {
        result.width = !result.width;

        if (result.width && !result._md && result.text) {
            result._md = 1;
            marked.setOptions({ gfm: true, breaks: false });
            const template = document.createElement('template');
            template.innerHTML = marked.parse(result.text);
            template.content.querySelectorAll('pre code').forEach(code => {
                const raw = code.textContent || '';
                try {
                    const highlighted = hljs.highlightAuto(raw).value;
                    code.innerHTML = highlighted;
                    code.classList.add('hljs');
                } catch (_) {
                    code.textContent = raw;
                }
            });
            result.text = template.innerHTML;
        }

        let show;
        const open = row.results.filter((res, i) => {
            if (res.model == result.model) show = i;
            return res.width;
        });

        row.results.splice(show, 1);
        if (result.width) {
            row.results.unshift(result);
        } else {
            row.results.push(result);
        }

        const w = 90/(open.length);
        open.forEach(res => {
            res.width = w + 'vw';
        });
    }

    getModels() {
        app.fetch("/api/models", (err, data) => {
            if (!err) this.models = data.data;
        });
    }

    editModels(data) {
        app.bootpopup({
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
            buttons: ["Save","cancel"],
            Save: this._save,
        })
    }

    async _save(body, list, event, popup) {
        if (!body.id || !body.type) return popup.showAlert("id and type are required")
        if (!body.token && !/ollama/.test(body.type)) return popup.showAlert("token is required")

        const { err } = await app.fetch("/api/model/", { post: true, body });
        if (err) return app.showToast("error", err);

        this.getModels();
    }

};

app.debug = 1
app.$ready(async () => {
    app.ws = new app.WS({ path: "/ws" });
    app.ws.connect();

    app.start();
});
