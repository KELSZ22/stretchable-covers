/**
 * Product-page volume price preview via Shopify Cart API (matches cart drawer pricing).
 */
(function () {
  'use strict';

  var previewToken = 0;
  var priceCache = new Map();
  var cartCache = null;
  var cartCacheAt = 0;
  var CART_CACHE_MS = 1500;
  var PRICE_CACHE_MAX = 40;

  function cartEndpoint(path) {
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    return root.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '');
  }

  function cacheKey(variantId, lineQuantity) {
    return String(variantId) + ':' + String(lineQuantity);
  }

  function trimPriceCache() {
    if (priceCache.size <= PRICE_CACHE_MAX) return;
    var keys = priceCache.keys();
    priceCache.delete(keys.next().value);
  }

  function formatMoney(cents, moneyFormat, currency) {
    cents = Math.max(0, Number(cents) || 0);

    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      return window.Shopify.formatMoney(cents, moneyFormat || '${{amount}}');
    }

    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(cents / 100);
  }

  function fetchCart(force) {
    var now = Date.now();
    if (!force && cartCache && now - cartCacheAt < CART_CACHE_MS) {
      return Promise.resolve(cartCache);
    }

    return fetch(cartEndpoint('cart.js'), { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().then(function (cart) {
        cartCache = cart;
        cartCacheAt = Date.now();
        return cart;
      });
    });
  }

  function invalidateCartCache() {
    cartCache = null;
    cartCacheAt = 0;
  }

  function changeCartLine(key, quantity) {
    invalidateCartCache();
    return fetch(cartEndpoint('cart/change.js'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ id: key, quantity: Math.max(0, Number(quantity) || 0) }),
    }).then(function (res) {
      return res.json().then(function (cart) {
        if (!res.ok) throw cart;
        cartCache = cart;
        cartCacheAt = Date.now();
        return cart;
      });
    });
  }

  function addToCart(variantId, quantity) {
    invalidateCartCache();
    return fetch(cartEndpoint('cart/add.js'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        items: [{ id: Number(variantId), quantity: Math.max(1, Number(quantity) || 1) }],
      }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw data;
        return data;
      });
    });
  }

  function restoreCartLine(key, quantity) {
    changeCartLine(key, quantity).then(function () {
      document.dispatchEvent(
        new CustomEvent('cart:updated', { detail: { source: 'volume-price-preview' } })
      );
    });
  }

  function findLine(cart, variantId) {
    return (cart.items || []).find(function (item) {
      return Number(item.variant_id) === Number(variantId);
    });
  }

  function lineFromAddResponse(added, variantId) {
    if (!added) return null;

    var items = [];

    if (Array.isArray(added.items)) {
      items = added.items;
    } else if (Array.isArray(added)) {
      items = added;
    } else if (added.variant_id) {
      items = [added];
    }

    return (
      items.find(function (item) {
        return Number(item.variant_id) === Number(variantId);
      }) || items[0] || null
    );
  }

  function priceFromLine(line) {
    if (!line) return null;

    var quantity = Number(line.quantity) || 1;
    var finalUnitCents = Number(
      line.final_price != null
        ? line.final_price
        : line.discounted_price != null
          ? line.discounted_price
          : line.price
    ) || 0;
    var compareUnitCents =
      Number(line.original_price != null ? line.original_price : line.price) || finalUnitCents;
    var lineTotalCents =
      Number(
        line.final_line_price != null
          ? line.final_line_price
          : line.line_price != null
            ? line.line_price
            : finalUnitCents * quantity
      ) || 0;
    var originalLineCents =
      Number(line.original_line_price != null ? line.original_line_price : compareUnitCents * quantity) ||
      0;
    var hasDiscount = originalLineCents > lineTotalCents || compareUnitCents > finalUnitCents;

    return {
      finalUnitCents: finalUnitCents,
      compareUnitCents: hasDiscount ? compareUnitCents : finalUnitCents,
      hasDiscount: hasDiscount,
    };
  }

  function fetchCartLinePricing(cart, variantId, lineQuantity, token) {
    variantId = Number(variantId);
    lineQuantity = Math.max(1, Number(lineQuantity) || 1);

    var existing = findLine(cart, variantId);

    if (existing) {
      var savedQty = Number(existing.quantity) || 0;

      if (savedQty === lineQuantity) {
        return Promise.resolve(priceFromLine(existing));
      }

      return changeCartLine(existing.key, lineQuantity).then(function (cartAfter) {
        if (token !== previewToken) return null;

        var line = findLine(cartAfter, variantId);
        var prices = priceFromLine(line);

        if (savedQty !== lineQuantity && line && line.key) {
          restoreCartLine(line.key, savedQty);
        }

        return prices;
      });
    }

    return addToCart(variantId, lineQuantity).then(function (added) {
      if (token !== previewToken) return null;

      var line = lineFromAddResponse(added, variantId);
      var prices = priceFromLine(line);

      if (line && line.key) {
        restoreCartLine(line.key, 0);
      }

      return prices;
    });
  }

  function renderPriceHtml(prices, formatMoneyFn) {
    if (!prices) return '';

    if (!prices.hasDiscount) {
      return '<span class="price">Starts at ' + formatMoneyFn(prices.finalUnitCents) + '</span>';
    }

    return (
      '<span class="price">' +
      formatMoneyFn(prices.finalUnitCents) +
      '</span>' +
      '<span class="custom-cart-item-price-compare">' +
      formatMoneyFn(prices.compareUnitCents) +
      '</span>'
    );
  }

  function init(root) {
    if (!root || root.dataset.volumePriceInit === 'true') return;

    root.dataset.volumePriceInit = 'true';

    var section = root.closest('.shopify-section');
    var productId = root.dataset.productId || '';
    var productForm = root.closest('form[action*="/cart/add"]');
    var moneyFormat = root.dataset.moneyFormat || '${{amount}}';
    var currency = root.dataset.currency || 'USD';
    var format = function (cents) {
      return formatMoney(cents, moneyFormat, currency);
    };

    var debounceTimer = null;
    var activeController = null;
    var priceContainers = null;

    function getQuantitySelector() {
      return root.querySelector('quantity-selector-component, cart-quantity-selector-component');
    }

    function getQuantityInput() {
      var direct = root.querySelector('input[name="quantity"]');
      if (direct instanceof HTMLInputElement) return direct;

      var selector = getQuantitySelector();
      if (!selector) return null;

      if (selector.shadowRoot) {
        var shadowInput = selector.shadowRoot.querySelector('input[name="quantity"]');
        if (shadowInput instanceof HTMLInputElement) return shadowInput;
      }

      var lightInput = selector.querySelector('input[name="quantity"]');
      return lightInput instanceof HTMLInputElement ? lightInput : null;
    }

    function findVariantId() {
      var form =
        productForm ||
        (section && section.querySelector('form[action*="/cart/add"]')) ||
        document.querySelector('form[action*="/cart/add"]');
      if (!form) return null;

      var variantInput = form.querySelector('[name="id"]');
      return variantInput ? String(variantInput.value) : null;
    }

    function resolvePriceContainers() {
      if (priceContainers && priceContainers.length) return priceContainers;

      var containers = [];
      var seen = new Set();

      function add(el) {
        if (!el || seen.has(el)) return;
        seen.add(el);
        containers.push(el);
      }

      if (section) {
        section.querySelectorAll('[data-volume-price-updatable]').forEach(add);
      }

      if (productId) {
        document.querySelectorAll('product-price[data-product-id="' + productId + '"]').forEach(function (el) {
          el.querySelectorAll('[data-volume-price-updatable]').forEach(add);
          var priceContainer = el.querySelector('[ref="priceContainer"]');
          if (priceContainer) add(priceContainer);
        });
      }

      priceContainers = containers;
      return containers;
    }

    function priceValuesEl(container) {
      return container.querySelector('.volume-price-preview__values') || container;
    }

    function setLoading(isLoading) {
      resolvePriceContainers().forEach(function (container) {
        container.classList.toggle('is-volume-price-loading', isLoading);
        container.setAttribute('aria-busy', isLoading ? 'true' : 'false');

        var spinner = container.querySelector('.volume-price-preview__spinner');
        if (spinner) {
          spinner.hidden = !isLoading;
        }
      });
    }

    function applyPrices(prices) {
      if (!prices) return;

      var html = renderPriceHtml(prices, format);
      var containers = resolvePriceContainers();

      if (!containers.length) {
        setTimeout(refreshPricing, 100);
        return;
      }

      containers.forEach(function (container) {
        priceValuesEl(container).innerHTML = html;
      });
    }

    function refreshPricing() {
      var variantId = findVariantId();
      var input = getQuantityInput();

      if (!variantId || !input) return;

      var inputQty = Math.max(1, parseInt(String(input.value), 10) || 1);
      var token = ++previewToken;
      var hadInstantCache = false;

      var cachedPrices = priceCache.get(cacheKey(variantId, inputQty));
      if (cachedPrices) {
        hadInstantCache = true;
        applyPrices(cachedPrices);
      }

      if (activeController) {
        activeController.aborted = true;
      }

      var controller = { aborted: false };
      activeController = controller;

      setLoading(!hadInstantCache);

      fetchCart(false)
        .then(function (cart) {
          if (controller.aborted || token !== previewToken) return null;

          var lineQuantity = inputQty;

          var hit = priceCache.get(cacheKey(variantId, lineQuantity));
          if (hit) {
            return hit;
          }

          return fetchCartLinePricing(cart, variantId, lineQuantity, token).then(function (prices) {
            return { prices: prices, lineQuantity: lineQuantity };
          });
        })
        .then(function (result) {
          if (controller.aborted || token !== previewToken || !result || !result.prices) return;

          priceCache.set(cacheKey(variantId, result.lineQuantity), result.prices);
          trimPriceCache();
          applyPrices(result.prices);
        })
        .catch(function (err) {
          if (!controller.aborted) {
            console.error('[custom-product-volume-price] cart preview failed', err);
          }
        })
        .finally(function () {
          if (!controller.aborted) {
            setLoading(false);
          }
        });
    }

    function scheduleRefresh(immediate) {
      clearTimeout(debounceTimer);

      if (immediate) {
        refreshPricing();
        return;
      }

      debounceTimer = setTimeout(refreshPricing, 120);
    }

    function bindQuantityInput() {
      var input = getQuantityInput();
      if (!input) return;

      if (input.dataset.volumePriceBound !== 'true') {
        input.dataset.volumePriceBound = 'true';
        input.addEventListener('input', function () {
          scheduleRefresh(false);
        });
        input.addEventListener('change', function () {
          scheduleRefresh(true);
        });
      }
    }

    bindQuantityInput();

    var quantitySelector = getQuantitySelector();
    if (quantitySelector) {
      quantitySelector.addEventListener('quantity-selector:update', function () {
        scheduleRefresh(true);
      });
    }

    document.addEventListener('quantity-selector:update', function (event) {
      if (!(event.target instanceof Node)) return;
      if (!root.contains(event.target) && !(productForm && productForm.contains(event.target))) return;
      scheduleRefresh(true);
    });

    if (section) {
      section.addEventListener('variant:update', function () {
        priceCache.clear();
        invalidateCartCache();
        priceContainers = null;
        setTimeout(function () {
          bindQuantityInput();
          scheduleRefresh(true);
        }, 50);
      });

      section.addEventListener('volume-price:sync', function () {
        scheduleRefresh(true);
      });
    }

    document.addEventListener('cart:updated', function (event) {
      if (event.detail && event.detail.source === 'volume-price-preview') return;
      priceCache.clear();
      invalidateCartCache();
      scheduleRefresh(true);
    });

    document.addEventListener('change', function (event) {
      if (!event.target || !event.target.matches) return;
      if (!event.target.matches('input, select')) return;
      if (section && !section.contains(event.target)) return;
      scheduleRefresh(false);
    });

    scheduleRefresh(true);
  }

  function initAll() {
    document.querySelectorAll('[data-quantity-volume-root]').forEach(init);
  }

  window.CustomProductVolumePrice = {
    init: init,
    initAll: initAll,
    invalidateCartCache: invalidateCartCache,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', initAll);
})();
