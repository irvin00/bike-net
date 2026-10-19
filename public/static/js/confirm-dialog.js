/**
 * Native <dialog> confirm. Promise-based replacement for window.confirm:
 * confirmDialog(message) -> Promise<boolean>. ESC and backdrop click cancel;
 * focus returns to the opener on settle. Cancel is the default (Enter-safe:
 * the Cancel button is autofocused, so Enter never confirms a destructive
 * action — deliberate; don't "fix" it).
 */
(function () {
  const dialog = document.getElementById('confirm-dialog');
  if (!dialog) return;
  const msgEl = dialog.querySelector('.confirm-dialog__message');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');

  let resolveFn = null;
  let lastFocus = null;

  function settle(value) {
    if (!dialog.open) return;
    dialog.close();
    const resolve = resolveFn;
    resolveFn = null;
    if (resolve) resolve(value);
    if (lastFocus) {
      lastFocus.focus();
      lastFocus = null;
    }
  }

  okBtn.addEventListener('click', function () { settle(true); });
  cancelBtn.addEventListener('click', function () { settle(false); });
  dialog.addEventListener('cancel', function (e) {
    e.preventDefault(); // ESC: keep control of resolution
    settle(false);
  });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) settle(false); // backdrop click
  });
  dialog.addEventListener('close', function () {
    if (resolveFn) {
      const r = resolveFn;
      resolveFn = null;
      r(false);
    }
  });

  window.confirmDialog = function (message, options) {
    if (resolveFn) resolveFn(false); // one dialog at a time
    msgEl.textContent = message;
    okBtn.textContent = (options && options.confirmLabel) || 'Delete';
    lastFocus = document.activeElement;
    dialog.showModal();
    return new Promise(function (resolve) { resolveFn = resolve; });
  };
})();
