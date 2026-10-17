/* global app */

app.debug = 1;

app.components.index = class extends app.AlpineComponent {

    tree = [];          // root nodes
    rows = [];          // flattened visible nodes for rendering
    current = null;     // selected node
    loading = false;
    indent = 20;        // px per tree level
    width = 320;        // left pane width in px
    infoWidth = 280;    // info panel width in px
    resizing = "";      // "left" | "info" while dragging
    showInfo = true;    // info panel visible

    preview = "none";   // image, video, audio, frame, text, none
    text = "";
    textLoading = false;

    query = "";         // search string
    results = null;     // flat list of matches from /api/find
    searching = false;
    _searchId = 0;

    onCreate()
    {
        this.reload();
        this.$watch("query", () => this.search());
    }

    // --- API -----------------------------------------------------------------

    // Returns list of items in a folder: [{ name, type, size, mtime }]
    async ls(path)
    {
        return app.fetch("/api/ls/?file=" + encodeURI(path || ""));
    }

    // URL to view/download a file
    url(node, download)
    {
        return "/api/cat?file=" + encodeURI(node.path) + (download ? "?download=1" : "");
    }

    async readText(node)
    {
        return app.fetch("/api/cat?file=" + encodeURI(node.path), { data_type: "text" });
    }

    // --- Splitter ------------------------------------------------------------

    // which: "left" resizes the tree pane (grows to the right), "info" resizes the info panel (grows to the left)
    resizeStart(ev, which = "left")
    {
        ev.preventDefault();
        const prop = which == "info" ? "infoWidth" : "width";
        const dir = which == "info" ? -1 : 1;
        const startX = ev.clientX, startW = this[prop];
        const total = this.$refs.panes?.clientWidth || window.innerWidth;
        // keep at least 200px for the preview area
        const max = total - 200 - (which == "info" ? this.width : (this.showInfo ? this.infoWidth : 0));
        this.resizing = which;

        const move = (e) => {
            this[prop] = Math.min(max, Math.max(150, startW + dir * (e.clientX - startX)));
        };
        const up = () => {
            this.resizing = "";
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
    }

    // --- Tree ----------------------------------------------------------------

    async reload()
    {
        this.current = null;
        this.results = null;
        this.loading = true;
        const { err, data } = await this.ls("");
        this.loading = false;
        if (err) return app.showToast("error", err);
        this.tree = this.prepare(data).
                         sort((a, b) => (a.name.localeCompare(b.name)));
        this.flatten(this.tree);
    }

    prepare(list, parent, depth)
    {
        return (list || []).map(x => ({
            name: x.name,
            type: x.type,
            file: x.file,
            path: parent ? parent + "/" + x.name : x.file || x.name,
            size: x.size,
            mode: x.mode,
            mtime: x.mtime,
            meta: x.meta,
            depth: depth || 0,
            open: false,
            loading: false,
            loaded: false,
            children: [],
        }));
    }

    // Build the visible rows list from expanded nodes, either the file tree or the search results
    flatten(tree)
    {
        const rows = [];
        const walk = (list) => {
            for (const n of list) {
                if (!n.hidden) rows.push(n);
                if (n.type == "d" && n.open) walk(n.children);
            }
        };
        walk(tree);
        this.rows = rows;
    }

    // --- Search --------------------------------------------------------------

    async search()
    {
        const q = this.query.trim();
        if (!q) {
            this.results = null;
            this.searching = false;
            return this.flatten(this.tree);
        }
        const id = ++this._searchId;
        this.searching = true;
        this.flatten([]);
        const { err, data } = await app.fetch("/api/find", { body: { q, limit: 500 } });
        if (id != this._searchId) return;
        this.searching = false;
        if (err) return app.showToast("error", err);
        this.flatten(this.results = this.prepare(data));
    }

    // Expand the tree down to the given path, select the node and clear the search
    async reveal(node)
    {
        const parts = node.path.split("/");
        let list = this.tree, found = null;
        for (let i = 0; i < parts.length; i++) {
            const path = parts.slice(0, i + 1).join("/");
            found = list.find(x => x.path == path);
            if (!found) break;
            if (i < parts.length - 1) {
                if (!found.open) await this.toggle(found);
                list = found.children;
            }
        }
        this.query = "";
        if (!found) return app.showToast("warning", "Not found in tree: " + node.path);
        this.select(found);
        this.$nextTick(() => {
            app.$(`[data-path="${CSS.escape(found.path)}"]`, this.$el)?.scrollIntoView({ block: "center" });
        });
    }

    async toggle(node)
    {
        if (node.type != "d") return this.select(node);
        if (node.open) {
            node.open = false;
            return this.flatten(this.results || this.tree);
        }
        if (!node.loaded) {
            node.loading = true;
            const { err, data } = await this.ls(node.path);
            node.loading = false;
            if (err) return app.showToast("error", err);
            node.children = this.prepare(data, node.path, node.depth + 1).
                                 sort((a, b) => (a.name.localeCompare(b.name)));
            node.loaded = true;
        }
        node.open = true;
        this.flatten(this.results || this.tree);
    }

    async select(node)
    {
        this.current = node;
        if (node.type == "d") {
            if (!node.open) await this.toggle(node);
            return;
        }
        this.showPreview(node);
    }

    // --- Preview -------------------------------------------------------------

    ext(name)
    {
        return (name || "").split(".").pop().toLowerCase();
    }

    icon(node)
    {
        if (node.type == "d") return node.open ? "bi-folder2-open text-warning" : "bi-folder-fill text-warning";
        const ext = this.ext(node.name);
        if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "bi-file-earmark-image text-info";
        if (["mp4", "webm", "ogv", "mov"].includes(ext)) return "bi-file-earmark-play text-danger";
        if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "bi-file-earmark-music text-success";
        if (ext == "pdf") return "bi-file-earmark-pdf text-danger";
        if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) return "bi-file-earmark-zip text-secondary";
        if (["js", "json", "html", "css", "py", "sh", "ts", "md"].includes(ext)) return "bi-file-earmark-code text-primary";
        if (["txt", "csv", "log", "xml", "yml", "yaml", "ini", "conf"].includes(ext)) return "bi-file-earmark-text text-secondary";
        return "bi-file-earmark text-secondary";
    }

    kind(node)
    {
        const t = this.previewType(node);
        return t == "image" ? "Image" : t == "video" ? "Video" : t == "audio" ? "Audio" :
               t == "frame" ? "Document" : t == "text" ? "Text" : "File";
    }

    previewType(node)
    {
        const ext = this.ext(node.name);
        if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
        if (["mp4", "webm", "ogv"].includes(ext)) return "video";
        if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
        if (["pdf", "html", "htm"].includes(ext)) return "frame";
        if (["txt", "md", "csv", "log", "json", "js", "css", "xml", "yml", "yaml", "ini", "conf", "sh", "py", "ts"].includes(ext)) return "text";
        return "none";
    }

    async showPreview(node)
    {
        this.preview = this.previewType(node);
        this.text = "";
        if (this.preview != "text") return;
        this.textLoading = true;
        const { err, data } = await this.readText(node);
        this.textLoading = false;
        if (err) return app.showToast("error", err);
        if (this.current === node) this.text = typeof data == "string" ? data : JSON.stringify(data, null, 2);
    }

    // --- Actions -------------------------------------------------------------

    rename()
    {
        const node = this.current;
        if (!node) return;
        const popup = app.bootpopup({
            title: "Rename",
            alert: 1,
            content: [
                { input: { name: "name", label: "New name:", value: node.name } },
            ],
            buttons: ["cancel", "Rename"],
            Rename: async (d) => {
                const name = (d.name || "").trim();
                if (!name) return popup.showAlert("Name is required");
                if (name.includes("/")) return popup.showAlert("Name cannot contain /");
                const { err } = await app.fetch("/api/mv", { post: 1, body: { file: node.file, name } });
                if (err) return popup.showAlert(err);
                const parent = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
                node.name = name;
                node.path = parent ? parent + "/" + name : name;
                // children paths are reloaded on next expand
                node.loaded = false;
                node.open = false;
                node.children = [];
                this.flatten(this.results || this.tree);
                popup.close();
                app.showToast("success", "Renamed");
                return null;
            },
        });
    }

    remove()
    {
        const node = this.current;
        if (!node) return;
        app.bootpopup.confirm(`Delete ${node.type == "d" ? "folder" : node.type == "l" ? "link": "file"} "${node.name}"?`, async (ok) => {
            if (!ok) return;
            const { err } = await app.fetch("/api/rm", { post: 1, body: { file: node.file } });
            if (err) return app.showToast("error", err);
            // remove from whichever list holds it: search results or the tree
            node.hidden = true;
            this.current = null;
            this.flatten(this.results || this.tree);
            app.showToast("success", "Deleted");
        });
    }

};

app.$ready(() => {
    app.render("index");
});
