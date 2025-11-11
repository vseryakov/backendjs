
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    boards = [];

    onCreate() {
        app.fetch("/api/boards", (err, rc) => {
            if (err) return alert(err);
            this.boards = rc;
        });
    }
}

app.$ready(() => {
    app.ui.setColorScheme();
    app.start();

});
