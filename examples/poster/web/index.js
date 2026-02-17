
app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    dragging;
    error;

    onCreate() {

    }

    onFileDropped(event) {

    }

    preview() {

    }
};

app.$ready(() => {
    app.start();
});
