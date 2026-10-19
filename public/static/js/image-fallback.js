/**
 * Placeholder fallback for missing image files. Import restores image rows,
 * not bytes — when uploads/ wasn't copied alongside a bike_view.json export,
 * /api/images 404s and the img swaps to the placeholder here. Capture phase
 * covers every <img>, including ones created dynamically by image-upload.js.
 */
(function () {
  document.addEventListener('error', function (e) {
    const img = e.target;
    if (img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = '1'; // no loop if the placeholder itself 404s
    img.src = '/static/img/placeholder-bike.svg';
    img.classList.add('image-fallback');
  }, true);
})();
