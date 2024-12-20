/*!
 *  bkjs client
 *  Vlad Seryakov vseryakov@gmail.com 2024
 */

bkjs.AlpineComponent = class {
    // x-template dynamic rendering
    template = "";
    // Render options
    params = {};

    static _id = 0;

    constructor(name) {
        this.$name = name;
        this.$key = `${name}:${bkjs.AlpineComponent._id++}`;
        this._handleEvent = this.handleEvent.bind(this);
    }

    init() {
        bkjs.trace("init:", this.$key);
        bkjs.call(this.onInit?.bind(this));
        bkjs.on("component:event", this._handleEvent);
    }

    postInit(options) {
        Object.assign(this.params, options);
        bkjs.emit("component:created", { type: "alpine", name: this.$name, component: this, element: this.$el, params: Object.assign({}, this.params) });
    }

    destroy() {
        bkjs.trace("destroy:", this.$key);
        bkjs.off("component:event", this._handleEvent);
        bkjs.emit("component:destroyed", { type: "alpine", name: this.$name, component: this, element: this.$el, params: Object.assign({}, this.params) });
        bkjs.call(this.onDestroy?.bind(this));
        this.params = {};
    }

    handleEvent(name, data) {
        if (this.params.$noevents) return;
        bkjs.trace("handleEvent:", this.$key, name, data)
        const $data = this.$data;
        bkjs.call(this[bkjs.toCamel("on_" + name)]?.bind($data), name, data);
        bkjs.call(this.onEvent?.bind($data), name, data);
    }

}

bkjs.AlpineElement = class extends HTMLElement {

    connectedCallback() {
        bkjs.renderComponent(this, this.getAttribute("template") || this.tagName.substr(2).toLowerCase());
    }

}

bkjs.renderComponent = function(element, name, options)
{
    if (!(element instanceof HTMLElement)) return;

    var tmpl = bkjs.findComponent(name, options);
    if (!tmpl) tmpl = bkjs.findComponent(options?.$index || tmpl?.params?.$index);
    if (!tmpl) return;
    bkjs.trace("renderComponent:", tmpl);

    // Remove existing elements, allow Alpine to cleanup
    bkjs.$empty(element)

    // Add new elements
    const node = bkjs.$create("template", "x-data", tmpl.component ? tmpl.name : "", ".display", "block");
    const body = new DOMParser().parseFromString(tmpl.template, "text/html").body;
    while (body.firstChild) {
        node.appendChild(body.firstChild);
    }

    Alpine.mutateDom(() => {
        element.appendChild(node);
        Alpine.initTree(node);
    });

    // x-data does not allow to pass specific options thus we pass params after the init
    var stack = Alpine.closestDataStack(node)[0];
    bkjs.call(stack, "postInit", Object.assign(tmpl.params || {}, options));
}

bkjs.showComponent = function(name, options)
{
    bkjs.trace("showComponent:", name, options);

    var target = options?.$target;
    if (!target && /\$target=/.test(name)) {
        target = (name.match(/\$target=([^&]+)/) || "")[1];
    }
    const element = bkjs.$(target || "x-app");
    if (!element) return;

    if (element.tagName == "X-APP" && element.firstChild?.tagName == "TEMPLATE") {
        var stack = Alpine.closestDataStack(element.firstChild)[0];
        if (bkjs.call(stack, "canDestroy", options) === false) return false;
    }

    return bkjs.renderComponent(element, name, options);
}

bkjs.$on(document, "alpine:init", () => {

    customElements.define("x-app", class XApp extends bkjs.AlpineElement {});

    for (const name in bkjs.components) {
        customElements.define("x-" + name, class $name extends bkjs.AlpineElement {});
        Alpine.data(name, () => (typeof bkjs.components[name] == "function" ? new bkjs.components[name](name) : {}));
    }

    Alpine.magic('render', (el) => (name, options) => {
        if (typeof name != "string") name = el?.dataset?.template;
        bkjs.showComponent(name, options);
    });

    Alpine.directive('link', (el, { modifiers, expression }, { evaluate, cleanup }) => {
        const click = (e) => {
            e.preventDefault()
            bkjs.showComponent(evaluate(expression));
        }
        el.addEventListener('click', click)

        cleanup(() => {
            el.removeEventListener('click', click)
        })
    });

    Alpine.directive('template', (el, { expression }, { effect, cleanup }) => {
        const evaluate = Alpine.evaluateLater(el, expression || "template");

        const show = (template) => {
            bkjs.renderComponent(el, template);

            el._x_undoTmpl = () => {
                Alpine.mutateDom(() => {
                    bkjs.$empty(el, (node) => Alpine.destroyTree(node));
                })
            }
        }

        const hide = () => {
            if (el._x_undoTmpl) el._x_undoTmpl()
            delete el._x_undoTmpl
        }

        effect(() => evaluate(value => {
            value ? show(value) : hide()
        }))

        cleanup(() => el._x_undoTmpl && el._x_undoTmpl())
    });

});

