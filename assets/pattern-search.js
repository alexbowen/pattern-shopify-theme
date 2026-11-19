/* Pattern search: an inline search field with a predictive dropdown (WAI-ARIA combobox + listbox).

   Markup: snippets/pattern-search-form.liquid. Results come from Shopify's Predictive Search API
   through section rendering (sections/pattern-predictive-search.liquid), so nothing reloads the
   page until the form is submitted. Without JS the form is a plain GET to /search.

   - Opens after 2 characters, debounced (200ms); a newer keystroke aborts the stale request.
   - Arrow keys move through the results, Enter opens the highlighted one; with none highlighted
     Enter submits to the results page. Escape closes (a second Escape closes the mobile field).
   - Outside click closes. "/" focuses the field when no other field has focus.
   - Header on small screens: the search icon (a link to /search without JS) opens the field in
     place over the header; a close button and Escape put it away. */

(() => {
  if (customElements.get('pattern-search')) return;

  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 200;
  let instanceCount = 0;

  class PatternSearch extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      instanceCount += 1;
      this.uid = `ps${instanceCount}`;

      this.form = this.querySelector('form');
      this.input = this.querySelector('input[type="search"]');
      this.panel = this.querySelector('[data-search-panel]');
      this.listbox = this.querySelector('[role="listbox"]');
      this.status = this.querySelector('[data-search-status]');
      this.closeButton = this.querySelector('[data-search-close]');
      this.toggle = this.id ? document.querySelector(`[data-search-toggle="${this.id}"]`) : null;
      this.sectionId = this.dataset.sectionId || 'pattern-predictive-search';
      this.cache = new Map();
      this.activeIndex = -1;
      this.lastTerms = '';

      this.onInput = this.onInput.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onDocumentPointer = this.onDocumentPointer.bind(this);
      this.onFocus = this.onFocus.bind(this);

      this.input.addEventListener('input', this.onInput);
      this.input.addEventListener('keydown', this.onKeydown);
      this.input.addEventListener('focus', this.onFocus);
      document.addEventListener('pointerdown', this.onDocumentPointer);

      // Pointer: open the result under the pointer (the links themselves are tabindex -1).
      this.listbox.addEventListener('mousemove', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option) this.setActive(this.options().indexOf(option), false);
      });

      if (this.toggle) {
        this.toggle.setAttribute('role', 'button');
        this.toggle.setAttribute('aria-expanded', 'false');
        this.toggle.setAttribute('aria-controls', this.id);
        this.toggle.addEventListener('click', (event) => {
          event.preventDefault();
          this.openField();
        });
      }
      if (this.closeButton) this.closeButton.addEventListener('click', () => this.closeField(true));
    }

    disconnectedCallback() {
      document.removeEventListener('pointerdown', this.onDocumentPointer);
      if (this.controller) this.controller.abort();
    }

    // ----- Small-screen header field -----
    openField() {
      this.classList.add('is-open');
      if (this.toggle) this.toggle.setAttribute('aria-expanded', 'true');
      this.input.focus();
    }

    closeField(returnFocus) {
      if (!this.classList.contains('is-open')) return false;
      this.close();
      this.classList.remove('is-open');
      if (this.toggle) {
        this.toggle.setAttribute('aria-expanded', 'false');
        if (returnFocus) this.toggle.focus();
      }
      return true;
    }

    // Is the field currently hidden behind the small-screen toggle?
    fieldHidden() {
      return this.input.offsetParent === null && !this.classList.contains('is-open');
    }

    focusField() {
      if (this.fieldHidden() && this.toggle) this.openField();
      else this.input.focus();
    }

    // ----- Input and fetching -----
    onFocus() {
      const terms = this.input.value.trim();
      if (terms.length >= MIN_CHARS && terms === this.lastTerms && this.listbox.childElementCount > 0) this.open();
    }

    onInput() {
      clearTimeout(this.timer);
      const terms = this.input.value.trim();
      if (terms.length < MIN_CHARS) {
        if (this.controller) this.controller.abort();
        this.lastTerms = '';
        this.close();
        return;
      }
      this.timer = setTimeout(() => this.search(terms), DEBOUNCE_MS);
    }

    async search(terms) {
      if (this.controller) this.controller.abort();
      const key = terms.toLowerCase();
      if (this.cache.has(key)) {
        this.render(terms, this.cache.get(key));
        return;
      }
      this.controller = new AbortController();
      const params = new URLSearchParams({
        q: terms,
        'resources[type]': 'product,collection,page',
        'resources[limit]': '6',
        'resources[limit_scope]': 'each',
        'resources[options][prefix]': 'last',
        section_id: this.sectionId,
      });
      const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
      this.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(`${root}search/suggest?${params}`, { signal: this.controller.signal });
        if (!response.ok) throw new Error(response.status);
        const text = await response.text();
        const html = new DOMParser().parseFromString(text, 'text/html').querySelector('.pattern-predictive');
        const markup = html ? html.outerHTML : '';
        this.cache.set(key, markup);
        // Only render if the field still holds these terms (a newer request may be pending).
        if (this.input.value.trim() === terms) this.render(terms, markup);
      } catch (error) {
        if (error.name !== 'AbortError') this.close();
      } finally {
        this.removeAttribute('aria-busy');
      }
    }

    render(terms, markup) {
      this.lastTerms = terms;
      this.listbox.innerHTML = markup;
      // Unique option ids per instance (the header and the results page can both hold results).
      this.options().forEach((option, index) => {
        option.id = `${this.uid}-option-${index}`;
      });
      this.listbox.querySelectorAll('[id^="PatternPredictive"]').forEach((el) => {
        const id = `${this.uid}-${el.id}`;
        this.listbox.querySelectorAll(`[aria-labelledby="${el.id}"]`).forEach((ref) => ref.setAttribute('aria-labelledby', id));
        el.id = id;
      });
      this.activeIndex = -1;
      this.input.removeAttribute('aria-activedescendant');
      const result = this.listbox.querySelector('.pattern-predictive');
      const count = result ? Number(result.dataset.resultCount || 0) : 0;
      if (this.status) {
        this.status.textContent = count
          ? `${count} ${count === 1 ? this.dataset.oneResult || 'result' : this.dataset.manyResults || 'results'}`
          : this.dataset.noResults || '';
      }
      if (document.activeElement === this.input) this.open();
    }

    // ----- Open / close -----
    open() {
      this.panel.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
      this.classList.add('has-results');
    }

    close() {
      clearTimeout(this.timer);
      this.panel.hidden = true;
      this.input.setAttribute('aria-expanded', 'false');
      this.input.removeAttribute('aria-activedescendant');
      this.classList.remove('has-results');
      this.setActive(-1, false);
    }

    isOpen() {
      return !this.panel.hidden;
    }

    onDocumentPointer(event) {
      if (this.contains(event.target)) return;
      if (this.toggle && this.toggle.contains(event.target)) return;
      this.close();
      if (this.classList.contains('is-open') && this.input.value.trim() === '') this.closeField(false);
    }

    // ----- Keyboard -----
    options() {
      return Array.from(this.listbox.querySelectorAll('[role="option"]'));
    }

    setActive(index, scroll = true) {
      const options = this.options();
      options.forEach((option, i) => option.setAttribute('aria-selected', i === index ? 'true' : 'false'));
      this.activeIndex = index;
      const active = options[index];
      if (active) {
        this.input.setAttribute('aria-activedescendant', active.id);
        if (scroll) active.scrollIntoView({ block: 'nearest' });
      } else {
        this.input.removeAttribute('aria-activedescendant');
      }
    }

    onKeydown(event) {
      const options = this.options();
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          if (!this.isOpen()) {
            if (options.length && this.input.value.trim() === this.lastTerms && this.lastTerms) this.open();
            else return;
          }
          event.preventDefault();
          if (!options.length) return;
          const step = event.key === 'ArrowDown' ? 1 : -1;
          // Down wraps from the last result to the first; Up from the first goes back to the
          // field (nothing highlighted), and from the field to the last result.
          let next = this.activeIndex + step;
          if (next >= options.length) next = 0;
          if (next < 0) next = this.activeIndex === -1 ? options.length - 1 : -1;
          this.setActive(next);
          break;
        }
        case 'Home':
        case 'End':
          if (!this.isOpen() || !options.length || this.activeIndex === -1) return;
          event.preventDefault();
          this.setActive(event.key === 'Home' ? 0 : options.length - 1);
          break;
        case 'Enter': {
          const active = this.isOpen() ? options[this.activeIndex] : null;
          if (active && active.dataset.url) {
            event.preventDefault();
            window.location.href = active.dataset.url;
          }
          // Nothing highlighted: the form submits to the results page as normal.
          break;
        }
        case 'Escape':
          if (this.isOpen()) {
            event.preventDefault();
            this.close();
          } else if (this.closeField(true)) {
            event.preventDefault();
          }
          break;
        default:
      }
    }
  }

  customElements.define('pattern-search', PatternSearch);

  // "/" focuses the first visible search field when no other field has focus.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    const searches = Array.from(document.querySelectorAll('pattern-search'));
    const target = searches.find((s) => !s.fieldHidden()) || searches[0];
    if (!target) return;
    event.preventDefault();
    target.focusField();
  });
})();
