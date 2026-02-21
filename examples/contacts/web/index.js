
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
        this.contacts.push(...data.data.map(this.prepare));
    }

    prepare(row) {
        row.label = `${row.first_name?.charAt(0).toUpperCase()||''}${row.last_name?.charAt(0).toUpperCase()}`
        return row;
    }

    edit(data) {
        var popup = bootpopup({
            title: `${data ? "Edit" : "Add"} Contact`,
            alert: 1,
            content: [
                { input: { type: 'text', id: 'first_name', label: 'First Name', value: data?.first_name } },
                { input: { type: 'text', id: 'last_name', label: 'Last Name', value: data?.last_name } },
                { input: { type: 'email', id: 'email', label: 'Email', value: data?.email } },
                { input: { type: 'phone', id: 'phone', label: 'Phone', value: data?.phone } },
                { input: { type: 'url', id: 'logo', label: 'Logo URL', value: data?.logo } },
            ],
            buttons: [ "cancel", data ? "Save" : "Add" ],
            Add: async (d) => {
                if (!d.first_name || !d.last_name) {
                    return popup.showAlert('First and Last names are required');
                }
                const opts = { method: "POST", body: d };
                const { err } = await app.afetch("/api/contacts", opts);
                if (err) return popup.showAlert(err);
                this.unshift.push(this.prepare(d))
            },

            Save: async (d) => {
                if (!d.first_name || !d.last_name) {
                    return popup.showAlert('First and Last names are required');
                }
                const opts = { method: "PUT", body: d };
                const { err } = await app.afetch("/api/contact/" + data.id, opts);
                if (err) return popup.showAlert(err);
                Object.assign(data, this.prepare(d));
            }
        });
    }
};

app.$ready(() => {
    app.start();
});
