/**
 * Delete bikes from the home grid (X on each card) and the detail page
 * ("Delete Bike" button). The detail button is created by render/detail.js
 * after its fetch, so it is handled via document-level delegation.
 */
(function () {
  const grid = document.getElementById('bike-grid');

  async function deleteBike(id, name, onSuccess) {
    const ok = await confirmDialog('Delete "' + name + '"? This also removes its photos and maintenance history.');
    if (!ok) return;
    try {
      await api.del('/api/bikes/' + id); // api.del surfaces the server 404 detail
      onSuccess();
    } catch (err) {
      showError('Failed to delete bike: ' + err.message);
    }
  }

  if (grid) {
    const emptyState = document.getElementById('empty-state');
    const updateEmptyState = function () {
      emptyState.style.display =
        grid.querySelectorAll('.bike-card').length ? 'none' : '';
    };

    grid.addEventListener('click', function (e) {
      const delBtn = e.target.closest('.bike-card__delete');
      if (!delBtn) return;
      const card = delBtn.closest('.bike-card');
      deleteBike(delBtn.dataset.bikeId, delBtn.dataset.bikeName, function () {
        card.remove();
        updateEmptyState();
      });
    });
  }

  // Delegated so it works regardless of when render/detail.js inserts the button.
  document.addEventListener('click', function (e) {
    const detailBtn = e.target.closest('#delete-bike-btn');
    if (!detailBtn) return;
    deleteBike(detailBtn.dataset.bikeId, detailBtn.dataset.bikeName, function () {
      window.location.href = '/'; // the bike no longer exists
    });
  });
})();
