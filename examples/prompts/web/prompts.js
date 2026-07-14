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
                { number: { name: "max_tokens", label: "Max tokens:" } },
                { select: { name: "reasoning", label: "Reasoning effort:", caption: "Default", options: ["low", "medium", "high"] } },
                { hr: {} },
                { checkboxes: { label: "Models*", inline: true,
                                options: this.models.map(x => ({ name: x.id, label: `${x.id}: ${x.type}`, value: x.id })),
                } },
                data ? { checkbox: { name: "force", label: "Start over with only these models", value: 1, switch: true } } : null,
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
        const body = {
            id,
            models,
            prompt: data.prompt,
            force: data.force,
            max_tokens: data.max_tokes,
            reasoning: data.reasoning,
        };

        const { err } = await app.fetch(`/api/prompt${id ? "/" + id : ""}`, { method: id ? "PUT" : "POST", body });
        if (err) return popup.showAlert(err);
    }

    async cancel(prompt) {
        const ok = await app.bootpopup.aconfirm("Cancel this prompt?");
        if (!ok) return;

        const { err } = await app.fetch("/api/prompt/" + prompt.id, { method: "PATCH" });
        if (err) return app.showToast("error", err);
    }

    async del(prompt) {
        const ok = await app.bootpopup.aconfirm("Delete this prompt?");
        if (!ok) return;

        const { err } = await app.fetch("/api/prompt/" + prompt.id, { method: "DELETE" });
        if (err) return app.showToast("error", err);

        const i = this.prompts.findIndex(x => x.id === prompt.id);
        if (i > -1) this.prompts.splice(i, 1);
    }

    async delResult(prompt, result) {
        const ok = await app.bootpopup.aconfirm("Delete this result?");
        if (!ok) return;

        const { err } = await app.fetch("/api/prompt/" + prompt.id + "/" + result.model, { method: "DELETE" });
        if (err) return app.showToast("error", err);

        prompt.results.splice(prompt.results.findIndex(x => x.model == result.model), 1);
    }

    toggle(prompt, collapse) {
        prompt.results.filter(x => (collapse ? x.width : !x.width)).forEach(x => {
            this.show(prompt, x);
        });
    }

    scale(prompt) {
        prompt.height = !prompt.height || prompt.height === '50vh' ? '1000vh' : '50vh';
    }

    show(prompt, result) {
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
        const open = prompt.results.filter((res, i) => {
            if (res.model == result.model) show = i;
            return res.width;
        });

        prompt.results.splice(show, 1);
        if (result.width) {
            prompt.results.unshift(result);
        } else {
            prompt.results.push(result);
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
                url: "",

                edit(row) {
                    this.id = row.id
                    this.type = row.type
                    this.url = row.url
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
            Save: this._save.bind(this),
        })
    }

    async _save(body, list, event, popup) {
        if (!body.id || !body.type) return popup.showAlert("id and type are required")

        const { err } = await app.fetch("/api/model/", { post: true, body });
        if (err) return app.showToast("error", err);

        this.getModels();
    }

    async download(prompt, el) {
        this.toggle(prompt);
        await new Promise((resolve) => setTimeout(resolve, 500))
        this.scale(prompt);
        await new Promise((resolve) => setTimeout(resolve, 500))
        const canvas = await html2canvas(el);
        const a = document.createElement('a');
        a.href = canvas.toDataURL("image/png");
        a.download = "prompts_" + prompt.prompt.substr(0, 32).replace(/[^a-z0-9.-]/g, "_") + ".png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

};

app.debug = 1
app.$ready(async () => {
    app.ws = new app.WS({ path: "/ws" });
    app.ws.connect();

    app.start();
});
