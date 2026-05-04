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
      '.custom-cart-item + .custom-cart-item{border-top:1px solid #eee;}'
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

  function shouldShowProperty(key, value) {
    if (!key || key.charAt(0) === '_') return false;
    if (value === null || value === undefined || String(value).trim() === '') return false;
    return true;
  }

  function getPropertiesHtml(item) {
    var props = item && item.properties ? item.properties : {};
    var keys = Object.keys(props).filter(function (key) {
      return shouldShowProperty(key, props[key]);
    });

    if (!keys.length) return '';

    return '<div class="custom-cart-item-properties">' + keys.map(function (key) {
      var label = normalizePropertyLabel(key);
      return '<div class="custom-cart-item-property"><strong>' + escapeHtml(label) + ':</strong> <span>' + escapeHtml(props[key]) + '</span></div>';
    }).join('') + '</div>';
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
    if (els.subtotal) els.subtotal.textContent = money(cart.total_price);
    if (els.itemLabel) els.itemLabel.textContent = cart.item_count + (cart.item_count === 1 ? ' Item' : ' Items');

    els.body.innerHTML = cart.items.map(function (item) {
      var image = getItemImage(item);
      var quantity = Number(item.quantity || 0);
      var unitPrice = item.final_price != null ? item.final_price : item.price;
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
                getPropertiesHtml(item) +
                '<div class="custom-cart-item-price">' + money(unitPrice) + '</div>' +
              '</div>' +
              '<button type="button" class="custom-cart-remove" data-key="' + key + '" aria-label="Remove item">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>' +
              '</button>' +
            '</div>' +
            '<div class="custom-cart-item-bottom">' +
              '<div class="custom-cart-qty">' +
                '<button type="button" data-key="' + key + '" data-qty="' + (quantity - 1) + '">−</button>' +
                '<span>' + quantity + '</span>' +
                '<button type="button" data-key="' + key + '" data-qty="' + (quantity + 1) + '">+</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    if (els.footer) {
      els.footer.innerHTML = '' +
        '<div class="custom-cart-subtotal-row">' +
          '<div class="custom-cart-subtotal-row-inner">' +
            '<strong>Subtotal (<span id="customCartItemLabel">' + cart.item_count + (cart.item_count === 1 ? ' Item' : ' Items') + '</span>)</strong>' +
            '<strong id="customCartSubtotal">' + money(cart.total_price) + '</strong>' +
          '</div>' +
          '<p>Discounts and promo codes will be calculated at checkout</p>' +
        '</div>' +
        '<a href="/checkout" class="custom-cart-checkout">Secure Check Out</a>' +
        getDeliveryEstimateHtml();
    }
  }

  function loadCart(callback) {
    return fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        renderCart(cart);
        if (callback) callback(cart);
        return cart;
      })
      .catch(function (error) {
        console.error('[StretchableCartDrawer] Cart load error:', error);
        var els = getEls();
        if (els.body) els.body.innerHTML = '<div class="custom-cart-error">There was an error loading your cart.</div>';
      });
  }

  function openDrawer(cart) {
    var els = getEls();
    if (!els.drawer || !els.overlay) return;

    injectStyles();
    els.drawer.classList.add('open');
    els.overlay.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (cart) renderCart(cart);
    else loadCart();
  }

  function closeDrawer() {
    var els = getEls();
    if (!els.drawer || !els.overlay) return;

    els.drawer.classList.remove('open');
    els.overlay.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function updateCartByKey(key, quantity) {
    if (!key) return;

    return fetch('/cart/change.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ id: key, quantity: Math.max(0, Number(quantity || 0)) })
    })
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        renderCart(cart);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: cart } }));
      })
      .catch(function (error) {
        console.error('[StretchableCartDrawer] Cart update error:', error);
      });
  }

  function bind() {
    injectStyles();

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

      event.preventDefault();
      event.stopImmediatePropagation();
      updateCartByKey(qtyBtn.getAttribute('data-key'), parseInt(qtyBtn.getAttribute('data-qty'), 10));
    }, true);

    document.addEventListener('click', function (event) {
      var removeBtn = event.target.closest && event.target.closest('.custom-cart-remove[data-key]');
      if (!removeBtn) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      updateCartByKey(removeBtn.getAttribute('data-key'), 0);
    }, true);

    document.addEventListener('cart:refresh', function (event) {
      var cart = event.detail && event.detail.cart;
      if (cart) renderCart(cart);
      else loadCart();
    });

    document.addEventListener('cart:open', function (event) {
      var cart = event.detail && event.detail.cart;
      openDrawer(cart);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
    });

    log('[StretchableCartDrawer] Patch loaded');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
