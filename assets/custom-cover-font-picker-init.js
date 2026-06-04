/**
 * Font picker for custom cover customizer.
 * Custom list only — removes legacy native <select> font menus.
 */
(function () {
  const ROOT = ".custom-cover-font-picker[data-font-picker]";
  const FONT_ROW = ".custom-cover-customizer__text-font-row";

  function fontStack(name, fallback) {
    return `"${String(name).replace(/"/g, '\\"')}", ${fallback || "sans-serif"}`;
  }

  function fontClass(name) {
    return (
      "cc-font--" +
      String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  }

  function loadGoogleBatch(families) {
    const google = families.filter(Boolean);
    if (!google.length) return;
    const chunk = 8;
    for (let i = 0; i < google.length; i += chunk) {
      const slice = google.slice(i, i + chunk);
      const params = slice
        .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400`)
        .join("&");
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
      link.className = "custom-cover-customizer-google-fonts";
      document.head.appendChild(link);
    }
  }

  const portalPlaceholders = new WeakMap();

  function getPortalHost(picker) {
    const sheet = picker.closest(".custom-cover-customizer__drawer-sheet");
    if (sheet && getComputedStyle(sheet).display !== "contents") {
      return sheet;
    }

    const panel = picker.closest(".custom-cover-customizer__panel");
    if (panel && getComputedStyle(panel).display !== "contents") {
      return panel;
    }

    return (
      picker.closest(".custom-cover-customizer__left-column") ||
      picker.closest(".custom-cover-customizer__layout") ||
      null
    );
  }

  function portalDropdown(picker, dropdown) {
    if (dropdown.dataset.portaled === "true") {
      return getPortalHost(picker);
    }
    const host = getPortalHost(picker);
    if (!host) return null;

    const placeholder = document.createComment("cc-font-dropdown-anchor");
    dropdown.parentNode.insertBefore(placeholder, dropdown);
    portalPlaceholders.set(picker, placeholder);

    host.classList.add("custom-cover-font-picker__portal-host");
    host.appendChild(dropdown);
    dropdown.dataset.portaled = "true";
    dropdown.classList.add("is-portaled");
    return host;
  }

  function restoreDropdown(picker, dropdown) {
    if (dropdown.dataset.portaled !== "true") return;

    const placeholder = portalPlaceholders.get(picker);
    if (placeholder?.parentNode) {
      placeholder.parentNode.insertBefore(dropdown, placeholder);
      placeholder.remove();
    } else {
      picker.appendChild(dropdown);
    }
    portalPlaceholders.delete(picker);

    dropdown.dataset.portaled = "";
    dropdown.classList.remove("is-portaled");
    const host = getPortalHost(picker);
    host?.classList.remove("custom-cover-font-picker__portal-host");
  }

  function positionPortaledDropdown(trigger, dropdown, host) {
    const triggerRect = trigger.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const left = Math.max(0, triggerRect.left - hostRect.left + host.scrollLeft);
    const width = triggerRect.width;
    const spaceBelow = hostRect.bottom - triggerRect.bottom - 8;
    const spaceAbove = triggerRect.top - hostRect.top - 8;
    const maxH = 280;

    dropdown.style.position = "absolute";
    dropdown.style.left = `${left}px`;
    dropdown.style.width = `${width}px`;
    dropdown.style.right = "auto";
    dropdown.style.zIndex = "100";

    if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
      dropdown.style.top = `${triggerRect.bottom - hostRect.top + 4 + host.scrollTop}px`;
      dropdown.style.bottom = "auto";
      dropdown.style.maxHeight = `${Math.min(maxH, Math.max(96, spaceBelow))}px`;
    } else {
      const height = Math.min(maxH, Math.max(96, spaceAbove));
      dropdown.style.top = `${Math.max(0, triggerRect.top - hostRect.top + host.scrollTop - height - 4)}px`;
      dropdown.style.bottom = "auto";
      dropdown.style.maxHeight = `${height}px`;
    }
  }

  function resetDropdownPosition(dropdown) {
    dropdown.style.position = "";
    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.bottom = "";
    dropdown.style.width = "";
    dropdown.style.right = "";
    dropdown.style.maxHeight = "";
    dropdown.style.zIndex = "";
  }

  function closeDropdown(picker, dropdown, trigger) {
    dropdown.hidden = true;
    dropdown.classList.remove("is-open");
    resetDropdownPosition(dropdown);
    restoreDropdown(picker, dropdown);
    trigger.setAttribute("aria-expanded", "false");
  }

  function applyFace(node, name, fallback) {
    if (!node || !name) return;
    const target =
      node.querySelector(".custom-cover-font-picker__option-text") ||
      node.querySelector("[data-font-picker-label]") ||
      node;
    target.dataset.fontValue = name;
    target.classList.add(fontClass(name));
    target.style.setProperty("font-family", fontStack(name, fallback), "important");
  }

  function removeLegacyFontSelects() {
    document.querySelectorAll(FONT_ROW).forEach((row) => {
      row
        .querySelectorAll("select:not([data-font-size-input])")
        .forEach((sel) => {
          const group = sel.closest(".custom-cover-customizer__group");
          const picker = group?.querySelector(ROOT);
          if (picker) {
            sel.remove();
            return;
          }
          const fallback =
            document
              .querySelector("custom-cover-customizer-component")
              ?.getAttribute("data-font-fallback") || "sans-serif";
          const built = buildPickerFromSelect(sel, fallback);
          if (built) {
            sel.replaceWith(built);
          } else {
            sel.remove();
          }
        });
    });
  }

  function buildPickerFromSelect(select, fallback) {
    const options = [...select.options].filter((o) => o.value);
    if (!options.length) return null;

    const defaultVal = select.value || options[0].value;
    const families = options.map((o) => o.value);
    loadGoogleBatch(families);

    const wrapper = document.createElement("div");
    wrapper.className = "custom-cover-font-picker";
    wrapper.setAttribute("data-font-picker", "");
    wrapper.setAttribute("data-cc-font-picker-version", "3");
    wrapper.setAttribute("data-font-fallback", fallback);

    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.id = select.id || "";
    hidden.setAttribute("data-font-input", "");
    hidden.value = defaultVal;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className =
      "custom-cover-font-picker__trigger custom-cover-customizer__input--select-like";
    trigger.setAttribute("data-font-picker-trigger", "");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const label = document.createElement("span");
    label.className = `custom-cover-font-picker__label ${fontClass(defaultVal)}`;
    label.setAttribute("data-font-picker-label", "");
    label.textContent = defaultVal;
    applyFace(label, defaultVal, fallback);

    const arrow = document.createElement("span");
    arrow.className = "custom-cover-font-picker__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';

    trigger.append(label, arrow);

    const dropdown = document.createElement("div");
    dropdown.className = "custom-cover-font-picker__dropdown";
    dropdown.setAttribute("data-font-picker-dropdown", "");
    dropdown.hidden = true;
    dropdown.setAttribute("role", "listbox");

    options.forEach((opt) => {
      const family = opt.value;
      const row = document.createElement("div");
      row.className = "custom-cover-font-picker__option";
      row.setAttribute("data-font-picker-option", "");
      row.setAttribute("data-value", family);
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "0");

      const text = document.createElement("span");
      text.className = `custom-cover-font-picker__option-text ${fontClass(family)}`;
      text.textContent = family;
      applyFace(text, family, fallback);

      row.append(text);
      dropdown.append(row);
    });

    wrapper.append(hidden, trigger, dropdown);
    return wrapper;
  }

  function initPicker(picker) {
    if (
      !picker ||
      picker.dataset.fontPickerReady === "true" ||
      picker.dataset.ccFontPickerInlineInit === "true"
    ) {
      return;
    }
    picker.dataset.fontPickerReady = "true";

    const fontInput = picker.querySelector("[data-font-input]");
    const trigger = picker.querySelector("[data-font-picker-trigger]");
    const dropdown = picker.querySelector("[data-font-picker-dropdown]");
    const triggerLabel = picker.querySelector("[data-font-picker-label]");
    if (!fontInput || !trigger || !dropdown || !triggerLabel) return;

    const fallback = picker.getAttribute("data-font-fallback") || "sans-serif";

    picker
      .closest(".custom-cover-customizer__group")
      ?.querySelectorAll("select:not([data-font-size-input])")
      .forEach((sel) => sel.remove());

    const optionRows = [...dropdown.querySelectorAll("[data-font-picker-option]")];
    const families = optionRows
      .map((row) => row.getAttribute("data-value"))
      .filter(Boolean);
    loadGoogleBatch(families);

    function sync() {
      const family =
        fontInput.value || optionRows[0]?.getAttribute("data-value") || "";
      triggerLabel.textContent = family;
      triggerLabel.className = `custom-cover-font-picker__label ${fontClass(family)}`;
      applyFace(triggerLabel, family, fallback);
      optionRows.forEach((row) => {
        const isOn = row.getAttribute("data-value") === family;
        row.classList.toggle("is-selected", isOn);
        row.setAttribute("aria-selected", isOn ? "true" : "false");
      });
    }

    optionRows.forEach((row) => {
      const family = row.getAttribute("data-value");
      if (!family) return;
      applyFace(row, family, fallback);

      const pick = () => {
        fontInput.value = family;
        sync();
        closeDropdown(picker, dropdown, trigger);
        fontInput.dispatchEvent(new Event("change", { bubbles: true }));
        if (document.fonts?.load) {
          void document.fonts.load(`400 16px ${fontStack(family, fallback)}`);
        }
      };

      row.addEventListener("click", pick);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
    });

    const setOpen = (open) => {
      dropdown.hidden = !open;
      dropdown.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const host = portalDropdown(picker, dropdown) || picker;
        positionPortaledDropdown(trigger, dropdown, host);
        const val = fontInput.value || "";
        const esc =
          typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(val)
            : val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const active = dropdown.querySelector(`[data-value="${esc}"]`);
        active?.scrollIntoView({ block: "nearest" });
      } else {
        resetDropdownPosition(dropdown);
        restoreDropdown(picker, dropdown);
      }
    };

    const toggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(dropdown.hidden);
    };

    const reposition = () => {
      if (dropdown.hidden || !dropdown.classList.contains("is-open")) return;
      const host =
        dropdown.dataset.portaled === "true"
          ? getPortalHost(picker)
          : picker;
      if (host) positionPortaledDropdown(trigger, dropdown, host);
    };

    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        if (dropdown.hidden) toggle(e);
      }
      if (e.key === "Escape" && !dropdown.hidden) {
        closeDropdown(picker, dropdown, trigger);
      }
    });

    if (!picker.dataset.fontPickerRepositionBound) {
      picker.dataset.fontPickerRepositionBound = "true";
      window.addEventListener("scroll", reposition, true);
      window.addEventListener("resize", reposition);
    }

    if (!picker.dataset.fontPickerOutsideBound) {
      picker.dataset.fontPickerOutsideBound = "true";
      document.addEventListener("pointerdown", (e) => {
        if (
          !picker.contains(e.target) &&
          !dropdown.contains(e.target)
        ) {
          closeDropdown(picker, dropdown, trigger);
        }
      });
    }

    fontInput.addEventListener("change", sync);
    if (!fontInput.value && optionRows[0]) {
      fontInput.value = optionRows[0].getAttribute("data-value") || "";
    }
    sync();

    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => sync());
    }
  }

  function boot() {
    removeLegacyFontSelects();
    document.querySelectorAll(ROOT).forEach(initPicker);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("shopify:section:load", boot);

  const observer = new MutationObserver(() => {
    removeLegacyFontSelects();
    document.querySelectorAll(`${ROOT}:not([data-font-picker-ready="true"])`).forEach(initPicker);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
