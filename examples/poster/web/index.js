
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    create() {

    }
};

app.$ready(() => {
    app.start();
});
