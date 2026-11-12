class FacetFiltersForm extends HTMLElement {
  constructor() {
    super();
    this.onActiveFilterClick = this.onActiveFilterClick.bind(this);

    this.debouncedOnSubmit = debounce((event) => {
      this.onSubmitHandler(event);
    }, 800);

    const facetForm = this.querySelector('form');
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
        FacetFiltersForm.setGenrePillPressed(pill, pill.getAttribute('aria-pressed') !== 'true');
        FacetFiltersForm.syncGenrePills(form);
        pill.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      // "All" and "Clear" are facet-remove links (url_to_remove), which do the AJAX render.
      // Clear the pills here too so a pending debounced submit can't re-apply old genres.
      if (event.target.closest('[data-genre-clear]')) {
        form.querySelectorAll('.genre-pill[data-genre-handle]').forEach((p) => FacetFiltersForm.setGenrePillPressed(p, false));
        FacetFiltersForm.syncGenrePills(form);
      }
    });

    // Scroll events don't bubble; capture them from the rows to update the edge fade.
    form.addEventListener('scroll', (event) => {
      if (event.target.matches && event.target.matches('[data-genre-row]')) FacetFiltersForm.updateGenreRowFade(event.target);
    }, true);
    window.addEventListener('resize', debounce(() => FacetFiltersForm.refreshGenreRows(form), 100));

    requestAnimationFrame(() => FacetFiltersForm.refreshGenreRows(form, { scrollActive: true }));
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
    const children = pills.filter((pill) => pill.dataset.genreParent);
    // Same rule as genre-pills.liquid: a parent's children stay open while the parent or any of them is selected.
    const shouldShow = (pill) =>
      pressedHandles.has(pill.dataset.genreParent) || parentsOfPressedChildren.has(pill.dataset.genreParent);

    clearTimeout(FacetFiltersForm.genreCollapseTimer);
    if (children.some(shouldShow)) {
      children.forEach((pill) => {
        const show = shouldShow(pill);
        if (show && pill.hidden) {
          pill.hidden = false;
          pill.classList.add('genre-pill--entering');
          pill.addEventListener('animationend', () => pill.classList.remove('genre-pill--entering'), { once: true });
        } else if (!show) {
          pill.hidden = true;
        }
      });
      childWrapper.classList.add('is-open');
    } else {
      // Collapse with the pills still in place, then hide them once the row has closed.
      childWrapper.classList.remove('is-open');
      FacetFiltersForm.genreCollapseTimer = setTimeout(() => {
        children.forEach((pill) => (pill.hidden = true));
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
      }
    }
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
    const scrollPositions = {};
    target.querySelectorAll('[data-genre-row]').forEach((row) => {
      scrollPositions[row.dataset.genreRow] = row.scrollLeft;
    });

    target.innerHTML = source.innerHTML;

    target.querySelectorAll('[data-genre-row]').forEach((row) => {
      if (scrollPositions[row.dataset.genreRow]) row.scrollLeft = scrollPositions[row.dataset.genreRow];
    });
    if (focusedId) {
      let focusTarget = document.getElementById(focusedId);
      // Clear is hidden once nothing is selected; move focus to "All" instead of losing it.
      if (!focusTarget || focusTarget.closest('[hidden]')) focusTarget = document.getElementById('GenrePill-all');
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
    if (event.srcElement.className == 'mobile-facets__checkbox') {
      forms.push(this.createSearchParams(sourceForm));
    } else {
      // Genre pills sit outside both filter forms, so pair them with whichever set is on screen.
      const isGenrePills = sourceForm.id === 'FacetGenrePillsForm';
      const isMobile =
        sourceForm.id === 'FacetFiltersFormMobile' || (isGenrePills && !FacetFiltersForm.isDesktopFiltersVisible());

      sortFilterForms.forEach((form) => {
        if (!isMobile) {
          if (form.id === 'FacetSortForm' || form.id === 'FacetFiltersForm' || form.id === 'FacetSortDrawerForm') {
            forms.push(this.createSearchParams(form));
          }
        } else if (form.id === 'FacetFiltersFormMobile') {
          forms.push(this.createSearchParams(form));
        }
      });
    }

    // The genre filter lives only in the pills form, so add it to every submission.
    const genrePillsForm = document.getElementById('FacetGenrePillsForm');
    if (genrePillsForm) forms.push(this.createSearchParams(genrePillsForm));

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
