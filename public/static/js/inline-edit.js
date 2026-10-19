/**
 * Inline headline editing on bike cards.
 * Click the bike name to edit it inline. Blur or Enter saves via PATCH.
 */
document.addEventListener('click', (e) => {
  const nameEl = e.target.closest('.bike-card__name-text');
  if (!nameEl) return;

  const cardName = nameEl.closest('.bike-card__name');
  const bikeId = cardName.dataset.bikeId;
  const current = nameEl.textContent.trim();

  // Replace span with input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'bike-card__name-input';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newName = input.value.trim();
    if (!newName || newName === current) {
      // Revert
      const span = document.createElement('span');
      span.className = 'bike-card__name-text';
      span.textContent = current;
      input.replaceWith(span);
      return;
    }

    // Show saving state
    input.disabled = true;

    try {
      await api.patch(`/api/bikes/${bikeId}`, { name: newName });
      const span = document.createElement('span');
      span.className = 'bike-card__name-text';
      span.textContent = newName;
      input.replaceWith(span);
    } catch (err) {
      input.disabled = false;
      input.style.borderColor = 'var(--color-danger)';
      console.error('Failed to save bike name:', err);
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === 'Escape') {
      const span = document.createElement('span');
      span.className = 'bike-card__name-text';
      span.textContent = current;
      input.replaceWith(span);
    }
  });
});
