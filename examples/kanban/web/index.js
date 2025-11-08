
app.debug = 1;

app.$ready(() => {
    app.user = Alpine.reactive({});
    Alpine.magic('user', (el) => app.user);

    app.ui.setColorScheme();
    app.start();

});
