// Handle Push events to display messages
console.log("ServiceWorker loaded: Push Notifications");
self.addEventListener("push", (e) => {
    const options = {};
    const data = e.data && e.data.json() || {};
    for (const p of ["actions", "badge", "body" ,"data", "dir", "icon", "image", "lang", "renotify", "requireInteraction", "silent", "tag", "timestamp", "vibrate"]) {
        if (typeof data[p] != "undefined") options[p] = data[p];
    }
    if (data.body && !data.title) delete options.body;
    self.registration.showNotification(data.title || data.body || "New message!", options);
});
