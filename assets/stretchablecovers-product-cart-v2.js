(function () {
  'use strict';

  var CONFIG = window.StretchableProductCartConfig || {};
  var FORM_SELECTOR = CONFIG.formSelector || 'form[action*="/cart/add"]';
  var DEBUG = Boolean(CONFIG.debug);

  var PROPERTY_KEYWORDS = CONFIG.propertyKeywords || [
    'color', 'colour', 'background', 'design', 'imprint', 'print', 'logo',
    'text', 'custom', 'personalization', 'personalisation', 'name', 'number',
    'size', 'diameter', 'width', 'height', 'material', 'finish', 'shape',
    'option', 'style'
  ];

  var IGNORE_NAMES = {
    id: true,
    quantity: true,
    form_type: true,
    utf8: true,
    return_to: true,
    product_id: true,
    section_id: true,
    'add-to-cart': true
  };

  function log() {
    if (!DEBUG || !window.console) return;
    console.log.apply(console, arguments);
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleCase(value) {
    return normalizeText(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function (char) { return char.toUpperCase(); });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function getClosestProductArea(form) {
    return form.closest('[data-product-form], [data-product-section], [data-section-type="product"], .product, .product-section, .product__info-container, .product-form, main') || document;
  }

  function cleanSelectedValue(value) {
    value = normalizeText(value);
    value = value.replace(/\s*[-+]?\$\d+(\.\d{2})?\s*$/g, '').trim();
    value = value.replace(/^(select|choose|please select)\s+/i, '').trim();
    return value;
  }

  function getLabelText(field) {
    var label = '';
    var id = field.getAttribute('id');
    var name = field.getAttribute('name') || '';
    var optionMatch = name.match(/^options\[([^\]]+)\]$/i);

    if (optionMatch) {
      label = optionMatch[1];
    } else if (field.getAttribute('data-property-name')) {
      label = field.getAttribute('data-property-name');
    } else if (field.getAttribute('data-line-item-property')) {
      label = field.getAttribute('data-line-item-property');
    } else if (field.getAttribute('aria-label')) {
      label = field.getAttribute('aria-label');
    } else if (id) {
      var labelEl = document.querySelector('label[for="' + cssEscape(id) + '"]');
      if (labelEl) label = labelEl.textContent;
    }

    if (!label) {
      var wrapper = field.closest('.product-form__input, .product-form__input--dropdown, .selector-wrapper, .form-field, .field, .custom-field, .option, .product-option, .swatch, .variant-picker, .variant-option, .imprint, .quantity-selector');
      if (wrapper) {
        var wrapperLabel = wrapper.querySelector('label, .form__label, .field__label, .option-label, legend, .label, .heading, .title, [data-option-name]');
        if (wrapperLabel) label = wrapperLabel.getAttribute('data-option-name') || wrapperLabel.textContent;
      }
    }

    if (!label) label = name || field.getAttribute('id') || '';

    label = normalizeText(label)
      .replace(/[:*]+$/g, '')
      .replace(/^select\s+/i, '')
      .replace(/^choose\s+/i, '');

    return normalizePropertyName(label);
  }

  function isPropertyName(name) {
    return /^properties\[[^\]]+\]$/.test(String(name || ''));
  }

  function isVariantOptionName(name) {
    return /^options\[[^\]]+\]$/.test(String(name || ''));
  }

  function getNameFromBracketInput(name) {
    var propertyMatch = String(name || '').match(/^properties\[([^\]]+)\]$/);
    if (propertyMatch) return normalizeText(propertyMatch[1]);

    var optionMatch = String(name || '').match(/^options\[([^\]]+)\]$/);
    if (optionMatch) return normalizeText(optionMatch[1]);

    return '';
  }

  function normalizePropertyName(name) {
    var cleaned = normalizeText(name)
      .replace(/^properties\[|\]$/g, '')
      .replace(/^options\[|\]$/g, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    var lower = cleaned.toLowerCase();

    if (lower === 'product diameter' || lower === 'diameter' || lower === 'product variant diameter' || lower === 'variant diameter') {
      return 'Diameter';
    }

    if (lower === 'imprint' || lower === 'standard cover imprint' || lower === 'cover imprint' || lower === 'imprint option') {
      return 'Imprint';
    }

    if (lower === 'imprint size' || lower === 'print size' || lower === 'logo size' || lower === 'imprint diameter') {
      return 'Imprint Size';
    }

    if (lower === 'color' || lower === 'colour' || lower === 'background color' || lower === 'background colour' || lower === 'cover color') {
      return 'Color';
    }

    return titleCase(cleaned);
  }

  function shouldCollectField(field, label) {
    if (!field || field.disabled) return false;

    var tag = field.tagName ? field.tagName.toLowerCase() : '';
    var type = String(field.type || '').toLowerCase();
    var name = normalizeText(field.getAttribute('name'));

    if (!tag || ['input', 'select', 'textarea'].indexOf(tag) === -1) return false;
    if (['submit', 'button', 'reset', 'file', 'password'].indexOf(type) !== -1) return false;

    if (isPropertyName(name) || isVariantOptionName(name)) return true;

    var simpleName = name.replace(/\[.*\]/g, '').toLowerCase();
    if (IGNORE_NAMES[simpleName] || IGNORE_NAMES[name.toLowerCase()]) return false;
    if (/^option\d+$/i.test(name)) return true;
    if (/selling_plan/i.test(name)) return false;

    var haystack = (name + ' ' + (field.id || '') + ' ' + label + ' ' + (field.className || '')).toLowerCase();

    return PROPERTY_KEYWORDS.some(function (keyword) {
      return haystack.indexOf(keyword.toLowerCase()) !== -1;
    });
  }

  function getFieldValue(field) {
    var type = String(field.type || '').toLowerCase();

    if ((type === 'radio' || type === 'checkbox') && !field.checked) return '';

    if (field.tagName && field.tagName.toLowerCase() === 'select') {
      var option = field.options[field.selectedIndex];
      var value = normalizeText(field.value || (option ? option.textContent : ''));
      var text = normalizeText(option ? option.textContent : '');
      var selected = cleanSelectedValue(text && !/^select|choose|please select/i.test(text) ? text : value);
      if (!selected || /^select|choose|please select/i.test(selected)) return '';
      return selected;
    }

    return cleanSelectedValue(field.value);
  }

  function setProperty(properties, name, value) {
    name = normalizePropertyName(name);
    value = cleanSelectedValue(value);

    if (!name || !value) return;
    if (/^(select|choose|please select)$/i.test(value)) return;
    if (/^(default title|title)$/i.test(value)) return;

    properties[name] = value;
  }

  function collectStandardFields(form, area, properties) {
    var fields = [];
    var seen = [];

    function addFields(nodeList) {
      Array.prototype.forEach.call(nodeList || [], function (field) {
        if (seen.indexOf(field) !== -1) return;
        seen.push(field);
        fields.push(field);
      });
    }

    addFields(form.querySelectorAll('input, select, textarea'));
    addFields(area.querySelectorAll('[data-line-item-property], [data-property-name], input, select, textarea'));

    fields.forEach(function (field) {
      var name = normalizeText(field.getAttribute('name'));
      var label = getLabelText(field);
      var propertyName = getNameFromBracketInput(name) || label;

      if (!shouldCollectField(field, label)) return;

      setProperty(properties, propertyName, getFieldValue(field));
    });
  }

  function getVisibleText(node) {
    if (!node) return '';
    if (node.offsetParent === null && node !== document.body) return '';
    return normalizeText(node.textContent || node.value || '');
  }

  function removeLabelFromValue(label, value) {
    label = normalizeText(label);
    value = normalizeText(value);

    if (!label || !value) return value;

    var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp('^' + escaped + '\\s*:?\\s*', 'i'), '').trim();
    return cleanSelectedValue(value);
  }

  function collectVisibleOptionBlocks(area, properties) {
    var labelSelectors = [
      '.product-form__input legend',
      '.product-form__input .form__label',
      '.product-option__name',
      '.variant-option__name',
      '.variant-picker__option-name',
      '.selector-wrapper label',
      '.field label',
      '.custom-field label',
      '[data-option-name]'
    ].join(',');

    Array.prototype.forEach.call(area.querySelectorAll(labelSelectors), function (labelEl) {
      var label = normalizePropertyName(labelEl.getAttribute('data-option-name') || labelEl.textContent);
      var lower = label.toLowerCase();
      var shouldTry = PROPERTY_KEYWORDS.some(function (keyword) {
        return lower.indexOf(keyword.toLowerCase()) !== -1;
      });

      if (!shouldTry) return;

      var wrapper = labelEl.closest('.product-form__input, .selector-wrapper, .field, .custom-field, .product-option, .variant-option, .variant-picker__option, .imprint') || labelEl.parentElement;
      if (!wrapper) return;

      var selected = wrapper.querySelector('input[type="radio"]:checked + label, input[type="checkbox"]:checked + label, .is-selected, .selected, [aria-selected="true"], [data-selected="true"], button[aria-pressed="true"], option:checked');
      var value = selected ? getVisibleText(selected) : '';

      if (!value) {
        var select = wrapper.querySelector('select');
        if (select) value = getFieldValue(select);
      }

      if (!value) {
        var input = wrapper.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea');
        if (input) value = getFieldValue(input);
      }

      value = removeLabelFromValue(label, value);
      setProperty(properties, label, value);
    });
  }

  function collectLineProperties(form) {
    var properties = {};
    var area = getClosestProductArea(form);

    collectStandardFields(form, area, properties);
    collectVisibleOptionBlocks(area, properties);

    log('[StretchableCart] Collected line properties', properties);
    return properties;
  }

  function getQuantity(form) {
    var area = getClosestProductArea(form);
    var candidates = [
      form.querySelector('[name="quantity"]'),
      form.querySelector('input[type="number"]'),
      area.querySelector('[name="quantity"]'),
      area.querySelector('.quantity__input'),
      area.querySelector('[data-quantity-input]'),
      area.querySelector('input[type="number"]'),
      area.querySelector('[data-quantity]')
    ];

    var quantity = 1;

    candidates.some(function (field) {
      if (!field) return false;
      var raw = field.value || field.getAttribute('value') || field.textContent;
      var parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        quantity = parsed;
        return true;
      }
      return false;
    });

    return quantity;
  }

  function getVariantId(form) {
    var formData = new FormData(form);
    var id = formData.get('id');
    if (id) return String(id);

    var area = getClosestProductArea(form);
    var idField = form.querySelector('[name="id"]') || area.querySelector('[name="id"]');
    if (idField && idField.value) return String(idField.value);

    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('variant')) return params.get('variant');
    } catch (e) {}

    return '';
  }

  function updateCartBubble(count) {
    var cartLink = document.getElementById('customCartTrigger') || document.querySelector('a[href*="/cart"]');
    var bubble = document.querySelector('.cart-count');

    if (!cartLink) return;

    if (!bubble && count > 0) {
      bubble = document.createElement('span');
      bubble.className = 'cart-count';
      cartLink.appendChild(bubble);
    }

    if (bubble) {
      bubble.textContent = count;
      bubble.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  function refreshCartAndOpen() {
    fetch('/cart.js', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        updateCartBubble(cart.item_count || 0);
        document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { cart: cart } }));
        document.dispatchEvent(new CustomEvent('cart:open', { detail: { cart: cart } }));
      })
      .catch(function () {
        document.dispatchEvent(new CustomEvent('cart:refresh'));
      });
  }

  function addToCart(form, submitter) {
    if (!form || form.dataset.stretchableCartAdding === 'true') return;

    var variantId = getVariantId(form);
    var quantity = getQuantity(form);

    if (!variantId) {
      log('[StretchableCart] Missing variant id; allowing normal submit.');
      form.submit();
      return;
    }

    var formData = new FormData(form);
    formData.set('id', variantId);
    formData.set('quantity', String(quantity));

    var properties = collectLineProperties(form);
    Object.keys(properties).forEach(function (key) {
      formData.set('properties[' + key + ']', properties[key]);
    });

    if (submitter && submitter.name) {
      formData.set(submitter.name, submitter.value || '');
    }

    form.dataset.stretchableCartAdding = 'true';
    if (submitter) {
      submitter.setAttribute('aria-busy', 'true');
      submitter.disabled = true;
    }

    log('[StretchableCart] Adding item', {
      id: variantId,
      quantity: quantity,
      properties: properties
    });

    return fetch('/cart/add.js', {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            throw new Error(data.description || data.message || 'Cart add failed');
          });
        }
        return res.json();
      })
      .then(function () {
        refreshCartAndOpen();
      })
      .catch(function (error) {
        console.error('[StretchableCart] Add to cart error:', error);
        alert(error.message || 'Could not add this item to cart. Please try again.');
      })
      .finally(function () {
        delete form.dataset.stretchableCartAdding;
        if (submitter) {
          submitter.removeAttribute('aria-busy');
          submitter.disabled = false;
        }
      });
  }

  function handleSubmit(event) {
    var form = event.target && event.target.closest ? event.target.closest(FORM_SELECTOR) : null;
    if (!form || form.dataset.stretchableCartBypass === 'true') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    addToCart(form, event.submitter || document.activeElement);
  }

  function handleClick(event) {
    var button = event.target && event.target.closest ? event.target.closest('button, input[type="submit"], [data-add-to-cart], .product-form__submit') : null;
    if (!button) return;

    var form = button.closest(FORM_SELECTOR);
    if (!form || form.dataset.stretchableCartBypass === 'true') return;

    var type = String(button.getAttribute('type') || button.type || '').toLowerCase();
    var looksLikeSubmit = type === 'submit' || button.matches('[data-add-to-cart], .product-form__submit');

    if (!looksLikeSubmit) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    addToCart(form, button);
  }

  document.addEventListener('submit', handleSubmit, true);
  document.addEventListener('click', handleClick, true);
})();
