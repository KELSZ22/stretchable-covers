/**
 * Font picker for custom cover customizer.
 * Builds or upgrades the UI and applies each font name in its own typeface.
 */
(function () {
  const ROOT = ".custom-cover-font-picker[data-font-picker]";
  const FONT_ROW = ".custom-cover-customizer__text-font-row";

  function fontStack(name, fallback) {
    return `"${String(name).replace(/"/g, '\\"')}", ${fallback || "sans-serif"}`;
  }

  function loadGoogleBatch(families) {
    const google = families.filter(Boolean);
    if (!google.length) return;
    const chunk = 10;
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

  function applyFace(node, name, fallback) {
    if (!node || !name) return;
    const target =
      node.querySelector(".custom-cover-font-picker__option-text") || node;
    target.dataset.fontValue = name;
    target.style.setProperty("font-family", fontStack(name, fallback), "important");
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
    label.className = "custom-cover-font-picker__label";
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
      text.className = "custom-cover-font-picker__option-text";
      text.textContent = family;
      applyFace(text, family, fallback);

      row.append(text);
      dropdown.append(row);
    });

    wrapper.append(hidden, trigger, dropdown);
    return wrapper;
  }

  function migrateLegacySelects() {
    document.querySelectorAll(FONT_ROW).forEach((row) => {
      const group = row.querySelector(".custom-cover-customizer__group");
      if (!group) return;

      const legacy = group.querySelector(
        "select:not([data-font-size-input])",
      );
      const picker = group.querySelector(ROOT);

      if (legacy && picker) {
        legacy.remove();
        return;
      }

      if (legacy && !picker) {
        const fallback =
          document
            .querySelector("custom-cover-customizer-component")
            ?.getAttribute("data-font-fallback") || "sans-serif";
        const built = buildPickerFromSelect(legacy, fallback);
        if (built) {
          legacy.replaceWith(built);
        }
      }
    });
  }

  function initPicker(picker) {
    if (!picker || picker.dataset.fontPickerReady === "true") return;
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
        fontInput.value ||
        optionRows[0]?.getAttribute("data-value") ||
        "";
      triggerLabel.textContent = family;
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
        dropdown.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        fontInput.dispatchEvent(new Event("change", { bubbles: true }));
      };

      row.addEventListener("click", pick);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      });
    });

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = dropdown.hidden;
      dropdown.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) {
        const val = fontInput.value || "";
        const esc =
          typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(val)
            : val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const active = dropdown.querySelector(`[data-value="${esc}"]`);
        active?.scrollIntoView({ block: "nearest" });
      }
    });

    if (!picker.dataset.fontPickerOutsideBound) {
      picker.dataset.fontPickerOutsideBound = "true";
      document.addEventListener("pointerdown", (e) => {
        if (!picker.contains(e.target)) {
          dropdown.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    }

    fontInput.addEventListener("change", sync);
    if (!fontInput.value && optionRows[0]) {
      fontInput.value = optionRows[0].getAttribute("data-value") || "";
    }
    sync();
  }

  function boot() {
    migrateLegacySelects();
    document.querySelectorAll(ROOT).forEach(initPicker);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("shopify:section:load", boot);
})();
