
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    boards = [];

    async onCreate() {
        const { err, data } = await app.fetch("/api/boards");
        if (err) return app.showToast("error", err);
        this.boards = data;
    }
}

app.components.board = class extends app.AlpineComponent {

    cards = []

    async onCreate() {
        const { err, data } = await app.fetch("/api/board/" + this.params.id);
        if (err) return app.showToast("error", err);
        this.cards = data;
    }
}

app.$ready(() => {
    app.start();
});
