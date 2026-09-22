
// Handle Push events to display messages
console.log("ServiceWorker loaded: Push Notifications");

self.addEventListener("push", (event) => {
    const options = {};
    const data = event.data && event.data.json() || {};
    for (const p of ["actions", "badge", "body" ,"data", "dir", "icon", "image", "lang", "renotify", "requireInteraction", "silent", "tag", "timestamp", "vibrate"]) {
        if (data[p] !== undefined) options[p] = data[p];
    }
    if (data.body && !data.title) delete options.body;
    if (data.renotify && !data.tag) delete options.renotify;
    if (data.silent) delete options.vibrate;
    self.registration.showNotification(data.title || data.body || "New message!", options);
});
