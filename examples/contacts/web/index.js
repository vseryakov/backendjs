
app.debug = 1

app.components.index = class extends app.AlpineComponent {
    contacts = []
    search;
    next_token;

    onCreate() {
        this.$watch("search", this.refresh.bind(this, true));
        this.refresh();
    }

    async refresh(force) {
        const opts = { body: { q: this.search || "", start: this.next_token || "" } };
        const { err, data } = await app.afetch("/api/contacts", opts);
        if (err) return app.showToast("error", err);

        this.next_token = data?.next_token;
        if (force) this.contacts = [];
        this.contacts.push(...data.data.map(x => {
            x.label = `${x.first_name?.charAt(0).toUpperCase()||''}${x.last_name?.charAt(0).toUpperCase()}`
            return x;
        }));
    }

    add() {
        var popup = bootpopup({
            title: 'Add New Contact',
            alert: 1,
            content: [
                { input: { type: 'text', id: 'first_name', label: 'First Name', placeholder: 'Enter first name' } },
                { input: { type: 'text', id: 'last_name', label: 'Last Name', placeholder: 'Enter last name' } },
                { input: { type: 'email', id: 'email', label: 'Email', placeholder: 'Enter email address' } },
                { input: { type: 'phne', id: 'phone', label: 'Phone', placeholder: 'Enter phone' } },
                { input: { type: 'url', id: 'logo', label: 'Logo' } },
            ],
            buttons: [ "cancel", "Save" ],
            Save: async (d) => {
                if (!d.first_name || !d.last_name) {
                    return popup.showAlert('First and Last names are required');
                }
                const opts = { method: "POST", body: d };
                const { err } = await app.afetch("/api/contacts", opts);
                if (err) return popup.showAlert(err);
            }
        });
    }
};

app.$ready(() => {
    app.start();
});
