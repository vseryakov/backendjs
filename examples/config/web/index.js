
app.debug = 1;

app.$ready(async () => {
    app.user = Alpine.reactive({});
    Alpine.magic('user', (el) => app.user);

    const { ok, data } = await app.afetch("/auth", { post: 1 });
    if (ok) Object.assign(app.user, data);

    app.start();
});
