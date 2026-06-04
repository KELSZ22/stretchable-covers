(function () {
  'use strict';

  var DEBUG = Boolean((window.StretchableCartDrawerConfig || {}).debug);

  function log() {
    if (!DEBUG || !window.console) return;
    console.log.apply(console, arguments);
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(cents) {
    cents = Number(cents || 0);

    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      return window.Shopify.formatMoney(cents, window.theme && window.theme.moneyFormat ? window.theme.moneyFormat : '${{amount}}');
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || 'USD'
    }).format(cents / 100);
  }

  function getEls() {
    return {
      trigger: $('#customCartTrigger'),
      drawer: $('#customCartDrawer'),
      overlay: $('#customCartOverlay'),
      closeBtn: $('#customCartClose'),
      body: $('#customCartBody'),
      footer: $('#customCartFooter'),
      count: $('#customCartCount'),
      subtotal: $('#customCartSubtotal'),
      itemLabel: $('#customCartItemLabel')
    };
  }

  function injectStyles() {
    if ($('#stretchable-cart-drawer-patch-styles')) return;

    var style = document.createElement('style');
    style.id = 'stretchable-cart-drawer-patch-styles';
    style.textContent = [
      '.custom-cart-drawer{height:100vh;height:100dvh;overflow:hidden;}',
      '.custom-cart-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:18px;}',
      '.custom-cart-body.is-empty{overflow:hidden;padding-bottom:0;}',
      '.custom-cart-footer{flex:0 0 auto;}',
      '.custom-cart-item-properties{margin:4px 0 8px;font-family:Lato,Arial,sans-serif;font-size:13px;line-height:1.35;color:#555;}',
      '.custom-cart-item-property{margin-bottom:2px;}',
      '.custom-cart-item-property strong{font-weight:700;color:#333;}',
      '.custom-cart-error{padding:20px;font-family:Lato,Arial,sans-serif;color:#222;}',
      '.custom-cart-item{padding-bottom:18px;}',
      '.custom-cart-item + .custom-cart-item{border-top:1px solid #eee;}',
      '.custom-cart-item-price-each{font-size:12px;color:#666;font-weight:400;white-space:nowrap;}',
      '.custom-cart-item-price-compare{margin-left:6px;font-size:12px;color:#777;text-decoration:line-through;white-space:nowrap;}',
      '.custom-cart-item-discounts{list-style:none;margin:6px 0 0;padding:0;font-size:12px;color:#c62828;font-weight:600;}',
      '.custom-cart-item-discounts li{margin:0;}',
      '.custom-cart-summary-discount{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:#2d5b2e;font-weight:600;}',
      '.custom-cart-design-link{display:inline-block;cursor:pointer;background:none;border:none;padding:0;font:inherit;color:inherit;}',
      '.custom-cart-design-thumb{display:block;width:80px;height:80px;object-fit:contain;border-radius:6px;border:1px solid #e5e5e5;margin-top:4px;}',
      '.custom-cart-design-label{font-size:13px;font-family:Lato,sans-serif;font-weight:400;color:#555;line-height:1.35;}',
      '.custom-cart-design-title-link{display:inline;cursor:pointer;background:none;border:none;padding:0;font-size:13px;font-family:Lato,sans-serif;font-weight:400;color:#555;text-decoration:underline;text-underline-offset:2px;line-height:1.35;}',
      '.custom-cart-design-modal-overlay{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s ease;}',
      '.custom-cart-design-modal-overlay.open{opacity:1;pointer-events:auto;}',
      '.custom-cart-design-modal{background:#fff;border-radius:10px;padding:20px;max-width:min(92vw,700px);max-height:90vh;overflow:auto;position:relative;box-shadow:0 8px 30px rgba(0,0,0,.18);}',
      '.custom-cart-design-modal-close{position:absolute;top:10px;right:10px;width:32px;height:32px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:999px;}',
      '.custom-cart-design-modal-close:hover{background:rgba(0,0,0,.06);}',
      '.custom-cart-design-modal-heading{margin:0 0 4px;font-size:18px;font-weight:700;line-height:1.2;}',
      '.custom-cart-design-modal-title{margin:0 0 12px;font-size:14px;font-weight:500;color:#555;}',
      '.custom-cart-design-modal-image{display:block;width:auto;max-width:min(84vw,640px);height:auto;max-height:calc(90vh - 10rem);margin:0 auto;object-fit:contain;border-radius:6px;}',
      '.custom-cart-qty{position:relative;}',
      '.custom-cart-qty-value{display:inline-block;min-width:24px;text-align:center;}',
      '.custom-cart-item.is-updating{opacity:.72;}',
      '.custom-cart-item.is-updating .custom-cart-qty button,.custom-cart-item.is-updating .custom-cart-remove{cursor:wait;}',
      '.custom-cart-qty.is-loading .custom-cart-qty-value{visibility:hidden;}',
      '.custom-cart-qty.is-loading::after{content:"";position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid rgba(53,91,136,.25);border-top-color:#355b88;border-radius:50%;animation:custom-cart-qty-spin .65s linear infinite;}',
      '.custom-cart-body.is-cart-updating,.custom-cart-footer.is-cart-updating{cursor:wait;}',
      '.custom-cart-footer.is-cart-updating .custom-cart-checkout{pointer-events:none;opacity:.7;}',
      '@keyframes custom-cart-qty-spin{to{transform:rotate(360deg);}}',
      '.custom-diameter-meta{display:flex;align-items:center;gap:6px;margin:4px 0 0;color:#5f5f5f;font-family:Lato,Arial,sans-serif;font-size:14px;line-height:18px;}',
      '.custom-diameter-meta__label,.custom-diameter-meta__value{color:inherit;font:inherit;}',
      '.custom-diameter-meta__icon{display:inline-flex;width:18px;height:18px;flex:0 0 18px;}',
      '.custom-diameter-meta__icon svg{display:block;width:18px;height:18px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function getItemImage(item) {
    if (!item) return '';
    if (typeof item.image === 'string' && item.image) return item.image;
    if (item.featured_image && item.featured_image.url) return item.featured_image.url;
    if (item.featured_image && typeof item.featured_image === 'string') return item.featured_image;
    return '';
  }

  function getVariantText(item) {
    if (!item) return '';
    if (item.variant_title && item.variant_title !== 'Default Title') return item.variant_title;
    return '';
  }

  function normalizePropertyLabel(key) {
    var original = String(key || '').trim();
    var normalized = original
      .replace(/^properties\[|\]$/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    var lower = normalized.toLowerCase();

    if (lower === 'product diameter' || lower === 'diameter' || lower === 'product variant diameter') {
      return 'Diameter';
    }

    if (lower === 'imprint' || lower === 'standard cover imprint' || lower === 'cover imprint') {
      return 'Imprint';
    }

    if (lower === 'imprint size' || lower === 'print size' || lower === 'logo size') {
      return 'Imprint Size';
    }

    if (lower === 'color' || lower === 'colour' || lower === 'background color' || lower === 'background colour') {
      return 'Color';
    }

    return normalized.replace(/\b\w/g, function (char) { return char.toUpperCase(); });
  }

  var DIAMETER_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
    '<path d="M9 0C4.03711 0 0 4.03711 0 9C0 13.9629 4.03711 18 9 18C13.9629 18 18 13.9629 18 9C18 4.03711 13.9629 0 9 0ZM9 1.5C13.1514 1.5 16.5 4.84863 16.5 9C16.5 13.1514 13.1514 16.5 9 16.5C4.84863 16.5 1.5 13.1514 1.5 9C1.5 4.84863 4.84863 1.5 9 1.5ZM9.75 4.5L11.0947 5.84473L5.84473 11.0947L4.5 9.75V13.5H8.25L6.90527 12.1553L12.1553 6.90527L13.5 8.25V4.5H9.75Z" fill="#5F5F5F"/></svg>';

  function isDiameterPropertyKey(key) {
    var lower = String(key || '').replace(/^_+/, '').trim().toLowerCase();
    return (
      lower === 'diameter' ||
      lower === 'product diameter' ||
      lower === 'product variant diameter' ||
      lower === 'variant diameter' ||
      lower === 'bell diameter' ||
      lower === 'entered diameter' ||
      lower === 'custom diameter' ||
      lower === 'diameter size'
    );
  }

  function isCartHiddenDetailProperty(key) {
    var lower = String(key || '').replace(/^_+/, '').trim().toLowerCase();
    return (
      isDiameterPropertyKey(key) ||
      lower === 'imprint size' ||
      lower === 'imprint' ||
      lower === 'imprint type' ||
      lower === 'cover imprint' ||
      lower === 'print size' ||
      lower === 'design image' ||
      lower === 'design file format'
    );
  }

  function getLineItemDesignImageUrl(props) {
    props = props || {};
    var designImage = props['_Design Image'] || props['Design Image'];
    if (!designImage) return '';
    return String(designImage).trim();
  }

  function formatDiameterDisplay(value) {
    if (window.CustomDiameterFormat && typeof window.CustomDiameterFormat.formatDiameterDisplay === 'function') {
      return window.CustomDiameterFormat.formatDiameterDisplay(value);
    }
    return String(value || '').trim();
  }

  function getLineItemDiameter(item) {
    var props = item && item.properties ? item.properties : {};
    var propertyName;
    var value;

    for (propertyName in props) {
      if (!Object.prototype.hasOwnProperty.call(props, propertyName)) continue;
      if (!isDiameterPropertyKey(propertyName)) continue;
      if (propertyName.charAt(0) === '_') continue;

      value = String(props[propertyName] == null ? '' : props[propertyName]).trim();
      if (value && value !== '0' && value !== 'Default Title') {
        return formatDiameterDisplay(value);
      }
    }

    return '';
  }

  function getDiameterDisplayHtml(item) {
    var value = getLineItemDiameter(item);
    if (!value) return '';

    return (
      '<div class="custom-cart-item-diameter custom-diameter-meta">' +
        '<span class="custom-diameter-meta__label">Diameter</span>' +
        '<span class="custom-diameter-meta__icon">' + DIAMETER_ICON_SVG + '</span>' +
        '<span class="custom-diameter-meta__value">' + escapeHtml(value) + '</span>' +
      '</div>'
    );
  }

  function shouldShowProperty(key, value) {
    if (!key) return false;
    if (key.charAt(0) === '_') return false;
    if (isCartHiddenDetailProperty(key)) return false;
    if (value === null || value === undefined || String(value).trim() === '') return false;
    return true;
  }

  function readCachedPreviewByToken(productId, token) {
    if (!token) return '';

    try {
      var storageKey = 'custom-cover-preview:v1:' + (productId || 'unknown-product');
      var raw = window.localStorage.getItem(storageKey);
      if (!raw) return '';

      var map = JSON.parse(raw);
      var cached = map && map[token] && map[token].image;
      return cached ? String(cached).trim() : '';
    } catch (e) {
      return '';
    }
  }

  function isAllowedDesignPreviewUrl(url) {
    url = String(url || '').trim();
    if (!url || url.indexOf('data:') !== -1) return false;
    return (
      url.indexOf('/uploads/') !== -1 ||
      url.indexOf('cdn.shopify.com') !== -1 ||
      /^https?:\/\//i.test(url)
    );
  }

  function resolveDesignPreviewSrc(item) {
    var props = item && item.properties ? item.properties : {};
    var designImage = getLineItemDesignImageUrl(props);
    if (designImage && isAllowedDesignPreviewUrl(designImage)) {
      return designImage;
    }
    return '';
  }

  function getDesignPreviewUrlForAttr(previewSrc) {
    previewSrc = String(previewSrc || '').trim();
    if (!previewSrc) return '';
    if (previewSrc.indexOf('/uploads/') !== -1 || previewSrc.indexOf('cdn.shopify.com') !== -1) {
      return previewSrc;
    }
    if (/^https?:\/\//i.test(previewSrc)) return previewSrc;
    return '';
  }

  function getDesignPreviewTriggerAttrs(item, previewSrc) {
    var props = item && item.properties ? item.properties : {};
    var token = String(props['_Customizer Preview Token'] || props['Customizer Preview Token'] || '').trim();
    var productId = String(item && item.product_id ? item.product_id : 'unknown-product').trim();
    var attrSrc = getDesignPreviewUrlForAttr(previewSrc);

    return (
      'data-design-drawer-open data-design-preview-open ' +
      'data-design-src="' + escapeHtml(attrSrc) + '" ' +
      'data-design-preview-src="' + escapeHtml(attrSrc) + '" ' +
      'data-design-preview-token="' + escapeHtml(token) + '" ' +
      'data-design-preview-product-id="' + escapeHtml(productId) + '"'
    );
  }

  function resolveDesignPreviewSrcFromTrigger(trigger) {
    if (!trigger) return '';

    var src = (
      trigger.getAttribute('data-design-preview-src') ||
      trigger.getAttribute('data-design-src') ||
      ''
    ).trim();
    var token = (trigger.getAttribute('data-design-preview-token') || '').trim();
    var productId = (trigger.getAttribute('data-design-preview-product-id') || 'unknown-product').trim();

    if (isAllowedDesignPreviewUrl(src)) {
      return src;
    }

    return '';
  }

  function getPropertiesHtml(item) {
    var props = item && item.properties ? item.properties : {};
    var previewSrc = resolveDesignPreviewSrc(item);
    var designTitle = props['Design title'] || '';
    var keys = Object.keys(props).filter(function (key) {
      return shouldShowProperty(key, props[key]);
    });

    if (!keys.length && !previewSrc) return '';

    var html = '<div class="custom-cart-item-properties">';

    html += keys.map(function (key) {
      var label = normalizePropertyLabel(key);
      var value = props[key];

      if (key === 'Design title' && previewSrc) {
        return '<div class="custom-cart-item-property">' +
          '<span class="custom-cart-design-label">' + escapeHtml(label) + ':</span> ' +
          '<button type="button" class="custom-cart-design-title-link" ' +
          getDesignPreviewTriggerAttrs(item, previewSrc) + ' ' +
          'data-design-title="' + escapeHtml(value) + '" ' +
          'data-design-preview-title="' + escapeHtml(value) + '">' +
          escapeHtml(value) +
          '</button></div>';
      }

      return '<div class="custom-cart-item-property"><strong>' + escapeHtml(label) + ':</strong> <span>' + escapeHtml(value) + '</span></div>';
    }).join('');


    html += '</div>';
    return html;
  }

  function getLineDiscountsHtml(item) {
    var allocations = item && Array.isArray(item.line_level_discount_allocations) ? item.line_level_discount_allocations : [];
    if (!allocations.length) return '';

    return '<ul class="custom-cart-item-discounts">' + allocations.map(function (allocation) {
      var amount = Number(allocation && allocation.amount ? allocation.amount : 0);
      if (!amount) return '';
      return '<li>Save - ' + money(amount) + '</li>';
    }).join('') + '</ul>';
  }

  function updateHeaderBubble(count) {
    var trigger = $('#customCartTrigger') || document.querySelector('a[href*="/cart"]');
    var bubble = $('.cart-count');

    if (!trigger) return;

    if (!bubble && count > 0) {
      bubble = document.createElement('span');
      bubble.className = 'cart-count';
      trigger.appendChild(bubble);
    }

    if (bubble) {
      bubble.textContent = count;
      bubble.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  function fetchCartJson() {
    return fetch('/cart.js', { headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json();
    });
  }

  function resolveCartAfterDiameterNormalize(cart) {
    if (
      !window.CustomDiameterFormat ||
      typeof window.CustomDiameterFormat.normalizeCartDiameters !== 'function'
    ) {
      return Promise.resolve(cart);
    }

    return window.CustomDiameterFormat.normalizeCartDiameters()
      .then(function (updated) {
        if (!updated) return cart;
        return fetchCartJson();
      })
      .catch(function () {
        return cart;
      });
  }

  function getLinePriceDisplay(item) {
    var quantity = Number(item.quantity || 0);
    var unitPriceCents = Number(item.final_price != null ? item.final_price : item.price) || 0;
    var compareUnitCents =
      Number(item.original_price != null ? item.original_price : item.price) || unitPriceCents;
    var lineTotalCents =
      Number(item.final_line_price != null ? item.final_line_price : unitPriceCents * quantity) || 0;
    var originalLineCents =
      Number(item.original_line_price != null ? item.original_line_price : lineTotalCents) || 0;
    var hasUnitDiscount = compareUnitCents > unitPriceCents;
    var linePriceDisplay;

    if (quantity > 1) {
      linePriceDisplay =
        money(lineTotalCents) +
        ' <span class="custom-cart-item-price-each">(' +
        money(unitPriceCents) +
        ' each)</span>';
      if (hasUnitDiscount) {
        linePriceDisplay +=
          '<span class="custom-cart-item-price-compare">' + money(compareUnitCents) + ' each</span>';
      }
    } else {
      linePriceDisplay = money(lineTotalCents);
      if (hasUnitDiscount) {
        linePriceDisplay +=
          '<span class="custom-cart-item-price-compare">' + money(compareUnitCents) + '</span>';
      } else if (originalLineCents > lineTotalCents) {
        linePriceDisplay +=
          '<span class="custom-cart-item-price-compare">' + money(originalLineCents) + '</span>';
      }
    }

    return linePriceDisplay;
  }

  function updateCartSummary(cart) {
    var els = getEls();
    if (!cart) return;

    updateHeaderBubble(cart.item_count || 0);

    if (els.count) {
      els.count.textContent = '(' + cart.item_count + ')';
    }

    if (els.itemLabel) {
      els.itemLabel.textContent = cart.item_count + (cart.item_count === 1 ? ' Item' : ' Items');
    }

    if (els.subtotal) {
      els.subtotal.textContent = money(Number(cart.total_price || 0));
    }

    var discountRow = els.footer && els.footer.querySelector('.custom-cart-summary-discount');
    var itemsSubtotal = Number(
      cart.items_subtotal_price != null ? cart.items_subtotal_price : cart.total_price || 0
    );
    var totalPrice = Number(cart.total_price || 0);
    var discountTotal = Number(
      cart.total_discount != null ? cart.total_discount : Math.max(0, itemsSubtotal - totalPrice)
    );

    if (discountTotal > 0) {
      if (!discountRow && els.footer) {
        var subtotalRow = els.footer.querySelector('.custom-cart-subtotal-row');
        if (subtotalRow) {
          subtotalRow.insertAdjacentHTML(
            'afterend',
            '<div class="custom-cart-summary-discount"><span>Discounts</span><span>-' +
              money(discountTotal) +
              '</span></div>'
          );
        }
      } else if (discountRow) {
        var discountValue = discountRow.querySelector('span:last-child');
        if (discountValue) {
          discountValue.textContent = '-' + money(discountTotal);
        }
      }
    } else if (discountRow) {
      discountRow.remove();
    }
  }

  function updateCartLinePricing(cart) {
    if (!cart || !Array.isArray(cart.items)) return;

    cart.items.forEach(function (item) {
      var key = String(item.key || '');
      if (!key) return;

      var row = document.querySelector('.custom-cart-item[data-cart-key="' + cssEscapeValue(key) + '"]');
      if (!row) return;

      var priceEl = row.querySelector('.custom-cart-item-price');
      if (priceEl) {
        priceEl.innerHTML = getLinePriceDisplay(item);
      }

      var qtyValue = row.querySelector('.custom-cart-qty-value');
      if (qtyValue) {
        qtyValue.textContent = String(Number(item.quantity || 0));
      }

      var qtyButtons = row.querySelectorAll('.custom-cart-qty button[data-qty]');
      if (qtyButtons.length >= 2) {
        qtyButtons[0].setAttribute('data-qty', String(Math.max(0, Number(item.quantity || 0) - 1)));
        qtyButtons[1].setAttribute('data-qty', String(Number(item.quantity || 0) + 1));
      }
    });
  }

  function cssEscapeValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function addBusinessDays(startDate, businessDays) {
    var date = new Date(startDate);
    var added = 0;

    while (added < businessDays) {
      date.setDate(date.getDate() + 1);
      var day = date.getDay();
      if (day !== 0 && day !== 6) added++;
    }

    return date;
  }

  function getDeliveryEstimateHtml() {
    var estimatedDate = addBusinessDays(new Date(), 15);
    var formattedDate = estimatedDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    return '<div class="custom-cart-delivery">Estimated Delivery by <strong>' + formattedDate + '</strong></div>';
  }

  function renderEmpty(cart) {
    var els = getEls();
    if (!els.body) return;

    if (els.count) els.count.textContent = '(' + (cart.item_count || 0) + ')';
    if (els.footer) els.footer.style.display = 'none';
    els.body.classList.add('is-empty');
    els.body.innerHTML = '<div class="custom-cart-empty-wrap"><div class="custom-cart-empty"><h3>Your cart is currently empty.</h3><p>Add your custom covers to your cart!</p><a href="/collections/all" class="shop-now-btn">Shop Now</a></div></div>';
  }

  function renderCart(cart) {
    var els = getEls();
    if (!els.body) return;

    cart = cart || { item_count: 0, items: [], total_price: 0 };
    updateHeaderBubble(cart.item_count || 0);

    if (!cart.items || !cart.items.length) {
      renderEmpty(cart);
      return;
    }

    els.body.classList.remove('is-empty');
    if (els.count) els.count.textContent = '(' + cart.item_count + ')';
    if (els.footer) els.footer.style.display = 'block';
    if (els.itemLabel) els.itemLabel.textContent = cart.item_count + (cart.item_count === 1 ? ' Item' : ' Items');

    els.body.innerHTML = cart.items.map(function (item) {
      var image = getItemImage(item);
      var quantity = Number(item.quantity || 0);
      var linePriceDisplay = getLinePriceDisplay(item);
      var variantText = getVariantText(item);
      var key = escapeHtml(item.key || '');

      return '' +
        '<div class="custom-cart-item" data-cart-key="' + key + '">' +
          '<div class="custom-cart-item-image">' +
            (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.product_title || item.title) + '">' : '') +
          '</div>' +
          '<div class="custom-cart-item-details">' +
            '<div class="custom-cart-item-top">' +
              '<div>' +
                '<div class="custom-cart-item-title">' + escapeHtml(item.product_title || item.title) + '</div>' +
                (variantText ? '<div class="custom-cart-item-variant">' + escapeHtml(variantText) + '</div>' : '') +
                getDiameterDisplayHtml(item) +
                getPropertiesHtml(item) +
                '<div class="custom-cart-item-price">' + linePriceDisplay + '</div>' +
                getLineDiscountsHtml(item) +
              '</div>' +
              '<button type="button" class="custom-cart-remove" data-key="' + key + '" aria-label="Remove item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>' +
              '</button>' +
            '</div>' +
            '<div class="custom-cart-item-bottom">' +
              '<div class="custom-cart-qty">' +
                '<button type="button" data-key="' + key + '" data-qty="' + (quantity - 1) + '" aria-label="Decrease quantity">−</button>' +
                '<span class="custom-cart-qty-value">' + quantity + '</span>' +
                '<button type="button" data-key="' + key + '" data-qty="' + (quantity + 1) + '" aria-label="Increase quantity">+</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    if (els.footer) {
      var itemsSubtotal = Number(cart.items_subtotal_price != null ? cart.items_subtotal_price : cart.total_price || 0);
      var totalPrice = Number(cart.total_price || 0);
      var discountTotal = Number(cart.total_discount != null ? cart.total_discount : Math.max(0, itemsSubtotal - totalPrice));
      els.footer.innerHTML = '' +
        '<div class="custom-cart-subtotal-row">' +
          '<div class="custom-cart-subtotal-row-inner">' +
            '<strong>Subtotal (<span id="customCartItemLabel">' + cart.item_count + (cart.item_count === 1 ? ' Item' : ' Items') + '</span>)</strong>' +
            '<strong id="customCartSubtotal">' + money(totalPrice) + '</strong>' +
          '</div>' +
          (discountTotal > 0 ? '<div class="custom-cart-summary-discount"><span>Discounts</span><span>-' + money(discountTotal) + '</span></div>' : '') +
          '<p>Shipping, taxes, and promo codes may apply at checkout</p>' +
        '</div>' +
        '<a href="/checkout" class="custom-cart-checkout">Secure Check Out</a>' +
        getDeliveryEstimateHtml();
    }
  }

  function loadCart(callback) {
    return fetchCartJson()
      .then(function (cart) {
        renderCart(cart);
        return resolveCartAfterDiameterNormalize(cart).then(function (finalCart) {
          if (finalCart !== cart) {
            renderCart(finalCart);
          }
          if (callback) callback(finalCart);
          return finalCart;
        });
      })
      .catch(function (error) {
        console.error('[StretchableCartDrawer] Cart load error:', error);
        var els = getEls();
        if (els.body) els.body.innerHTML = '<div class="custom-cart-error">There was an error loading your cart.</div>';
      });
  }

  function openDrawer(cartOrSkipLoad) {
    var els = getEls();
    if (!els.drawer || !els.overlay) return;

    injectStyles();
    els.drawer.classList.add('open');
    els.overlay.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (cartOrSkipLoad === true) {
      return;
    }

    if (cartOrSkipLoad && cartOrSkipLoad.items) {
      renderCart(cartOrSkipLoad);
      return;
    }

    loadCart();
  }

  function closeDrawer() {
    var els = getEls();
    if (!els.drawer || !els.overlay) return;

    els.drawer.classList.remove('open');
    els.overlay.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  var cartQuantityUpdatesInFlight = 0;

  function findCartItemByKey(key) {
    var items = document.querySelectorAll('.custom-cart-item[data-cart-key]');
    var match = null;

    items.forEach(function (item) {
      if (item.getAttribute('data-cart-key') === key) {
        match = item;
      }
    });

    return match;
  }

  function setCartKeyLoading(key, isLoading) {
    if (!key) return;

    var item = findCartItemByKey(key);
    if (!item) return;

    item.classList.toggle('is-updating', !!isLoading);

    if (isLoading) {
      item.setAttribute('aria-busy', 'true');
    } else {
      item.removeAttribute('aria-busy');
    }

    item.querySelectorAll('.custom-cart-qty button, .custom-cart-remove').forEach(function (btn) {
      btn.disabled = !!isLoading;
    });

    var qty = item.querySelector('.custom-cart-qty');
    if (qty) {
      qty.classList.toggle('is-loading', !!isLoading);
    }
  }

  function setCartDrawerUpdating(isLoading) {
    var els = getEls();

    if (els.body) {
      els.body.classList.toggle('is-cart-updating', !!isLoading);
    }

    if (els.footer) {
      els.footer.classList.toggle('is-cart-updating', !!isLoading);
    }
  }

  function beginCartQuantityUpdate(key) {
    cartQuantityUpdatesInFlight += 1;
    setCartKeyLoading(key, true);
  }

  function endCartQuantityUpdate(key) {
    cartQuantityUpdatesInFlight = Math.max(0, cartQuantityUpdatesInFlight - 1);
    setCartKeyLoading(key, false);
  }

  function updateCartByKey(key, quantity) {
    if (!key) return;

    var updatingItem = findCartItemByKey(key);
    if (updatingItem && updatingItem.classList.contains('is-updating')) {
      return;
    }

    beginCartQuantityUpdate(key);

    return fetch('/cart/change.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ id: key, quantity: Math.max(0, Number(quantity || 0)) })
    })
      .then(function (res) {
        return res.json().then(function (cart) {
          if (!res.ok) {
            throw cart;
          }
          return cart;
        });
      })
      .then(function (cart) {
        updateCartSummary(cart);
        updateCartLinePricing(cart);
        renderCart(cart);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: cart } }));
      })
      .catch(function (error) {
        console.error('[StretchableCartDrawer] Cart update error:', error);
      })
      .finally(function () {
        endCartQuantityUpdate(key);
      });
  }

  function ensureDesignModal() {
    if (document.getElementById('customCartDesignOverlay') && document.getElementById('customCartDesignImage')) {
      return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'customCartDesignOverlay';
    overlay.className = 'custom-cart-design-modal-overlay';
    overlay.innerHTML =
      '<div class="custom-cart-design-modal">' +
        '<button type="button" class="custom-cart-design-modal-close" id="customCartDesignClose" data-design-modal-close aria-label="Close preview">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>' +
        '</button>' +
        '<p class="custom-cart-design-modal-heading">Design Preview</p>' +
        '<p class="custom-cart-design-modal-title" id="customCartDesignTitle" data-design-modal-title></p>' +
        '<img class="custom-cart-design-modal-image" id="customCartDesignImage" data-design-modal-image src="" alt="Design preview">' +
      '</div>';
    document.body.appendChild(overlay);
  }

  function openDesignModal(src, title, trigger) {
    var resolvedSrc = resolveDesignPreviewSrcFromTrigger(trigger);
    if (!isAllowedDesignPreviewUrl(resolvedSrc)) return;

    ensureDesignModal();

    var overlay = document.getElementById('customCartDesignOverlay');
    var img = document.getElementById('customCartDesignImage');
    var titleEl = document.getElementById('customCartDesignTitle');
    if (!overlay) return;

    if (img) {
      img.removeAttribute('srcset');
      img.src = resolvedSrc;
      img.alt = (title || 'Design') + ' preview';
    }

    if (titleEl) {
      titleEl.textContent = title || '';
    }

    overlay.classList.add('open');
  }

  function closeDesignModal() {
    var overlay = $('#customCartDesignOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function bind() {
    if (window.__stretchableCartDrawerBound) {
      return;
    }
    window.__stretchableCartDrawerBound = true;

    injectStyles();

    window.__stretchableCartDrawerActive = true;
    window.StretchableCartDrawer = {
      load: loadCart,
      render: renderCart,
      open: openDrawer,
      close: closeDrawer,
      update: updateCartByKey
    };

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('#customCartTrigger');
      if (!trigger) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openDrawer();
    }, true);

    document.addEventListener('click', function (event) {
      var close = event.target.closest && event.target.closest('#customCartClose, #customCartOverlay');
      if (!close) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      closeDrawer();
    }, true);

    document.addEventListener('click', function (event) {
      var qtyBtn = event.target.closest && event.target.closest('.custom-cart-qty button[data-key]');
      if (!qtyBtn) return;

      var qtyItem = qtyBtn.closest('.custom-cart-item');
      if (qtyItem && qtyItem.classList.contains('is-updating')) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      updateCartByKey(qtyBtn.getAttribute('data-key'), parseInt(qtyBtn.getAttribute('data-qty'), 10));
    }, true);

    document.addEventListener('click', function (event) {
      var removeBtn = event.target.closest && event.target.closest('.custom-cart-remove[data-key]');
      if (!removeBtn) return;

      var removeItem = removeBtn.closest('.custom-cart-item');
      if (removeItem && removeItem.classList.contains('is-updating')) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      updateCartByKey(removeBtn.getAttribute('data-key'), 0);
    }, true);

    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('[data-design-drawer-open], [data-design-preview-open]');
      if (!trigger) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openDesignModal(
        trigger.getAttribute('data-design-src') || '',
        trigger.getAttribute('data-design-title') ||
          trigger.getAttribute('data-design-preview-title') ||
          'Custom Design',
        trigger
      );
    }, true);

    document.addEventListener('click', function (event) {
      var close = event.target.closest && event.target.closest('[data-design-modal-close], #customCartDesignOverlay');
      if (!close) return;
      if (event.target.closest('.custom-cart-design-modal') && !event.target.closest('[data-design-modal-close]')) return;

      event.preventDefault();
      closeDesignModal();
    }, true);

    document.addEventListener('cart:open', function (event) {
      var cart = event.detail && event.detail.cart;
      openDrawer(cart);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var designOverlay = $('#customCartDesignOverlay');
      if (designOverlay && designOverlay.classList.contains('open')) {
        closeDesignModal();
        return;
      }
      closeDrawer();
    });

    log('[StretchableCartDrawer] Patch loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
