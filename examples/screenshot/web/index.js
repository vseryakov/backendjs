
app.debug = 1

app.components.index = class extends app.AlpineComponent {
    onCreate() {

    }
};

app.(() => {
    app.start();
});
