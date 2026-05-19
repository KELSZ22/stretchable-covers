(function (global) {
  'use strict';

  function stripQuotes(value) {
    return String(value || '')
      .trim()
      .replace(/['′"″]+/g, '')
      .trim();
  }

  function formatSingleDiameter(value) {
    var cleaned = stripQuotes(value);
    if (!cleaned) return '';

    cleaned = cleaned.replace(/[^0-9.]/g, '').trim();
    if (!cleaned) return '';

    return cleaned + "'";
  }

  function formatDiameterRange(min, max) {
    var minLabel = formatSingleDiameter(min);
    var maxLabel = formatSingleDiameter(max);

    if (!minLabel) return maxLabel;
    if (!maxLabel) return minLabel;
    if (minLabel === maxLabel) return minLabel;

    return minLabel + ' - ' + maxLabel;
  }

  function normalizeDiameterSpacing(value) {
    return String(value || '')
      .trim()
      .replace(/\s*[-–—]\s*/g, ' - ')
      .replace(/\s+/g, ' ')
      .replace(/\s*'\s*/g, "'")
      .replace(/′/g, "'");
  }

  function formatFromObject(value) {
    if (!value || typeof value !== 'object') return '';

    var min =
      value.min != null
        ? value.min
        : value.minimum != null
          ? value.minimum
          : value.from != null
            ? value.from
            : value.start;
    var max =
      value.max != null
        ? value.max
        : value.maximum != null
          ? value.maximum
          : value.to != null
            ? value.to
            : value.end;

    if (min != null && max != null) {
      return formatDiameterRange(min, max);
    }

    if (value.value != null) {
      return formatDiameterDisplay(value.value);
    }

    return '';
  }

  function formatConcatenatedDigits(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 6 || digits.length % 2 !== 0) {
      return '';
    }

    var half = digits.length / 2;
    var minPart = digits.slice(0, half);
    var maxPart = digits.slice(half);
    var minNum = parseInt(minPart, 10);
    var maxNum = parseInt(maxPart, 10);

    if (isNaN(minNum) || isNaN(maxNum)) return '';
    if (maxNum < minNum) return '';
    if (maxNum - minNum > 24) return '';

    return formatDiameterRange(minPart, maxPart);
  }

  function formatDiameterDisplay(value) {
    if (value == null || value === '') return '';

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        if (value.length >= 2) {
          return formatDiameterRange(value[0], value[1]);
        }
        if (value.length === 1) {
          return formatDiameterDisplay(value[0]);
        }
        return '';
      }

      return formatFromObject(value);
    }

    var raw = normalizeDiameterSpacing(String(value).trim());
    if (!raw || raw === '0' || raw === 'Default Title') return '';

    if (/['′]/.test(raw) || /\d\s*-\s*\d/.test(raw)) {
      if (raw.indexOf('-') !== -1) {
        var parts = raw.split(/\s*-\s*/);
        if (parts.length >= 2) {
          return formatDiameterRange(parts[0], parts.slice(1).join('-'));
        }
      }

      if (/['′]/.test(raw)) {
        return raw.replace(/′/g, "'");
      }
    }

    var rangeMatch = raw.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      return formatDiameterRange(rangeMatch[1], rangeMatch[2]);
    }

    if (/^\d+$/.test(raw)) {
      var fromDigits = formatConcatenatedDigits(raw);
      if (fromDigits) return fromDigits;

      return formatSingleDiameter(raw);
    }

    return raw;
  }

  function readRawDiameterValue(value) {
    return String(value == null ? '' : value).trim();
  }

  function readDiameterFromFormData(formData) {
    if (!formData || typeof formData.get !== 'function') return '';

    return readRawDiameterValue(
      formData.get('properties[Diameter]') || formData.get('properties[diameter]') || '',
    );
  }

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

  function mergeFormattedDiameterProperties(item) {
    var props = item && item.properties ? item.properties : {};
    var merged = Object.assign({}, props);
    var changed = false;
    var key;
    var raw;
    var formatted;

    for (key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (!isDiameterPropertyKey(key)) continue;
      if (key.charAt(0) === '_') continue;

      raw = props[key];
      formatted = formatDiameterDisplay(raw);
      if (!formatted) continue;
      if (formatted === String(raw == null ? '' : raw).trim()) continue;

      merged[key] = formatted;
      changed = true;
    }

    return changed ? merged : null;
  }

  function normalizeCartDiameters() {
    if (normalizeCartDiameters._promise) {
      return normalizeCartDiameters._promise;
    }

    normalizeCartDiameters._promise = fetch('/cart.js', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (cart) {
        var updates = [];

        (cart.items || []).forEach(function (item) {
          var properties = mergeFormattedDiameterProperties(item);
          if (properties) {
            updates.push({
              id: item.key,
              properties: properties,
            });
          }
        });

        if (!updates.length) {
          return false;
        }

        return Promise.all(
          updates.map(function (update) {
            return fetch('/cart/change.js', {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              credentials: 'same-origin',
              body: JSON.stringify(update),
            }).then(function (res) {
              if (!res.ok) {
                return res.json().then(function (data) {
                  throw data;
                });
              }
              return res.json();
            });
          }),
        ).then(function () {
          return true;
        });
      })
      .finally(function () {
        normalizeCartDiameters._promise = null;
      });

    return normalizeCartDiameters._promise;
  }

  function goToCheckout(target) {
    var href = '/checkout';

    if (target && target.href) {
      href = target.href;
    } else if (target && target.getAttribute) {
      var dataHref = target.getAttribute('data-checkout-url');
      if (dataHref) href = dataHref;
    }

    window.location.href = href;
  }

  function bindCheckoutDiameterFix() {
    if (bindCheckoutDiameterFix._bound) return;
    bindCheckoutDiameterFix._bound = true;

    document.addEventListener(
      'click',
      function (event) {
        var target = event.target.closest(
          'a[href="/checkout"], a[href*="/checkout?"], .custom-cart-checkout',
        );
        if (!target) return;
        if (target.disabled) return;

        event.preventDefault();
        event.stopPropagation();

        normalizeCartDiameters()
          .catch(function () {
            return false;
          })
          .finally(function () {
            goToCheckout(target);
          });
      },
      true,
    );

    document.addEventListener(
      'submit',
      function (event) {
        var form = event.target;
        var submitter = event.submitter;
        var isCheckoutSubmit;

        if (!form || !form.action) return;
        if (String(form.action).indexOf('/cart') === -1) return;
        if (form.dataset.diameterCheckoutReady === 'true') {
          delete form.dataset.diameterCheckoutReady;
          return;
        }

        isCheckoutSubmit =
          (submitter && submitter.name === 'checkout') ||
          (submitter &&
            (submitter.classList.contains('cart__checkout-button') ||
              submitter.id === 'checkout'));

        if (!isCheckoutSubmit) return;

        event.preventDefault();
        event.stopPropagation();

        normalizeCartDiameters()
          .catch(function () {
            return false;
          })
          .finally(function () {
            form.dataset.diameterCheckoutReady = 'true';
            form.submit();
          });
      },
      true,
    );
  }

  function initDiameterCartFix() {
    bindCheckoutDiameterFix();

    if (window.location.pathname === '/cart') {
      normalizeCartDiameters().catch(function () {
        return false;
      });
    }
  }

  global.CustomDiameterFormat = {
    formatDiameterDisplay: formatDiameterDisplay,
    formatDiameterRange: formatDiameterRange,
    formatSingleDiameter: formatSingleDiameter,
    readRawDiameterValue: readRawDiameterValue,
    readDiameterFromFormData: readDiameterFromFormData,
    isDiameterPropertyKey: isDiameterPropertyKey,
    normalizeCartDiameters: normalizeCartDiameters,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDiameterCartFix);
  } else {
    initDiameterCartFix();
  }
})(typeof window !== 'undefined' ? window : globalThis);
