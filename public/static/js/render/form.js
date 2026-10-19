/**
 * Shared create/edit bike form. Ports the inline submit handler from
 * bike_form.html.j2 and fills the edit form from the API. The bike id is set
 * on #image-list synchronously (before any await) so image-upload.js — loaded
 * after this file — enters edit mode against the right bike.
 */
(function () {
  const form = document.getElementById('bike-form');
  if (!form) return;

  const editMatch = location.pathname.match(/^\/bikes\/(\d+)\/edit\/?$/);
  const mode = editMatch ? 'edit' : 'create';
  const bikeId = editMatch ? editMatch[1] : null;

  const submitBtn = document.getElementById('form-submit');
  const imageList = document.getElementById('image-list');
  let submitting = false;
  let loaded = mode === 'create';

  // --- Mode setup (synchronous: image-upload.js loads next) ---

  if (mode === 'edit') {
    imageList.dataset.bikeId = bikeId;
    document.getElementById('form-back-link').href = '/bikes/' + bikeId;
    document.getElementById('form-back-link').textContent = 'Back to bike';
    document.getElementById('form-title').textContent = 'Edit Bike';
    document.getElementById('form-submit').textContent = 'Save Changes';
    document.getElementById('form-cancel').href = '/bikes/' + bikeId;
    const note = document.getElementById('image-note');
    if (note) note.remove();
    submitBtn.disabled = true; // re-enabled once the bike has loaded
  }

  // --- Helpers ---

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createImageRow(image) {
    const div = document.createElement('div');
    div.className = 'image-row' + (image.is_primary ? ' is-primary' : '');
    div.dataset.imageId = image.id;
    div.innerHTML =
      '<span class="image-row__handle" draggable="true" title="Drag to reorder">&vArr;</span>' +
      '<img src="' + escapeHtml(image.thumb_url) + '" alt="' + escapeHtml(image.original_name) + '">' +
      '<button type="button" class="image-row__primary" data-image-id="' + image.id + '" title="Make primary">' +
        (image.is_primary ? '★' : '☆') +
      '</button>' +
      '<button type="button" class="image-row__delete" data-image-id="' + image.id + '" title="Delete image">&times;</button>';
    return div;
  }

  function fillBike(bike) {
    form.elements.name.value = bike.name || '';
    form.elements.description.value = bike.description || '';
    form.elements.full_story.value = bike.full_story || '';
    form.elements.acquired_on.value = bike.acquired_on || '';
    form.elements.retired_on.value = bike.retired_on || '';
    const status = bike.status === 'former' ? 'former' : 'active';
    const radio = form.querySelector('input[name="status"][value="' + status + '"]');
    if (radio) radio.checked = true;

    imageList.innerHTML = '';
    (bike.images || []).forEach(function (img) {
      imageList.appendChild(createImageRow(img));
    });
  }

  function fillPills(pills, checkedIds) {
    const selector = document.getElementById('pill-selector');
    selector.innerHTML = pills.map(function (pill) {
      return '<label class="pill-option" style="--pill-color: ' + escapeHtml(pill.color) + '">' +
        '<input type="checkbox" name="pill_ids" value="' + pill.id + '"' +
          (checkedIds.has(pill.id) ? ' checked' : '') + '>' +
        escapeHtml(pill.label) +
      '</label>';
    }).join('');
  }

  // --- Load initial data ---

  (async function load() {
    try {
      const pillsPromise = api.get('/api/pills');
      const bikePromise = mode === 'edit' ? api.get('/api/bikes/' + bikeId) : Promise.resolve(null);
      const results = await Promise.all([pillsPromise, bikePromise]);
      const pills = results[0];
      const bike = results[1];

      const checkedIds = new Set();
      if (bike) {
        (bike.pills || []).forEach(function (p) { checkedIds.add(p.id); });
        fillBike(bike);
        document.title = bike.name + ' — Edit — Bike View';
      }
      fillPills(pills, checkedIds);

      loaded = true;
      submitBtn.disabled = false;
    } catch (err) {
      showError('Failed to load form: ' + err.message);
    }
  })();

  // --- Submit (ported from bike_form.html.j2) ---

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!loaded || submitting) return;

    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      description: formData.get('description') || '',
      full_story: formData.get('full_story') || '',
      status: formData.get('status') || 'active',
      acquired_on: formData.get('acquired_on') || null,
      retired_on: formData.get('retired_on') || null,
    };
    const pillIds = formData.getAll('pill_ids').map(Number);

    submitting = true;
    submitBtn.disabled = true;

    try {
      if (mode === 'create') {
        const bike = await api.post('/api/bikes', data);
        // Post-create steps are best-effort: the bike exists, so alert and
        // still redirect rather than strand the user on the form.
        if (pillIds.length > 0) {
          try {
            await api.put('/api/bikes/' + bike.id + '/pills', { pill_ids: pillIds });
          } catch (err) {
            showError('Bike created, but pills failed to save: ' + err.message);
          }
        }
        if (window.BikeImages && window.BikeImages.hasPending()) {
          try {
            await window.BikeImages.uploadPending(bike.id);
          } catch (err) {
            showError('Bike created, but image upload failed: ' + err.message + ' (add them via Edit)');
          }
        }
        window.location.href = '/bikes/' + bike.id;
      } else {
        await api.patch('/api/bikes/' + bikeId, data);
        await api.put('/api/bikes/' + bikeId + '/pills', { pill_ids: pillIds });
        window.location.href = '/bikes/' + bikeId;
      }
    } catch (err) {
      submitting = false;
      submitBtn.disabled = false;
      showError('Failed to ' + (mode === 'create' ? 'create bike' : 'save bike') + ': ' + err.message);
    }
  });
})();
