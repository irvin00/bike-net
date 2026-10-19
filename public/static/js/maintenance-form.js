/**
 * Maintenance record CRUD on the bike detail page.
 * Uses delegated event handlers on the maintenance section container.
 */
(function () {
  const section = document.querySelector('.maintenance-section');
  if (!section) return;

  const timeline = document.getElementById('maintenance-timeline');
  const addForm = document.getElementById('add-maintenance-form');
  const bikeId = section.dataset.bikeId;

  // --- Helpers ---

  function formatCost(cost) {
    if (cost === null || cost === undefined || cost === '') return '';
    return '$' + parseFloat(cost).toFixed(2);
  }

  function createRecordEl(record) {
    const div = document.createElement('div');
    div.className = 'maintenance-record';
    div.dataset.recordId = record.id;

    const cost = record.cost !== null && record.cost !== undefined ? record.cost : '';

    div.innerHTML =
      '<div class="maintenance-record__date">' + escapeHtml(record.date) + '</div>' +
      '<div class="maintenance-record__desc">' + escapeHtml(record.description) + '</div>' +
      (cost !== '' ? '<span class="maintenance-record__cost">' + formatCost(cost) + '</span>' : '') +
      '<div class="maintenance-record__actions">' +
        '<button class="maintenance-record__edit" data-record-id="' + record.id + '" data-record-date="' + escapeHtml(record.date) + '" data-record-desc="' + escapeHtml(record.description) + '" data-record-cost="' + cost + '">Edit</button>' +
        '<button class="maintenance-record__delete" data-record-id="' + record.id + '">Delete</button>' +
      '</div>';

    return div;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateHeaderCount(delta) {
    const h2 = section.querySelector('.maintenance-header h2');
    const match = h2.textContent.match(/\((\d+)\)/);
    if (match) {
      const count = parseInt(match[1], 10) + delta;
      h2.textContent = 'Maintenance History (' + count + ')';
    }
  }

  // --- Toggle Add Form ---

  document.getElementById('add-maintenance-btn').addEventListener('click', function () {
    addForm.classList.toggle('maintenance-form--hidden');
    if (!addForm.classList.contains('maintenance-form--hidden')) {
      addForm.querySelector('[name="date"]').focus();
    }
  });

  document.getElementById('cancel-maintenance-btn').addEventListener('click', function () {
    addForm.reset();
    addForm.classList.add('maintenance-form--hidden');
  });

  // --- Submit Add Form ---

  addForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(addForm);
    const data = {
      date: formData.get('date'),
      description: formData.get('description'),
      cost: formData.get('cost') ? parseFloat(formData.get('cost')) : null,
    };

    if (!data.date || !data.description) {
      showError('Date and description are required.');
      return;
    }

    try {
      const record = await api.post('/api/bikes/' + bikeId + '/maintenance', data);
      timeline.prepend(createRecordEl(record));
      addForm.reset();
      addForm.classList.add('maintenance-form--hidden');
      updateHeaderCount(1);
    } catch (err) {
      showError('Failed to add record: ' + err.message);
    }
  });

  // --- Delegated Edit & Delete ---

  section.addEventListener('click', async function (e) {
    // --- Edit button ---
    const editBtn = e.target.closest('.maintenance-record__edit');
    if (editBtn) {
      const recordEl = editBtn.closest('.maintenance-record');
      const recordId = editBtn.dataset.recordId;
      const currentDate = editBtn.dataset.recordDate;
      const currentDesc = editBtn.dataset.recordDesc;
      const currentCost = editBtn.dataset.recordCost || '';

      // Replace content with edit form
      recordEl.innerHTML =
        '<div class="maintenance-record__edit-form">' +
          '<input type="date" name="edit-date" value="' + escapeHtml(currentDate) + '" required>' +
          '<input type="text" name="edit-desc" value="' + escapeHtml(currentDesc) + '" required>' +
          '<input type="number" name="edit-cost" value="' + escapeHtml(currentCost) + '" placeholder="Cost ($)" step="0.01" min="0">' +
          '<div class="maintenance-record__edit-actions">' +
            '<button class="maintenance-record__edit-save" data-record-id="' + recordId + '">Save</button>' +
            '<button class="maintenance-record__edit-cancel" data-record-id="' + recordId + '">Cancel</button>' +
          '</div>' +
        '</div>';

      recordEl.querySelector('[name="edit-date"]').focus();
      return;
    }

    // --- Save edit ---
    const saveBtn = e.target.closest('.maintenance-record__edit-save');
    if (saveBtn) {
      const recordEl = saveBtn.closest('.maintenance-record');
      const recordId = saveBtn.dataset.recordId;
      const form = recordEl.querySelector('.maintenance-record__edit-form');

      const dateInput = form.querySelector('[name="edit-date"]');
      const descInput = form.querySelector('[name="edit-desc"]');
      const costInput = form.querySelector('[name="edit-cost"]');

      const data = {
        date: dateInput.value,
        description: descInput.value,
        cost: costInput.value ? parseFloat(costInput.value) : null,
      };

      if (!data.date || !data.description) {
        showError('Date and description are required.');
        return;
      }

      try {
        const updated = await api.patch(
          '/api/bikes/' + bikeId + '/maintenance/' + recordId, data
        );
        const newEl = createRecordEl(updated);
        recordEl.replaceWith(newEl);
      } catch (err) {
        showError('Failed to save: ' + err.message);
      }
      return;
    }

    // --- Cancel edit ---
    const cancelBtn = e.target.closest('.maintenance-record__edit-cancel');
    if (cancelBtn) {
      const recordEl = cancelBtn.closest('.maintenance-record');
      const recordId = cancelBtn.dataset.recordId;
      // Build display from the edit form's current values
      const form = recordEl.querySelector('.maintenance-record__edit-form');
      const dateVal = form.querySelector('[name="edit-date"]').value;
      const descVal = form.querySelector('[name="edit-desc"]').value;
      const costVal = form.querySelector('[name="edit-cost"]').value;

      const display = {
        id: recordId,
        date: dateVal,
        description: descVal,
        cost: costVal ? parseFloat(costVal) : null,
      };
      const newEl = createRecordEl(display);
      recordEl.replaceWith(newEl);
      return;
    }

    // --- Delete button ---
    const delBtn = e.target.closest('.maintenance-record__delete');
    if (delBtn) {
      const recordEl = delBtn.closest('.maintenance-record');
      const recordId = delBtn.dataset.recordId;

      if (!(await confirmDialog('Delete this maintenance record?'))) return;

      try {
        await api.del('/api/bikes/' + bikeId + '/maintenance/' + recordId);
        recordEl.remove();
        updateHeaderCount(-1);
      } catch (err) {
        showError('Failed to delete: ' + err.message);
      }
    }
  });
})();
