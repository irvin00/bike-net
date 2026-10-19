/**
 * Settings / Data page. Export is a plain anchor — the endpoint sets
 * Content-Disposition. Import posts the picked file to /api/import behind a
 * confirm dialog (destructive full restore) and shows the restored counts.
 */
(function () {
  const fileInput = document.getElementById('import-file');
  const importBtn = document.getElementById('import-btn');
  const statusEl = document.getElementById('import-status');
  if (!fileInput || !importBtn || !statusEl) return;

  fileInput.addEventListener('change', function () {
    importBtn.disabled = !fileInput.files.length;
    statusEl.hidden = true;
  });

  importBtn.addEventListener('click', async function () {
    const file = fileInput.files[0];
    if (!file) return;
    const ok = await confirmDialog(
      'Importing "' + file.name + '" replaces ALL existing bikes, pills, photos, and maintenance records. Continue?',
      { confirmLabel: 'Import' }
    );
    if (!ok) return;

    const fd = new FormData();
    fd.append('file', file);
    try {
      const result = await api.upload('/api/import', fd);
      statusEl.textContent = 'Restored ' + result.bikes + ' bikes, ' +
        result.pills + ' pills, ' + result.images + ' images, ' +
        result.maintenance + ' maintenance records.';
      statusEl.classList.add('settings-status--ok');
      statusEl.hidden = false;
      fileInput.value = '';
      importBtn.disabled = true;
    } catch (err) {
      showError('Import failed: ' + err.message);
    }
  });
})();
