/**
 * Image management on the bike form (edit + create): drag-and-drop upload
 * zone, primary selection, reorder, delete.
 *
 * Difference from the Python app: Pillow is gone. Netlify Functions reject
 * requests over 6MB, so the browser now does the resize + thumbnail work with
 * a canvas (EXIF orientation honored, alpha flattened onto white, JPEG q85,
 * 2000px full / 1024px thumb — same constants as app/image_store.py) and
 * uploads the full + thumb pair one file per request.
 *
 * Edit mode talks to the API; create mode holds files client-side as pending
 * previews (object URLs) and uploads them after the bike is created via
 * window.BikeImages.uploadPending — called by render/form.js. Local DOM
 * mutation from API responses (no list refetch on success); a GET re-render
 * is the error recovery path — never location.reload(), which would wipe
 * unsaved form fields.
 */
(function () {
  const zone = document.getElementById('upload-zone');
  const list = document.getElementById('image-list');
  if (!zone || !list) return;

  // Mode signal: render/form.js sets data-bike-id synchronously in edit mode.
  const bikeId = list.dataset.bikeId;
  const isCreate = !bikeId;
  const fileInput = document.getElementById('image-file-input');

  const MAX_FULL = 2000;
  const MAX_THUMB = 1024;
  const JPEG_QUALITY = 0.85;
  const MAX_RAW_BYTES = 25 * 1024 * 1024;

  // Create-mode pending state: DOM order IS upload order; the map only
  // retains the file + preview URL payloads.
  let pendingIdCounter = 0;
  let pendingById = new Map();

  // --- Helpers ---

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // String row key shared by both modes. Edit rows carry data-image-id,
  // pending rows data-pending-id. (Must stay a string: Number(undefined)
  // is NaN and NaN === NaN is false, which would break dragover's skip.)
  function rowKey(row) {
    return row.dataset.imageId || row.dataset.pendingId;
  }

  // Mirror of the Jinja row in bike_form.html.j2, built from API data.
  function createRowEl(image) {
    const div = document.createElement('div');
    div.className = 'image-row' + (image.is_primary ? ' is-primary' : '');
    div.dataset.imageId = image.id;
    div.innerHTML =
      '<span class="image-row__handle" draggable="true" title="Drag to reorder">&vArr;</span>' +
      '<img src="' + escapeHtml(image.thumb_url) + '" alt="' + escapeHtml(image.original_name) + '">' +
      '<button type="button" class="image-row__primary" data-image-id="' + image.id + '" title="Make primary">' +
        (image.is_primary ? '★' : '☆') + '</button>' +
      '<button type="button" class="image-row__delete" data-image-id="' + image.id + '" title="Delete image">&times;</button>';
    return div;
  }

  // Pending row (create mode): same layout, no star button — the server
  // makes the first uploaded image primary, so reorder order decides it.
  function createPendingRowEl(item) {
    const div = document.createElement('div');
    div.className = 'image-row is-pending';
    div.dataset.pendingId = item.id;
    div.innerHTML =
      '<span class="image-row__handle" draggable="true" title="Drag to reorder">&vArr;</span>' +
      '<img src="' + escapeHtml(item.url) + '" alt="' + escapeHtml(item.file.name) + '">' +
      '<button type="button" class="image-row__delete" title="Remove image">&times;</button>';
    return div;
  }

  function starRow(row) {
    const prev = list.querySelector('.image-row.is-primary');
    if (prev) {
      prev.classList.remove('is-primary');
      prev.querySelector('.image-row__primary').textContent = '☆';
    }
    row.classList.add('is-primary');
    row.querySelector('.image-row__primary').textContent = '★';
  }

  function renderFromApi(bike) {
    list.innerHTML = '';
    bike.images.forEach(function (img) {
      list.appendChild(createRowEl(img));
    });
  }

  // --- Browser-side image processing (Pillow replacement) ---

  function fileLabel(file) {
    return (file && file.name) || 'image';
  }

  function failure(file, message) {
    return new Error(fileLabel(file) + ': ' + message);
  }

  function isHeic(file) {
    return /heic|heif/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  }

  function fittedSize(width, height, bound) {
    const scale = Math.min(1, bound / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  function encodeJpeg(bitmap, bound) {
    const size = fittedSize(bitmap.width, bitmap.height, bound);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // flatten RGBA onto white (Pillow _to_rgb)
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode image'));
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }

  async function processFile(file) {
    if (!file || file.size === 0) throw failure(file, 'empty file');
    if (file.size > MAX_RAW_BYTES) throw failure(file, 'file exceeds 25MB limit');
    if (file.type && !file.type.startsWith('image/')) throw failure(file, 'not an image file');

    let bitmap;
    try {
      // Honors EXIF orientation and decodes the real pixels. HEIC decodes in
      // Safari; Chrome/Firefox throw, which is surfaced below with a hint.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (err) {
      throw failure(file, isHeic(file)
        ? 'Not a valid image — HEIC photos only work in Safari. Convert to JPG/PNG first.'
        : 'Not a valid image');
    }

    try {
      const full = await encodeJpeg(bitmap, MAX_FULL);
      const thumb = await encodeJpeg(bitmap, MAX_THUMB);
      return { full: full, thumb: thumb };
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }

  async function processAndUpload(bike, file) {
    const prepared = await processFile(file);
    const fd = new FormData();
    const stem = (file.name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
    fd.append('files', prepared.full, stem + '.jpg');
    fd.append('thumb', prepared.thumb, stem + '.jpg');
    fd.append('original_name', file.name || 'image');
    const created = await api.upload('/api/bikes/' + bike + '/images', fd);
    return created[0];
  }

  // --- Upload ---

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    if (isCreate) {
      // Create mode: hold files client-side; they upload after the bike exists.
      files.forEach(function (file) {
        const item = { id: ++pendingIdCounter, file: file, url: URL.createObjectURL(file) };
        pendingById.set(item.id, item);
        list.appendChild(createPendingRowEl(item));
      });
      return;
    }

    // Edit mode: process + upload sequentially, one file per request, so each
    // request stays well under the 6MB function limit. Per-file success means
    // one bad file no longer discards the rest of the batch.
    for (const file of files) {
      try {
        const image = await processAndUpload(bikeId, file);
        list.appendChild(createRowEl(image));
      } catch (err) {
        showError('Upload failed: ' + err.message);
      }
    }
  }

  zone.addEventListener('click', function () {
    fileInput.click();
  });

  zone.addEventListener('dragover', function (e) {
    if (!e.dataTransfer.types.includes('Files')) return; // don't hijack text drags
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', function (e) {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', function () {
    uploadFiles(fileInput.files);
    fileInput.value = ''; // allow re-selecting the same file
  });

  // --- Delete (delegated) ---

  list.addEventListener('click', async function (e) {
    const starBtn = e.target.closest('.image-row__primary');
    if (starBtn) {
      const row = starBtn.closest('.image-row');
      if (row.classList.contains('is-primary')) return;
      try {
        await api.patch(
          '/api/bikes/' + bikeId + '/images/' + starBtn.dataset.imageId,
          { is_primary: true }
        );
        starRow(row); // server response confirms; unstar the old primary locally
      } catch (err) {
        showError('Failed to set primary: ' + err.message);
      }
      return;
    }

    const delBtn = e.target.closest('.image-row__delete');
    if (!delBtn) return;

    if (!(await confirmDialog('Delete this image?'))) return;

    const row = delBtn.closest('.image-row');

    // Create mode: pending rows are local only — no API call.
    const pendingId = row.dataset.pendingId;
    if (pendingId) {
      const item = pendingById.get(Number(pendingId));
      if (item) URL.revokeObjectURL(item.url);
      pendingById.delete(Number(pendingId));
      row.remove();
      return;
    }

    const wasPrimary = row.classList.contains('is-primary');
    try {
      await api.del('/api/bikes/' + bikeId + '/images/' + delBtn.dataset.imageId);
      row.remove();
      // Mirror the server's promotion rule: first remaining row in DOM order
      // becomes primary (server: lowest sort_order, tie-break oldest id — the
      // form renders in that order).
      if (wasPrimary) {
        const first = list.querySelector('.image-row');
        if (first) starRow(first);
      }
    } catch (err) {
      showError('Failed to delete: ' + err.message);
    }
  });

  // --- Reorder (HTML5 drag-and-drop on the handle) ---

  let dragId = null;
  let orderBefore = [];

  list.addEventListener('dragstart', function (e) {
    const handle = e.target.closest('.image-row__handle');
    if (!handle) return;
    const row = handle.closest('.image-row');
    dragId = rowKey(row);
    orderBefore = Array.from(list.querySelectorAll('.image-row')).map(rowKey);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId)); // required for Firefox
  });

  list.addEventListener('dragover', function (e) {
    const row = e.target.closest('.image-row');
    if (!row || dragId == null || rowKey(row) === dragId) return;
    e.preventDefault(); // required to allow the drop
    const dragging = list.querySelector('.image-row.dragging');
    if (!dragging) return;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    if (before) {
      if (row.previousElementSibling !== dragging) list.insertBefore(dragging, row);
    } else {
      if (row.nextElementSibling !== dragging) list.insertBefore(dragging, row.nextElementSibling);
    }
  });

  list.addEventListener('drop', async function (e) {
    e.preventDefault();
    if (dragId == null) return;
    if (isCreate) {
      // Create mode: DOM order IS upload order — just resync the map.
      const next = new Map();
      list.querySelectorAll('.image-row').forEach(function (r) {
        const key = Number(r.dataset.pendingId);
        if (pendingById.has(key)) next.set(key, pendingById.get(key));
      });
      pendingById = next;
      return;
    }
    const orderAfter = Array.from(list.querySelectorAll('.image-row')).map(rowKey);
    // DOM order IS sort order; PATCH only the images whose index changed.
    const patches = [];
    orderAfter.forEach(function (id, idx) {
      if (orderBefore[idx] !== id) {
        patches.push(api.patch('/api/bikes/' + bikeId + '/images/' + id, { sort_order: idx }));
      }
    });
    try {
      await Promise.all(patches);
    } catch (err) {
      showError('Failed to save order: ' + err.message);
      try {
        const bike = await api.get('/api/bikes/' + bikeId);
        renderFromApi(bike);
      } catch (err2) {
        console.error('Resync failed', err2);
      }
    }
  });

  list.addEventListener('dragend', function () {
    const dragging = list.querySelector('.image-row.dragging');
    if (dragging) dragging.classList.remove('dragging');
    dragId = null;
  });

  // Create-mode API for render/form.js: upload pending files to the
  // just-created bike, sequentially in DOM order. Throws a combined error if
  // any file failed so the caller can alert (then still redirect).
  window.BikeImages = {
    hasPending: function () { return pendingById.size > 0; },
    uploadPending: async function (newBikeId) {
      if (!pendingById.size) return;
      const items = [];
      list.querySelectorAll('.image-row').forEach(function (r) {
        const item = pendingById.get(Number(r.dataset.pendingId));
        if (item) items.push(item);
      });

      const errors = [];
      for (const item of items) {
        try {
          await processAndUpload(newBikeId, item.file);
        } catch (err) {
          errors.push(err.message);
        }
      }

      pendingById.forEach(function (item) { URL.revokeObjectURL(item.url); });
      pendingById.clear();
      list.innerHTML = '';
      if (errors.length) throw new Error(errors.join('; '));
    },
  };
})();
