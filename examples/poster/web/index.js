
app.debug = 1;

app.components.index = class extends app.AlpineComponent {
    template;

    toggle() {
        this.template = !this.template ? "/test.html" : this.template != "empty" ? "empty" : "";
    }
};

app.$ready(() => {
    app.start();
});
