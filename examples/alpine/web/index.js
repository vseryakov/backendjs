
app.debug = 1;

app.templates.empty = `<div class="py-3 border">Empty</div>`;

app.components.index = class extends app.AlpineComponent {
    template;

    toggle() {
        this.template = !this.template ? "/test.html" : this.template == "config" ? "empty" : "";
    }
};

app.$ready(() => {
    app.start();
});
