(() => {
  if (window.location.hostname !== "glossalia-explorer.tuqo.ru" || window.glossaliaeMetrikaInitialized) return;
  window.glossaliaeMetrikaInitialized = true;

  (function(m, e, t, r, i, k, a) {
    m[i] = m[i] || function() { (m[i].a = m[i].a || []).push(arguments); };
    m[i].l = 1 * new Date();
    for (let j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = true;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=113419573", "ym");

  window.ym(113419573, "init", {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: window.location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });

  let previousUrl = window.location.href;
  window.addEventListener("hashchange", () => {
    if (document.body.dataset.pageId || window.location.href === previousUrl) return;
    const panel = document.getElementById(window.location.hash.slice(1));
    if (!panel?.hasAttribute("data-panel")) return;

    // Только переход к другому разделу оболочки считается новым просмотром
    window.ym(113419573, "hit", window.location.href, { title: document.title, referer: previousUrl });
    previousUrl = window.location.href;
  });
})();
