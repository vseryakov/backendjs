
app.debug = 1;

app.$ready(async () => {
    app.user = Alpine.reactive({});
    Alpine.magic('user', (el) => app.user);

    const { ok, data } = await app.afetch("/auth", { post: 1 });
    if (ok) Object.assign(app.user, data);

    app.start();
});

app.components.index = class extends app.AlpineComponent {

    login
    secret

    async submit()
    {
        const body = { login: this.login, secret: this.secret };
        const { err, data } = await app.afetch("/login", { post: 1, body });
        if (err) return app.showAlert("error", err);
        Object.assign(app.user, data);
    }
}

