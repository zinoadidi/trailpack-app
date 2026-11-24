// Register the service worker as early as possible, so the shell is cached on
// the first visit. A separate file because the security policy forbids inline scripts.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
