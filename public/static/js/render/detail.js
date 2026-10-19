/**
 * Bike detail renderer: fetches the bike + maintenance records and builds the
 * gallery/info/maintenance markup that used to be server-rendered by
 * bike_detail.html.j2. The bike id is set synchronously (before any await) so
 * maintenance-form.js — loaded after this file — binds to the right bike.
 */
(function () {
  const match = location.pathname.match(/^\/bikes\/(\d+)\/?$/);
  const galleryEl = document.getElementById('bike-gallery');
  const infoEl = document.getElementById('bike-info');
  const section = document.getElementById('maintenance-section');
  if (!match || !galleryEl || !infoEl || !section) return;

  const bikeId = match[1];
  section.dataset.bikeId = bikeId;

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

  function recordEl(record) {
    const cost = record.cost !== null && record.cost !== undefined
      ? '$' + Number(record.cost).toFixed(2)
      : '';
    const costAttr = record.cost !== null && record.cost !== undefined ? String(record.cost) : '';
    return '<div class="maintenance-record" data-record-id="' + record.id + '">' +
      '<div class="maintenance-record__date">' + escapeHtml(record.date) + '</div>' +
      '<div class="maintenance-record__desc">' + escapeHtml(record.description) + '</div>' +
      (cost ? '<span class="maintenance-record__cost">' + cost + '</span>' : '') +
      '<div class="maintenance-record__actions">' +
        '<button class="maintenance-record__edit" data-record-id="' + record.id +
          '" data-record-date="' + escapeHtml(record.date) +
          '" data-record-desc="' + escapeHtml(record.description) +
          '" data-record-cost="' + escapeHtml(costAttr) + '">Edit</button>' +
        '<button class="maintenance-record__delete" data-record-id="' + record.id + '">Delete</button>' +
      '</div>' +
    '</div>';
  }

  function renderGallery(bike) {
    if (!bike.images || !bike.images.length) {
      galleryEl.innerHTML = '<div class="gallery--empty">No images yet</div>';
      return;
    }

    const images = bike.images.map(function (img) {
      return '<img src="' + escapeHtml(img.thumb_url) + '" alt="' + escapeHtml(bike.name) +
        '" class="gallery__image" data-full-src="' + escapeHtml(img.url) + '">';
    }).join('');

    let arrows = '';
    if (bike.images.length > 1) {
      arrows =
        '<button type="button" class="gallery-nav__arrow gallery-nav__arrow--prev" aria-label="Previous image" disabled>' +
          '<svg class="gallery-nav__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
        '</button>' +
        '<button type="button" class="gallery-nav__arrow gallery-nav__arrow--next" aria-label="Next image">' +
          '<svg class="gallery-nav__icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>';
    }

    galleryEl.innerHTML = '<div class="gallery-nav"><div class="gallery">' + images + '</div>' + arrows + '</div>';

    // gallery-nav.js defines window.GalleryNav and auto-inits only if a gallery
    // exists at load; here the gallery was just created, so init explicitly.
    if (bike.images.length > 1 && window.GalleryNav) window.GalleryNav.init();
  }

  function renderInfo(bike) {
    let html = '<h1 class="bike-info__name">' + escapeHtml(bike.name) + '</h1>';

    html += '<div class="bike-info__meta">' +
      '<span class="bike-card__status status--' + escapeHtml(bike.status) + '">' +
        (bike.status === 'active' ? 'Active' : 'Former') +
      '</span>';
    if (bike.acquired_on) html += '<span>Acquired ' + escapeHtml(bike.acquired_on) + '</span>';
    if (bike.retired_on) html += '<span>Retired ' + escapeHtml(bike.retired_on) + '</span>';
    html += '</div>';

    if (bike.description) {
      html += '<p class="bike-info__description">' + escapeHtml(bike.description) + '</p>';
    }
    if (bike.full_story) {
      html += '<div class="bike-info__full-story">' + escapeHtml(bike.full_story) + '</div>';
    }
    if (bike.pills && bike.pills.length) {
      html += '<div class="bike-info__pills">' + bike.pills.map(pillBadge).join('') + '</div>';
    }

    html += '<div class="bike-detail__actions">' +
      '<a href="/bikes/' + bike.id + '/edit" class="btn btn--primary">Edit Bike</a>' +
      '<button type="button" id="delete-bike-btn" class="btn btn--danger" data-bike-id="' +
        bike.id + '" data-bike-name="' + escapeHtml(bike.name) + '">Delete Bike</button>' +
    '</div>';

    infoEl.innerHTML = html;
  }

  function renderMaintenance(records) {
    const heading = section.querySelector('.maintenance-header h2');
    if (heading) heading.textContent = 'Maintenance History (' + records.length + ')';
    const timeline = document.getElementById('maintenance-timeline');
    if (timeline) timeline.innerHTML = records.map(recordEl).join('');
  }

  function wireModal() {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-image');
    const closeBtn = document.getElementById('modal-close-btn');
    const gallery = document.querySelector('.gallery');
    if (!modal || !modalImg || !closeBtn) return;

    if (gallery) {
      gallery.addEventListener('click', function (e) {
        const img = e.target.closest('.gallery__image');
        if (!img) return;
        modalImg.src = img.dataset.fullSrc;
        modal.classList.add('open');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target === closeBtn) modal.classList.remove('open');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
    });
  }

  function renderNotFound() {
    document.getElementById('bike-detail').remove();
    section.remove();
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.innerHTML = 'Bike not found. <a href="/">Back to all bikes</a>.';
    document.querySelector('main').appendChild(p);
  }

  (async function load() {
    try {
      const results = await Promise.all([
        api.get('/api/bikes/' + bikeId),
        api.get('/api/bikes/' + bikeId + '/maintenance'),
      ]);
      const bike = results[0];
      const maintenance = results[1];

      document.title = bike.name + ' — Bike View';
      renderGallery(bike);
      renderInfo(bike);
      renderMaintenance(maintenance);
      wireModal();
    } catch (err) {
      if (/404|not found/i.test(err.message)) {
        renderNotFound();
      } else {
        showError('Failed to load bike: ' + err.message);
      }
    }
  })();
})();
