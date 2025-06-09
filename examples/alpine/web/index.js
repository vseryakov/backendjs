/*!
 *  bkjs client
 *  Vlad Seryakov vseryakov@gmail.com 2024
 */

app.debug = 1;

app.templates.empty = `<div class="py-3 border">Empty</div>`;

app.templates.test = `<div class="py-3 border">Rendering just text templates: <span x-text=template></span> <span x-text=title></span></div>`;

app.components.index = class extends app.AlpineComponent {
    title = "Index"
    toggle() {
        this.template = !this.template ? "config" : this.template == "config" ? "empty" : "";
    }
};

app.$ready(() => {
    app.setColorScheme();
    ko.applyBindings(app);
    app.restorePath();
});

