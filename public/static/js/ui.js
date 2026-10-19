/**
 * Page-level error banner. One banner, fixed top-center below the nav;
 * repeated errors replace the message and reset the 6s auto-dismiss.
 * Replaces window.alert as the error surface across the app.
 */
(function () {
  let banner = null;
  let timer = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML =
      '<span class="banner__msg"></span>' +
      '<button type="button" class="banner__close" aria-label="Dismiss">&times;</button>';
    banner.querySelector('.banner__close').addEventListener('click', hide);
    document.body.appendChild(banner);
    return banner;
  }

  function hide() {
    if (!banner) return;
    banner.classList.remove('banner--visible');
    clearTimeout(timer);
  }

  function showError(message) {
    const b = ensureBanner();
    b.querySelector('.banner__msg').textContent =
      String(message || 'Something went wrong.');
    b.classList.add('banner--visible');
    clearTimeout(timer);
    timer = setTimeout(hide, 6000);
  }

  window.showError = showError;
})();
