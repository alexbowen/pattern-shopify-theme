/* Pattern heading anchors: policy pages (/policies/*) and standard pages (sections/main-page.liquid).
   Loaded from layout/theme.liquid with pattern-pages.css (page and policy page types only).

   - Every h2 and h3 in the main text without an id gets one from its text: accents removed,
     lowercase, spaces to hyphens, anything else that isn't a-z / 0-9 / hyphen removed, repeated
     hyphens collapsed ("Returns & refunds" -> "returns-refunds", "Envíos a España" ->
     "envios-a-espana"). Duplicates get -2, -3 ... Existing ids are left alone.
   - A quiet "#" link is added after each heading (visible on hover / keyboard focus).
   - Jump offset: --pattern-anchor-offset = the header's height when it's sticky or fixed, plus 16px.
   - Arriving with a #fragment: once the ids exist, scroll to the heading and mark it (the browser
     looked for it before it had an id, so :target alone wouldn't match). */
(() => {
  const SELECTOR = '.shopify-policy__body h2, .shopify-policy__body h3, .pattern-page__body h2, .pattern-page__body h3';

  const slugify = (text) =>
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section';

  const setOffset = () => {
    const header = document.querySelector('.shopify-section-group-header-group, .section-header, sticky-header');
    let height = 0;
    if (header) {
      const position = getComputedStyle(header).position;
      if (position === 'sticky' || position === 'fixed') height = header.getBoundingClientRect().height;
    }
    document.documentElement.style.setProperty('--pattern-anchor-offset', `${Math.round(height + 16)}px`);
  };

  const markTarget = () => {
    document.querySelectorAll('.pattern-anchor-target').forEach((el) => el.classList.remove('pattern-anchor-target'));
    if (!location.hash) return null;
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch (e) {
      id = location.hash.slice(1);
    }
    const target = document.getElementById(id);
    if (target && target.matches(SELECTOR)) target.classList.add('pattern-anchor-target');
    return target;
  };

  const init = () => {
    const headings = document.querySelectorAll(SELECTOR);
    if (!headings.length) return;
    setOffset();

    const used = new Set(Array.from(document.querySelectorAll('[id]'), (el) => el.id));
    headings.forEach((heading) => {
      if (!heading.id) {
        const base = slugify(heading.textContent);
        let id = base;
        let n = 2;
        while (used.has(id)) id = `${base}-${n++}`;
        heading.id = id;
        used.add(id);
      }
      if (!heading.querySelector('.pattern-anchor-link')) {
        const link = document.createElement('a');
        link.className = 'pattern-anchor-link';
        link.href = `#${encodeURIComponent(heading.id)}`;
        link.textContent = '#';
        link.setAttribute('aria-label', `Link to this section: ${heading.textContent.trim()}`);
        heading.append(link);
      }
    });

    // Arrived with a fragment: scroll now that the id exists, and once more after load (fonts,
    // images and the reveal animation can move the heading) unless the visitor has scrolled since.
    const target = markTarget();
    if (target) {
      let userScrolled = false;
      const stop = () => (userScrolled = true);
      ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((type) =>
        window.addEventListener(type, stop, { once: true, passive: true })
      );
      const jump = () => {
        if (!userScrolled) target.scrollIntoView({ block: 'start', behavior: 'instant' });
      };
      jump();
      window.addEventListener('load', () => setTimeout(jump, 400), { once: true });
    }

    window.addEventListener('hashchange', markTarget);
    window.addEventListener('resize', setOffset, { passive: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
