
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

    Alpine.directive('droppable', (el, { expression }, { evaluate, cleanup }) => {
        const data = evaluate(expression)
        var lastEnteredElement = null;

        app.$on(el, "click", click);
        app.$on(el, "drop", drop);
        app.$on(el, "dragdrop", drop);
        app.$on(el, "dragenter", dragenter);
        app.$on(el, "dragleave", dragleave);
        app.$on(el, "dragover", dragover);

        cleanup(() => {
            app.$off(el, "click", click);
            app.$off(el, "drop", drop);
            app.$off(el, "dragdrop", drop);
            app.$off(el, "dragenter", dragenter)
            app.$off(el, "dragleave", dragleave)
            app.$off(el, "dragover", dragover);
        })

        function click(event) {
            app.$('[type="file"]', el).click();
        }

        function drop(event) {
            event.preventDefault();
            data.dragging = 0;
            var file = event.dataTransfer.files[0];
            app.emit(app.event, "file:dropped", { file, event });
        }

        function dragenter(event) {
            lastEnteredElement = event.target;
            data.dragging = 1;
        }

        function dragleave(event) {
            if (event.target === lastEnteredElement) {
                data.dragging = 0;
            }
        }

        function dragover(event) {
            event.preventDefault();
            data.dragging = 1;
        }

    })

});
