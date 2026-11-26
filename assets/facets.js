class FacetFiltersForm extends HTMLElement {
  constructor() {
    super();
    this.onActiveFilterClick = this.onActiveFilterClick.bind(this);

    this.debouncedOnSubmit = debounce((event) => {
      this.onSubmitHandler(event);
    }, 800);

    const facetForm = this.querySelector('form');
    // In stock toggle (snippets/pattern-filter-bar.liquid): its paired metafield filter
    // (pattern_availability = in_stock) is a hidden input, enabled only while the toggle is ticked,
    // so both filters are added or removed together. Runs before the debounced submit below.
    facetForm.addEventListener('input', (event) => {
      if (!event.target.matches('[data-pattern-in-stock]')) return;
      const pair = event.target.parentElement.querySelector('[data-pattern-in-stock-pair]');
      if (pair) pair.disabled = !event.target.checked;
    });
    facetForm.addEventListener('input', this.debouncedOnSubmit.bind(this));

    const facetWrapper = this.querySelector('#FacetsWrapperDesktop');
    if (facetWrapper) facetWrapper.addEventListener('keyup', onKeyUpEscape);

    if (facetForm.id === 'FacetGenrePillsForm') FacetFiltersForm.initGenrePills(facetForm);
  }

  // Genre pills (snippets/genre-pills.liquid). Pills are aria-pressed buttons, each with a hidden
  // input that is disabled while the pill is off. Toggling one fires a normal 'input' event, so
  // the debounced submit and AJAX render above handle the filtering.
  static initGenrePills(form) {
    form.addEventListener('click', (event) => {
      const pill = event.target.closest('.genre-pill[data-genre-handle]');
      if (pill) {
        const pressed = pill.getAttribute('aria-pressed') !== 'true';
        FacetFiltersForm.setGenrePillPressed(pill, pressed);
        // Shopify ORs values of one filter, so a parent and its child together return the whole
        // parent. Selecting a child replaces its parent; selecting a parent replaces its
        // children. Other parents (and their children) stay as they are.
        if (pressed) {
          const parentHandle = pill.dataset.genreParent;
          const replaced = parentHandle
            ? form.querySelectorAll(`.genre-pill[data-genre-handle="${CSS.escape(parentHandle)}"]`)
            : form.querySelectorAll(`.genre-pill[data-genre-parent="${CSS.escape(pill.dataset.genreHandle)}"]`);
          replaced.forEach((other) => FacetFiltersForm.setGenrePillPressed(other, false));
        }
        FacetFiltersForm.syncGenrePills(form);
        pill.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      // "All" and "Clear" are facet-remove links (url_to_remove), which do the AJAX render.
      // Clear the pills here too so a pending debounced submit can't re-apply old genres.
      const genreClear = event.target.closest('[data-genre-clear]');
      if (genreClear) {
        // Keyboard on the Clear link, which hides itself: move focus to "All" first, so it isn't lost.
        if (genreClear.id === 'GenreClear' && genreClear.matches(':focus-visible')) {
          document.getElementById('GenrePill-all')?.focus({ preventScroll: true });
        }
        form.querySelectorAll('.genre-pill[data-genre-handle]').forEach((p) => FacetFiltersForm.setGenrePillPressed(p, false));
        FacetFiltersForm.syncGenrePills(form);
      }
    });

    // Scroll events don't bubble; capture them from the rows to update the edge fade.
    form.addEventListener('scroll', (event) => {
      if (event.target.matches && event.target.matches('[data-genre-row]')) FacetFiltersForm.updateGenreRowFade(event.target);
    }, true);
    window.addEventListener('resize', debounce(() => FacetFiltersForm.refreshGenreRows(form), 100));

    FacetFiltersForm.initOriginLine(form);

    requestAnimationFrame(() => FacetFiltersForm.refreshGenreRows(form, { scrollActive: true }));
  }

  // Origin line (snippets/origin-line.liquid). Each origin has one hidden input that the form
  // submits; the pills and the panel checkboxes are proxies kept in step here.
  static initOriginLine(form) {
    // Listeners sit on the form (its contents are replaced on every AJAX render).
    form.addEventListener('click', (event) => {
      const pill = event.target.closest('.origin-pill[data-origin-key]');
      if (pill) {
        FacetFiltersForm.setOriginSelected(form, pill.dataset.originKey, pill.getAttribute('aria-pressed') !== 'true');
        pill.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (event.target.closest('[data-origin-close]')) {
        FacetFiltersForm.closeOriginPanel(form, true);
      }
      // Origin "Clear" is a facet-remove link (url_to_remove). Unselect here too so a pending
      // debounced submit can't re-apply the old origins.
      const originClear = event.target.closest('[data-origin-clear]');
      if (originClear) {
        // Keyboard on the Clear link, which hides itself: move focus to the first origin pill first.
        if (originClear.matches(':focus-visible')) form.querySelector('.origin-pill')?.focus({ preventScroll: true });
        form.querySelectorAll('[data-origin-input]').forEach((input) => {
          FacetFiltersForm.setOriginSelected(form, input.dataset.originInput, false);
        });
      }
    });

    form.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-origin-panel] input[type="checkbox"][data-origin-key]');
      if (checkbox) FacetFiltersForm.setOriginSelected(form, checkbox.dataset.originKey, checkbox.checked);
    });

    // The search box filters the list; it must never submit the filters (debounced 'input' handler
    // on the form, or implicit submission on Enter).
    const pillsContainer = form.querySelector('#GenrePills') || form;
    pillsContainer.addEventListener('input', (event) => {
      if (!event.target.matches('[data-origin-search]')) return;
      event.stopPropagation();
      FacetFiltersForm.filterOriginList(form);
    });
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.matches('[data-origin-search]')) event.preventDefault();
      if (event.key === 'Tab') FacetFiltersForm.trapOriginTab(event);
    });

    // Keep focus in the open panel if it lands outside by other means (the toggle itself is
    // allowed: clicking outside closes the panel through it).
    document.addEventListener('focusin', (event) => {
      const panel = document.querySelector('[data-origin-panel][open]');
      if (!panel) return;
      const content = panel.querySelector('.origin-panel__content');
      if (content.contains(event.target) || event.target === panel.querySelector(':scope > summary')) return;
      FacetFiltersForm.originFocusables(panel)[0]?.focus();
    });

    form.addEventListener('keyup', (event) => {
      if (event.code && event.code.toUpperCase() === 'ESCAPE' && event.target.closest('[data-origin-panel][open]')) {
        FacetFiltersForm.closeOriginPanel(form, true);
      }
    });

    // Open: trap focus in the panel (search first) and, on mobile, lock page scroll. Close: release.
    form.addEventListener(
      'toggle',
      (event) => {
        const panel = event.target;
        if (!(panel instanceof HTMLDetailsElement) || !panel.matches('[data-origin-panel]')) return;
        const summary = panel.querySelector(':scope > summary');
        summary.setAttribute('aria-expanded', String(panel.open));
        if (panel.open) {
          const focusId = FacetFiltersForm.originRestoreFocusId;
          FacetFiltersForm.originRestoreFocusId = null;
          const focusTarget = (focusId && document.getElementById(focusId)) || panel.querySelector('[data-origin-search]');
          focusTarget?.focus({ preventScroll: true });
          if (window.matchMedia('(max-width: 749px)').matches) document.body.classList.add('overflow-hidden-mobile');
        } else {
          document.body.classList.remove('overflow-hidden-mobile');
          // Escape / close buttons return focus to the toggle; clicking outside leaves it where it lands.
          if (FacetFiltersForm.originClosingWithFocus) summary.focus({ preventScroll: true });
          FacetFiltersForm.originClosingWithFocus = false;
        }
      },
      true
    );
  }

  static setOriginSelected(form, key, selected) {
    const input = form.querySelector(`[data-origin-input="${CSS.escape(key)}"]`);
    if (input) input.disabled = !selected;
    form.querySelectorAll(`.origin-pill[data-origin-key="${CSS.escape(key)}"]`).forEach((pill) => {
      pill.setAttribute('aria-pressed', String(selected));
      pill.classList.toggle('origin-pill--active', selected);
    });
    form.querySelectorAll(`[data-origin-panel] input[data-origin-key="${CSS.escape(key)}"]`).forEach((checkbox) => {
      checkbox.checked = selected;
    });
    const selectedCount = form.querySelectorAll('[data-origin-input]:not([disabled])').length;
    const countLabel = form.querySelector('[data-origin-count]');
    if (countLabel) countLabel.textContent = selectedCount > 0 ? ` · ${selectedCount}` : '';
    form.querySelector('.origin-panel__toggle')?.classList.toggle('origin-panel__toggle--active', selectedCount > 0);
    const clear = form.querySelector('.origin-line__clear-wrapper');
    if (clear) clear.hidden = selectedCount === 0;
  }

  // Focusable controls in the open panel that are actually visible right now (search hides list
  // items; the footer button only shows on mobile), so the trap wraps at the real ends.
  static originFocusables(panel) {
    return Array.from(
      panel.querySelectorAll('.origin-panel__content button, .origin-panel__content input:not([type="hidden"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  static trapOriginTab(event) {
    const panel = event.target.closest && event.target.closest('[data-origin-panel][open]');
    if (!panel || !panel.querySelector('.origin-panel__content').contains(event.target)) return;
    const focusables = FacetFiltersForm.originFocusables(panel);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  }

  static closeOriginPanel(form, returnFocus) {
    const panel = form.querySelector('[data-origin-panel][open]');
    if (!panel) return;
    FacetFiltersForm.originClosingWithFocus = returnFocus;
    panel.open = false;
    if (returnFocus) panel.querySelector(':scope > summary')?.focus();
  }

  // Live search: case- and accent-insensitive match anywhere in the name.
  static normaliseOriginText(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  static filterOriginList(form) {
    const search = form.querySelector('[data-origin-search]');
    if (!search) return;
    const query = FacetFiltersForm.normaliseOriginText(search.value);
    let shown = 0;
    form.querySelectorAll('[data-origin-panel] [data-origin-name]').forEach((item) => {
      const match = !query || FacetFiltersForm.normaliseOriginText(item.dataset.originName).includes(query);
      item.hidden = !match;
      if (match) shown++;
    });
    const empty = form.querySelector('[data-origin-empty]');
    if (empty) empty.hidden = shown > 0;
  }

  static setGenrePillPressed(pill, pressed) {
    pill.setAttribute('aria-pressed', String(pressed));
    const input = pill.querySelector('input');
    if (input) input.disabled = !pressed;
  }

  // Mirror the server-rendered state on the client straight away: active classes, the "All" pill,
  // the Clear link and which child pills are shown.
  static syncGenrePills(form) {
    const pills = Array.from(form.querySelectorAll('.genre-pill[data-genre-handle]'));
    const isPressed = (pill) => pill.getAttribute('aria-pressed') === 'true';
    const pressedHandles = new Set(pills.filter(isPressed).map((pill) => pill.dataset.genreHandle));
    const parentsOfPressedChildren = new Set(
      pills.filter((pill) => pill.dataset.genreParent && isPressed(pill)).map((pill) => pill.dataset.genreParent)
    );

    pills.forEach((pill) => {
      pill.classList.toggle('genre-pill--active', isPressed(pill));
      if (!pill.dataset.genreParent) {
        pill.classList.toggle(
          'genre-pill--has-active-child',
          !isPressed(pill) && parentsOfPressedChildren.has(pill.dataset.genreHandle)
        );
      }
    });

    const anyPressed = pressedHandles.size > 0;
    const allPill = form.querySelector('.genre-pill--all');
    if (allPill) {
      allPill.classList.toggle('genre-pill--active', !anyPressed);
      allPill.setAttribute('aria-pressed', String(!anyPressed));
    }
    const clear = form.querySelector('.genre-pills__clear-wrapper');
    if (clear) clear.hidden = !anyPressed;

    const childWrapper = form.querySelector('[data-genre-children]');
    if (!childWrapper) return;
    // One tray per parent. Same rule as genre-pills.liquid: a tray stays open while its parent or
    // any of its children is selected.
    const trays = Array.from(childWrapper.querySelectorAll('[data-genre-tray]'));
    const shouldShow = (tray) =>
      pressedHandles.has(tray.dataset.genreTray) || parentsOfPressedChildren.has(tray.dataset.genreTray);

    clearTimeout(FacetFiltersForm.genreCollapseTimer);
    if (trays.some(shouldShow)) {
      trays.forEach((tray) => {
        const show = shouldShow(tray);
        if (show && tray.hidden) {
          tray.hidden = false;
          tray.classList.add('genre-tray--entering');
          tray.addEventListener('animationend', () => tray.classList.remove('genre-tray--entering'), { once: true });
        } else if (!show) {
          tray.hidden = true;
        }
      });
      childWrapper.classList.add('is-open');
    } else {
      // Collapse with the trays still in place, then hide them once the row has closed.
      childWrapper.classList.remove('is-open');
      FacetFiltersForm.genreCollapseTimer = setTimeout(() => {
        trays.forEach((tray) => (tray.hidden = true));
      }, FacetFiltersForm.prefersReducedMotion() ? 0 : 220);
    }
    FacetFiltersForm.refreshGenreRows(form);
  }

  static prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  static updateGenreRowFade(row) {
    const moreToTheRight = row.scrollWidth - row.clientWidth - row.scrollLeft > 2;
    row.classList.toggle('genre-pills__row--more', moreToTheRight);
  }

  // Scroll a row sideways (never the page) so its active pill is visible.
  static scrollGenrePillIntoView(row, pill) {
    if (!pill || row.scrollWidth <= row.clientWidth) return;
    const rowRect = row.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const gutter = 24;
    let left = null;
    if (pillRect.left < rowRect.left + gutter) left = row.scrollLeft + pillRect.left - rowRect.left - gutter;
    else if (pillRect.right > rowRect.right - gutter) left = row.scrollLeft + pillRect.right - rowRect.right + gutter;
    if (left !== null) row.scrollTo({ left, behavior: FacetFiltersForm.prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  static refreshGenreRows(form, { scrollActive = false, preferredPillId = null } = {}) {
    form.querySelectorAll('[data-genre-row]').forEach((row) => {
      if (scrollActive) {
        const preferred = preferredPillId && row.querySelector(`#${CSS.escape(preferredPillId)}.genre-pill--active`);
        const active = preferred || row.querySelector('.genre-pill--active:not([hidden])');
        FacetFiltersForm.scrollGenrePillIntoView(row, active);
      }
      FacetFiltersForm.updateGenreRowFade(row);
    });
  }

  static isDesktopFiltersVisible() {
    const desktopForm = document.getElementById('FacetFiltersForm');
    return Boolean(desktopForm && desktopForm.offsetParent !== null);
  }

  static setListeners() {
    const onHistoryChange = (event) => {
      const searchParams = event.state ? event.state.searchParams : FacetFiltersForm.searchParamsInitial;
      if (searchParams === FacetFiltersForm.searchParamsPrev) return;
      FacetFiltersForm.renderPage(searchParams, null, false);
    };
    window.addEventListener('popstate', onHistoryChange);

    // Sort control (snippets/pattern-sort.liquid). #PatternSort sits in the genre pills form, so its
    // native 'input' event submits like any filter. The mobile copy has no name: copy its value
    // across and fire 'input' on #PatternSort so sort_by is only sent once.
    document.addEventListener('change', (event) => {
      const select = event.target;
      if (!select.matches || !select.matches('.pattern-sort__select')) return;
      FacetFiltersForm.updateSortLabel(select);
      if (select.hasAttribute('data-sort-proxy')) {
        const main = document.getElementById('PatternSort');
        if (!main) return;
        main.value = select.value;
        FacetFiltersForm.updateSortLabel(main);
        main.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  static updateSortLabel(select) {
    const current = select.closest('.pattern-sort')?.querySelector('[data-sort-current]');
    const option = select.options[select.selectedIndex];
    if (current && option) current.textContent = option.textContent.trim();
  }

  // Re-render the sort controls from the response: they sit outside the .js-filter blocks facets.js
  // updates, so without this they'd show a stale choice after Clear, back/forward, etc.
  static renderMobileSort(html) {
    ['PatternSort', 'PatternSortMobile'].forEach((id) => {
      const source = html.getElementById(`${id}-wrapper`);
      const target = document.getElementById(`${id}-wrapper`);
      if (!source || !target) return;
      const hadFocus = target.contains(document.activeElement);
      target.innerHTML = source.innerHTML;
      if (hadFocus) document.getElementById(id)?.focus({ preventScroll: true });
    });
  }

  static toggleActiveFacets(disable = true) {
    document.querySelectorAll('.js-facet-remove').forEach((element) => {
      element.classList.toggle('disabled', disable);
    });
  }

  static renderPage(searchParams, event, updateURLHash = true) {
    FacetFiltersForm.searchParamsPrev = searchParams;
    const sections = FacetFiltersForm.getSections();
    const countContainer = document.getElementById('ProductCount');
    const countContainerDesktop = document.getElementById('ProductCountDesktop');
    const loadingSpinners = document.querySelectorAll(
      '.facets-container .loading__spinner, facet-filters-form .loading__spinner'
    );
    loadingSpinners.forEach((spinner) => spinner.classList.remove('hidden'));
    document.getElementById('ProductGridContainer').querySelector('.collection').classList.add('loading');
    if (countContainer) {
      countContainer.classList.add('loading');
    }
    if (countContainerDesktop) {
      countContainerDesktop.classList.add('loading');
    }

    sections.forEach((section) => {
      const url = `${window.location.pathname}?section_id=${section.section}&${searchParams}`;
      const filterDataUrl = (element) => element.url === url;

      FacetFiltersForm.filterData.some(filterDataUrl)
        ? FacetFiltersForm.renderSectionFromCache(filterDataUrl, event)
        : FacetFiltersForm.renderSectionFromFetch(url, event);
    });

    if (updateURLHash) FacetFiltersForm.updateURLHash(searchParams);
  }

  static renderSectionFromFetch(url, event) {
    fetch(url)
      .then((response) => response.text())
      .then((responseText) => {
        const html = responseText;
        FacetFiltersForm.filterData = [...FacetFiltersForm.filterData, { html, url }];
        FacetFiltersForm.renderFilters(html, event);
        FacetFiltersForm.renderProductGridContainer(html);
        FacetFiltersForm.renderProductCount(html);
        if (typeof initializeScrollAnimationTrigger === 'function') initializeScrollAnimationTrigger(html.innerHTML);
      });
  }

  static renderSectionFromCache(filterDataUrl, event) {
    const html = FacetFiltersForm.filterData.find(filterDataUrl).html;
    FacetFiltersForm.renderFilters(html, event);
    FacetFiltersForm.renderProductGridContainer(html);
    FacetFiltersForm.renderProductCount(html);
    if (typeof initializeScrollAnimationTrigger === 'function') initializeScrollAnimationTrigger(html.innerHTML);
  }

  static renderProductGridContainer(html) {
    document.getElementById('ProductGridContainer').innerHTML = new DOMParser()
      .parseFromString(html, 'text/html')
      .getElementById('ProductGridContainer').innerHTML;

    document
      .getElementById('ProductGridContainer')
      .querySelectorAll('.scroll-trigger')
      .forEach((element) => {
        element.classList.add('scroll-trigger--cancel');
      });
  }

  static renderProductCount(html) {
    const count = new DOMParser().parseFromString(html, 'text/html').getElementById('ProductCount').innerHTML;
    const container = document.getElementById('ProductCount');
    const containerDesktop = document.getElementById('ProductCountDesktop');
    container.innerHTML = count;
    container.classList.remove('loading');
    if (containerDesktop) {
      containerDesktop.innerHTML = count;
      containerDesktop.classList.remove('loading');
    }
    const loadingSpinners = document.querySelectorAll(
      '.facets-container .loading__spinner, facet-filters-form .loading__spinner'
    );
    loadingSpinners.forEach((spinner) => spinner.classList.add('hidden'));
  }

  static renderFilters(html, event) {
    const parsedHTML = new DOMParser().parseFromString(html, 'text/html');
    const facetDetailsElementsFromFetch = parsedHTML.querySelectorAll(
      '#FacetFiltersForm .js-filter, #FacetFiltersFormMobile .js-filter, #FacetFiltersPillsForm .js-filter'
    );
    const facetDetailsElementsFromDom = document.querySelectorAll(
      '#FacetFiltersForm .js-filter, #FacetFiltersFormMobile .js-filter, #FacetFiltersPillsForm .js-filter'
    );

    // Remove facets that are no longer returned from the server
    Array.from(facetDetailsElementsFromDom).forEach((currentElement) => {
      if (!Array.from(facetDetailsElementsFromFetch).some(({ id }) => currentElement.id === id)) {
        currentElement.remove();
      }
    });

    const matchesId = (element) => {
      const jsFilter = event ? event.target.closest('.js-filter') : undefined;
      return jsFilter ? element.id === jsFilter.id : false;
    };

    const facetsToRender = Array.from(facetDetailsElementsFromFetch).filter((element) => !matchesId(element));
    const countsToRender = Array.from(facetDetailsElementsFromFetch).find(matchesId);

    facetsToRender.forEach((elementToRender, index) => {
      const currentElement = document.getElementById(elementToRender.id);
      // Element already rendered in the DOM so just update the innerHTML
      if (currentElement) {
        document.getElementById(elementToRender.id).innerHTML = elementToRender.innerHTML;
      } else {
        if (index > 0) {
          const { className: previousElementClassName, id: previousElementId } = facetsToRender[index - 1];
          // Same facet type (eg horizontal/vertical or drawer/mobile)
          if (elementToRender.className === previousElementClassName) {
            document.getElementById(previousElementId).after(elementToRender);
            return;
          }
        }

        if (elementToRender.parentElement) {
          document.querySelector(`#${elementToRender.parentElement.id} .js-filter`).before(elementToRender);
        }
      }
    });

    FacetFiltersForm.renderActiveFacets(parsedHTML);
    FacetFiltersForm.renderAdditionalElements(parsedHTML);
    FacetFiltersForm.renderGenrePills(parsedHTML);
    FacetFiltersForm.renderMobileSort(parsedHTML);
    FacetFiltersForm.renderFilterBarCount(parsedHTML);

    if (countsToRender) {
      const closestJSFilterID = event.target.closest('.js-filter').id;

      if (closestJSFilterID) {
        FacetFiltersForm.renderCounts(countsToRender, event.target.closest('.js-filter'));
        FacetFiltersForm.renderMobileCounts(countsToRender, document.getElementById(closestJSFilterID));

        const newFacetDetailsElement = document.getElementById(closestJSFilterID);
        const newElementSelector = newFacetDetailsElement.classList.contains('mobile-facets__details')
          ? `.mobile-facets__close-button`
          : `.facets__summary`;
        const newElementToActivate = newFacetDetailsElement.querySelector(newElementSelector);

        const isTextInput = event.target.getAttribute('type') === 'text';

        if (newElementToActivate && !isTextInput) newElementToActivate.focus();

        // Pattern filter bar: re-render the whole chip / sheet group (label count, filled state,
        // hidden values) but keep its popover open and focus on the same checkbox.
        if (newFacetDetailsElement.matches('.filter-bar__item, .filter-sheet__item')) {
          FacetFiltersForm.renderPatternFilterItem(countsToRender, newFacetDetailsElement, event.target.id);
        }
      }
    }
  }

  static renderPatternFilterItem(source, target, focusId) {
    const wasOpen = Boolean(target.querySelector('details[open]'));
    target.innerHTML = source.innerHTML;
    const details = target.querySelector('details');
    if (wasOpen && details) {
      details.setAttribute('open', '');
      details.querySelector('summary')?.setAttribute('aria-expanded', 'true');
    }
    const focusTarget = focusId && document.getElementById(focusId);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  // Filter bar pieces outside the .js-filter blocks: record count, the row's Clear link and the
  // sheet's Clear link (their URLs keep the other filters and sort, so they follow every render).
  static renderFilterBarCount(html) {
    const clearHadFocus = Boolean(document.getElementById('FilterBarClear')?.contains(document.activeElement));
    ['FilterBarCount', 'FilterBarClear'].forEach((id) => {
      const source = html.getElementById(id);
      const target = document.getElementById(id);
      if (source && target) target.innerHTML = source.innerHTML;
    });
    // The row's Clear goes once it has cleared: keep keyboard focus in the row (first control).
    if (clearHadFocus) document.querySelector('#FilterBarFilters summary.filter-chip')?.focus({ preventScroll: true });

    const clearSource = html.getElementById('FilterSheetClear');
    const clearTarget = document.getElementById('FilterSheetClear');
    if (clearSource && clearTarget) clearTarget.setAttribute('href', clearSource.getAttribute('href'));
  }

  // Filter bar popovers and sheet: keep aria-expanded in step with <details>, close a popover when
  // focus leaves it, and move focus into the sheet when it opens.
  static setFilterBarListeners() {
    document.addEventListener(
      'toggle',
      (event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement)) return;
        if (!details.matches('.filter-chip-disclosure, .filter-sheet > details')) return;
        details.querySelector(':scope > summary')?.setAttribute('aria-expanded', String(details.open));
        if (details.open && details.closest('.filter-sheet')) {
          setTimeout(() => details.querySelector('.filter-sheet__close')?.focus(), 150);
        }
      },
      true
    );

    document.addEventListener('focusout', (event) => {
      const details = event.target.closest && event.target.closest('.filter-chip-disclosure[open]');
      if (!details) return;
      if (event.relatedTarget && details.contains(event.relatedTarget)) return;
      // Leave it open while a click inside is in progress (relatedTarget is null for non-focusable targets)
      setTimeout(() => {
        if (details.open && !details.contains(document.activeElement) && !details.matches(':hover')) {
          details.removeAttribute('open');
        }
      });
    });
  }

  static renderActiveFacets(html) {
    const activeFacetElementSelectors = ['.active-facets-mobile', '.active-facets-desktop'];

    activeFacetElementSelectors.forEach((selector) => {
      const activeFacetsElement = html.querySelector(selector);
      if (!activeFacetsElement) return;
      document.querySelector(selector).innerHTML = activeFacetsElement.innerHTML;
    });

    FacetFiltersForm.toggleActiveFacets(false);
  }

  static renderAdditionalElements(html) {
    const mobileElementSelectors = ['.mobile-facets__open', '.mobile-facets__count', '.sorting'];

    mobileElementSelectors.forEach((selector) => {
      if (!html.querySelector(selector)) return;
      document.querySelector(selector).innerHTML = html.querySelector(selector).innerHTML;
    });

    document.getElementById('FacetFiltersFormMobile').closest('menu-drawer').bindEvents();
  }

  static renderGenrePills(html) {
    const target = document.getElementById('GenrePills');
    const source = html.getElementById('GenrePills');
    if (!target || !source) return;

    // Keep focus and each row's horizontal scroll position across the re-render.
    const focusedId = target.contains(document.activeElement) ? document.activeElement.id : null;
    // Only put focus back if it was keyboard focus: restoring a mouse click's focus makes some
    // browsers (Safari) draw a focus ring on the clicked pill.
    const focusWasVisible = focusedId ? document.activeElement.matches(':focus-visible') : false;
    const scrollPositions = {};
    target.querySelectorAll('[data-genre-row]').forEach((row) => {
      scrollPositions[row.dataset.genreRow] = row.scrollLeft;
    });

    // Origin panel: keep it open with the same search, list scroll and focus.
    const originPanel = target.querySelector('[data-origin-panel]');
    const originState = originPanel && originPanel.open
      ? {
          query: originPanel.querySelector('[data-origin-search]')?.value || '',
          listScroll: originPanel.querySelector('.origin-panel__list')?.scrollTop || 0,
          focusId: originPanel.contains(document.activeElement) ? document.activeElement.id : null,
        }
      : null;

    target.innerHTML = source.innerHTML;

    if (originState) {
      const newPanel = target.querySelector('[data-origin-panel]');
      if (newPanel) {
        const search = newPanel.querySelector('[data-origin-search]');
        if (search) search.value = originState.query;
        FacetFiltersForm.filterOriginList(target.closest('form'));
        FacetFiltersForm.originRestoreFocusId = originState.focusId;
        newPanel.open = true;
        const list = newPanel.querySelector('.origin-panel__list');
        if (list) list.scrollTop = originState.listScroll;
      }
    }

    target.querySelectorAll('[data-genre-row]').forEach((row) => {
      if (scrollPositions[row.dataset.genreRow]) row.scrollLeft = scrollPositions[row.dataset.genreRow];
    });
    if (focusedId && focusWasVisible && !originState) {
      let focusTarget = document.getElementById(focusedId);
      // A Clear link is hidden once its group has nothing selected: move focus to the group's first
      // pill (origin) or "All" (genre) instead of losing it.
      if (!focusTarget || focusTarget.closest('[hidden]')) {
        focusTarget =
          (focusedId === 'OriginClear' && target.querySelector('.origin-pill')) || document.getElementById('GenrePill-all');
      }
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }

    const form = document.getElementById('FacetGenrePillsForm');
    if (form) FacetFiltersForm.refreshGenreRows(form, { scrollActive: true, preferredPillId: focusedId });
  }

  static renderCounts(source, target) {
    const targetSummary = target.querySelector('.facets__summary');
    const sourceSummary = source.querySelector('.facets__summary');

    if (sourceSummary && targetSummary) {
      targetSummary.outerHTML = sourceSummary.outerHTML;
    }

    const targetHeaderElement = target.querySelector('.facets__header');
    const sourceHeaderElement = source.querySelector('.facets__header');

    if (sourceHeaderElement && targetHeaderElement) {
      targetHeaderElement.outerHTML = sourceHeaderElement.outerHTML;
    }

    const targetWrapElement = target.querySelector('.facets-wrap');
    const sourceWrapElement = source.querySelector('.facets-wrap');

    if (sourceWrapElement && targetWrapElement) {
      const isShowingMore = Boolean(target.querySelector('show-more-button .label-show-more.hidden'));
      if (isShowingMore) {
        sourceWrapElement
          .querySelectorAll('.facets__item.hidden')
          .forEach((hiddenItem) => hiddenItem.classList.replace('hidden', 'show-more-item'));
      }

      targetWrapElement.outerHTML = sourceWrapElement.outerHTML;
    }
  }

  static renderMobileCounts(source, target) {
    const targetFacetsList = target.querySelector('.mobile-facets__list');
    const sourceFacetsList = source.querySelector('.mobile-facets__list');

    if (sourceFacetsList && targetFacetsList) {
      targetFacetsList.outerHTML = sourceFacetsList.outerHTML;
    }
  }

  static updateURLHash(searchParams) {
    history.pushState({ searchParams }, '', `${window.location.pathname}${searchParams && '?'.concat(searchParams)}`);
  }

  static getSections() {
    return [
      {
        section: document.getElementById('product-grid').dataset.id,
      },
    ];
  }

  createSearchParams(form) {
    const formData = new FormData(form);
    return new URLSearchParams(formData).toString();
  }

  onSubmitForm(searchParams, event) {
    FacetFiltersForm.renderPage(searchParams, event);
  }

  onSubmitHandler(event) {
    event.preventDefault();
    const sortFilterForms = document.querySelectorAll('facet-filters-form form');
    const sourceForm = event.target.closest('form');
    const forms = [];
    const usedForms = new Set();
    const addForm = (form) => {
      usedForms.add(form);
      forms.push(this.createSearchParams(form));
    };
    if (event.srcElement.className == 'mobile-facets__checkbox') {
      addForm(sourceForm);
    } else {
      // Genre pills sit outside both filter forms, so pair them with whichever set is on screen.
      const isGenrePills = sourceForm.id === 'FacetGenrePillsForm';
      const isMobile =
        sourceForm.id === 'FacetFiltersFormMobile' || (isGenrePills && !FacetFiltersForm.isDesktopFiltersVisible());

      sortFilterForms.forEach((form) => {
        if (!isMobile) {
          if (form.id === 'FacetSortForm' || form.id === 'FacetFiltersForm' || form.id === 'FacetSortDrawerForm') {
            addForm(form);
          }
        } else if (form.id === 'FacetFiltersFormMobile') {
          addForm(form);
        }
      });
    }

    // The genre filter lives only in the pills form, so add it to every submission.
    const genrePillsForm = document.getElementById('FacetGenrePillsForm');
    if (genrePillsForm) addForm(genrePillsForm);

    // The sort control (#PatternSort) may sit in a form this submission didn't include (the
    // filter bar's desktop form when the mobile sheet submits): add sort_by so it's never dropped.
    const patternSort = document.getElementById('PatternSort');
    if (patternSort && patternSort.form && !usedForms.has(patternSort.form)) {
      forms.push(new URLSearchParams({ sort_by: patternSort.value }).toString());
    }

    this.onSubmitForm(forms.filter(Boolean).join('&'), event);
  }

  onActiveFilterClick(event) {
    event.preventDefault();
    FacetFiltersForm.toggleActiveFacets();
    const url =
      event.currentTarget.href.indexOf('?') == -1
        ? ''
        : event.currentTarget.href.slice(event.currentTarget.href.indexOf('?') + 1);
    FacetFiltersForm.renderPage(url);
  }
}

FacetFiltersForm.filterData = [];
FacetFiltersForm.searchParamsInitial = window.location.search.slice(1);
FacetFiltersForm.searchParamsPrev = window.location.search.slice(1);
customElements.define('facet-filters-form', FacetFiltersForm);
FacetFiltersForm.setListeners();
FacetFiltersForm.setFilterBarListeners();

class PriceRange extends HTMLElement {
  constructor() {
    super();
    this.querySelectorAll('input').forEach((element) => {
      element.addEventListener('change', this.onRangeChange.bind(this));
      element.addEventListener('keydown', this.onKeyDown.bind(this));
    });
    this.setMinAndMaxValues();
  }

  onRangeChange(event) {
    this.adjustToValidValues(event.currentTarget);
    this.setMinAndMaxValues();
  }

  onKeyDown(event) {
    if (event.metaKey) return;

    const pattern = /[0-9]|\.|,|'| |Tab|Backspace|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Delete|Escape/;
    if (!event.key.match(pattern)) event.preventDefault();
  }

  setMinAndMaxValues() {
    const inputs = this.querySelectorAll('input');
    const minInput = inputs[0];
    const maxInput = inputs[1];
    if (maxInput.value) minInput.setAttribute('data-max', maxInput.value);
    if (minInput.value) maxInput.setAttribute('data-min', minInput.value);
    if (minInput.value === '') maxInput.setAttribute('data-min', 0);
    if (maxInput.value === '') minInput.setAttribute('data-max', maxInput.getAttribute('data-max'));
  }

  adjustToValidValues(input) {
    const value = Number(input.value);
    const min = Number(input.getAttribute('data-min'));
    const max = Number(input.getAttribute('data-max'));

    if (value < min) input.value = min;
    if (value > max) input.value = max;
  }
}

customElements.define('price-range', PriceRange);

class FacetRemove extends HTMLElement {
  constructor() {
    super();
    const facetLink = this.querySelector('a');
    facetLink.setAttribute('role', 'button');
    facetLink.addEventListener('click', this.closeFilter.bind(this));
    facetLink.addEventListener('keyup', (event) => {
      event.preventDefault();
      if (event.code.toUpperCase() === 'SPACE') this.closeFilter(event);
    });
  }

  closeFilter(event) {
    event.preventDefault();
    const form = this.closest('facet-filters-form') || document.querySelector('facet-filters-form');
    form.onActiveFilterClick(event);
  }
}

customElements.define('facet-remove', FacetRemove);
