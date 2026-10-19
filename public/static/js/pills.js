/**
 * Pill CRUD on the /pills page.
 * The list is fetched client-side (the page is a static shell), then the add
 * form submit + delegated delete handler operate on the rendered rows.
 */
(function () {
  const page = document.querySelector('.pill-manage');
  if (!page) return;

  const list = document.getElementById('pill-list');
  const emptyState = document.getElementById('pill-empty');
  const addForm = document.getElementById('add-pill-form');

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

  function createPillRowEl(pill) {
    const li = document.createElement('li');
    li.className = 'pill-row';
    li.dataset.pillId = pill.id;
    li.innerHTML =
      '<span class="pill-swatch" style="background: ' + escapeHtml(pill.color) + '"></span>' +
      '<span class="pill-row__label">' + escapeHtml(pill.label) + '</span>' +
      '<button class="pill-row__delete" data-pill-id="' + pill.id + '">Delete</button>';
    return li;
  }

  function updateEmptyState() {
    emptyState.style.display =
      list.querySelectorAll('.pill-row').length ? 'none' : '';
  }

  // --- Initial load ---

  (async function load() {
    try {
      const pills = await api.get('/api/pills');
      list.innerHTML = '';
      pills.forEach(function (pill) {
        list.appendChild(createPillRowEl(pill));
      });
      updateEmptyState();
    } catch (err) {
      showError('Failed to load pills: ' + err.message);
    }
  })();

  // --- Submit Add Form ---

  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const label = addForm.querySelector('[name="label"]').value.trim();
    const color = addForm.querySelector('[name="color"]').value;

    if (!label) {
      showError('Label is required.');
      return;
    }

    // Client-side duplicate guard (server 409 is the fallback)
    const exists = Array.from(list.querySelectorAll('.pill-row__label'))
      .some(function (el) { return el.textContent === label; });
    if (exists) {
      showError('A pill with this label already exists.');
      return;
    }

    try {
      const pill = await api.post('/api/pills', { label: label, color: color });
      // Rows are sorted by label; insert before the first row whose label sorts after.
      const row = createPillRowEl(pill);
      const rows = Array.from(list.querySelectorAll('.pill-row'));
      const next = rows.find(function (r) {
        return r.querySelector('.pill-row__label').textContent > label;
      });
      if (next) list.insertBefore(row, next);
      else list.appendChild(row);
      addForm.reset();
      updateEmptyState();
    } catch (err) {
      showError('Failed to add pill: ' + err.message);
    }
  });

  // --- Delegated Delete ---

  list.addEventListener('click', async function (e) {
    const delBtn = e.target.closest('.pill-row__delete');
    if (!delBtn) return;

    if (!(await confirmDialog('Delete this pill? It will be removed from all bikes.'))) return;

    const row = delBtn.closest('.pill-row');
    try {
      await api.del('/api/pills/' + delBtn.dataset.pillId);
      row.remove();
      updateEmptyState();
    } catch (err) {
      showError('Failed to delete: ' + err.message);
    }
  });
})();
