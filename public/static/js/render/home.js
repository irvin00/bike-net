/**
 * Home page renderer: fetches the bike list and builds the card grid that
 * used to be server-rendered by index.html.j2 + partials/bike_card.html.j2.
 * Delegated modules (inline-edit.js, bike-delete.js) operate on this markup.
 */
(function () {
  const grid = document.getElementById('bike-grid');
  const emptyState = document.getElementById('empty-state');
  const statusFilter = document.getElementById('status-filter');
  if (!grid) return;

  const params = new URLSearchParams(location.search);
  const rawStatus = params.get('status');
  const status = rawStatus === 'active' || rawStatus === 'former' ? rawStatus : 'all';

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

  function pillBadge(pill) {
    const color = escapeHtml(pill.color);
    return '<span class="pill-badge" style="background: ' + color + '1a; color: ' +
      color + '; border: 1px solid ' + color + '40;">' + escapeHtml(pill.label) + '</span>';
  }

  function bikeCard(bike) {
    const image = bike.primary_image
      ? '<img src="/api/images/' + bike.id + '/' + escapeHtml(bike.primary_thumb) +
        '" alt="' + escapeHtml(bike.name) + '" class="bike-card__image">'
      : '<img src="/static/img/placeholder-bike.svg" alt="" class="bike-card__image bike-card__image--placeholder">';

    const statusLabel = bike.status === 'active' ? 'Active' : 'Former';
    const pills = bike.pills && bike.pills.length
      ? '<div class="bike-card__pills">' + bike.pills.map(pillBadge).join('') + '</div>'
      : '';

    return '<article class="bike-card" data-bike-id="' + bike.id + '">' +
      '<a href="/bikes/' + bike.id + '" class="bike-card__image-link">' + image + '</a>' +
      '<div class="bike-card__body">' +
        '<h2 class="bike-card__name" data-bike-id="' + bike.id + '">' +
          '<span class="bike-card__name-text">' + escapeHtml(bike.name) + '</span>' +
        '</h2>' +
        '<p class="bike-card__desc">' + escapeHtml(bike.description) + '</p>' +
        pills +
        '<div class="bike-card__footer">' +
          '<span class="bike-card__status status--' + escapeHtml(bike.status) + '">' + statusLabel + '</span>' +
          '<button class="bike-card__delete btn--icon" data-bike-id="' + bike.id +
            '" data-bike-name="' + escapeHtml(bike.name) + '" title="Delete bike">&times;</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function emptyCopy() {
    if (status === 'active') return 'No active bikes.';
    if (status === 'former') return 'No former bikes.';
    return 'No bikes yet. <a href="/bikes/new">Add your first one</a>.';
  }

  function updateFilterActiveState() {
    if (!statusFilter) return;
    statusFilter.querySelectorAll('.status-filter__btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
  }

  // --- Load + render ---

  updateFilterActiveState();

  (async function load() {
    try {
      const bikes = await api.get('/api/bikes' + (status === 'all' ? '' : '?status=' + status));
      grid.innerHTML = bikes.map(bikeCard).join('');
      if (bikes.length) {
        emptyState.style.display = 'none';
      } else {
        emptyState.innerHTML = emptyCopy();
        emptyState.style.display = '';
      }
    } catch (err) {
      showError('Failed to load bikes: ' + err.message);
    }
  })();
})();
