import vscode from './vscode_extension'
import {loadFromUrl} from './share'

if (!vscode) {
    window.onbeforeunload = function() {
        return 'Your changes might not be saved';
    }

    // No offline worker in this fork: its cache-first copy would keep an old build after each deploy.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(list => list.forEach(r => r.unregister())).catch(() => {});
    }

    loadFromUrl()
}
