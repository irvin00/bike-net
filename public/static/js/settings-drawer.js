/**
 * Native <dialog> settings drawer. The gear button in the nav opens a
 * slide-in sidebar; ESC and backdrop click close it, focus returns to the
 * opener. Same overlay pattern as the confirm dialog.
 */
(function () {
  const dialog = document.getElementById('settings-drawer');
  const openBtn = document.getElementById('settings-open-btn');
  const closeBtn = document.getElementById('settings-close-btn');
  if (!dialog || !openBtn) return;

  let lastFocus = null;

  function openDrawer() {
    lastFocus = document.activeElement;
    dialog.showModal();
    if (closeBtn) closeBtn.focus(); // Enter-safe: opens on the close button
  }

  function closeDrawer() {
    if (!dialog.open) return;
    dialog.close();
    if (lastFocus) {
      lastFocus.focus();
      lastFocus = null;
    }
  }

  openBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  dialog.addEventListener('cancel', function (e) {
    e.preventDefault(); // ESC: keep control of closing
    closeDrawer();
  });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) closeDrawer(); // backdrop click
  });

  window.openSettingsDrawer = openDrawer;
})();
