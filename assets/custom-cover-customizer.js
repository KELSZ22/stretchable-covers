import {
  BUILTIN_SHAPES,
  resolveFullShapeLibrary,
  SHAPES_PAGE_SIZE,
} from "./custom-cover-customizer-shapes-registry.js";

const CUSTOMIZER_ROT_HANDLE_OFFSET = 28;
const CUSTOMIZER_HANDLE_RADIUS_PX = 6;
const CUSTOMIZER_ROT_HANDLE_RADIUS_PX = 6;
const CUSTOMIZER_ROT_HANDLE_HIT_RADIUS_PX = 5;
const CUSTOMIZER_DRAFTS_STORAGE_VERSION = 1;
const CUSTOMIZER_PREVIEW_STORAGE_VERSION = 1;
const CUSTOMIZER_TEXT_EFFECT_IDS = [
  "straight",
  "curve",
  "arc",
  "small-to-large",
  "large-to-small",
  "bulge",
];

class CustomCoverCustomizer extends HTMLElement {
  constructor() {
    super();
    this.canvas = null;
    this.ctx = null;
    this.form = null;
    this.warningOutput = null;
    this.elements = [];
    this.selectedElementId = null;
    this.dragState = null;
    this.moneyFormatter = null;
    this.variantPriceCents = 0;
    this.safeArea = {
      x: Number(this.dataset.safeX || 10),
      y: Number(this.dataset.safeY || 10),
      width: Number(this.dataset.safeWidth || 80),
      height: Number(this.dataset.safeHeight || 80),
    };
    this.priceAdjustments = {
      text: Number(this.dataset.textPriceCents || 0),
      image: Number(this.dataset.imagePriceCents || 0),
      clipart: Number(this.dataset.clipartPriceCents || 0),
      shape: Number(this.dataset.shapePriceCents || 0),
    };
    this.textDefaults = {
      textAlign: "left",
      fontWeight: "normal",
      fontStyle: "normal",
      underline: false,
      strikethrough: false,
      outlineEnabled: true,
      outlineWidth: 3,
      outlineColor: "#ffffff",
      textEffect: "straight",
      curveRadius: 320,
      curveSpacing: 0,
      arcRadius: 320,
      arcSpacing: 0,
      stlLeft: 72,
      stlRight: 140,
      ltsLeft: 140,
      ltsRight: 72,
      bulgeLeft: 80,
      bulgeRight: 80,
    };
    /** @type {"text" | "image" | "clipart" | "shapes" | string} */
    this.currentTool = "text";
    this._caretBlinkOn = true;
    this._caretIntervalId = null;
    /** @type {unknown[] | null} */
    this._shapeLibrary = null;
    /** @type {Map<string, unknown>} */
    this._shapeById = new Map();
    /** @type {Promise<void> | null} */
    this._shapeLibraryPromise = null;
    /** @type {Promise<void> | null} */
    this._shapeGridPopulateLock = null;
    this._outlineVisibleCount = SHAPES_PAGE_SIZE;
    this._filledVisibleCount = SHAPES_PAGE_SIZE;
    this.viewZoom = 1;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.viewPanMode = false;
    this.viewPanDrag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = 60;
    this.pendingHistorySnapshot = null;
    this.drafts = [];
    this.draftNotice = "";
    this.lastTemplateSelection = null;
    this.setMode = null;
    this._draftSyncInFlight = false;
    this.previewToken = "";
    this._shareTooltipTimer = null;
    this._canvasViewportMq = null;
    this._onCanvasViewportChange = null;
    /** @type {boolean} */
    this._suppressImprintVariantResolution = false;
    /** @type {string | null} */
    this._imprintSizeInnerTemplate = null;
    /** @type {string | null} */
    this._imprintTypeInnerTemplate = null;
    /** @type {(() => void) | null} */
    this._designHelpCleanup = null;
    /** @type {((event: KeyboardEvent) => void) | null} */
    this._onDesignHelpEscape = null;
  }

  connectedCallback() {
    const section = this.closest(".custom-cover-customizer");
    this.canvas = section?.querySelector("[data-customizer-canvas]");
    this.form = this.querySelector("form");
    this.warningOutput = this.querySelector("[data-warning-output]");

    if (!this.canvas || !this.form) {
      return;
    }

    this.applyResponsiveCanvasSize();
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) {
      return;
    }
    this._canvasViewportMq = window.matchMedia("(max-width: 989px)");
    this._onCanvasViewportChange = () => {
      if (!this.canvas) {
        return;
      }
      if (this.applyResponsiveCanvasSize()) {
        this.render();
      }
    };
    this._canvasViewportMq.addEventListener(
      "change",
      this._onCanvasViewportChange,
    );

    this.setupMoneyFormatter();
    this.bindFields();
    const seedOutlineColor = this.querySelector("[data-text-outline-color]");
    if (seedOutlineColor?.value) {
      let v = String(seedOutlineColor.value).trim();
      if (!v.startsWith("#")) {
        v = `#${v}`;
      }
      this.textDefaults.outlineColor = v;
    }
    this.updateShapeFillChrome();
    this.updateShapeOutlineColorChrome();
    this.seedVariantPrice();
    this.render();
    this.updatePrice();
    void this.preloadGoogleFontsForCanvas();
  }

  disconnectedCallback() {
    if (this._onCanvasViewportChange && this._canvasViewportMq) {
      this._canvasViewportMq.removeEventListener(
        "change",
        this._onCanvasViewportChange,
      );
      this._onCanvasViewportChange = null;
      this._canvasViewportMq = null;
    }
    if (this._onDesignKeydown) {
      window.removeEventListener("keydown", this._onDesignKeydown);
      this._onDesignKeydown = null;
    }
    if (this._onDrawerEscape) {
      window.removeEventListener("keydown", this._onDrawerEscape, true);
      this._onDrawerEscape = null;
    }
    if (this._onDrawerMq && this._drawerMq) {
      this._drawerMq.removeEventListener("change", this._onDrawerMq);
      this._onDrawerMq = null;
      this._drawerMq = null;
    }
    document.documentElement.classList.remove(
      "custom-cover-customizer-drawer-open",
    );
    if (this._onOutsideCanvasPointerDown) {
      window.removeEventListener("mousedown", this._onOutsideCanvasPointerDown);
      window.removeEventListener(
        "touchstart",
        this._onOutsideCanvasPointerDown,
      );
      this._onOutsideCanvasPointerDown = null;
    }
    if (this._onDesignOverflowOutsidePointerDown) {
      document.removeEventListener(
        "pointerdown",
        this._onDesignOverflowOutsidePointerDown,
        true,
      );
      this._onDesignOverflowOutsidePointerDown = null;
    }
    if (typeof this._designHelpCleanup === "function") {
      this._designHelpCleanup();
    }
    this._stopCaretBlinkLoop();
  }

  /** Normalize textarea newlines for canvas layout and storage. */
  normalizeNewlines(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  applyResponsiveCanvasSize() {
    if (!this.canvas) {
      return false;
    }
    const isMobile = window.matchMedia("(max-width: 989px)").matches;
    const targetWidth = isMobile ? 350 : 600;
    const targetHeight = isMobile ? 355 : 600;
    if (
      this.canvas.width === targetWidth &&
      this.canvas.height === targetHeight
    ) {
      return false;
    }
    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    return true;
  }

  setupMoneyFormatter() {
    const currencyCode = this.dataset.currencyCode || "USD";
    try {
      this.moneyFormatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      });
    } catch (error) {
      this.moneyFormatter = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      });
    }
  }

  _usesGoogleFontApi() {
    const mode = this.dataset.googleFontLibrary || "custom";
    return mode === "google" || mode === "both";
  }

  _shouldTryGoogleLoad(family) {
    const name = (family || "").trim();
    if (!name || !this._usesGoogleFontApi()) {
      return false;
    }
    const mode = this.dataset.googleFontLibrary || "custom";
    if (mode === "google") {
      return true;
    }
    const raw = this.dataset.googleFontAllowlist || "";
    const allow = raw
      .split("|")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return allow.includes(name.toLowerCase());
  }

  /**
   * @param {string} family
   * @param {{ redraw?: boolean }} [options]
   */
  ensureGoogleFontLoaded(family, options = {}) {
    const { redraw = true } = options;
    if (!this._shouldTryGoogleLoad(family)) {
      return Promise.resolve();
    }
    const name = family.trim();
    const norm = name.toLowerCase();
    if (!this._googleFontPromises) {
      this._googleFontPromises = new Map();
    }
    const hit = this._googleFontPromises.get(norm);
    if (hit) {
      return hit;
    }

    const safeId =
      norm.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "f";
    const linkId = `gf-customizer-${safeId}`;

    const innerPromise = document.getElementById(linkId)
      ? document.fonts.ready
      : new Promise((resolve) => {
          const param = encodeURIComponent(name).replace(/%20/g, "+");
          const href = `https://fonts.googleapis.com/css2?family=${param}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
          const link = document.createElement("link");
          link.id = linkId;
          link.rel = "stylesheet";
          link.href = href;
          link.onload = () => {
            document.fonts.ready.then(resolve);
          };
          link.onerror = () => resolve();
          document.head.appendChild(link);
        });

    const tracked = innerPromise.then(() => {
      if (redraw) {
        this.render();
        this.updateHiddenProperties();
      }
    });
    this._googleFontPromises.set(norm, tracked);
    return tracked;
  }

  async preloadGoogleFontsForCanvas() {
    if (!this._usesGoogleFontApi()) {
      return;
    }
    const names = [];
    for (const el of this.elements) {
      if (el.type === "text" && el.fontFamily) {
        names.push(el.fontFamily);
      }
    }
    const fontInput = this.querySelector("[data-font-input]");
    if (fontInput?.value) {
      names.push(fontInput.value);
    }
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    await Promise.all(
      unique.map((f) => this.ensureGoogleFontLoaded(f, { redraw: false })),
    );
    this.render();
    this.updateHiddenProperties();
  }

  _captureImprintControlTemplatesIfNeeded() {
    if (this._imprintSizeInnerTemplate == null) {
      const el = this.querySelector("[data-imprint-size]");
      if (el) {
        this._imprintSizeInnerTemplate = el.innerHTML;
      }
    }
    if (this._imprintTypeInnerTemplate == null) {
      const el = this.querySelector("[data-imprint-text]");
      if (el) {
        this._imprintTypeInnerTemplate = el.innerHTML;
      }
    }
  }

  _toVariantOptionNameIndexSet(excludeIndices) {
    if (excludeIndices instanceof Set) {
      return excludeIndices;
    }
    return new Set(
      Array.isArray(excludeIndices)
        ? excludeIndices.filter((i) => typeof i === "number" && i >= 0)
        : [],
    );
  }

  /**
   * Match a theme-configured label to `product.optionNames` index.
   * Excludes indices already used (e.g. never map "Imprint" to "Imprint Size").
   */
  _matchVariantOptionNameIndex(optionNames, label, excludeIndices) {
    const raw = String(label || "").trim();
    if (!raw || !Array.isArray(optionNames) || !optionNames.length) {
      return -1;
    }
    const ex = this._toVariantOptionNameIndexSet(excludeIndices);
    const n = raw.toLowerCase();
    let i = optionNames.findIndex(
      (x, idx) =>
        !ex.has(idx) &&
        String(x || "")
          .trim()
          .toLowerCase() === n,
    );
    if (i >= 0) {
      return i;
    }
    i = optionNames.findIndex((x, idx) => {
      if (ex.has(idx)) {
        return false;
      }
      const t = String(x || "")
        .trim()
        .toLowerCase();
      if (!t) {
        return false;
      }
      if (t.includes(n)) {
        if (t !== n && t.startsWith(`${n} `)) {
          return false;
        }
        return true;
      }
      if (n.includes(t) && t.length >= 4) {
        // Reject: label "Imprint Size" must not match option "Imprint" (prefix of the real option name)
        if (
          n !== t &&
          (n.startsWith(`${t} `) ||
            n.startsWith(`${t}/`) ||
            n.startsWith(`${t}-`))
        ) {
          return false;
        }
        return true;
      }
      return false;
    });
    return i;
  }

  _resolvedColorOptionIndex(optionNames, colorLabelConfigured, excludeIndices) {
    if (!Array.isArray(optionNames) || optionNames.length === 0) {
      return -1;
    }
    const ex = this._toVariantOptionNameIndexSet(excludeIndices);
    const fromCfg = this._matchVariantOptionNameIndex(
      optionNames,
      colorLabelConfigured,
      ex,
    );
    if (fromCfg >= 0) {
      return fromCfg;
    }
    return optionNames.findIndex(
      (x, idx) => !ex.has(idx) && /\bcolor\b|\bcolour\b/i.test(String(x || "")),
    );
  }

  /**
   * @param {Record<string, unknown>} product Normalized catalog product
   */
  resolveImprintOptionIndices(product) {
    const names = Array.isArray(product?.optionNames)
      ? product.optionNames
      : [];
    const sizeLbl = String(
      this.dataset.imprintVariantSizeOption || "Imprint Size",
    ).trim();
    const typeLbl = String(
      this.dataset.imprintVariantTypeOption || "Imprint",
    ).trim();
    const colorLbl = String(
      this.dataset.imprintVariantColorOption || "Color",
    ).trim();
    let sizeIdx = this._matchVariantOptionNameIndex(names, sizeLbl);
    const sizeTaken =
      typeof sizeIdx === "number" && sizeIdx >= 0
        ? new Set([sizeIdx])
        : new Set();
    let typeIdx = this._matchVariantOptionNameIndex(names, typeLbl, sizeTaken);
    if (
      sizeIdx >= 0 &&
      typeIdx >= 0 &&
      sizeIdx === typeIdx &&
      names.length >= 2
    ) {
      typeIdx = -1;
    }
    const reservedForColor = new Set(
      [sizeIdx, typeIdx].filter((i) => typeof i === "number" && i >= 0),
    );
    const colorIdx =
      names.length > 0
        ? this._resolvedColorOptionIndex(names, colorLbl, reservedForColor)
        : -1;

    const variants =
      Array.isArray(product?.variants) && product.variants.length
        ? product.variants
        : [];
    if (
      variants.length > 4 &&
      sizeIdx >= 0 &&
      typeIdx >= 0 &&
      sizeIdx !== typeIdx &&
      colorIdx >= 0
    ) {
      const rSize = this._variantColumnDimensionalRatio(variants, sizeIdx);
      const rType = this._variantColumnDimensionalRatio(variants, typeIdx);
      if (rType - rSize >= 0.12) {
        const swap = sizeIdx;
        sizeIdx = typeIdx;
        typeIdx = swap;
      }
    }

    return { names, sizeIdx, typeIdx, colorIdx };
  }

  /**
   * Heuristic for routing bare `imprint=` URL params: diameters/inches vs imprint style strings.
   * "Standard Cover Imprint" → false ; "29.5\" " or "12 in" → true
   */
  looksLikeDimensionalImprintSize(raw) {
    const t = String(raw || "").trim();
    if (!t) return false;
    const s = t.toLowerCase();
    if (/\b(inch|inches|in\.?|cm\b|mm\b|diameter|dia\.?|ø|dia\b)\b/.test(s)) {
      return true;
    }
    if (/\d/.test(s) && /["\u2033\u2032]/.test(t)) return true;
    if (/^\d+(\.\d+)?\s*$/.test(t.trim())) return true;
    const plainNum = /^(\d+(\.\d+)?)(\"|'|\u2033|\u2032)?\s*$/i.test(t.trim());
    if (plainNum) return true;
    return false;
  }

  _variantColumnDimensionalRatio(variants, colIdx) {
    if (!Array.isArray(variants) || colIdx < 0 || colIdx > 2) return 0;
    let total = 0;
    let dim = 0;
    for (const v of variants) {
      const val = String(this.variantOptionTriple(v)[colIdx] || "").trim();
      if (!val) continue;
      total += 1;
      if (this.looksLikeDimensionalImprintSize(val)) {
        dim += 1;
      }
    }
    return total ? dim / total : 0;
  }

  variantOptionTriple(variant) {
    return [
      String(variant?.option1 ?? "").trim(),
      String(variant?.option2 ?? "").trim(),
      String(variant?.option3 ?? "").trim(),
    ];
  }

  /** Normalize option text for comparison (quotes, spacing, case). */
  normalizeComparableOptionValue(val) {
    return String(val == null ? "" : val)
      .trim()
      .toLowerCase()
      .replace(/\u2033|\u2032/g, '"')
      .replace(/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"')
      .replace(/\s+/g, " ");
  }

  /** Size values: 18.0" vs 18.0 in admin, minor quote/whitespace drift, or same numeric core. */
  imprintSizeStringsMatch(a, b) {
    const na = this.normalizeComparableOptionValue(a);
    const nb = this.normalizeComparableOptionValue(b);
    if (na && nb && na === nb) {
      return true;
    }
    const fa = Number.parseFloat(String(a).replace(/[^\d.-]/g, ""));
    const fb = Number.parseFloat(String(b).replace(/[^\d.-]/g, ""));
    if (
      Number.isFinite(fa) &&
      Number.isFinite(fb) &&
      Math.abs(fa - fb) < 1e-4
    ) {
      return true;
    }
    if (!na || !nb) {
      return false;
    }
    return na.includes(nb) || nb.includes(na);
  }

  /** Imprint type / color: allow "Navy" vs "Navy Blue" style drift. */
  literalOptionStringsMatch(a, b) {
    const na = this.normalizeComparableOptionValue(a);
    const nb = this.normalizeComparableOptionValue(b);
    if (!na || !nb) {
      return false;
    }
    if (na === nb) {
      return true;
    }
    return na.includes(nb) || nb.includes(na);
  }

  _assignImprintSelectFromVariantValue(selectEl, rawValue, axis) {
    if (!selectEl || rawValue == null) {
      return false;
    }
    const desired = String(rawValue).trim();
    if (!desired) {
      return false;
    }
    const match = [...selectEl.options].find((o) => {
      const ov = String(o.value ?? "").trim();
      if (!ov) {
        return false;
      }
      if (axis === "size") {
        return ov === desired || this.imprintSizeStringsMatch(ov, desired);
      }
      return ov === desired || this.literalOptionStringsMatch(ov, desired);
    });
    if (!match) {
      return false;
    }
    selectEl.value = match.value;
    return true;
  }

  imprintSizeSortDesc(a, b) {
    const pa = Number.parseFloat(String(a).replace(/[^\d.+-]/g, ""));
    const pb = Number.parseFloat(String(b).replace(/[^\d.+-]/g, ""));
    const na = Number.isFinite(pa);
    const nb = Number.isFinite(pb);
    if (na && nb && pa !== pb) return pb - pa;
    return String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  _uniqueSortedStrings(values, sortFn) {
    const seen = new Set();
    const out = [];
    for (const val of values) {
      const s = String(val || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    out.sort(sortFn);
    return out;
  }

  /**
   * Rebuild imprint size / imprint type selects from variant option values.
   * @returns {boolean} true when at least one axis was driven by variants
   */
  syncVariantImprintSelectors(product) {
    this._captureImprintControlTemplatesIfNeeded();
    const sizeSel = this.querySelector("[data-imprint-size]");
    const typeSel = this.querySelector("[data-imprint-text]");
    if (!sizeSel) {
      return false;
    }
    const ix = this.resolveImprintOptionIndices(product);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    let used = false;

    if (ix.sizeIdx >= 0 && variants.length) {
      const rawVals = variants.map(
        (v) => this.variantOptionTriple(v)[ix.sizeIdx],
      );
      const uniq = this._uniqueSortedStrings(rawVals, (a, b) =>
        this.imprintSizeSortDesc(a, b),
      );
      if (uniq.length) {
        const ph =
          [...sizeSel.querySelectorAll("option")].find(
            (o) => o.disabled && String(o.value || "") === "",
          )?.textContent || "Select imprint size";
        sizeSel.innerHTML = "";
        const p = document.createElement("option");
        p.value = "";
        p.disabled = true;
        p.selected = true;
        p.textContent = ph.trim();
        sizeSel.append(p);
        for (const val of uniq) {
          const o = document.createElement("option");
          o.value = val;
          o.textContent = val;
          sizeSel.append(o);
        }
        sizeSel.setAttribute("data-variant-driven", "");
        used = true;
      }
    } else if (this._imprintSizeInnerTemplate != null) {
      sizeSel.innerHTML = this._imprintSizeInnerTemplate;
      sizeSel.removeAttribute("data-variant-driven");
    }

    if (typeSel) {
      if (ix.typeIdx >= 0 && variants.length) {
        const rawVals = variants.map(
          (v) => this.variantOptionTriple(v)[ix.typeIdx],
        );
        const uniq = this._uniqueSortedStrings(rawVals, (a, b) =>
          String(a).localeCompare(String(b), undefined, {
            sensitivity: "base",
          }),
        );
        if (uniq.length) {
          const ph =
            [...typeSel.querySelectorAll("option")].find(
              (o) => o.disabled && String(o.value || "") === "",
            )?.textContent || "Select imprint";
          typeSel.innerHTML = "";
          const p = document.createElement("option");
          p.value = "";
          p.disabled = true;
          p.selected = true;
          p.textContent = ph.trim();
          typeSel.append(p);
          for (const val of uniq) {
            const o = document.createElement("option");
            o.value = val;
            o.textContent = val;
            typeSel.append(o);
          }
          typeSel.setAttribute("data-variant-driven", "");
          used = true;
        }
      } else if (this._imprintTypeInnerTemplate != null) {
        typeSel.innerHTML = this._imprintTypeInnerTemplate;
        typeSel.removeAttribute("data-variant-driven");
      }
    }

    return used;
  }

  primeImprintSelectsFromVariant(product, variant) {
    if (!product || !variant) {
      return;
    }
    const ix = this.resolveImprintOptionIndices(product);
    const triple = this.variantOptionTriple(variant);
    const sizeSel = this.querySelector("[data-imprint-size]");
    const typeSel = this.querySelector("[data-imprint-text]");
    if (ix.sizeIdx >= 0 && sizeSel) {
      const v = triple[ix.sizeIdx];
      this._assignImprintSelectFromVariantValue(sizeSel, v, "size");
    }
    if (ix.typeIdx >= 0 && typeSel) {
      const v = triple[ix.typeIdx];
      this._assignImprintSelectFromVariantValue(typeSel, v, "imprint");
    }
  }

  syncImprintSelectsOnlyFromVariantId(product, variantId) {
    if (!product || variantId == null || variantId === "") {
      return;
    }
    const variant = (
      Array.isArray(product.variants) ? product.variants : []
    ).find((v) => String(v?.id ?? "") === String(variantId));
    if (!variant) {
      return;
    }
    const ix = this.resolveImprintOptionIndices(product);
    const triple = this.variantOptionTriple(variant);
    const sizeSel = this.querySelector("[data-imprint-size]");
    const typeSel = this.querySelector("[data-imprint-text]");
    if (sizeSel && ix.sizeIdx >= 0) {
      const v = triple[ix.sizeIdx];
      this._assignImprintSelectFromVariantValue(sizeSel, v, "size");
    }
    if (typeSel && ix.typeIdx >= 0) {
      const v = triple[ix.typeIdx];
      this._assignImprintSelectFromVariantValue(typeSel, v, "imprint");
    }
  }

  /**
   * Find variant matching imprint picks; by default relax color if no variant matches all axes.
   * @param {{ enforceUrlColorHint?: boolean }} [opts] When `enforceUrlColorHint` is true (URL `color=`), do not relax color — imprint prefill must not pick a wrong-color variant.
   */
  pickVariantMatchingImprints(product, opts = {}) {
    if (!product) {
      return null;
    }
    const ix = this.resolveImprintOptionIndices(product);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const sizeSel = this.querySelector("[data-imprint-size]");
    const typeSel = this.querySelector("[data-imprint-text]");
    const sizeVal = ix.sizeIdx >= 0 ? String(sizeSel?.value || "").trim() : "";
    const imprintVal =
      ix.typeIdx >= 0 ? String(typeSel?.value || "").trim() : "";
    const sizeNeed = ix.sizeIdx >= 0 && Boolean(sizeVal);
    const imprintNeed = ix.typeIdx >= 0 && Boolean(imprintVal);
    const colorHint = String(this.dataset.productColor || "").trim();

    const pools = variants.filter((v) => Boolean(v.available));
    const candidates = pools.length ? pools : variants.slice();

    const matches = (subset, { requireColor }) => {
      return subset.filter((v) => {
        const t = this.variantOptionTriple(v);
        if (
          sizeNeed &&
          sizeVal &&
          !this.imprintSizeStringsMatch(String(t[ix.sizeIdx] || ""), sizeVal)
        ) {
          return false;
        }
        if (
          imprintNeed &&
          imprintVal &&
          !this.literalOptionStringsMatch(
            String(t[ix.typeIdx] || ""),
            imprintVal,
          )
        ) {
          return false;
        }
        if (
          requireColor &&
          colorHint &&
          ix.colorIdx >= 0 &&
          !this.literalOptionStringsMatch(
            String(t[ix.colorIdx] || ""),
            colorHint,
          )
        ) {
          return false;
        }
        return true;
      });
    };

    const strictOnly = opts.enforceUrlColorHint === true && Boolean(colorHint);
    let pick = strictOnly
      ? (matches(candidates, { requireColor: true })[0] ?? null)
      : matches(candidates, { requireColor: true })[0] ||
        matches(candidates, { requireColor: false })[0] ||
        null;
    return pick?.id ?? null;
  }

  /**
   * HTMLSelectElement rejects setting `value` to a disabled `<option>`; PDP links can
   * target unavailable variants programmatically — enable the option briefly so hydration works.
   * @returns {boolean} Whether the DOM select now reflects `variantId`.
   */
  _setVariantSelectorValueAllowDisabled(variantSel, variantId) {
    if (!variantSel || variantId == null || variantId === "") {
      return false;
    }
    const want = String(variantId).trim();
    const opt =
      [...variantSel.options].find((o) => String(o.value || "") === want) ||
      null;
    if (!opt?.value) {
      return false;
    }
    if (opt.disabled) {
      opt.disabled = false;
    }
    variantSel.value = opt.value;
    return String(variantSel.value || "") === want;
  }

  _variantColorTailFromTitle(title) {
    const raw = String(title || "").trim();
    if (!raw) return "";
    const parts = raw
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  }

  /**
   * Match PDP/storefront `color=` to a variant id using option values / title fallbacks.
   * @returns {string} Numeric id string when found, otherwise "".
   */
  findVariantIdMatchingUrlColor(product, urlColorRaw) {
    const desired = String(urlColorRaw || "").trim();
    if (!product || !desired || !Array.isArray(product?.variants)) {
      return "";
    }
    const variants = product.variants.filter(Boolean);
    if (!variants.length) {
      return "";
    }
    const ix = this.resolveImprintOptionIndices(product);
    const matchesColor = (v) => {
      const triple = this.variantOptionTriple(v);
      const fromOpt =
        ix.colorIdx >= 0 ? String(triple[ix.colorIdx] || "").trim() : "";
      const tail = this._variantColorTailFromTitle(String(v?.title || ""));
      const fullTitle = String(v?.title || "").trim();
      if (fromOpt && this.literalOptionStringsMatch(fromOpt, desired)) {
        return true;
      }
      if (tail && this.literalOptionStringsMatch(tail, desired)) {
        return true;
      }
      if (fullTitle && this.literalOptionStringsMatch(fullTitle, desired)) {
        return true;
      }
      return false;
    };
    const availableOnes = variants.filter((v) => Boolean(v.available));
    const bucket = availableOnes.length ? availableOnes : variants.slice();
    let hit = bucket.find(matchesColor);
    if (!hit && availableOnes.length) {
      hit = variants.find(matchesColor);
    }
    return hit?.id != null ? String(hit.id) : "";
  }

  /** True when current imprint size/type selects agree with variant option axes. */
  _variantMatchesUiImprints(product, variant) {
    const ix = this.resolveImprintOptionIndices(product);
    const sizeSel = this.querySelector("[data-imprint-size]");
    const typeSel = this.querySelector("[data-imprint-text]");
    const sizeVal = ix.sizeIdx >= 0 ? String(sizeSel?.value || "").trim() : "";
    const imprintVal =
      ix.typeIdx >= 0 ? String(typeSel?.value || "").trim() : "";
    const sizeNeed = ix.sizeIdx >= 0 && Boolean(sizeVal);
    const imprintNeed = ix.typeIdx >= 0 && Boolean(imprintVal);
    const t = this.variantOptionTriple(variant);
    if (
      sizeNeed &&
      sizeVal &&
      !this.imprintSizeStringsMatch(String(t[ix.sizeIdx] || ""), sizeVal)
    ) {
      return false;
    }
    if (
      imprintNeed &&
      imprintVal &&
      !this.literalOptionStringsMatch(String(t[ix.typeIdx] || ""), imprintVal)
    ) {
      return false;
    }
    return true;
  }

  _variantMatchesUiColor(product, variant, pinned) {
    const colorHint = String(pinned || "").trim();
    if (!colorHint) {
      return true;
    }
    const ix = this.resolveImprintOptionIndices(product);
    const t = this.variantOptionTriple(variant);
    if (
      ix.colorIdx >= 0 &&
      !this.literalOptionStringsMatch(String(t[ix.colorIdx] || ""), colorHint)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Resolves Shopify line-item `id` before Ajax cart interception (see theme header cart script).
   * Swatch/URL color can hydrate `dataset.productColor` without setting the variant select.
   */
  ensureVariantIdForCart() {
    const variantSel = this.querySelector("[data-variant-selector]");
    const formEl = this.form;
    const idField = formEl?.querySelector?.('input[name="id"]');
    if (!variantSel || !formEl) {
      return;
    }
    let cur = String(variantSel.value || "").trim();
    if (cur) {
      if (idField) idField.value = cur;
      return;
    }

    const getCatalog =
      typeof this._getProductCatalog === "function"
        ? this._getProductCatalog
        : null;
    if (!getCatalog) {
      return;
    }
    const pid = String(this.dataset.productId || "").trim();
    const product = getCatalog().find((p) => String(p?.id ?? "") === pid);
    if (!product) {
      return;
    }

    const pinned = String(this.dataset.productColor || "").trim();

    let pick =
      pinned !== ""
        ? this.pickVariantMatchingImprints(product, {
            enforceUrlColorHint: true,
          })
        : this.pickVariantMatchingImprints(product);

    if (pick == null && pinned !== "") {
      const pools = Array.isArray(product.variants)
        ? product.variants.filter((v) => Boolean(v.available))
        : [];
      const pool = pools.length ? pools : (product.variants || []).slice();
      const vidColor = this.findVariantIdMatchingUrlColor(product, pinned);
      if (vidColor) {
        const hit = pool.find((v) => String(v?.id ?? "") === String(vidColor));
        if (
          hit &&
          this._variantMatchesUiColor(product, hit, pinned) &&
          this._variantMatchesUiImprints(product, hit)
        ) {
          pick = hit.id ?? null;
        }
      }
      if (pick == null) {
        const matchRow = pool.find(
          (v) =>
            this._variantMatchesUiColor(product, v, pinned) &&
            this._variantMatchesUiImprints(product, v),
        );
        if (matchRow?.id != null) {
          pick = matchRow.id;
        }
      }
    }

    if (pick == null) {
      pick = this.pickVariantMatchingImprints(product);
    }

    if (pick != null) {
      const ok = this._setVariantSelectorValueAllowDisabled(
        variantSel,
        String(pick),
      );
      if (ok) {
        variantSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  resolveVariantFromImprintSelections() {
    if (this._suppressImprintVariantResolution) {
      return;
    }
    const variantSel = this.querySelector("[data-variant-selector]");
    const pid = String(this.dataset.productId || "").trim();
    const productCatalog =
      typeof this._getProductCatalog === "function"
        ? this._getProductCatalog()
        : [];
    if (!pid || !Array.isArray(productCatalog) || !variantSel) {
      return;
    }
    const product = productCatalog.find((p) => String(p?.id ?? "") === pid);
    if (!product) {
      return;
    }
    const pickId = this.pickVariantMatchingImprints(product);
    if (pickId == null) {
      return;
    }
    const match = [...variantSel.options].find(
      (o) => String(o.value || "") === String(pickId),
    );
    if (!match?.value) {
      return;
    }
    const cur = variantSel.value;
    if (String(cur || "") === String(pickId)) {
      this.updateHiddenProperties();
      return;
    }
    // Do not copy `dataset.productColor` from the *previous* selection here —
    // before applying `pickId` that clobbered PDP `color=` hints off the Orange row.
    this._suppressImprintVariantResolution = true;
    this._setVariantSelectorValueAllowDisabled(variantSel, pickId);
    this._suppressImprintVariantResolution = false;
    variantSel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Select the "Other" imprint option when nothing was URL-prefilled and the
   * UI is still on the disabled placeholder — legacy manual lists only.
   */
  ensureImprintSizeDefaultToOther(urlHadImprintPrefill) {
    if (urlHadImprintPrefill) {
      return;
    }
    const sel = this.querySelector("[data-imprint-size]");
    if (!sel || sel.hasAttribute("data-variant-driven")) {
      return;
    }
    const idx = sel.selectedIndex;
    const chosen = idx >= 0 ? sel.options[idx] : null;
    const placeholder =
      chosen && chosen.disabled && String(chosen.value || "") === "";

    let noRealChoice = placeholder;
    if (!noRealChoice && String(sel.value || "").trim() === "") {
      noRealChoice = true;
    }

    if (!noRealChoice) {
      return;
    }
    const other = [...sel.options].find((o) =>
      o.hasAttribute("data-imprint-other-option"),
    );
    if (!other?.value) {
      return;
    }
    sel.value = other.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  resolveImprintSizeForPayload() {
    const sel = this.querySelector("[data-imprint-size]");
    if (!sel) {
      return "";
    }
    const val = String(sel.value || "").trim();
    const opt = sel.selectedOptions?.[0];
    if (
      opt?.hasAttribute?.("data-imprint-other-option") &&
      val === "__custom_imprint_size__"
    ) {
      return String(opt.textContent || "").trim() || val;
    }
    return val;
  }

  bindFields() {
    const sectionRoot = this.closest(".custom-cover-customizer");
    const uploadInput = this.querySelector("[data-upload-input]");
    const imageRights = this.querySelector("[data-image-rights]");
    const uploadDropzone = this.querySelector("[data-upload-dropzone]");
    const modeTabs = this.querySelectorAll("[data-mode-tab]");
    const modePanels = this.querySelectorAll("[data-mode-panel]");
    const toolButtons = this.querySelectorAll("[data-tool-button]");
    const clipartButtons = this.querySelectorAll("[data-add-clipart]");
    const templateButtons = this.querySelectorAll("[data-add-template]");
    const shapeFillInput = this.querySelector("[data-shape-fill-input]");
    const productSelector = this.querySelector("[data-product-selector]");
    const variantSelector = this.querySelector("[data-variant-selector]");
    const imprintSizeSelector = this.querySelector("[data-imprint-size]");
    const imprintTextInput = this.querySelector("[data-imprint-text]");
    const imprintTextHelper = this.querySelector("[data-imprint-text-helper]");
    const variantSizeHelper = this.querySelector(
      '[data-size-helper="variant"]',
    );
    const imprintSizeHelper = this.querySelector(
      '[data-size-helper="imprint"]',
    );
    const idField = this.form.querySelector('input[name="id"]');
    const imprintSizeProperty = this.form.querySelector(
      "[data-imprint-size-property]",
    );
    const imprintTextProperty = this.form.querySelector(
      "[data-imprint-text-property]",
    );
    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textInput = this.querySelector("[data-text-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");
    const designTitleInput = sectionRoot?.querySelector(
      "[data-design-title-input]",
    );
    const designTitleEditIcon = sectionRoot?.querySelector(
      ".custom-cover-customizer__design-title-icon",
    );
    const zoomInBtn = sectionRoot?.querySelector("[data-canvas-zoom-in]");
    const zoomOutBtn = sectionRoot?.querySelector("[data-canvas-zoom-out]");
    const panBtn = sectionRoot?.querySelector("[data-canvas-pan]");
    const copyBtns = sectionRoot?.querySelectorAll("[data-design-copy]") ?? [];
    const flipHorizontalBtns =
      sectionRoot?.querySelectorAll("[data-design-flip-horizontal]") ?? [];
    const flipVerticalBtns =
      sectionRoot?.querySelectorAll("[data-design-flip-vertical]") ?? [];
    const undoBtns = sectionRoot?.querySelectorAll("[data-design-undo]") ?? [];
    const redoBtns = sectionRoot?.querySelectorAll("[data-design-redo]") ?? [];
    const deleteBtns =
      sectionRoot?.querySelectorAll("[data-design-delete]") ?? [];
    const downloadBtns =
      sectionRoot?.querySelectorAll("[data-design-download]") ?? [];
    const loadBtns = sectionRoot?.querySelectorAll("[data-design-load]") ?? [];
    const shareBtn = sectionRoot?.querySelector("[data-design-share]");
    const saveDraftBtns =
      sectionRoot?.querySelectorAll("[data-save-draft]") ?? [];
    const draftsList = this.querySelector("[data-drafts-list]");
    const draftsEmpty = this.querySelector("[data-drafts-empty]");
    const draftsNotice = this.querySelector("[data-drafts-notice]");
    const drawerRoot = this.querySelector("[data-customizer-drawer]");
    const drawerBackdrop = this.querySelector(
      "[data-customizer-drawer-backdrop]",
    );
    const drawerClose = this.querySelector("[data-customizer-drawer-close]");
    const drawerTitleEl = this.querySelector("[data-customizer-drawer-title]");
    const drawerMq = window.matchMedia("(max-width: 989px)");
    this._drawerMq = drawerMq;
    let lastModeTabForFocus = null;

    const drawerModeLabels = {
      editor: "Editor",
      templates: "Templates",
      drafts: "Drafts",
    };

    const setDrawerScrollLock = (on) => {
      document.documentElement.classList.toggle(
        "custom-cover-customizer-drawer-open",
        Boolean(on),
      );
    };

    const isMobileDrawer = () => drawerMq.matches;

    const openDrawer = () => {
      if (!drawerRoot || !isMobileDrawer()) {
        return;
      }
      drawerRoot.classList.add("is-open");
      drawerRoot.setAttribute("aria-hidden", "false");
      setDrawerScrollLock(true);
      requestAnimationFrame(() => {
        drawerClose?.focus({ preventScroll: true });
      });
    };

    const closeDrawer = () => {
      if (!drawerRoot?.classList.contains("is-open")) {
        return;
      }
      drawerRoot.classList.remove("is-open");
      drawerRoot.setAttribute("aria-hidden", "true");
      setDrawerScrollLock(false);
      const returnEl =
        lastModeTabForFocus || this.querySelector("[data-mode-tab].is-active");
      returnEl?.focus({ preventScroll: true });
    };

    this.applyCanvasViewportTransform();

    const syncDesignTitleInputWidth = () => {
      if (!designTitleInput) {
        return;
      }
      const text = designTitleInput.value || "";
      designTitleInput.style.width = `${Math.max(text.length, 1)}ch`;
    };
    syncDesignTitleInputWidth();
    designTitleInput?.addEventListener("input", syncDesignTitleInputWidth);
    designTitleInput?.addEventListener("change", syncDesignTitleInputWidth);
    designTitleEditIcon?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    designTitleEditIcon?.addEventListener("click", () => {
      if (!designTitleInput) {
        return;
      }
      designTitleInput.focus({ preventScroll: true });
      if (typeof designTitleInput.select === "function") {
        designTitleInput.select();
      }
    });

    const setMode = (mode) => {
      modeTabs.forEach((tab) => {
        const isActive = tab.getAttribute("data-mode-tab") === mode;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      modePanels.forEach((panel) => {
        panel.hidden = panel.getAttribute("data-mode-panel") !== mode;
      });
      if (drawerTitleEl) {
        drawerTitleEl.textContent =
          drawerModeLabels[mode] ||
          (mode && mode.length > 0
            ? mode.charAt(0).toUpperCase() + mode.slice(1)
            : "Editor");
      }
    };
    this.setMode = setMode;

    modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.getAttribute("data-mode-tab");
        if (!mode) {
          return;
        }
        lastModeTabForFocus = tab;
        setMode(mode);
        openDrawer();
      });
    });

    drawerClose?.addEventListener("click", () => closeDrawer());
    drawerBackdrop?.addEventListener("click", () => closeDrawer());

    this._onDrawerEscape = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (!drawerRoot?.classList.contains("is-open") || !isMobileDrawer()) {
        return;
      }
      event.preventDefault();
      closeDrawer();
    };
    window.addEventListener("keydown", this._onDrawerEscape, true);

    this._onDrawerMq = () => {
      if (drawerMq.matches) {
        return;
      }
      drawerRoot?.classList.remove("is-open");
      drawerRoot?.setAttribute("aria-hidden", "true");
      setDrawerScrollLock(false);
    };
    drawerMq.addEventListener("change", this._onDrawerMq);

    toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.getAttribute("data-tool-button");
        if (!tool) {
          return;
        }
        this.setActiveTool(tool);
        this.toggleToolPanels(tool);

        if (tool === "text") {
          this.revealTextInsertUi();
          void this.tryAddTextFromForm();
        }
        if (tool === "clipart") {
          const smoothScroll = !window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          this.querySelector(
            ".custom-cover-customizer__clipart-list",
          )?.scrollIntoView({
            behavior: smoothScroll ? "smooth" : "auto",
            block: "nearest",
          });
        }
        if (tool === "shapes") {
          const smoothScroll = !window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          this.querySelector(
            ".custom-cover-customizer__shapes-list",
          )?.scrollIntoView({
            behavior: smoothScroll ? "smooth" : "auto",
            block: "nearest",
          });
        }
      });
    });

    uploadInput?.addEventListener("change", (event) =>
      this.handleUpload(event),
    );
    uploadDropzone?.addEventListener("click", () => uploadInput?.click());
    uploadDropzone?.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadDropzone.classList.add("is-dragover");
    });
    uploadDropzone?.addEventListener("dragleave", () =>
      uploadDropzone.classList.remove("is-dragover"),
    );
    uploadDropzone?.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadDropzone.classList.remove("is-dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        this.handleUploadFile(file);
      }
    });

    this.querySelectorAll("[data-text-align]").forEach((segment) => {
      segment.addEventListener("click", () => {
        const align = segment.getAttribute("data-text-align");
        if (!align) {
          return;
        }
        const el = this.getSelectedElement();
        if (el?.type === "text") {
          el.textAlign = align;
        }
        Object.assign(this.textDefaults, { textAlign: align });
        this.syncAlignmentControls(align);
        this.render();
        this.updateHiddenProperties();
      });
    });

    const bindFormatToggle = (selector, key, flip) => {
      this.querySelector(selector)?.addEventListener("click", () => {
        const el = this.getSelectedElement();
        const current = el?.type === "text" ? el[key] : this.textDefaults[key];
        const resolved = flip(current);
        this.textDefaults[key] = resolved;
        if (el?.type === "text") {
          el[key] = resolved;
        }
        this.syncFormatToolbars();
        this.render();
        this.updateHiddenProperties();
      });
    };

    bindFormatToggle("[data-format-bold]", "fontWeight", (weight) =>
      weight === "bold" ? "normal" : "bold",
    );
    bindFormatToggle("[data-format-italic]", "fontStyle", (style) =>
      style === "italic" ? "normal" : "italic",
    );
    this.querySelector("[data-format-underline]")?.addEventListener(
      "click",
      () => {
        const el = this.getSelectedElement();
        const current = Boolean(
          el?.type === "text" ? el.underline : this.textDefaults.underline,
        );
        const resolved = !current;
        this.textDefaults.underline = resolved;
        if (el?.type === "text") {
          el.underline = resolved;
        }
        this.syncFormatToolbars();
        this.render();
        this.updateHiddenProperties();
      },
    );
    this.querySelector("[data-format-strikethrough]")?.addEventListener(
      "click",
      () => {
        const el = this.getSelectedElement();
        const current = Boolean(
          el?.type === "text"
            ? el.strikethrough
            : this.textDefaults.strikethrough,
        );
        const resolved = !current;
        this.textDefaults.strikethrough = resolved;
        if (el?.type === "text") {
          el.strikethrough = resolved;
        }
        this.syncFormatToolbars();
        this.render();
        this.updateHiddenProperties();
      },
    );

    clipartButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setMode("editor");
        this.setActiveTool("clipart");
        this.toggleToolPanels("clipart");
        const src = button.getAttribute("data-src");
        if (!src) {
          return;
        }
        this.addImageElement(src, "clipart");
      });
    });

    templateButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const src = button.getAttribute("data-src");
        if (!src) {
          return;
        }
        this.lastTemplateSelection = {
          src,
          label: button.getAttribute("aria-label") || "Template",
          selectedAt: new Date().toISOString(),
        };
        setMode("editor");
        this.addImageElement(src, "image");
      });
    });

    this.populateShapePickerGrid();
    const shapesRoot = this.querySelector("[data-shapes-root]");
    shapesRoot?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-shape-id]");
      if (!btn) {
        return;
      }
      const shapeId = btn.getAttribute("data-shape-id");
      if (!shapeId) {
        return;
      }
      this.setActiveTool("shapes");
      this.toggleToolPanels("shapes");
      this.addShapeElement(shapeId);
    });

    shapeFillInput?.addEventListener("input", () => {
      this.updateShapeFillChrome();
      const el = this.getSelectedElement();
      if (el?.type === "shape") {
        let v = (shapeFillInput.value || "#000000").trim();
        if (!v.startsWith("#")) {
          v = `#${v}`;
        }
        el.fill = v;
        this.render();
        this.updateHiddenProperties();
      }
    });
    this.querySelector("[data-shape-outline-enabled]")?.addEventListener(
      "change",
      () => this.applyShapeOutlineFromFormToSelection(),
    );
    this.querySelector("[data-shape-outline-width-input]")?.addEventListener(
      "input",
      () => this.applyShapeOutlineFromFormToSelection(),
    );
    this.querySelector("[data-shape-outline-color-input]")?.addEventListener(
      "input",
      () => {
        this.updateShapeOutlineColorChrome();
        this.applyShapeOutlineFromFormToSelection();
      },
    );
    const shapeOutlineWeightToggle = this.querySelector(
      "[data-shape-outline-weight-toggle]",
    );
    const shapeOutlineWeightPopover = this.querySelector(
      "[data-shape-outline-weight-popover]",
    );
    const setShapeOutlineWeightPopover = (open) => {
      if (!shapeOutlineWeightToggle || !shapeOutlineWeightPopover) return;
      shapeOutlineWeightPopover.hidden = !open;
      shapeOutlineWeightToggle.setAttribute(
        "aria-expanded",
        open ? "true" : "false",
      );
    };
    shapeOutlineWeightToggle?.addEventListener("click", () => {
      const isOpen = shapeOutlineWeightPopover?.hidden === false;
      setShapeOutlineWeightPopover(!isOpen);
    });
    this.addEventListener("click", (event) => {
      if (
        !shapeOutlineWeightToggle ||
        !shapeOutlineWeightPopover ||
        shapeOutlineWeightPopover.hidden
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        shapeOutlineWeightToggle.contains(target) ||
        shapeOutlineWeightPopover.contains(target)
      ) {
        return;
      }
      setShapeOutlineWeightPopover(false);
    });

    let productCatalog = this.readProductCatalog();
    this._getProductCatalog = () => productCatalog;
    this._captureImprintControlTemplatesIfNeeded();
    const urlParams = new URLSearchParams(window.location.search || "");
    const prefillVariantId = (
      urlParams.get("variant") ||
      urlParams.get("variant_id") ||
      ""
    ).trim();
    const prefillProductId = (
      urlParams.get("product") ||
      urlParams.get("product_id") ||
      ""
    ).trim();
    const prefillSizeExplicit = (
      urlParams.get("imprint_size") ||
      urlParams.get("imprintSize") ||
      ""
    ).trim();
    const prefillStyleExplicit = (
      urlParams.get("imprint_text") ||
      urlParams.get("imprintText") ||
      urlParams.get("imprint_type") ||
      urlParams.get("imprintStyle") ||
      ""
    ).trim();
    const rawLegacyImprintParam = (urlParams.get("imprint") || "").trim();

    /** Parse `imprint=` only when dedicated params are absent (backward compatible). */
    const legacyImprintAlone =
      Boolean(rawLegacyImprintParam) &&
      !prefillSizeExplicit &&
      !prefillStyleExplicit;

    const prefillSizeFromUrl =
      prefillSizeExplicit ||
      (legacyImprintAlone &&
      this.looksLikeDimensionalImprintSize(rawLegacyImprintParam)
        ? rawLegacyImprintParam
        : "");

    const prefillStyleFromUrl =
      prefillStyleExplicit ||
      (legacyImprintAlone &&
      !this.looksLikeDimensionalImprintSize(rawLegacyImprintParam)
        ? rawLegacyImprintParam
        : "");
    const prefillColor = (urlParams.get("color") || "").trim();
    let didPrefillVariant = false;

    const getSwatchBgForColorName = (name) => {
      const n = String(name || "")
        .trim()
        .toLowerCase();
      if (!n) return "";
      const map = {
        "safety orange": "#f57c00",
        orange: "#f57c00",
        "safety yellow": "#f4ea00",
        yellow: "#f4ea00",
        white: "#ffffff",
        black: "#111111",
        navy: "#0f2e53",
        blue: "#1e73d8",
        red: "#d32f2f",
        green: "#2e7d32",
        gray: "#9e9e9e",
        grey: "#9e9e9e",
        silver: "#c0c0c0",
      };
      return map[n] || "";
    };

    const renderVariantSwatches = (productForSwatches) => {
      const root = this.querySelector("[data-variant-swatches]");
      const selectedColorLabel = this.querySelector(
        "[data-selected-color-label]",
      );
      if (!root || !variantSelector) {
        return;
      }

      const ixResolved =
        productForSwatches &&
        typeof productForSwatches === "object" &&
        Array.isArray(productForSwatches.optionNames)
          ? this.resolveImprintOptionIndices(productForSwatches)
          : null;
      const colorIdxResolved =
        ixResolved && typeof ixResolved.colorIdx === "number"
          ? ixResolved.colorIdx
          : -1;

      if (typeof this._variantSwatchOnChange === "function") {
        variantSelector.removeEventListener(
          "change",
          this._variantSwatchOnChange,
        );
        this._variantSwatchOnChange = null;
      }

      const colorGroup = this.querySelector("[data-variant-color-group]");

      root.innerHTML = "";
      if (selectedColorLabel) {
        selectedColorLabel.textContent = "—";
      }

      if (colorIdxResolved < 0) {
        if (colorGroup) {
          colorGroup.hidden = true;
        }
        this._syncVariantSwatchUi = null;
        return;
      }
      if (colorGroup) {
        colorGroup.hidden = false;
      }
      if (selectedColorLabel) {
        selectedColorLabel.textContent = "Select color";
      }

      const variantsRaw =
        productForSwatches &&
        typeof productForSwatches === "object" &&
        Array.isArray(productForSwatches.variants)
          ? productForSwatches.variants
          : Array.isArray(productForSwatches)
            ? productForSwatches
            : [];

      const seen = new Set();
      const items = variantsRaw
        .map((v) => {
          const title = String(v?.title || "").trim();
          const triple = this.variantOptionTriple(v);
          let colorCanonical =
            colorIdxResolved >= 0
              ? String(triple[colorIdxResolved] || "").trim()
              : "";
          if (!colorCanonical) {
            colorCanonical = this._variantColorTailFromTitle(title);
          }
          const variantId = String(v?.id || "").trim();
          const available = Boolean(v?.available);
          return { title, colorCanonical, variantId, available };
        })
        .filter((x) => x.variantId && x.colorCanonical);

      items.forEach((item) => {
        const key = this.normalizeComparableOptionValue(item.colorCanonical);
        if (!key || seen.has(key)) return;
        seen.add(key);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-cover-customizer__swatch";
        btn.setAttribute("role", "listitem");
        btn.setAttribute("aria-label", item.colorCanonical);
        btn.setAttribute("data-color-name", item.colorCanonical);
        btn.disabled = !item.available;

        const bg = getSwatchBgForColorName(item.colorCanonical);
        if (bg) {
          btn.style.setProperty("--swatch-bg", bg);
        } else {
          btn.classList.add("is-empty");
        }

        btn.addEventListener("click", () => {
          if (
            !productForSwatches ||
            typeof productForSwatches !== "object" ||
            !productForSwatches.id
          ) {
            const normalized = item.colorCanonical.toLowerCase();
            const fallbackOpt = [...variantSelector.options].find((opt) => {
              const text = String(opt.textContent || "").toLowerCase();
              return text.includes(normalized);
            });
            if (fallbackOpt?.value) {
              this.dataset.productColor = item.colorCanonical;
              variantSelector.value = fallbackOpt.value;
              variantSelector.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
            }
            return;
          }
          this.dataset.productColor = item.colorCanonical;
          const pickId = this.pickVariantMatchingImprints(productForSwatches);
          if (pickId != null) {
            const row = [...variantSelector.options].find(
              (opt) => String(opt.value || "") === String(pickId),
            );
            if (row?.value) {
              variantSelector.value = row.value;
              variantSelector.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
              return;
            }
          }
          const normalized = item.colorCanonical.toLowerCase();
          const match = [...variantSelector.options].find((opt) => {
            const text = String(opt.textContent || "").toLowerCase();
            return text.includes(normalized);
          });
          if (match?.value) {
            variantSelector.value = match.value;
            variantSelector.dispatchEvent(
              new Event("change", { bubbles: true }),
            );
          }
        });

        root.appendChild(btn);
      });

      const syncSelected = () => {
        const selectedOpt =
          variantSelector.options[variantSelector.selectedIndex];
        const vid = String(selectedOpt?.value || "").trim();

        let selectedColorName = "";
        if (
          vid &&
          productForSwatches &&
          typeof productForSwatches === "object" &&
          Array.isArray(productForSwatches.variants)
        ) {
          const ixSel = this.resolveImprintOptionIndices(productForSwatches);
          const hit = productForSwatches.variants.find(
            (vv) => String(vv?.id ?? "") === vid,
          );
          if (hit && ixSel.colorIdx >= 0) {
            selectedColorName = String(
              this.variantOptionTriple(hit)[ixSel.colorIdx] || "",
            ).trim();
          }
        }
        if (!selectedColorName) {
          const selectedText = String(selectedOpt?.textContent || "");
          selectedColorName =
            this._variantColorTailFromTitle(selectedText) || "";
        }

        const pinnedColor = String(this.dataset.productColor || "").trim();
        if (!vid && pinnedColor) {
          selectedColorName = pinnedColor;
        } else if (vid && !selectedColorName && pinnedColor) {
          selectedColorName = pinnedColor;
        }

        root
          .querySelectorAll(".custom-cover-customizer__swatch")
          .forEach((el) => {
            const sw = String(el.getAttribute("data-color-name") || "").trim();
            el.classList.toggle(
              "is-selected",
              Boolean(sw) &&
                Boolean(selectedColorName) &&
                this.literalOptionStringsMatch(sw, selectedColorName),
            );
          });
        if (selectedColorLabel) {
          selectedColorLabel.textContent = selectedColorName || "Select color";
        }
      };
      this._syncVariantSwatchUi = syncSelected;
      syncSelected();
      this._variantSwatchOnChange = syncSelected;
      variantSelector.addEventListener("change", this._variantSwatchOnChange);
    };

    const populateVariantsForProduct = (productId) => {
      if (!variantSelector) {
        return;
      }
      const selectedProduct = productCatalog.find(
        (product) => String(product.id) === String(productId),
      );
      variantSelector.innerHTML = "";
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "Select color";
      placeholderOption.disabled = true;
      placeholderOption.selected = true;
      variantSelector.append(placeholderOption);
      if (!selectedProduct) {
        if (idField) {
          idField.value = "";
        }
        this.variantPriceCents = 0;
        this.dataset.productId = "";
        this.updatePrice();
        const swatchesRoot = this.querySelector("[data-variant-swatches]");
        if (swatchesRoot) {
          swatchesRoot.innerHTML = "";
        }
        const colorGroupEmpty = this.querySelector(
          "[data-variant-color-group]",
        );
        if (colorGroupEmpty) {
          colorGroupEmpty.hidden = true;
        }
        const selectedColorLabelEmpty = this.querySelector(
          "[data-selected-color-label]",
        );
        if (selectedColorLabelEmpty) {
          selectedColorLabelEmpty.textContent = "—";
        }
        if (typeof this._variantSwatchOnChange === "function") {
          variantSelector.removeEventListener(
            "change",
            this._variantSwatchOnChange,
          );
          this._variantSwatchOnChange = null;
        }
        this._syncVariantSwatchUi = null;
        const sizeEl = this.querySelector("[data-imprint-size]");
        const typeEl = this.querySelector("[data-imprint-text]");
        if (sizeEl && this._imprintSizeInnerTemplate != null) {
          sizeEl.innerHTML = this._imprintSizeInnerTemplate;
          sizeEl.removeAttribute("data-variant-driven");
        }
        if (typeEl && this._imprintTypeInnerTemplate != null) {
          typeEl.innerHTML = this._imprintTypeInnerTemplate;
          typeEl.removeAttribute("data-variant-driven");
        }
        return;
      }
      this.dataset.productId = String(selectedProduct.id);
      /* FIX 1: URL color wins immediately so nothing runs before applyUrlPrefill can pick it up */
      if (String(prefillColor || "").trim() !== "") {
        this.dataset.productColor = String(prefillColor).trim();
      }
      selectedProduct.variants.forEach((variant) => {
        const option = document.createElement("option");
        option.value = String(variant.id);
        option.setAttribute("data-price", String(variant.price || 0));
        option.disabled = !variant.available;
        option.textContent = variant.available
          ? variant.title
          : `${variant.title} - Unavailable`;
        variantSelector.append(option);
      });

      this.syncVariantImprintSelectors(selectedProduct);

      const firstAvailableVariant =
        selectedProduct.variants.find((variant) => variant.available) ||
        selectedProduct.variants[0];

      const ixEarly = this.resolveImprintOptionIndices(selectedProduct);
      // FIX: Only set productColor from the first variant if NO color was passed via URL
      const urlPinnedColor =
        typeof prefillColor === "string" && prefillColor.trim() !== "";
      if (firstAvailableVariant && ixEarly.colorIdx >= 0 && !urlPinnedColor) {
        const tripleEarly = this.variantOptionTriple(firstAvailableVariant);
        const col = String(tripleEarly[ixEarly.colorIdx] || "").trim();
        if (col) {
          this.dataset.productColor = col;
        }
      } else if (ixEarly.colorIdx < 0 && !urlPinnedColor) {
        delete this.dataset.productColor;
      }

      if (idField) {
        idField.value = "";
      }

      // FIX: Only pre-select first available variant if there's no URL color/variant to honour
      const hasUrlPrefillParams =
        Boolean(prefillColor) ||
        Boolean(prefillSizeFromUrl) ||
        Boolean(prefillStyleFromUrl) ||
        Boolean(prefillVariantId);

      if (!hasUrlPrefillParams && firstAvailableVariant?.id) {
        variantSelector.value = String(firstAvailableVariant.id);
      }

      renderVariantSwatches(selectedProduct);

      if (!hasUrlPrefillParams && firstAvailableVariant?.id) {
        this.syncImprintSelectsOnlyFromVariantId(
          selectedProduct,
          firstAvailableVariant.id,
        );
      }

      this.variantPriceCents = Number(firstAvailableVariant?.price || 0);
      this.updatePrice();

      // FIX: Only fire change event when not deferring to applyUrlPrefill
      if (!hasUrlPrefillParams && variantSelector?.value) {
        variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    productSelector?.addEventListener("change", () => {
      populateVariantsForProduct(productSelector.value);
      applyUrlPrefill();
      this.ensureImprintSizeDefaultToOther(Boolean(prefillSizeFromUrl));
    });

    const populateProductSelector = (products) => {
      if (!productSelector) {
        return;
      }
      productSelector.innerHTML = "";
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "Select product";
      placeholderOption.disabled = true;
      placeholderOption.selected = true;
      productSelector.append(placeholderOption);
      products.forEach((product) => {
        const option = document.createElement("option");
        option.value = String(product.id);
        option.textContent = product.title;
        productSelector.append(option);
      });
    };

    const syncVariantPickFromSelections = (
      prod,
      { dispatchVariantChange } = {},
    ) => {
      if (!variantSelector || !prod) {
        return false;
      }
      const pickCombined = this.pickVariantMatchingImprints(prod, {
        enforceUrlColorHint: String(prefillColor || "").trim() !== "",
      });
      if (pickCombined == null) {
        return false;
      }
      const ok = this._setVariantSelectorValueAllowDisabled(
        variantSelector,
        pickCombined,
      );
      if (ok && dispatchVariantChange) {
        variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return ok;
    };

    const applyUrlPrefill = () => {
      if (prefillColor) {
        this.dataset.productColor = prefillColor;
      }

      if (productSelector && prefillProductId) {
        productSelector.value = prefillProductId;
        productSelector.dispatchEvent(new Event("change", { bubbles: true }));
      }

      /** After product + variant hydrate imprint lists from Shopify options. */
      if (!String(this.dataset.productId || "").trim()) {
        return;
      }

      const applyImprintSizeFromUrlIfAny = () => {
        if (!imprintSizeSelector || !prefillSizeFromUrl) {
          return;
        }
        const imprintNorm = String(prefillSizeFromUrl || "")
          .trim()
          .replace(/\s+/g, " ");
        const imprintKey = imprintNorm.toLowerCase();
        const normLoose = (s) =>
          String(s || "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();

        const opts = [...imprintSizeSelector.options];
        const existingExact =
          opts.find((opt) => {
            const ov = normLoose(opt.value || "");
            const ot = normLoose(opt.textContent || "");
            return ov === imprintKey || ot === imprintKey;
          }) || null;
        const fuzzy =
          existingExact ||
          opts.find((opt) => {
            const v = normLoose(opt.value || "");
            if (!v || v === imprintKey) {
              return false;
            }
            return (
              this.imprintSizeStringsMatch(opt.value || "", imprintNorm) ||
              this.imprintSizeStringsMatch(opt.textContent || "", imprintNorm)
            );
          }) ||
          null;
        /**
         * List value is prefix of PDP string (merchant uses longer SKU-style names on PDP),
         * bounded so "large" doesn't hitch on "xlarge".
         */
        const prefixMatch =
          fuzzy ||
          opts.find((opt) => {
            const v = normLoose(opt.value);
            if (!v || v === imprintKey) return false;
            if (!imprintKey.startsWith(v)) return false;
            if (imprintKey.length === v.length) return true;
            var boundary = imprintKey[v.length];
            return (
              /[\s,./|(-–—:]/.test(boundary || "") ||
              imprintKey.includes(v + " ")
            );
          }) ||
          null;

        let chosenOpt = prefixMatch;
        const allowSynthetic = !imprintSizeSelector.hasAttribute(
          "data-variant-driven",
        );

        if (!chosenOpt && allowSynthetic) {
          const option = document.createElement("option");
          option.value = imprintNorm;
          option.textContent = imprintNorm;
          imprintSizeSelector.append(option);
          chosenOpt = option;
        }
        if (chosenOpt?.value != null && String(chosenOpt.value).trim()) {
          imprintSizeSelector.value = chosenOpt.value;
          imprintSizeSelector.dispatchEvent(
            new Event("change", { bubbles: true }),
          );
        }
      };

      const applyImprintStyleFromUrlIfAny = () => {
        if (!imprintTextInput || !prefillStyleFromUrl) {
          return;
        }
        const want = String(prefillStyleFromUrl || "").trim();
        if (!want) {
          return;
        }
        const wantLo = want.toLowerCase();
        const tag =
          imprintTextInput.tagName && imprintTextInput.tagName.toUpperCase();
        if (tag === "SELECT") {
          let opt = [...imprintTextInput.options].find(
            (o) =>
              String(o.value || "").toLowerCase() === wantLo ||
              this.literalOptionStringsMatch(String(o.value || ""), want) ||
              this.literalOptionStringsMatch(String(o.textContent || ""), want),
          );
          const allowSynthType = !imprintTextInput.hasAttribute(
            "data-variant-driven",
          );
          if (!opt && allowSynthType) {
            opt = document.createElement("option");
            opt.value = want;
            opt.textContent = want;
            imprintTextInput.append(opt);
          }
          if (opt?.value != null && opt.value !== "") {
            imprintTextInput.value = opt.value;
          }
        } else {
          imprintTextInput.value = want;
        }
        const tagAfter =
          imprintTextInput.tagName && imprintTextInput.tagName.toUpperCase();
        const hasVal =
          tagAfter !== "SELECT" ||
          (String(imprintTextInput.value || "").trim() !== "" &&
            imprintTextInput.selectedIndex > -1 &&
            imprintTextInput.options[imprintTextInput.selectedIndex] &&
            !imprintTextInput.options[imprintTextInput.selectedIndex].disabled);
        if (hasVal) {
          imprintTextInput.dispatchEvent(new Event("input", { bubbles: true }));
          imprintTextInput.dispatchEvent(
            new Event("change", { bubbles: true }),
          );
        }
      };

      applyImprintSizeFromUrlIfAny();
      applyImprintStyleFromUrlIfAny();

      if (prefillColor) {
        this.dataset.productColor = prefillColor;
      }

      const pidLo = String(this.dataset.productId || "").trim();
      const prod =
        pidLo && Array.isArray(productCatalog)
          ? productCatalog.find((p) => String(p?.id ?? "") === pidLo)
          : null;
      const hasUrlImprintOrColor =
        Boolean(prefillColor) ||
        Boolean(prefillSizeFromUrl) ||
        Boolean(prefillStyleFromUrl);

      if (
        variantSelector &&
        !didPrefillVariant &&
        prod &&
        hasUrlImprintOrColor
      ) {
        if (
          syncVariantPickFromSelections(prod, { dispatchVariantChange: true })
        ) {
          didPrefillVariant = true;
        }
      }

      if (variantSelector && !didPrefillVariant && prefillColor) {
        const vid = prod
          ? this.findVariantIdMatchingUrlColor(prod, prefillColor)
          : "";
        const options = [...variantSelector.options];
        let colorMatch =
          vid && options.find((opt) => String(opt.value || "") === String(vid));
        if (!colorMatch?.value) {
          colorMatch =
            options.find((opt) => {
              if (!opt.value) return false;
              const cn = this._variantColorTailFromTitle(
                String(opt.textContent || ""),
              );
              return this.literalOptionStringsMatch(cn, prefillColor);
            }) || null;
        }
        if (!colorMatch?.value) {
          colorMatch =
            options.find((opt) => {
              if (!opt.value) return false;
              return this.literalOptionStringsMatch(
                String(opt.textContent || ""),
                prefillColor,
              );
            }) || null;
        }
        if (
          colorMatch?.value &&
          this._setVariantSelectorValueAllowDisabled(
            variantSelector,
            colorMatch.value,
          )
        ) {
          variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
          didPrefillVariant = true;
        }
      }
      if (variantSelector && !didPrefillVariant && prefillVariantId) {
        if (
          this._setVariantSelectorValueAllowDisabled(
            variantSelector,
            prefillVariantId,
          )
        ) {
          variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
          didPrefillVariant = true;
        }
      }

      const urlPinsColor = String(prefillColor || "").trim() !== "";

      // FIX 3: do not overwrite URL-pinned color with first-available variant
      if (
        variantSelector &&
        !variantSelector.value &&
        !didPrefillVariant &&
        !urlPinsColor
      ) {
        const firstAvailable = [...variantSelector.options].find(
          (opt) => Boolean(opt.value) && !opt.disabled,
        );
        if (firstAvailable && firstAvailable.value) {
          const ixFb = prod
            ? this.resolveImprintOptionIndices(prod)
            : { colorIdx: -1 };
          if (typeof ixFb.colorIdx === "number" && ixFb.colorIdx >= 0) {
            const colorName = this._variantColorTailFromTitle(
              firstAvailable.textContent || "",
            );
            if (colorName) {
              this.dataset.productColor = colorName;
            }
          }
          variantSelector.value = firstAvailable.value;
          variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      if (typeof this._syncVariantSwatchUi === "function") {
        this._syncVariantSwatchUi();
      }
    };

    variantSelector?.addEventListener("change", () => {
      const selected = variantSelector.options[variantSelector.selectedIndex];
      if (!selected || !selected.value) {
        if (idField) {
          idField.value = "";
        }
        this.variantPriceCents = 0;
        this.updatePrice();
        return;
      }
      const selectedProduct = productCatalog.find(
        (p) => String(p.id) === String(this.dataset.productId),
      );
      if (selectedProduct) {
        const ixLive = this.resolveImprintOptionIndices(selectedProduct);
        const vCur = (
          Array.isArray(selectedProduct.variants)
            ? selectedProduct.variants
            : []
        ).find((vv) => String(vv?.id ?? "") === String(selected.value));
        if (vCur && ixLive.colorIdx >= 0) {
          const col = String(
            this.variantOptionTriple(vCur)[ixLive.colorIdx] || "",
          ).trim();
          if (col) {
            this.dataset.productColor = col;
          }
        }
      }
      if (selectedProduct && !this._suppressImprintVariantResolution) {
        this.syncImprintSelectsOnlyFromVariantId(
          selectedProduct,
          selected.value,
        );
      }
      if (idField) {
        idField.value = selected.value;
      }
      this.variantPriceCents = Number(selected.getAttribute("data-price") || 0);
      this.updatePrice();
    });
    imprintSizeSelector?.addEventListener("change", () => {
      this.resolveVariantFromImprintSelections();
      this.updateHiddenProperties();
    });
    imprintTextInput?.addEventListener("input", () =>
      this.updateHiddenProperties(),
    );
    imprintTextInput?.addEventListener("change", () => {
      this.resolveVariantFromImprintSelections();
      this.updateHiddenProperties();
    });

    imprintTextHelper?.addEventListener("click", () => {
      if (!imprintTextInput) {
        return;
      }
      const raw = window.prompt(
        "Enter imprint style (e.g. Full Cover Imprint).",
      );
      const requested = String(raw || "").trim();
      if (!requested) {
        return;
      }
      const tag =
        imprintTextInput.tagName && imprintTextInput.tagName.toUpperCase();
      if (tag === "SELECT") {
        let opt = [...imprintTextInput.options].find(
          (o) =>
            String(o.value || "").toLowerCase() === requested.toLowerCase(),
        );
        if (!opt) {
          opt = document.createElement("option");
          opt.value = requested;
          opt.textContent = requested;
          imprintTextInput.append(opt);
        }
        imprintTextInput.value = opt.value;
      } else {
        imprintTextInput.value = requested;
      }
      imprintTextInput.dispatchEvent(new Event("input", { bubbles: true }));
      imprintTextInput.dispatchEvent(new Event("change", { bubbles: true }));
      this.setWarning("");
    });

    variantSizeHelper?.addEventListener("click", () => {
      if (!variantSelector) {
        return;
      }
      const raw = window.prompt(
        "Enter a color to find (example: Black or Blue).",
      );
      const requested = String(raw || "").trim();
      if (!requested) {
        return;
      }
      const normalized = requested.toLowerCase();
      const options = [...variantSelector.options];
      const match = options.find((opt) => {
        const text = (opt.textContent || "").toLowerCase();
        return text.includes(normalized);
      });
      if (!match) {
        this.setWarning("No matching color found. Please pick from the list.");
        return;
      }
      variantSelector.value = match.value;
      variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
      this.setWarning("");
    });

    imprintSizeHelper?.addEventListener("click", () => {
      if (!imprintSizeSelector) {
        return;
      }
      const raw = window.prompt("Enter a custom imprint size (example: 12px).");
      const requested = String(raw || "").trim();
      if (!requested) {
        return;
      }
      const options = [...imprintSizeSelector.options];
      const existing = options.find(
        (opt) => (opt.value || "").toLowerCase() === requested.toLowerCase(),
      );
      if (existing) {
        imprintSizeSelector.value = existing.value;
      } else {
        const option = document.createElement("option");
        option.value = requested;
        option.textContent = requested;
        imprintSizeSelector.append(option);
        imprintSizeSelector.value = requested;
      }
      imprintSizeSelector.dispatchEvent(new Event("change", { bubbles: true }));
      this.setWarning("");
    });

    textInput?.addEventListener("input", () => {
      void this.syncTextFromTextareaInput();
    });
    const scheduleCaretRedraw = () => {
      requestAnimationFrame(() => this.render());
    };
    textInput?.addEventListener("keydown", scheduleCaretRedraw);
    textInput?.addEventListener("keyup", scheduleCaretRedraw);
    textInput?.addEventListener("select", scheduleCaretRedraw);
    textInput?.addEventListener("click", scheduleCaretRedraw);
    textInput?.addEventListener("focus", () => this._startCaretBlinkLoop());
    textInput?.addEventListener("blur", () => this._stopCaretBlinkLoop());

    fontInput?.addEventListener("change", () => {
      void (async () => {
        await this.ensureGoogleFontLoaded(fontInput.value);
        this.updateSelectedTextStyle();
      })();
    });
    fontSizeInput?.addEventListener("change", () =>
      this.updateSelectedTextStyle(),
    );
    textColorInput?.addEventListener("input", () => {
      this.updateSelectedTextStyle();
      this.updateColorChrome();
    });

    this.querySelector("[data-text-outline-enabled]")?.addEventListener(
      "change",
      () => this.applyTextOutlineEffectFromFormToSelection(),
    );
    this.querySelector("[data-text-outline-weight]")?.addEventListener(
      "input",
      () => this.applyTextOutlineEffectFromFormToSelection(),
    );
    const outlineWeightToggle = this.querySelector("[data-outline-weight-toggle]");
    const outlineWeightPopover = this.querySelector("[data-outline-weight-popover]");
    const setOutlineWeightPopover = (open) => {
      if (!outlineWeightToggle || !outlineWeightPopover) return;
      outlineWeightPopover.hidden = !open;
      outlineWeightToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    outlineWeightToggle?.addEventListener("click", () => {
      const isOpen = outlineWeightPopover?.hidden === false;
      const shouldOpen = !isOpen;
      setOutlineWeightPopover(shouldOpen);
    });
    this.addEventListener("click", (event) => {
      if (!outlineWeightToggle || !outlineWeightPopover || outlineWeightPopover.hidden) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        outlineWeightToggle.contains(target) ||
        outlineWeightPopover.contains(target)
      ) {
        return;
      }
      setOutlineWeightPopover(false);
    });
    this.querySelector("[data-text-outline-color]")?.addEventListener(
      "input",
      () => {
        this.updateOutlineColorChrome();
        this.applyTextOutlineEffectFromFormToSelection();
      },
    );
    this.querySelector("[data-text-effect]")?.addEventListener("change", () => {
      this.readTextOutlineEffectFromFormInto(this.textDefaults);
      const el = this.getActiveTextElementForStyleUpdate();
      if (el?.type === "text") {
        this.readTextOutlineEffectFromFormInto(el);
      }
      this.refreshTextEffectPanelVisibility();
      this.render();
      this.updateHiddenProperties();
    });
    this.querySelectorAll("[data-text-effect-radius]").forEach((input) => {
      input.addEventListener("input", () =>
        this.applyTextOutlineEffectFromFormToSelection(),
      );
    });
    this.querySelectorAll("[data-text-effect-spacing]").forEach((input) => {
      input.addEventListener("input", () =>
        this.applyTextOutlineEffectFromFormToSelection(),
      );
    });
    this.querySelectorAll("[data-text-effect-left-size]").forEach((input) => {
      input.addEventListener("input", () =>
        this.applyTextOutlineEffectFromFormToSelection(),
      );
    });
    this.querySelectorAll("[data-text-effect-right-size]").forEach((input) => {
      input.addEventListener("input", () =>
        this.applyTextOutlineEffectFromFormToSelection(),
      );
    });

    imageRights?.addEventListener("change", () =>
      this.updateHiddenProperties(),
    );

    this.canvas.addEventListener("mousedown", (event) =>
      this.handlePointerDown(event),
    );
    window.addEventListener("mousemove", (event) =>
      this.handlePointerMove(event),
    );
    window.addEventListener("mouseup", () => this.handlePointerUp());

    this.canvas.addEventListener("mousemove", (event) => {
      if (this.viewPanMode) {
        this.canvas.style.cursor = "grab";
        return;
      }
      if (this.dragState) {
        return;
      }
      const point = this.getPointer(event);
      const hit = this.hitTestTopInteraction(point.x, point.y);
      if (!hit) {
        this.canvas.style.cursor = this.currentTool === "text" ? "text" : "";
        return;
      }
      if (hit.mode === "scale") {
        this.canvas.style.cursor = "nwse-resize";
      } else if (hit.mode === "rotate") {
        this.canvas.style.cursor = "crosshair";
      } else {
        this.canvas.style.cursor = "move";
      }
    });
    this.canvas.addEventListener("mouseleave", () => {
      if (!this.dragState && !this.viewPanMode) {
        this.canvas.style.cursor = "";
      }
    });

    this.canvas.addEventListener(
      "touchstart",
      (event) => this.handlePointerDown(event),
      { passive: true },
    );
    window.addEventListener(
      "touchmove",
      (event) => this.handlePointerMove(event),
      { passive: false },
    );
    window.addEventListener("touchend", () => this.handlePointerUp());

    zoomInBtn?.addEventListener("click", () => {
      this.viewZoom = Math.min(1.4, this.viewZoom + 0.1);
      this.applyCanvasViewportTransform();
    });
    zoomOutBtn?.addEventListener("click", () => {
      this.viewZoom = Math.max(1, this.viewZoom - 0.1);
      if (this.viewZoom === 1) {
        this.viewPanX = 0;
        this.viewPanY = 0;
      }
      this.applyCanvasViewportTransform();
    });
    panBtn?.addEventListener("click", () => {
      this.viewPanMode = !this.viewPanMode;
      panBtn.classList.toggle("is-active", this.viewPanMode);
      panBtn.setAttribute("aria-pressed", this.viewPanMode ? "true" : "false");
      this.canvas.style.cursor = this.viewPanMode ? "grab" : "";
      if (!this.viewPanMode) {
        this.viewPanDrag = null;
      }
    });
    copyBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.duplicateSelectedElement()),
    );
    flipHorizontalBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.flipSelectedElement("horizontal")),
    );
    flipVerticalBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.flipSelectedElement("vertical")),
    );
    undoBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.undoLastChange()),
    );
    redoBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.redoLastChange()),
    );
    deleteBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.deleteSelectedElement()),
    );
    downloadBtns.forEach((btn) =>
      btn.addEventListener("click", () => this.downloadCanvasPng()),
    );
    loadBtns.forEach((btn) =>
      btn.addEventListener("click", () => {
        this.setActiveTool("image");
        this.toggleToolPanels("image");
        uploadInput?.click();
      }),
    );
    shareBtn?.addEventListener("click", async () => {
      const pageUrl = window.location.href;
      const copied = await this.copyTextToClipboard(pageUrl);
      this.showShareTooltip(shareBtn, copied ? "Copied" : "Copy failed");
    });

    const helpModal = sectionRoot?.querySelector(
      "[data-custom-cover-help-modal]",
    );
    const helpBtn = sectionRoot?.querySelector("[data-design-help]");
    const helpVideoFrame = helpModal?.querySelector("[data-help-video-frame]");
    const helpCloseEls = helpModal
      ? helpModal.querySelectorAll("[data-custom-cover-help-close]")
      : [];

    if (helpModal instanceof HTMLElement && helpBtn instanceof HTMLElement) {
      const embedUrl = helpModal.dataset.helpEmbedUrl?.trim() || "";

      const closeDesignHelpModal = () => {
        if (!helpModal.classList.contains("is-active")) {
          return;
        }
        helpModal.classList.remove("is-active");
        helpModal.setAttribute("aria-hidden", "true");
        document.documentElement.classList.remove(
          "custom-cover-help-modal-open",
        );
        if (helpVideoFrame instanceof HTMLIFrameElement) {
          helpVideoFrame.src = "";
        }
        helpBtn.setAttribute("aria-expanded", "false");
        if (helpBtn.isConnected) {
          helpBtn.focus({ preventScroll: true });
        }
      };

      const openDesignHelpModal = () => {
        helpModal.classList.add("is-active");
        helpModal.setAttribute("aria-hidden", "false");
        document.documentElement.classList.add("custom-cover-help-modal-open");
        helpBtn.setAttribute("aria-expanded", "true");
        if (helpVideoFrame instanceof HTMLIFrameElement && embedUrl) {
          helpVideoFrame.src = embedUrl;
        }
        const closeControl = helpModal.querySelector(
          ".custom-cover-help-modal__close",
        );
        if (closeControl instanceof HTMLElement) {
          closeControl.focus({ preventScroll: true });
        }
      };

      const openHandler = () => openDesignHelpModal();
      const closeHandler = () => closeDesignHelpModal();

      helpBtn.addEventListener("click", openHandler);
      helpCloseEls.forEach((el) => {
        el.addEventListener("click", closeHandler);
      });

      if (this._onDesignHelpEscape) {
        window.removeEventListener("keydown", this._onDesignHelpEscape);
      }
      this._onDesignHelpEscape = (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (!helpModal.classList.contains("is-active")) {
          return;
        }
        event.preventDefault();
        closeDesignHelpModal();
      };
      window.addEventListener("keydown", this._onDesignHelpEscape);

      this._designHelpCleanup = () => {
        const escapeHandler = this._onDesignHelpEscape;
        if (escapeHandler) {
          window.removeEventListener("keydown", escapeHandler);
          this._onDesignHelpEscape = null;
        }
        closeDesignHelpModal();
        helpBtn.removeEventListener("click", openHandler);
        helpCloseEls.forEach((el) => {
          el.removeEventListener("click", closeHandler);
        });
        this._designHelpCleanup = null;
      };
    } else {
      this._designHelpCleanup = null;
    }

    saveDraftBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        void this.saveCurrentAsDraft();
      });
    });

    const designOverflow = sectionRoot?.querySelector(
      ".custom-cover-customizer__design-overflow",
    );
    const designOverflowBody = designOverflow?.querySelector(
      ".custom-cover-customizer__design-overflow-body",
    );
    designOverflowBody?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("button, a[href]")) {
        /* Defer so submit / default actions finish before the panel hides */
        queueMicrotask(() => designOverflow?.removeAttribute("open"));
      }
    });

    if (this._onDesignOverflowOutsidePointerDown) {
      document.removeEventListener(
        "pointerdown",
        this._onDesignOverflowOutsidePointerDown,
        true,
      );
    }
    this._onDesignOverflowOutsidePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (!designOverflow?.hasAttribute("open")) {
        return;
      }
      if (designOverflow.contains(target)) {
        return;
      }
      designOverflow.removeAttribute("open");
    };
    document.addEventListener(
      "pointerdown",
      this._onDesignOverflowOutsidePointerDown,
      true,
    );
    draftsList?.addEventListener("click", (event) => {
      const deleteDraftBtn = event.target.closest("[data-draft-delete-id]");
      if (deleteDraftBtn) {
        const id = deleteDraftBtn.getAttribute("data-draft-delete-id");
        if (id) {
          void this.deleteDraftById(id);
        }
        return;
      }
      const draftCard = event.target.closest("[data-draft-item-id]");
      if (draftCard) {
        const id = draftCard.getAttribute("data-draft-item-id");
        if (id) {
          this.loadDraftById(id);
        }
      }
    });
    draftsList?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const draftCard = event.target.closest("[data-draft-item-id]");
      if (!draftCard) {
        return;
      }
      event.preventDefault();
      const id = draftCard.getAttribute("data-draft-item-id");
      if (id) {
        this.loadDraftById(id);
      }
    });

    this.form.addEventListener("submit", (event) => this.handleSubmit(event));
    if (this._onDesignKeydown) {
      window.removeEventListener("keydown", this._onDesignKeydown);
    }
    this._onDesignKeydown = (event) => this.handleDesignKeydown(event);
    window.addEventListener("keydown", this._onDesignKeydown);
    if (this._onOutsideCanvasPointerDown) {
      window.removeEventListener("mousedown", this._onOutsideCanvasPointerDown);
      window.removeEventListener(
        "touchstart",
        this._onOutsideCanvasPointerDown,
      );
    }
    this._onOutsideCanvasPointerDown = (event) =>
      this.handleOutsideCanvasPointerDown(event);
    window.addEventListener("mousedown", this._onOutsideCanvasPointerDown);
    window.addEventListener("touchstart", this._onOutsideCanvasPointerDown, {
      passive: true,
    });

    this.setActiveTool("text");
    this.toggleToolPanels("text");
    setMode("editor");
    if (productCatalog.length === 0) {
      void this.fetchProductCatalogFromStorefront().then((fallbackProducts) => {
        if (!fallbackProducts.length) {
          this.setWarning(
            "No products found. Make sure products are active and available on Online Store sales channel.",
          );
          return;
        }
        productCatalog = fallbackProducts;
        populateProductSelector(productCatalog);
        applyUrlPrefill();
        this.ensureImprintSizeDefaultToOther(Boolean(prefillSizeFromUrl));
      });
    }
    populateVariantsForProduct(productSelector?.value || "");
    applyUrlPrefill();
    this.ensureImprintSizeDefaultToOther(Boolean(prefillSizeFromUrl));
    this.syncFormatToolbars();
    this.syncAlignmentControls(this.textDefaults.textAlign);
    this.updateColorChrome();
    this.renderDraftsList();
    if (draftsEmpty) {
      draftsEmpty.hidden = this.drafts.length > 0;
    }
    if (draftsNotice) {
      draftsNotice.hidden = true;
    }
    void this.initializeDrafts();
  }

  async copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        // Fall through to legacy copy method.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  showShareTooltip(button, message) {
    if (!button) {
      return;
    }
    const defaultTooltip =
      button.getAttribute("data-tooltip-default") ||
      button.getAttribute("aria-label") ||
      "";
    button.setAttribute("data-tooltip", message);
    button.classList.add("is-tooltip-visible");
    if (this._shareTooltipTimer) {
      clearTimeout(this._shareTooltipTimer);
    }
    this._shareTooltipTimer = window.setTimeout(() => {
      button.classList.remove("is-tooltip-visible");
      if (defaultTooltip) {
        button.setAttribute("data-tooltip", defaultTooltip);
      } else {
        button.removeAttribute("data-tooltip");
      }
      this._shareTooltipTimer = null;
    }, 1600);
  }

  readProductCatalog() {
    const source = this.querySelector("[data-product-catalog]");
    if (!source) {
      return [];
    }
    try {
      const parsed = JSON.parse(source.textContent || "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((product) => ({
          id: product?.id,
          title: String(product?.title || "").trim(),
          optionNames: Array.isArray(product?.optionNames)
            ? product.optionNames
                .map((n) => String(n == null ? "" : n).trim())
                .filter(Boolean)
            : [],
          variants: Array.isArray(product?.variants)
            ? product.variants.map((variant) => ({
                id: variant?.id,
                title: String(variant?.title || "").trim(),
                price: Number(variant?.price || 0),
                available: Boolean(variant?.available),
                option1:
                  variant?.option1 != null
                    ? String(variant.option1).trim()
                    : "",
                option2:
                  variant?.option2 != null
                    ? String(variant.option2).trim()
                    : "",
                option3:
                  variant?.option3 != null
                    ? String(variant.option3).trim()
                    : "",
              }))
            : [],
        }))
        .filter(
          (product) =>
            product.id &&
            product.title &&
            Array.isArray(product.variants) &&
            product.variants.length > 0,
        );
    } catch (error) {
      return [];
    }
  }

  async fetchProductCatalogFromStorefront() {
    try {
      const response = await fetch("/products.json?limit=250", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const products = Array.isArray(data?.products) ? data.products : [];
      return products
        .map((product) => ({
          id: product?.id,
          title: String(product?.title || "").trim(),
          optionNames: Array.isArray(product?.options)
            ? product.options
                .map((o) =>
                  typeof o === "string"
                    ? o.trim()
                    : String(o?.name || "").trim(),
                )
                .filter(Boolean)
            : [],
          variants: Array.isArray(product?.variants)
            ? product.variants.map((variant) => ({
                id: variant?.id,
                title: String(variant?.title || "").trim(),
                price: Number(variant?.price || 0),
                available:
                  variant?.available !== false &&
                  variant?.inventory_quantity !== 0,
                option1:
                  variant?.option1 != null
                    ? String(variant.option1).trim()
                    : "",
                option2:
                  variant?.option2 != null
                    ? String(variant.option2).trim()
                    : "",
                option3:
                  variant?.option3 != null
                    ? String(variant.option3).trim()
                    : "",
              }))
            : [],
        }))
        .filter(
          (product) =>
            product.id &&
            product.title &&
            Array.isArray(product.variants) &&
            product.variants.length > 0,
        );
    } catch (error) {
      return [];
    }
  }

  updateColorChrome() {
    const input = this.querySelector("[data-text-color-input]");
    const hexEl = this.querySelector("[data-color-hex]");
    const swatch = this.querySelector("[data-color-swatch]");
    let v = (input?.value || "#000000").trim();
    if (!v.startsWith("#")) {
      v = `#${v}`;
    }
    if (hexEl) {
      hexEl.textContent = v.toUpperCase();
    }
    if (swatch) {
      swatch.style.backgroundColor = v;
    }
  }

  updateShapeFillChrome() {
    const input = this.querySelector("[data-shape-fill-input]");
    const hexEl = this.querySelector("[data-shape-fill-hex]");
    const swatch = this.querySelector("[data-shape-fill-swatch]");
    let v = (input?.value || "#000000").trim();
    if (!v.startsWith("#")) {
      v = `#${v}`;
    }
    if (hexEl) {
      hexEl.textContent = v.toUpperCase();
    }
    if (swatch) {
      swatch.style.backgroundColor = v;
    }
  }

  updateShapeOutlineColorChrome() {
    const input = this.querySelector("[data-shape-outline-color-input]");
    const hexEl = this.querySelector("[data-shape-outline-color-hex]");
    const swatch = this.querySelector("[data-shape-outline-color-swatch]");
    let v = (input?.value || "#000000").trim();
    if (!v.startsWith("#")) {
      v = `#${v}`;
    }
    if (hexEl) {
      hexEl.textContent = v.toUpperCase();
    }
    if (swatch) {
      swatch.style.backgroundColor = v;
    }
  }

  ensureShapeElementOutline(element) {
    if (!element || element.type !== "shape") {
      return;
    }
    const variant = String(element.shapeVariant || "").trim().toLowerCase();
    const defaultEnabled = variant === "outline";
    if (typeof element.strokeEnabled !== "boolean") {
      element.strokeEnabled = defaultEnabled;
    }
    const parsedStrokeWidth = Math.round(Number(element.strokeWidth));
    element.strokeWidth = Math.min(
      20,
      Math.max(0, Number.isFinite(parsedStrokeWidth) ? parsedStrokeWidth : 3),
    );
    let strokeColor = String(element.strokeColor || "").trim();
    if (!strokeColor) {
      strokeColor = "#000000";
    }
    if (!strokeColor.startsWith("#")) {
      strokeColor = `#${strokeColor}`;
    }
    element.strokeColor = strokeColor;
  }

  readShapeOutlineFromForm() {
    const strokeEnabledInput = this.querySelector("[data-shape-outline-enabled]");
    const strokeWidthInput = this.querySelector("[data-shape-outline-width-input]");
    const strokeColorInput = this.querySelector("[data-shape-outline-color-input]");
    let strokeColor = String(strokeColorInput?.value || "#000000").trim();
    if (!strokeColor.startsWith("#")) {
      strokeColor = `#${strokeColor}`;
    }
    const parsedStrokeWidth = Math.round(Number(strokeWidthInput?.value));
    const strokeWidth = Math.min(
      20,
      Math.max(0, Number.isFinite(parsedStrokeWidth) ? parsedStrokeWidth : 3),
    );
    return {
      strokeEnabled: strokeEnabledInput
        ? Boolean(strokeEnabledInput.checked)
        : true,
      strokeWidth,
      strokeColor,
    };
  }

  applyShapeOutlineFromFormToSelection() {
    const selected = this.getSelectedElement();
    const shapeOutline = this.readShapeOutlineFromForm();
    if (selected?.type === "shape") {
      selected.strokeEnabled = shapeOutline.strokeEnabled;
      selected.strokeWidth = shapeOutline.strokeWidth;
      selected.strokeColor = shapeOutline.strokeColor;
      this.ensureShapeElementOutline(selected);
      this.render();
      this.updateHiddenProperties();
    }
  }

  handleDesignKeydown(event) {
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable)
    ) {
      return;
    }
    if (!this.selectedElementId) {
      return;
    }
    event.preventDefault();
    this.pushHistorySnapshot();
    this.removeElementById(this.selectedElementId);
  }

  seedVariantPrice() {
    const selector = this.querySelector("[data-variant-selector]");
    if (!selector) {
      return;
    }
    const selected = selector.options[selector.selectedIndex];
    this.variantPriceCents = Number(selected?.getAttribute("data-price") || 0);
  }

  handleUpload(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.handleUploadFile(file);
    input.value = "";
  }

  handleUploadFile(file) {
    const mime = String(file.type || "").toLowerCase();
    if (mime && !mime.startsWith("image/")) {
      this.setWarning("Please upload an image file.");
      return;
    }

    const maxBytes = Number(this.dataset.maxUploadBytes || 0);
    const maxMb = Number(this.dataset.maxUploadMb || 0);
    if (maxBytes > 0 && file.size > maxBytes) {
      this.setWarning(
        maxMb > 0
          ? `This file is too large. Maximum upload size is ${maxMb} MB.`
          : this.dataset.uploadWarning || "This file is too large to upload.",
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }
      this.addImageElement(reader.result, "image");
    };
    reader.readAsDataURL(file);
  }

  sanitizeFilename(value) {
    const cleaned = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return cleaned || "design";
  }

  downloadCanvasPng() {
    if (!this.canvas) {
      return;
    }
    const sectionRoot = this.closest(".custom-cover-customizer");
    const designTitleInput = sectionRoot?.querySelector(
      "[data-design-title-input]",
    );
    const fileName = `${this.sanitizeFilename(designTitleInput?.value)}.png`;
    const pngDataUrl = this.canvas.toDataURL("image/png");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngDataUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
  }

  createCartPreviewDataUrl() {
    if (!this.canvas) {
      return "";
    }
    // Keep preview payload compact so line item properties are less likely
    // to be truncated before they reach cart/order surfaces.
    const maxChars = 12000;
    const maxSide = 320;
    const srcW = this.canvas.width;
    const srcH = this.canvas.height;
    if (!srcW || !srcH) {
      return "";
    }
    const previewCanvas = document.createElement("canvas");
    const previewCtx = previewCanvas.getContext("2d");
    if (!previewCtx) {
      return this.canvas.toDataURL("image/png");
    }

    const renderAt = (side, quality) => {
      const ratio = Math.min(side / srcW, side / srcH, 1);
      const outW = Math.max(1, Math.round(srcW * ratio));
      const outH = Math.max(1, Math.round(srcH * ratio));
      previewCanvas.width = outW;
      previewCanvas.height = outH;
      previewCtx.clearRect(0, 0, outW, outH);
      previewCtx.fillStyle = "#ffffff";
      previewCtx.fillRect(0, 0, outW, outH);
      previewCtx.drawImage(this.canvas, 0, 0, outW, outH);
      return previewCanvas.toDataURL("image/jpeg", quality);
    };

    let candidate = renderAt(maxSide, 0.85);
    if (candidate.length <= maxChars) {
      return candidate;
    }

    const qualitySteps = [0.7, 0.6, 0.5, 0.4];
    for (let i = 0; i < qualitySteps.length; i += 1) {
      candidate = renderAt(maxSide, qualitySteps[i]);
      if (candidate.length <= maxChars) {
        return candidate;
      }
    }

    const sideSteps = [280, 240, 220, 200, 180];
    for (let i = 0; i < sideSteps.length; i += 1) {
      candidate = renderAt(sideSteps[i], 0.55);
      if (candidate.length <= maxChars) {
        return candidate;
      }
    }

    return renderAt(220, 0.45);
  }

  getPreviewStorageKey() {
    const productId = this.dataset.productId || "unknown-product";
    return `custom-cover-preview:v${CUSTOMIZER_PREVIEW_STORAGE_VERSION}:${productId}`;
  }

  ensurePreviewToken() {
    if (this.previewToken) {
      return this.previewToken;
    }
    this.previewToken = `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return this.previewToken;
  }

  savePreviewByToken(token, previewDataUrl) {
    if (!token || !previewDataUrl) {
      return;
    }
    try {
      const storageKey = this.getPreviewStorageKey();
      const raw = window.localStorage.getItem(storageKey);
      const index = raw ? JSON.parse(raw) : {};
      const next = typeof index === "object" && index ? index : {};
      next[token] = {
        image: previewDataUrl,
        updatedAt: Date.now(),
      };
      const keys = Object.keys(next);
      if (keys.length > 30) {
        keys
          .sort(
            (a, b) =>
              Number(next[b]?.updatedAt || 0) - Number(next[a]?.updatedAt || 0),
          )
          .slice(30)
          .forEach((key) => {
            delete next[key];
          });
      }
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (error) {
      // Ignore preview cache failures and continue form submission.
    }
  }

  populateShapePickerGrid() {
    void this.populateShapePickerGridAsync();
  }

  async ensureShapeLibrary() {
    if (this._shapeLibrary) {
      return;
    }
    if (this._shapeLibraryPromise) {
      await this._shapeLibraryPromise;
      return;
    }
    this._shapeLibraryPromise = (async () => {
      try {
        this._shapeLibrary = await resolveFullShapeLibrary();
      } catch (error) {
        console.warn("Custom cover shapes: Iconify load failed", error);
        this.setWarning(
          "Could not load the online shape library. Basic shapes are still available.",
        );
        this._shapeLibrary = [...BUILTIN_SHAPES];
      }
      this._shapeById = new Map(this._shapeLibrary.map((def) => [def.id, def]));
    })();
    await this._shapeLibraryPromise;
  }

  /**
   * @param {object} def
   * @returns {HTMLButtonElement}
   */
  createShapeChoiceButton(def) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-cover-customizer__shape-choice";
    btn.dataset.shapeId = def.id;
    const ariaLabel =
      def.kind === "builtin" || !def.variant
        ? def.label
        : `${def.label}, ${def.variant}`;
    btn.setAttribute("aria-label", ariaLabel);
    const thumb = document.createElement("span");
    thumb.className = "custom-cover-customizer__shape-thumb-wrap";
    thumb.setAttribute("aria-hidden", "true");
    if (def.kind === "builtin") {
      const span = document.createElement("span");
      span.className =
        "custom-cover-customizer__shape-thumb custom-cover-customizer__shape-thumb--" +
        def.builtin;
      thumb.appendChild(span);
    } else {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const vb = def.viewBox || 24;
      svg.setAttribute("viewBox", `0 0 ${vb} ${vb}`);
      svg.setAttribute("class", "custom-cover-customizer__shape-thumb-svg");
      svg.setAttribute("width", "40");
      svg.setAttribute("height", "40");
      for (const pathD of def.paths || []) {
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", pathD);
        path.setAttribute("fill", "currentColor");
        svg.appendChild(path);
      }
      thumb.appendChild(svg);
    }
    const lab = document.createElement("span");
    lab.className = "custom-cover-customizer__shape-choice-label";
    lab.textContent = def.label;
    btn.append(thumb, lab);
    return btn;
  }

  /**
   * @param {string} headingText
   * @param {object[]} defs
   * @param {'outline' | 'filled'} variant
   * @returns {HTMLElement}
   */
  buildPaginatedVariantSection(headingText, defs, variant) {
    const wrap = document.createElement("div");
    wrap.className = "custom-cover-customizer__shapes-variant-group";

    const h = document.createElement("h3");
    h.className = "custom-cover-customizer__shapes-variant-heading";
    h.textContent = headingText;

    const grid = document.createElement("div");
    grid.className = "custom-cover-customizer__shapes-grid";
    grid.dataset.shapeVariantGrid = variant;

    const footer = document.createElement("div");
    footer.className = "custom-cover-customizer__shapes-variant-footer";

    const showMore = document.createElement("button");
    showMore.type = "button";
    showMore.className = "custom-cover-customizer__shapes-show-more";
    showMore.dataset.shapesShowMore = variant;
    showMore.textContent = "Show more";
    showMore.setAttribute(
      "aria-label",
      variant === "outline"
        ? "Show more outline shapes"
        : "Show more filled shapes",
    );

    const visibleKey =
      variant === "outline" ? "_outlineVisibleCount" : "_filledVisibleCount";

    const renderSlice = () => {
      const cap = this[visibleKey];
      const n = Math.min(cap, defs.length);
      grid.replaceChildren();
      for (let i = 0; i < n; i += 1) {
        grid.appendChild(this.createShapeChoiceButton(defs[i]));
      }
      showMore.hidden = n >= defs.length || defs.length === 0;
    };

    this[visibleKey] = SHAPES_PAGE_SIZE;
    renderSlice();

    showMore.addEventListener("click", () => {
      this[visibleKey] = Math.min(
        this[visibleKey] + SHAPES_PAGE_SIZE,
        defs.length,
      );
      renderSlice();
    });

    if (defs.length === 0) {
      h.hidden = true;
      grid.hidden = true;
      footer.hidden = true;
      showMore.hidden = true;
    }

    footer.appendChild(showMore);
    wrap.append(h, grid, footer);
    return wrap;
  }

  async populateShapePickerGridAsync() {
    const root = this.querySelector("[data-shapes-root]");
    if (!root || root.dataset.populated === "true") {
      return;
    }
    if (this._shapeGridPopulateLock) {
      await this._shapeGridPopulateLock;
      return;
    }
    this._shapeGridPopulateLock = (async () => {
      root.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "custom-cover-customizer__shapes-loading";
      loading.setAttribute("role", "status");
      loading.textContent = "Loading shapes…";
      root.appendChild(loading);
      await this.ensureShapeLibrary();
      loading.remove();
      if (root.dataset.populated === "true") {
        return;
      }

      const basicWrap = document.createElement("div");
      basicWrap.className = "custom-cover-customizer__shapes-basic-wrap";
      const basicLabel = document.createElement("p");
      basicLabel.className = "custom-cover-customizer__label";
      basicLabel.textContent = "Basic shapes";
      const basicGrid = document.createElement("div");
      basicGrid.className =
        "custom-cover-customizer__shapes-grid custom-cover-customizer__shapes-basic";
      for (const def of BUILTIN_SHAPES) {
        basicGrid.appendChild(this.createShapeChoiceButton(def));
      }
      basicWrap.append(basicLabel, basicGrid);
      root.appendChild(basicWrap);

      const lib = this._shapeLibrary || [];
      const outlineDefs = lib.filter((d) => d.variant === "outline");
      const filledDefs = lib.filter((d) => d.variant === "filled");

      if (outlineDefs.length > 0) {
        root.appendChild(
          this.buildPaginatedVariantSection("Outline", outlineDefs, "outline"),
        );
      }
      if (filledDefs.length > 0) {
        root.appendChild(
          this.buildPaginatedVariantSection("Filled", filledDefs, "filled"),
        );
      }

      root.dataset.populated = "true";
    })();
    try {
      await this._shapeGridPopulateLock;
    } finally {
      this._shapeGridPopulateLock = null;
    }
  }

  /**
   * @param {string} shapeId registry id (built-in or Iconify-backed)
   */
  addShapeElement(shapeId) {
    const def = this._shapeById.get(shapeId);
    if (!def) {
      return;
    }
    const fillInput = this.querySelector("[data-shape-fill-input]");
    let fill = (fillInput?.value || "#333333").trim();
    if (!fill.startsWith("#")) {
      fill = `#${fill}`;
    }
    const width = def.defaultW;
    const height = def.defaultH;
    const shapeOutlineDefaults = this.readShapeOutlineFromForm();
    const isOutlineShape = String(def.variant || "").toLowerCase() === "outline";

    const element = {
      id: crypto.randomUUID(),
      type: "shape",
      shapeId: def.id,
      fill,
      x: this.canvas.width / 2 - width / 2,
      y: this.canvas.height / 2 - height / 2,
      width,
      height,
      scale: 1,
      flipX: 1,
      flipY: 1,
      rotation: 0,
      strokeEnabled: isOutlineShape || shapeOutlineDefaults.strokeEnabled,
      strokeWidth: shapeOutlineDefaults.strokeWidth,
      strokeColor: shapeOutlineDefaults.strokeColor,
    };

    if (def.kind === "path" && def.paths?.length) {
      element.viewBox = def.viewBox || 24;
      element.paths = [...def.paths];
      element.fillRule = def.fillRule || "nonzero";
    }
    if (def.iconify) {
      element.iconifyCollection = def.iconify.collection;
      element.iconifyIcon = def.iconify.icon;
    }
    if (def.variant) {
      element.shapeVariant = def.variant;
    }
    this.ensureShapeElementOutline(element);

    this.pushHistorySnapshot();
    this.elements.push(element);
    this.selectedElementId = element.id;
    this.setActiveTool("shapes");
    this.toggleToolPanels("shapes");
    this.syncControlInputs();
    this.render();
    this.updatePrice();
  }

  /**
   * @param {object} element
   */
  drawShapeToContext(element) {
    const w = element.width;
    const h = element.height;
    this.ensureShapeElementOutline(element);
    this.ctx.fillStyle = element.fill || "#333333";
    this.ctx.strokeStyle = element.strokeColor || "#000000";
    this.ctx.lineWidth = Number(element.strokeWidth) || 1;
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    const shouldStroke =
      Boolean(element.strokeEnabled) && Number(element.strokeWidth) > 0;
    const shouldFill = String(element.shapeVariant || "").toLowerCase() !== "outline";

    if (element.paths?.length) {
      const vb = element.viewBox || 24;
      const rule = element.fillRule || "nonzero";
      this.ctx.scale(w / vb, h / vb);
      for (const d of element.paths) {
        const p = new Path2D(d);
        if (shouldFill) {
          this.ctx.fill(p, rule);
        }
        if (shouldStroke) {
          this.ctx.stroke(p);
        }
      }
      return;
    }

    const def = element.shapeId ? this._shapeById.get(element.shapeId) : null;

    if (def?.kind === "builtin") {
      const b = def.builtin;
      if (b === "rectangle") {
        if (shouldFill) {
          this.ctx.fillRect(0, 0, w, h);
        }
        if (shouldStroke) {
          this.ctx.strokeRect(0, 0, w, h);
        }
      } else if (b === "ellipse") {
        this.ctx.beginPath();
        this.ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (shouldFill) {
          this.ctx.fill();
        }
        if (shouldStroke) {
          this.ctx.stroke();
        }
      } else if (b === "triangle") {
        this.ctx.beginPath();
        this.ctx.moveTo(w / 2, 0);
        this.ctx.lineTo(w, h);
        this.ctx.lineTo(0, h);
        this.ctx.closePath();
        if (shouldFill) {
          this.ctx.fill();
        }
        if (shouldStroke) {
          this.ctx.stroke();
        }
      } else {
        if (shouldFill) {
          this.ctx.fillRect(0, 0, w, h);
        }
        if (shouldStroke) {
          this.ctx.strokeRect(0, 0, w, h);
        }
      }
      return;
    }

    if (def?.kind === "path" && def.paths?.length) {
      const vb = def.viewBox || 24;
      this.ctx.scale(w / vb, h / vb);
      const rule = def.fillRule || "nonzero";
      for (const d of def.paths) {
        const p = new Path2D(d);
        if (shouldFill) {
          this.ctx.fill(p, rule);
        }
        if (shouldStroke) {
          this.ctx.stroke(p);
        }
      }
      return;
    }

    const kind = element.shapeKind || "rectangle";
    if (kind === "rectangle") {
      if (shouldFill) {
        this.ctx.fillRect(0, 0, w, h);
      }
      if (shouldStroke) {
        this.ctx.strokeRect(0, 0, w, h);
      }
    } else if (kind === "ellipse") {
      this.ctx.beginPath();
      this.ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (shouldFill) {
        this.ctx.fill();
      }
      if (shouldStroke) {
        this.ctx.stroke();
      }
    } else if (kind === "triangle") {
      this.ctx.beginPath();
      this.ctx.moveTo(w / 2, 0);
      this.ctx.lineTo(w, h);
      this.ctx.lineTo(0, h);
      this.ctx.closePath();
      if (shouldFill) {
        this.ctx.fill();
      }
      if (shouldStroke) {
        this.ctx.stroke();
      }
    } else {
      if (shouldFill) {
        this.ctx.fillRect(0, 0, w, h);
      }
      if (shouldStroke) {
        this.ctx.strokeRect(0, 0, w, h);
      }
    }
  }

  addImageElement(src, type) {
    const img = new Image();
    img.onload = () => {
      const maxWidth = this.canvas.width * 0.4;
      const maxHeight = this.canvas.height * 0.4;
      const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);

      const element = {
        id: crypto.randomUUID(),
        type,
        src,
        image: img,
        x: this.canvas.width / 2,
        y: this.canvas.height / 2,
        width: img.width * ratio,
        height: img.height * ratio,
        scale: 1,
        flipX: 1,
        flipY: 1,
        rotation: 0,
      };

      this.pushHistorySnapshot();
      this.elements.push(element);
      this.selectedElementId = element.id;
      this.setActiveTool("image");
      this.toggleToolPanels("image");
      this.syncControlInputs();
      this.render();
      this.updatePrice();
    };
    img.src = src;
  }

  focusDesignSurface() {
    if (!this.canvas) {
      return;
    }
    const section = this.closest(".custom-cover-customizer");
    const active = document.activeElement;
    if (
      !section ||
      !active ||
      !section.contains(active) ||
      active === this.canvas
    ) {
      return;
    }
    try {
      this.canvas.focus({ preventScroll: true });
    } catch {
      this.canvas.focus();
    }
  }

  handlePointerDown(event) {
    if (this.viewPanMode) {
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      const clientX = touch ? touch.clientX : event.clientX;
      const clientY = touch ? touch.clientY : event.clientY;
      this.viewPanDrag = {
        startX: clientX,
        startY: clientY,
        panX: this.viewPanX,
        panY: this.viewPanY,
      };
      if (this.canvas) {
        this.canvas.style.cursor = "grabbing";
      }
      return;
    }

    const isPrimaryPointer =
      event.type === "touchstart" ||
      (event.type === "mousedown" && event.button === 0);

    const point = this.getPointer(event);
    const hit = this.hitTestTopInteraction(point.x, point.y);

    if (!hit && this.currentTool === "text" && isPrimaryPointer) {
      void this.placeNewTextAtCanvasPoint(point.x, point.y);
      return;
    }

    if (isPrimaryPointer) {
      this.focusDesignSurface();
    }

    if (!hit) {
      this.selectedElementId = null;
      this.dragState = null;
      this.render();
      this.syncControlInputs();
      return;
    }

    const { element: el, mode } = hit;
    this.selectedElementId = el.id;
    if (el.type === "text") {
      this.ensureTextElementOutlineAndEffect(el);
      Object.assign(this.textDefaults, {
        textAlign: el.textAlign || "left",
        fontWeight: el.fontWeight || "normal",
        fontStyle: el.fontStyle || "normal",
        underline: Boolean(el.underline),
        strikethrough: Boolean(el.strikethrough),
        outlineEnabled: Boolean(el.outlineEnabled),
        outlineWidth: el.outlineWidth,
        outlineColor: el.outlineColor,
        textEffect: el.textEffect,
        curveRadius: el.curveRadius,
        curveSpacing: el.curveSpacing,
        arcRadius: el.arcRadius,
        arcSpacing: el.arcSpacing,
        stlLeft: el.stlLeft,
        stlRight: el.stlRight,
        ltsLeft: el.ltsLeft,
        ltsRight: el.ltsRight,
        bulgeLeft: el.bulgeLeft,
        bulgeRight: el.bulgeRight,
      });
    }

    const local = this.canvasToLocal(point.x, point.y, el);
    if (mode === "move") {
      this.pendingHistorySnapshot = this.createHistorySnapshot();
      this.dragState = {
        mode: "move",
        elementId: el.id,
        offsetX: point.x - el.x,
        offsetY: point.y - el.y,
      };
    } else if (mode === "scale") {
      this.pendingHistorySnapshot = this.createHistorySnapshot();
      const center = this.localToCanvas(el.width / 2, el.height / 2, el);
      const startDist = Math.max(
        8,
        Math.hypot(point.x - center.x, point.y - center.y),
      );
      this.dragState = {
        mode: "scale",
        elementId: el.id,
        startScale: el.scale || 1,
        startDist,
        startFontSize: Number(el.fontSize) || 24,
      };
    } else if (mode === "rotate") {
      this.pendingHistorySnapshot = this.createHistorySnapshot();
      const center = this.localToCanvas(el.width / 2, el.height / 2, el);
      this.dragState = {
        mode: "rotate",
        elementId: el.id,
        startPointerAngle: Math.atan2(point.y - center.y, point.x - center.x),
        startRotation: el.rotation || 0,
      };
    }

    this.syncControlInputs();
    this.render();
  }

  handlePointerMove(event) {
    if (this.viewPanMode && this.viewPanDrag) {
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      const clientX = touch ? touch.clientX : event.clientX;
      const clientY = touch ? touch.clientY : event.clientY;
      this.viewPanX =
        this.viewPanDrag.panX + (clientX - this.viewPanDrag.startX);
      this.viewPanY =
        this.viewPanDrag.panY + (clientY - this.viewPanDrag.startY);
      this.applyCanvasViewportTransform();
      return;
    }

    if (!this.dragState) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const point = this.getPointer(event);
    const element = this.elements.find(
      (item) => item.id === this.dragState.elementId,
    );
    if (!element) {
      return;
    }

    if (this.canvas && this.dragState.mode === "scale") {
      this.canvas.style.cursor = "nwse-resize";
    } else if (this.canvas && this.dragState.mode === "rotate") {
      this.canvas.style.cursor = "crosshair";
    } else if (this.canvas && this.dragState.mode === "move") {
      this.canvas.style.cursor = "move";
    }

    if (this.dragState.mode === "move") {
      element.x = point.x - this.dragState.offsetX;
      element.y = point.y - this.dragState.offsetY;
    } else if (this.dragState.mode === "scale") {
      const center = this.localToCanvas(
        element.width / 2,
        element.height / 2,
        element,
      );
      const nowDist = Math.max(
        8,
        Math.hypot(point.x - center.x, point.y - center.y),
      );
      const ratio = nowDist / this.dragState.startDist;
      element.scale = Math.min(
        4,
        Math.max(0.15, this.dragState.startScale * ratio),
      );
    } else if (this.dragState.mode === "rotate") {
      const center = this.localToCanvas(
        element.width / 2,
        element.height / 2,
        element,
      );
      const curAngle = Math.atan2(point.y - center.y, point.x - center.x);
      const deltaDeg =
        ((curAngle - this.dragState.startPointerAngle) * 180) / Math.PI;
      element.rotation = this.dragState.startRotation + deltaDeg;
    }

    this.render();
    this.updateHiddenProperties();
  }

  getHandleThresholdLocal(element) {
    return CUSTOMIZER_HANDLE_RADIUS_PX / Math.max(0.01, element.scale || 1);
  }

  getRotateHandleThresholdLocal(element) {
    return (
      CUSTOMIZER_ROT_HANDLE_HIT_RADIUS_PX / Math.max(0.01, element.scale || 1)
    );
  }

  canvasToLocal(wx, wy, el) {
    const centerX = (el.width || 0) / 2;
    const centerY = (el.height || 0) / 2;
    const dx = wx - (el.x + centerX);
    const dy = wy - (el.y + centerY);
    const rad = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const s = el.scale || 1;
    const flipX = Number(el.flipX) === -1 ? -1 : 1;
    const flipY = Number(el.flipY) === -1 ? -1 : 1;
    return {
      x: (dx * cos + dy * sin) / (s * flipX) + centerX,
      y: (-dx * sin + dy * cos) / (s * flipY) + centerY,
    };
  }

  localToCanvas(lx, ly, el) {
    const centerX = (el.width || 0) / 2;
    const centerY = (el.height || 0) / 2;
    const rad = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const s = el.scale || 1;
    const flipX = Number(el.flipX) === -1 ? -1 : 1;
    const flipY = Number(el.flipY) === -1 ? -1 : 1;
    const sx = (lx - centerX) * s * flipX;
    const sy = (ly - centerY) * s * flipY;
    return {
      x: el.x + centerX + sx * cos - sy * sin,
      y: el.y + centerY + sx * sin + sy * cos,
    };
  }

  hitTestTopInteraction(canvasX, canvasY) {
    for (let index = this.elements.length - 1; index >= 0; index -= 1) {
      const el = this.elements[index];
      const local = this.canvasToLocal(canvasX, canvasY, el);
      const thr = this.getHandleThresholdLocal(el);
      if (Math.hypot(local.x - el.width, local.y - el.height) <= thr) {
        return { element: el, mode: "scale" };
      }
      if (
        Math.hypot(
          local.x - el.width / 2,
          local.y + CUSTOMIZER_ROT_HANDLE_OFFSET,
        ) <= this.getRotateHandleThresholdLocal(el)
      ) {
        return { element: el, mode: "rotate" };
      }
      if (
        local.x >= 0 &&
        local.x <= el.width &&
        local.y >= 0 &&
        local.y <= el.height
      ) {
        return { element: el, mode: "move" };
      }
    }
    return null;
  }

  handlePointerUp() {
    if (this.viewPanDrag) {
      this.viewPanDrag = null;
      if (this.canvas && this.viewPanMode) {
        this.canvas.style.cursor = "grab";
      }
      return;
    }
    if (this.dragState?.mode === "scale") {
      const scaledElement = this.elements.find(
        (item) => item.id === this.dragState.elementId,
      );
      if (scaledElement?.type === "text") {
        const centerX = scaledElement.x + (scaledElement.width || 0) / 2;
        const centerY = scaledElement.y + (scaledElement.height || 0) / 2;
        const effectiveFontSize = Math.min(
          420,
          Math.max(
            6,
            Math.round(
              (this.dragState.startFontSize || scaledElement.fontSize || 24) *
                Math.max(0.01, scaledElement.scale || 1),
            ),
          ),
        );
        scaledElement.fontSize = effectiveFontSize;
        scaledElement.scale = 1;
        this.render();
        scaledElement.x = centerX - (scaledElement.width || 0) / 2;
        scaledElement.y = centerY - (scaledElement.height || 0) / 2;
        this.render();
        this.updateHiddenProperties();
      }
    }
    if (this.dragState && this.pendingHistorySnapshot) {
      this.commitPendingHistorySnapshot();
    }
    this.dragState = null;
    this.pendingHistorySnapshot = null;
    if (this.canvas) {
      this.canvas.style.cursor = "";
    }
  }

  handleOutsideCanvasPointerDown(event) {
    if (!this.canvas || !this.selectedElementId) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest(
        ".custom-cover-customizer__design-bar, .custom-cover-customizer__panel",
      )
    ) {
      return;
    }
    if (target === this.canvas || this.canvas.contains(target)) {
      return;
    }
    this.selectedElementId = null;
    this.dragState = null;
    this.pendingHistorySnapshot = null;
    this.canvas.style.cursor = "";
    this.syncControlInputs();
    this.render();
  }

  applyCanvasViewportTransform() {
    if (!this.canvas) {
      return;
    }
    this.canvas.style.transform = `translate(${this.viewPanX}px, ${this.viewPanY}px) scale(${this.viewZoom})`;
  }

  getPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;

    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  getElementBounds(element) {
    const width = element.width * element.scale;
    const height = element.height * element.scale;
    return {
      left: element.x,
      top: element.y,
      right: element.x + width,
      bottom: element.y + height,
    };
  }

  updateSelectedTextStyle() {
    const element = this.getActiveTextElementForStyleUpdate();
    if (!element) {
      return;
    }

    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");

    element.fontFamily = fontInput?.value || element.fontFamily;
    element.fontSize = Number(fontSizeInput?.value || element.fontSize);
    element.color = textColorInput?.value || element.color;
    this.readTextOutlineEffectFromFormInto(element);
    this.readTextOutlineEffectFromFormInto(this.textDefaults);
    this.updateColorChrome();
    this.updateOutlineColorChrome();
    this.render();
    this.updateHiddenProperties();
  }

  getActiveTextElementForStyleUpdate() {
    const selected = this.getSelectedElement();
    if (selected?.type === "text") {
      return selected;
    }

    const textInput = this.querySelector("[data-text-input]");
    const typed = this.normalizeNewlines(String(textInput?.value || ""));
    const textElements = this.elements.filter(
      (element) => element.type === "text",
    );
    if (!textElements.length) {
      return null;
    }

    if (typed) {
      for (let index = textElements.length - 1; index >= 0; index -= 1) {
        const candidate = textElements[index];
        if (this.normalizeNewlines(String(candidate.text || "")) === typed) {
          this.selectedElementId = candidate.id;
          return candidate;
        }
      }
    }

    const latest = textElements[textElements.length - 1];
    this.selectedElementId = latest.id;
    return latest;
  }

  getSelectedElement() {
    if (!this.selectedElementId) {
      return null;
    }
    return (
      this.elements.find((element) => element.id === this.selectedElementId) ||
      null
    );
  }

  syncControlInputs() {
    const element = this.getSelectedElement();
    const textInput = this.querySelector("[data-text-input]");
    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");

    if (!element) {
      if (textInput) {
        textInput.value = "";
      }
      this.syncFormatToolbars();
      this.syncAlignmentControls(this.textDefaults.textAlign);
      this.updateColorChrome();
      this.syncTextOutlineEffectControls(null);
      const shapeOutlineEnabled = this.querySelector(
        "[data-shape-outline-enabled]",
      );
      if (shapeOutlineEnabled) {
        shapeOutlineEnabled.checked = true;
      }
      return;
    }

    if (element.type === "text") {
      if (textInput) {
        textInput.value = this.normalizeNewlines(element.text || "");
      }
      if (fontInput) fontInput.value = element.fontFamily || fontInput.value;
      if (fontSizeInput && fontSizeInput.tagName === "SELECT") {
        let v = Math.round(Number(element.fontSize || 24));
        const values = [...fontSizeInput.options].map((opt) =>
          Number(opt.value),
        );
        if (values.length && !values.includes(v)) {
          v = values.reduce(
            (best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best),
            values[0],
          );
        }
        fontSizeInput.value = String(v);
      } else if (fontSizeInput) {
        fontSizeInput.value = String(element.fontSize || 24);
      }
      if (textColorInput) textColorInput.value = element.color || "#000000";
      this.syncFormatToolbars();
      this.syncAlignmentControls(element.textAlign || "left");
      this.updateColorChrome();
    } else if (element.type === "shape") {
      if (textInput) {
        textInput.value = "";
      }
      const shapeFillInput = this.querySelector("[data-shape-fill-input]");
      if (shapeFillInput) {
        shapeFillInput.value = element.fill || shapeFillInput.value;
      }
      this.ensureShapeElementOutline(element);
      const shapeOutlineEnabled = this.querySelector(
        "[data-shape-outline-enabled]",
      );
      const shapeOutlineWidthInput = this.querySelector(
        "[data-shape-outline-width-input]",
      );
      const shapeOutlineColorInput = this.querySelector(
        "[data-shape-outline-color-input]",
      );
      if (shapeOutlineEnabled) {
        shapeOutlineEnabled.checked = Boolean(element.strokeEnabled);
      }
      if (shapeOutlineWidthInput) {
        shapeOutlineWidthInput.value = String(element.strokeWidth || 3);
      }
      if (shapeOutlineColorInput) {
        shapeOutlineColorInput.value = element.strokeColor || "#000000";
      }
      this.syncFormatToolbars();
      this.syncAlignmentControls(this.textDefaults.textAlign);
      this.updateColorChrome();
      this.updateShapeFillChrome();
      this.updateShapeOutlineColorChrome();
    } else {
      if (textInput) {
        textInput.value = "";
      }
      this.syncFormatToolbars();
      this.syncAlignmentControls(this.textDefaults.textAlign);
      this.updateColorChrome();
    }
    const textSource =
      this.getSelectedElement()?.type === "text"
        ? this.getSelectedElement()
        : null;
    this.syncTextOutlineEffectControls(textSource);
  }

  normalizeTextEffectValue(raw) {
    const s = String(raw || "").trim();
    return CUSTOMIZER_TEXT_EFFECT_IDS.includes(s) ? s : "straight";
  }

  /** @param {number} mag */
  clampRadiusMagnitude(mag) {
    return Math.min(2000, Math.max(60, Math.round(Math.abs(mag))));
  }

  /**
   * Signed curve/arc radius: sign = bend direction (curve: + up, − down; arc: + down, − up),
   * magnitude 60–2000 (smaller = tighter).
   * @param {unknown} raw
   * @param {unknown} fallbackRaw
   * @returns {number}
   */
  clampSignedTextCurveRadius(raw, fallbackRaw) {
    const fb = Math.round(Number(fallbackRaw));
    const fbSafe =
      !Number.isFinite(fb) || fb === 0
        ? 320
        : Math.sign(fb) * this.clampRadiusMagnitude(fb);
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v)) return fbSafe;
    if (v === 0) return fbSafe;
    return Math.sign(v) * this.clampRadiusMagnitude(v);
  }

  ensureTextElementOutlineAndEffect(element) {
    if (!element || element.type !== "text") {
      return;
    }
    const d = this.textDefaults;
    if (typeof element.outlineEnabled !== "boolean") {
      element.outlineEnabled = Boolean(d.outlineEnabled);
    }
    element.outlineWidth = Math.min(
      16,
      Math.max(
        0,
        (() => {
          const parsedOutlineWidth = Math.round(
            Number(element.outlineWidth ?? d.outlineWidth),
          );
          return Number.isFinite(parsedOutlineWidth)
            ? parsedOutlineWidth
            : d.outlineWidth;
        })(),
      ),
    );
    let oc = String(element.outlineColor || "").trim();
    if (!oc) {
      oc = d.outlineColor;
    }
    if (!oc.startsWith("#")) {
      oc = `#${oc}`;
    }
    element.outlineColor = oc;
    element.textEffect = this.normalizeTextEffectValue(
      element.textEffect ?? d.textEffect,
    );
    element.curveRadius = this.clampSignedTextCurveRadius(
      element.curveRadius,
      d.curveRadius,
    );
    element.curveSpacing = Math.min(
      48,
      Math.max(
        -8,
        Math.round(Number(element.curveSpacing ?? d.curveSpacing) || 0),
      ),
    );
    element.arcRadius = this.clampSignedTextCurveRadius(
      element.arcRadius,
      d.arcRadius,
    );
    element.arcSpacing = Math.min(
      48,
      Math.max(-8, Math.round(Number(element.arcSpacing ?? d.arcSpacing) || 0)),
    );
    const clampSize = (n, def) =>
      Math.min(220, Math.max(20, Math.round(Number(n) || def)));
    element.stlLeft = clampSize(element.stlLeft, d.stlLeft);
    element.stlRight = clampSize(element.stlRight, d.stlRight);
    element.ltsLeft = clampSize(element.ltsLeft, d.ltsLeft);
    element.ltsRight = clampSize(element.ltsRight, d.ltsRight);
    element.bulgeLeft = clampSize(element.bulgeLeft, d.bulgeLeft);
    element.bulgeRight = clampSize(element.bulgeRight, d.bulgeRight);
  }

  syncTextOutlineEffectControls(sourceElement) {
    const outlineEnabled = this.querySelector("[data-text-outline-enabled]");
    const outlineControls = this.querySelector("[data-text-outline-controls]");
    const base =
      sourceElement?.type === "text" ? sourceElement : this.textDefaults;

    if (outlineEnabled) {
      outlineEnabled.checked = Boolean(base.outlineEnabled);
    }
    if (outlineControls) {
      outlineControls.hidden = false;
    }
    const ow = this.querySelector("[data-text-outline-weight]");
    if (ow) {
      ow.value = String(base.outlineWidth ?? 3);
    }
    const ocol = this.querySelector("[data-text-outline-color]");
    if (ocol) {
      ocol.value = base.outlineColor || "#ffffff";
    }
    this.updateOutlineColorChrome();
    const effectSelect = this.querySelector("[data-text-effect]");
    if (effectSelect) {
      effectSelect.value = this.normalizeTextEffectValue(base.textEffect);
    }

    const setRange = (selector, val) => {
      const node = this.querySelector(selector);
      if (node) {
        node.value = String(val);
      }
    };
    setRange('[data-text-effect-radius-for="curve"]', base.curveRadius ?? 320);
    setRange('[data-text-effect-spacing-for="curve"]', base.curveSpacing ?? 0);
    setRange('[data-text-effect-radius-for="arc"]', base.arcRadius ?? 320);
    setRange('[data-text-effect-spacing-for="arc"]', base.arcSpacing ?? 0);
    setRange(
      '[data-text-effect-left-size-for="small-to-large"]',
      base.stlLeft ?? 72,
    );
    setRange(
      '[data-text-effect-right-size-for="small-to-large"]',
      base.stlRight ?? 140,
    );
    setRange(
      '[data-text-effect-left-size-for="large-to-small"]',
      base.ltsLeft ?? 140,
    );
    setRange(
      '[data-text-effect-right-size-for="large-to-small"]',
      base.ltsRight ?? 72,
    );
    setRange('[data-text-effect-left-size-for="bulge"]', base.bulgeLeft ?? 80);
    setRange(
      '[data-text-effect-right-size-for="bulge"]',
      base.bulgeRight ?? 80,
    );

    this.refreshTextEffectPanelVisibility();
  }

  refreshTextEffectPanelVisibility() {
    const effectSelect = this.querySelector("[data-text-effect]");
    const v = this.normalizeTextEffectValue(effectSelect?.value);
    this.querySelectorAll("[data-text-effect-panel]").forEach((panel) => {
      const id = panel.getAttribute("data-text-effect-panel");
      panel.hidden = id !== v;
    });
  }

  updateOutlineColorChrome() {
    const input = this.querySelector("[data-text-outline-color]");
    const hexEl = this.querySelector("[data-text-outline-hex]");
    const swatch = this.querySelector("[data-text-outline-swatch]");
    let val = (input?.value || "#ffffff").trim();
    if (!val.startsWith("#")) {
      val = `#${val}`;
    }
    if (hexEl) {
      hexEl.textContent = val.toUpperCase();
    }
    if (swatch) {
      swatch.style.backgroundColor = val;
    }
  }

  readTextOutlineEffectFromFormInto(target) {
    const outlineEnabled = this.querySelector("[data-text-outline-enabled]");
    const outlineWeight = this.querySelector("[data-text-outline-weight]");
    const outlineColor = this.querySelector("[data-text-outline-color]");
    const effectSelect = this.querySelector("[data-text-effect]");

    target.outlineEnabled = true;
    const parsedOutlineWeight = Math.round(Number(outlineWeight?.value));
    target.outlineWidth = Math.min(
      16,
      Math.max(0, Number.isFinite(parsedOutlineWeight) ? parsedOutlineWeight : 3),
    );
    let oc = String(outlineColor?.value || "#ffffff").trim();
    if (!oc.startsWith("#")) {
      oc = `#${oc}`;
    }
    target.outlineColor = oc;
    target.textEffect = this.normalizeTextEffectValue(effectSelect?.value);

    const num = (selector, min, max, fallback) => {
      const raw = this.querySelector(selector);
      const n = Math.round(Number(raw?.value));
      if (Number.isFinite(n)) {
        return Math.min(max, Math.max(min, n));
      }
      return fallback;
    };

    const curveRIn = this.querySelector(
      '[data-text-effect-radius-for="curve"]',
    );
    const arcRIn = this.querySelector('[data-text-effect-radius-for="arc"]');
    const curveParsed = Math.round(Number(curveRIn?.value));
    const arcParsed = Math.round(Number(arcRIn?.value));
    target.curveRadius = this.clampSignedTextCurveRadius(
      Number.isFinite(curveParsed) ? curveParsed : NaN,
      target.curveRadius ?? this.textDefaults.curveRadius,
    );
    target.arcRadius = this.clampSignedTextCurveRadius(
      Number.isFinite(arcParsed) ? arcParsed : NaN,
      target.arcRadius ?? this.textDefaults.arcRadius,
    );
    if (curveRIn) curveRIn.value = String(target.curveRadius);
    if (arcRIn) arcRIn.value = String(target.arcRadius);
    target.curveSpacing = num(
      '[data-text-effect-spacing-for="curve"]',
      -8,
      48,
      0,
    );
    target.arcSpacing = num('[data-text-effect-spacing-for="arc"]', -8, 48, 0);
    target.stlLeft = num(
      '[data-text-effect-left-size-for="small-to-large"]',
      20,
      220,
      72,
    );
    target.stlRight = num(
      '[data-text-effect-right-size-for="small-to-large"]',
      20,
      220,
      140,
    );
    target.ltsLeft = num(
      '[data-text-effect-left-size-for="large-to-small"]',
      20,
      220,
      140,
    );
    target.ltsRight = num(
      '[data-text-effect-right-size-for="large-to-small"]',
      20,
      220,
      72,
    );
    target.bulgeLeft = num(
      '[data-text-effect-left-size-for="bulge"]',
      20,
      220,
      80,
    );
    target.bulgeRight = num(
      '[data-text-effect-right-size-for="bulge"]',
      20,
      220,
      80,
    );
  }

  applyTextOutlineEffectFromFormToSelection() {
    const el = this.getActiveTextElementForStyleUpdate();
    this.readTextOutlineEffectFromFormInto(this.textDefaults);
    if (el?.type === "text") {
      this.readTextOutlineEffectFromFormInto(el);
    }
    this.render();
    this.updateHiddenProperties();
  }

  drawCharWithOptionalOutline(ctx, char, fillRgb, outlineCfg) {
    if (!outlineCfg.enabled || outlineCfg.width <= 0) {
      ctx.fillStyle = fillRgb;
      ctx.fillText(char, 0, 0);
      return;
    }
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = outlineCfg.width;
    ctx.strokeStyle = outlineCfg.color;
    ctx.strokeText(char, 0, 0);
    ctx.fillStyle = fillRgb;
    ctx.fillText(char, 0, 0);
  }

  getCharSizePxForWidthEffect(element, effect, index, lastIndex, basePx) {
    const t = lastIndex <= 0 ? 0 : index / lastIndex;
    let leftPct;
    let rightPct;
    if (effect === "small-to-large") {
      leftPct = (Number(element.stlLeft) || 72) / 100;
      rightPct = (Number(element.stlRight) || 140) / 100;
    } else if (effect === "large-to-small") {
      leftPct = (Number(element.ltsLeft) || 140) / 100;
      rightPct = (Number(element.ltsRight) || 72) / 100;
    } else {
      leftPct = (Number(element.bulgeLeft) || 80) / 100;
      rightPct = (Number(element.bulgeRight) || 80) / 100;
    }
    const l = leftPct * basePx;
    const r = rightPct * basePx;
    let s = l + (r - l) * t;
    if (effect === "bulge") {
      const amp = Math.min(l, r) * 0.42;
      s += amp * Math.sin(Math.PI * t);
    }
    return Math.max(6, s);
  }

  getOutlineDrawConfig(element) {
    const enabled = Boolean(element.outlineEnabled);
    const width = Math.min(16, Math.max(0, Number(element.outlineWidth) || 0));
    let color = String(element.outlineColor || "#ffffff").trim();
    if (!color.startsWith("#")) {
      color = `#${color}`;
    }
    return { enabled, width, color };
  }

  layoutCurvedLine(
    ctx,
    line,
    fontPx,
    family,
    fallback,
    weight,
    fontStyle,
    R,
    spacingPx,
    mode,
  ) {
    const chars = Array.from(line);
    ctx.font = `${fontStyle} ${weight} ${fontPx}px ${family}, ${fallback}`;
    if (!chars.length) {
      return {
        width: 20,
        height: fontPx * 1.25,
        samples: [],
        offsetX: 0,
        offsetY: 0,
      };
    }
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const gapTotal = spacingPx * Math.max(0, chars.length - 1);
    const straightW = Math.max(8, widths.reduce((a, b) => a + b, 0) + gapTotal);
    const rNum = Number(R);
    const signed =
      Number.isFinite(rNum) && rNum !== 0 ? rNum : 320;
    const absR = Math.max(60, Math.min(2000, Math.abs(signed)));
    const bendUp = signed > 0;
    const theta = Math.min(
      Math.PI * 1.35,
      Math.max(straightW / Math.max(absR, 1e-6), 0.08),
    );
    const centerX = straightW / 2;
    const baselineRef = fontPx * 0.9;
    let centerY;
    let a0;
    let a1;
    if (mode === "curve") {
      if (bendUp) {
        centerY = baselineRef + absR;
        a0 = -Math.PI / 2 - theta / 2;
        a1 = -Math.PI / 2 + theta / 2;
      } else {
        centerY = baselineRef - absR;
        a0 = Math.PI / 2 - theta / 2;
        a1 = Math.PI / 2 + theta / 2;
      }
    } else if (bendUp) {
      centerY = baselineRef - absR;
      a0 = Math.PI / 2 - theta / 2;
      a1 = Math.PI / 2 + theta / 2;
    } else {
      centerY = baselineRef + absR;
      a0 = -Math.PI / 2 - theta / 2;
      a1 = -Math.PI / 2 + theta / 2;
    }
    /** LTR: arc must run so the first character is left of the last (avoid mirrored word order). */
    if (Math.cos(a0) > Math.cos(a1) + 1e-9) {
      const t = a0;
      a0 = a1;
      a1 = t;
    }
    const samples = [];
    let trail = 0;
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      const w = widths[i];
      trail += w / 2;
      const frac = trail / straightW;
      const fracClamped = Math.min(1, Math.max(0, frac));
      const a = a0 + (a1 - a0) * fracClamped;
      const px = centerX + absR * Math.cos(a);
      const py = centerY + absR * Math.sin(a);
      const rot = 0;
      samples.push({ ch, px, py, rot });
      trail += w / 2;
      if (i < chars.length - 1) {
        trail += spacingPx;
      }
    }
    const pad = fontPx * 0.72;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of samples) {
      minX = Math.min(minX, s.px - pad);
      maxX = Math.max(maxX, s.px + pad);
      minY = Math.min(minY, s.py - pad);
      maxY = Math.max(maxY, s.py + pad);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = straightW;
      minY = 0;
      maxY = fontPx * 1.2;
    }
    return {
      width: Math.max(20, maxX - minX),
      height: Math.max(fontPx * 1.2, maxY - minY),
      samples,
      offsetX: -minX,
      offsetY: -minY,
    };
  }

  drawCurvedLineLayout(ctx, layout, fillRgb, outlineCfg) {
    ctx.save();
    ctx.translate(layout.offsetX, layout.offsetY);
    for (const s of layout.samples) {
      ctx.save();
      ctx.translate(s.px, s.py);
      ctx.rotate(s.rot);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.drawCharWithOptionalOutline(ctx, s.ch, fillRgb, outlineCfg);
      ctx.restore();
    }
    ctx.restore();
  }

  layoutVariableSizeLine(
    ctx,
    element,
    line,
    effect,
    baseFontPx,
    family,
    fallback,
    weight,
    fontStyle0,
  ) {
    const chars = Array.from(line);
    const n = chars.length;
    const lastIndex = Math.max(n - 1, 1);
    let x = 0;
    let minY = 0;
    let maxY = baseFontPx * 1.2;
    const placements = [];
    for (let i = 0; i < n; i += 1) {
      const ch = chars[i];
      const sizePx = this.getCharSizePxForWidthEffect(
        element,
        effect,
        i,
        lastIndex,
        baseFontPx,
      );
      ctx.font = `${fontStyle0} ${weight} ${sizePx}px ${family}, ${fallback}`;
      const w = ctx.measureText(ch).width;
      placements.push({ ch, x, sizePx, w });
      x += w;
      const ascendApprox = sizePx * 0.88;
      const descendApprox = sizePx * 0.28;
      minY = Math.min(minY, -ascendApprox);
      maxY = Math.max(maxY, descendApprox);
    }
    const width = Math.max(20, x);
    const height = maxY - minY;
    return { width, height, placements, baselineShift: -minY };
  }

  drawVariableLineLayout(
    ctx,
    layout,
    fillRgb,
    outlineCfg,
    family,
    fallback,
    weight,
    fontStyle0,
  ) {
    const by = layout.baselineShift;
    for (const p of layout.placements) {
      ctx.font = `${fontStyle0} ${weight} ${p.sizePx}px ${family}, ${fallback}`;
      ctx.save();
      ctx.translate(p.x, by);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      this.drawCharWithOptionalOutline(ctx, p.ch, fillRgb, outlineCfg);
      ctx.restore();
    }
  }

  drawTextDecorationLines(rawAlign, lineW, drawX) {
    let x1 = 0;
    let x2 = lineW;
    if (rawAlign === "center") {
      x1 = drawX - lineW / 2;
      x2 = drawX + lineW / 2;
    } else if (rawAlign === "right") {
      x1 = drawX - lineW;
      x2 = drawX;
    } else {
      x1 = 0;
      x2 = lineW;
    }
    return { x1, x2 };
  }

  renderTextElementToContext(element) {
    this.ensureTextElementOutlineAndEffect(element);
    const fontPx = element.fontSize || 24;
    const family = element.fontFamily || "Arial";
    const fallback = element.fontFallback || "sans-serif";
    const weight = element.fontWeight === "bold" ? "bold" : "normal";
    const fontStyle0 = element.fontStyle === "italic" ? "italic" : "normal";
    const text = this.normalizeNewlines(element.text || "");
    const lines = text.length > 0 ? text.split("\n") : [""];
    const lineHeight = fontPx * 1.2;
    const effect = this.normalizeTextEffectValue(element.textEffect);
    element.textEffect = effect;
    const rawAlign = element.textAlign || "left";
    const canvasAlign = rawAlign === "justify" ? "left" : rawAlign;
    const fillRgb = element.color || "#000000";
    const outlineCfg = this.getOutlineDrawConfig(element);

    if (effect === "straight") {
      this.ctx.font = `${fontStyle0} ${weight} ${fontPx}px ${family}, ${fallback}`;
      this.ctx.textBaseline = "alphabetic";
      let maxW = 20;
      for (const line of lines) {
        maxW = Math.max(maxW, this.ctx.measureText(line).width);
      }
      element.width = maxW;
      element.height = Math.max(lineHeight, lines.length * lineHeight);
      for (let li = 0; li < lines.length; li += 1) {
        const lineStr = lines[li] ?? "";
        const lineW = this.ctx.measureText(lineStr).width;
        let drawX = 0;
        if (canvasAlign === "center") {
          this.ctx.textAlign = "center";
          drawX = maxW / 2;
        } else if (canvasAlign === "right") {
          this.ctx.textAlign = "right";
          drawX = maxW;
        } else {
          this.ctx.textAlign = "left";
          drawX = 0;
        }
        const baselineY = li * lineHeight + fontPx * 0.88;
        if (outlineCfg.enabled && outlineCfg.width > 0) {
          this.ctx.lineJoin = "round";
          this.ctx.miterLimit = 2;
          this.ctx.lineWidth = outlineCfg.width;
          this.ctx.strokeStyle = outlineCfg.color;
          this.ctx.strokeText(lineStr, drawX, baselineY);
        }
        this.ctx.fillStyle = fillRgb;
        this.ctx.fillText(lineStr, drawX, baselineY);
        if ((element.underline || element.strikethrough) && lineStr) {
          const deco = this.drawTextDecorationLines(
            rawAlign,
            lineW,
            canvasAlign === "center"
              ? maxW / 2
              : canvasAlign === "right"
                ? maxW
                : 0,
          );
          this.ctx.strokeStyle = fillRgb;
          this.ctx.lineWidth = Math.max(1, fontPx / 14);
          if (element.underline) {
            const underlineY = baselineY + fontPx * 0.22;
            this.ctx.beginPath();
            this.ctx.moveTo(deco.x1, underlineY);
            this.ctx.lineTo(deco.x2, underlineY);
            this.ctx.stroke();
          }
          if (element.strikethrough) {
            const strikeY = baselineY - fontPx * 0.28;
            this.ctx.beginPath();
            this.ctx.moveTo(deco.x1, strikeY);
            this.ctx.lineTo(deco.x2, strikeY);
            this.ctx.stroke();
          }
        }
      }
      return;
    }

    if (effect === "curve" || effect === "arc") {
      const R =
        effect === "curve"
          ? this.clampSignedTextCurveRadius(
              element.curveRadius,
              this.textDefaults.curveRadius,
            )
          : this.clampSignedTextCurveRadius(
              element.arcRadius,
              this.textDefaults.arcRadius,
            );
      const spacingPx =
        effect === "curve"
          ? Math.min(
              48,
              Math.max(-8, Math.round(Number(element.curveSpacing) || 0)),
            )
          : Math.min(
              48,
              Math.max(-8, Math.round(Number(element.arcSpacing) || 0)),
            );
      const layouts = lines.map((line) =>
        this.layoutCurvedLine(
          this.ctx,
          line,
          fontPx,
          family,
          fallback,
          weight,
          fontStyle0,
          R,
          spacingPx,
          effect,
        ),
      );
      const maxW = Math.max(20, ...layouts.map((L) => L.width));
      let totalH = 0;
      for (let i = 0; i < layouts.length; i += 1) {
        totalH += layouts[i].height;
        if (i < layouts.length - 1) {
          totalH += lineHeight * 0.22;
        }
      }
      element.width = maxW;
      element.height = Math.max(lineHeight, totalH);
      let yCursor = 0;
      for (let li = 0; li < layouts.length; li += 1) {
        const layout = layouts[li];
        let offsetX = 0;
        if (canvasAlign === "center") {
          offsetX = (maxW - layout.width) / 2;
        } else if (canvasAlign === "right") {
          offsetX = maxW - layout.width;
        }
        this.ctx.save();
        this.ctx.translate(offsetX, yCursor);
        this.drawCurvedLineLayout(this.ctx, layout, fillRgb, outlineCfg);
        this.ctx.restore();
        yCursor +=
          layout.height + (li < layouts.length - 1 ? lineHeight * 0.22 : 0);
      }
      return;
    }

    if (
      effect === "small-to-large" ||
      effect === "large-to-small" ||
      effect === "bulge"
    ) {
      const rowLayouts = [];
      for (const line of lines) {
        rowLayouts.push(
          this.layoutVariableSizeLine(
            this.ctx,
            element,
            line,
            effect,
            fontPx,
            family,
            fallback,
            weight,
            fontStyle0,
          ),
        );
      }
      let maxW = 20;
      for (const layout of rowLayouts) {
        maxW = Math.max(maxW, layout.width);
      }
      let totalH = 0;
      for (const layout of rowLayouts) {
        totalH += layout.height;
      }
      totalH += Math.max(0, lines.length - 1) * lineHeight * 0.25;
      element.width = maxW;
      element.height = Math.max(lineHeight, totalH);
      let y0 = 0;
      for (let li = 0; li < rowLayouts.length; li += 1) {
        const layout = rowLayouts[li];
        let offsetX = 0;
        if (canvasAlign === "center") {
          offsetX = (maxW - layout.width) / 2;
        } else if (canvasAlign === "right") {
          offsetX = maxW - layout.width;
        }
        this.ctx.save();
        this.ctx.translate(offsetX, y0);
        this.drawVariableLineLayout(
          this.ctx,
          layout,
          fillRgb,
          outlineCfg,
          family,
          fallback,
          weight,
          fontStyle0,
        );
        if (element.underline || element.strikethrough) {
          const lineStr = lines[li] ?? "";
          if (lineStr) {
            const deco = this.drawTextDecorationLines(
              rawAlign,
              layout.width,
              canvasAlign === "center"
                ? layout.width / 2
                : canvasAlign === "right"
                  ? layout.width
                  : 0,
            );
            this.ctx.strokeStyle = fillRgb;
            this.ctx.lineWidth = Math.max(1, fontPx / 14);
            if (element.underline) {
              const underlineY = layout.baselineShift + fontPx * 1.12;
              this.ctx.beginPath();
              this.ctx.moveTo(deco.x1, underlineY);
              this.ctx.lineTo(deco.x2, underlineY);
              this.ctx.stroke();
            }
            if (element.strikethrough) {
              const strikeY = layout.baselineShift + fontPx * 0.55;
              this.ctx.beginPath();
              this.ctx.moveTo(deco.x1, strikeY);
              this.ctx.lineTo(deco.x2, strikeY);
              this.ctx.stroke();
            }
          }
        }
        this.ctx.restore();
        y0 +=
          layout.height + (li < rowLayouts.length - 1 ? lineHeight * 0.25 : 0);
      }
      return;
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.elements.forEach((element) => {
      this.ctx.save();
      this.ctx.translate(element.x, element.y);
      this.ctx.translate(element.width / 2, element.height / 2);
      this.ctx.rotate((element.rotation * Math.PI) / 180);
      const flipX = Number(element.flipX) === -1 ? -1 : 1;
      const flipY = Number(element.flipY) === -1 ? -1 : 1;
      this.ctx.scale(element.scale * flipX, element.scale * flipY);
      this.ctx.translate(-element.width / 2, -element.height / 2);

      if (element.type === "text") {
        this.renderTextElementToContext(element);
      } else if (element.type === "shape") {
        this.drawShapeToContext(element);
      } else if (element.image) {
        this.ctx.drawImage(element.image, 0, 0, element.width, element.height);
      }

      this.ctx.restore();

      if (element.id === this.selectedElementId) {
        this.drawElementSelection(element);
      }
    });

    const safe = this.elementsWithinSafeArea();
    const safeWarning = (this.dataset.safeWarning || "").trim();
    this.setWarning(safe ? "" : safeWarning);
    this.updateHiddenProperties();

    const editingText = this.getSelectedElement();
    if (editingText?.type === "text") {
      this.drawTextCaretIfEditing(editingText);
    }
  }

  drawHandleDisk(center, radius = CUSTOMIZER_HANDLE_RADIUS_PX) {
    const r = radius;
    this.ctx.fillStyle = "#fff";
    this.ctx.strokeStyle = "rgba(14, 54, 116, 0.95)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  drawHandleSquare(center, radius = CUSTOMIZER_HANDLE_RADIUS_PX) {
    const r = radius;
    this.ctx.fillStyle = "#fff";
    this.ctx.strokeStyle = "rgba(14, 54, 116, 0.95)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.rect(center.x - r, center.y - r, r * 2, r * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  removeElementById(id) {
    const index = this.elements.findIndex((e) => e.id === id);
    if (index === -1) {
      return;
    }
    this.elements.splice(index, 1);
    if (this.selectedElementId === id) {
      this.selectedElementId = null;
    }
    this.syncControlInputs();
    this.render();
    this.updatePrice();
    this.updateHiddenProperties();
  }

  createHistorySnapshot() {
    return {
      selectedElementId: this.selectedElementId,
      elements: this.elements.map((element) => {
        const copy = { ...element };
        if (Array.isArray(copy.paths)) {
          copy.paths = [...copy.paths];
        }
        delete copy.image;
        return copy;
      }),
    };
  }

  pushHistorySnapshot() {
    this.undoStack.push(this.createHistorySnapshot());
    if (this.undoStack.length > this.historyLimit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  commitPendingHistorySnapshot() {
    if (!this.pendingHistorySnapshot) {
      return;
    }
    this.undoStack.push(this.pendingHistorySnapshot);
    if (this.undoStack.length > this.historyLimit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.pendingHistorySnapshot = null;
  }

  restoreHistorySnapshot(snapshot) {
    if (!snapshot) {
      return;
    }
    this.elements = snapshot.elements.map((element) => {
      const restored = { ...element };
      this.ensureElementFlipState(restored);
      if (Array.isArray(restored.paths)) {
        restored.paths = [...restored.paths];
      }
      if (
        (restored.type === "image" || restored.type === "clipart") &&
        restored.src
      ) {
        const image = new Image();
        image.onload = () => this.render();
        image.src = restored.src;
        restored.image = image;
      }
      if (restored.type === "text") {
        this.ensureTextElementOutlineAndEffect(restored);
      } else if (restored.type === "shape") {
        this.ensureShapeElementOutline(restored);
      }
      return restored;
    });
    this.selectedElementId = snapshot.selectedElementId || null;
    this.syncControlInputs();
    this.render();
    this.updatePrice();
    this.updateHiddenProperties();
  }

  ensureElementFlipState(element) {
    if (!element || typeof element !== "object") {
      return;
    }
    element.flipX = Number(element.flipX) === -1 ? -1 : 1;
    element.flipY = Number(element.flipY) === -1 ? -1 : 1;
  }

  duplicateSelectedElement() {
    const selected = this.getSelectedElement();
    if (!selected) {
      return;
    }
    this.pushHistorySnapshot();
    const clone = { ...selected, id: crypto.randomUUID() };
    if (Array.isArray(clone.paths)) {
      clone.paths = [...clone.paths];
    }
    clone.x = Number(clone.x || 0) + 16;
    clone.y = Number(clone.y || 0) + 16;
    if ((clone.type === "image" || clone.type === "clipart") && clone.src) {
      const image = new Image();
      image.onload = () => this.render();
      image.src = clone.src;
      clone.image = image;
    }
    this.elements.push(clone);
    this.selectedElementId = clone.id;
    this.syncControlInputs();
    this.render();
    this.updatePrice();
  }

  flipSelectedElement(axis) {
    const selected = this.getSelectedElement();
    if (
      !selected ||
      !["text", "image", "clipart", "shape"].includes(selected.type)
    ) {
      return;
    }
    this.pushHistorySnapshot();
    const currentFlipX = Number(selected.flipX) === -1 ? -1 : 1;
    const currentFlipY = Number(selected.flipY) === -1 ? -1 : 1;
    if (axis === "vertical") {
      selected.flipY = currentFlipY * -1;
      selected.flipX = currentFlipX;
    } else {
      selected.flipX = currentFlipX * -1;
      selected.flipY = currentFlipY;
    }
    this.render();
    this.updateHiddenProperties();
  }

  deleteSelectedElement() {
    if (!this.selectedElementId) {
      return;
    }
    this.pushHistorySnapshot();
    this.removeElementById(this.selectedElementId);
  }

  undoLastChange() {
    if (!this.undoStack.length) {
      return;
    }
    this.redoStack.push(this.createHistorySnapshot());
    const snapshot = this.undoStack.pop();
    this.restoreHistorySnapshot(snapshot);
  }

  redoLastChange() {
    if (!this.redoStack.length) {
      return;
    }
    this.undoStack.push(this.createHistorySnapshot());
    const snapshot = this.redoStack.pop();
    this.restoreHistorySnapshot(snapshot);
  }

  drawElementSelection(el) {
    const w = el.width;
    const h = el.height;
    const corners = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([lx, ly]) => this.localToCanvas(lx, ly, el));

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(14, 54, 116, 0.9)";
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i += 1) {
      this.ctx.lineTo(corners[i].x, corners[i].y);
    }
    this.ctx.closePath();
    this.ctx.stroke();

    const scaleCenter = this.localToCanvas(w, h, el);
    const rotateCenter = this.localToCanvas(
      w / 2,
      -CUSTOMIZER_ROT_HANDLE_OFFSET,
      el,
    );
    const edgeMid = this.localToCanvas(w / 2, 0, el);

    this.ctx.strokeStyle = "rgba(14, 54, 116, 0.75)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(edgeMid.x, edgeMid.y);
    this.ctx.lineTo(rotateCenter.x, rotateCenter.y);
    this.ctx.stroke();

    this.drawHandleSquare(scaleCenter);
    this.drawHandleDisk(rotateCenter, CUSTOMIZER_ROT_HANDLE_RADIUS_PX);
    this.ctx.restore();
  }

  _caretBlinkAllowed() {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  _startCaretBlinkLoop() {
    this._stopCaretBlinkLoop();
    this._caretBlinkOn = true;
    if (!this._caretBlinkAllowed()) {
      return;
    }
    this._caretIntervalId = window.setInterval(() => {
      this._caretBlinkOn = !this._caretBlinkOn;
      this.render();
    }, 530);
  }

  _stopCaretBlinkLoop() {
    if (this._caretIntervalId != null) {
      window.clearInterval(this._caretIntervalId);
      this._caretIntervalId = null;
    }
    this._caretBlinkOn = true;
  }

  /**
   * Caret position in element local coords (multi-line: textarea `\n` → new line on canvas).
   * @returns {{ x: number, y: number, lineHeight: number }}
   */
  getCaretLocalPosition(element, caretIndex) {
    const fontPx = element.fontSize || 24;
    const lineHeight = fontPx * 1.2;
    const family = element.fontFamily || "Arial";
    const fallback = element.fontFallback || "sans-serif";
    const weight = element.fontWeight === "bold" ? "bold" : "normal";
    const fontStyle = element.fontStyle === "italic" ? "italic" : "normal";
    const text = this.normalizeNewlines(element.text || "");
    const lines = text.length > 0 ? text.split("\n") : [""];
    this.ctx.font = `${fontStyle} ${weight} ${fontPx}px ${family}, ${fallback}`;
    const i = Math.max(0, Math.min(caretIndex, text.length));
    const before = text.slice(0, i);
    const lineIdx = (before.match(/\n/g) || []).length;
    const lastNl = before.lastIndexOf("\n");
    const col = lastNl === -1 ? before.length : before.length - lastNl - 1;
    const line = lines[Math.min(lineIdx, lines.length - 1)] ?? "";
    const lineW = this.ctx.measureText(line).width;
    const prefixW = this.ctx.measureText(
      line.slice(0, Math.min(col, line.length)),
    ).width;
    const rawAlign = element.textAlign || "left";
    const drawX =
      rawAlign === "center"
        ? element.width / 2
        : rawAlign === "right"
          ? element.width
          : 0;
    let textLeft = 0;
    if (rawAlign === "center") {
      textLeft = drawX - lineW / 2;
    } else if (rawAlign === "right") {
      textLeft = drawX - lineW;
    } else {
      textLeft = 0;
    }
    return {
      x: textLeft + prefixW,
      y: lineIdx * lineHeight,
      lineHeight,
    };
  }

  drawTextCaretIfEditing(element) {
    const textInput = this.querySelector("[data-text-input]");
    if (!textInput || document.activeElement !== textInput) {
      return;
    }
    if (element.id !== this.selectedElementId || element.type !== "text") {
      return;
    }
    const caretEffect = this.normalizeTextEffectValue(element.textEffect);
    if (caretEffect === "curve" || caretEffect === "arc") {
      return;
    }
    if (this._caretBlinkAllowed() && !this._caretBlinkOn) {
      return;
    }
    const caretIndex = textInput.selectionStart ?? 0;
    const {
      x: cx,
      y: cy,
      lineHeight: caretLineHeight,
    } = this.getCaretLocalPosition(element, caretIndex);
    const top = this.localToCanvas(cx, cy, element);
    const bot = this.localToCanvas(cx, cy + caretLineHeight, element);
    const fontPx = element.fontSize || 24;
    this.ctx.save();
    this.ctx.strokeStyle = element.color || "#000000";
    this.ctx.lineWidth = Math.max(1.5, fontPx / 16);
    this.ctx.beginPath();
    this.ctx.moveTo(top.x, top.y);
    this.ctx.lineTo(bot.x, bot.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  getSafeAreaShape() {
    return this.dataset.safeAreaShape === "rectangle" ? "rectangle" : "circle";
  }

  /** Full circle inscribed in the square canvas (matches round CSS preview). */
  getCircleSafeMetrics() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2;
    return { cx, cy, r };
  }

  getSafeAreaBounds() {
    return {
      left: (this.safeArea.x / 100) * this.canvas.width,
      top: (this.safeArea.y / 100) * this.canvas.height,
      width: (this.safeArea.width / 100) * this.canvas.width,
      height: (this.safeArea.height / 100) * this.canvas.height,
      right:
        ((this.safeArea.x + this.safeArea.width) / 100) * this.canvas.width,
      bottom:
        ((this.safeArea.y + this.safeArea.height) / 100) * this.canvas.height,
    };
  }

  getElementWorldCorners(element) {
    const w = element.width;
    const h = element.height;
    return [
      this.localToCanvas(0, 0, element),
      this.localToCanvas(w, 0, element),
      this.localToCanvas(w, h, element),
      this.localToCanvas(0, h, element),
    ];
  }

  elementFullyInsideCircle(element, cx, cy, r) {
    const tol = 1;
    const corners = this.getElementWorldCorners(element);
    return corners.every((p) => Math.hypot(p.x - cx, p.y - cy) <= r + tol);
  }

  elementsWithinSafeArea() {
    if (this.getSafeAreaShape() === "rectangle") {
      const safe = this.getSafeAreaBounds();
      return this.elements.every((element) => {
        const bounds = this.getElementBounds(element);
        return (
          bounds.left >= safe.left &&
          bounds.top >= safe.top &&
          bounds.right <= safe.right &&
          bounds.bottom <= safe.bottom
        );
      });
    }
    const { cx, cy, r } = this.getCircleSafeMetrics();
    return this.elements.every((element) =>
      this.elementFullyInsideCircle(element, cx, cy, r),
    );
  }

  getLiveTotalCents() {
    const textCount = this.elements.filter(
      (element) => element.type === "text",
    ).length;
    const imageCount = this.elements.filter(
      (element) => element.type === "image",
    ).length;
    const clipartCount = this.elements.filter(
      (element) => element.type === "clipart",
    ).length;
    const shapeCount = this.elements.filter(
      (element) => element.type === "shape",
    ).length;
    const addonCents =
      textCount * this.priceAdjustments.text +
      imageCount * this.priceAdjustments.image +
      clipartCount * this.priceAdjustments.clipart +
      shapeCount * this.priceAdjustments.shape;
    return this.variantPriceCents + addonCents;
  }

  updatePrice() {
    const sectionRoot = this.closest(".custom-cover-customizer");
    const totalEl = sectionRoot?.querySelector(
      "[data-preview-footer-price-total]",
    );
    if (totalEl) {
      totalEl.textContent = this.moneyFormatter.format(
        this.getLiveTotalCents() / 100,
      );
    }
    this.updateHiddenProperties();
  }

  setWarning(message) {
    if (!this.warningOutput) {
      return;
    }
    this.warningOutput.textContent = message || "";
  }

  setActiveTool(tool) {
    this.currentTool = tool;
    const buttons = this.querySelectorAll("[data-tool-button]");
    buttons.forEach((button) => {
      const isActive = button.getAttribute("data-tool-button") === tool;
      button.classList.toggle("is-active", isActive);
    });
  }

  toggleToolPanels(tool) {
    const textPanel = this.querySelector('[data-tool-panel="text"]');
    const imagePanel = this.querySelector('[data-tool-panel="image"]');
    const clipartPanel = this.querySelector('[data-tool-panel="clipart"]');
    const shapesPanel = this.querySelector('[data-tool-panel="shapes"]');
    if (textPanel) {
      textPanel.hidden =
        tool === "image" || tool === "clipart" || tool === "shapes";
    }
    if (imagePanel) {
      imagePanel.hidden = tool !== "image";
    }
    if (clipartPanel) {
      clipartPanel.hidden = tool !== "clipart";
    }
    if (shapesPanel) {
      shapesPanel.hidden = tool !== "shapes";
    }
  }

  revealTextInsertUi() {
    const textPanel = this.querySelector('[data-tool-panel="text"]');
    const textInput = this.querySelector("[data-text-input]");
    const smoothScroll = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    textPanel?.scrollIntoView({
      behavior: smoothScroll ? "smooth" : "auto",
      block: "nearest",
    });
    requestAnimationFrame(() => {
      textInput?.focus({ preventScroll: true });
      if (textInput && typeof textInput.select === "function") {
        textInput.select();
      }
    });
  }

  /**
   * @param {Record<string, unknown>} [overrides]
   */
  buildTextElementFromForm(overrides = {}) {
    const textInput = this.querySelector("[data-text-input]");
    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");
    const style = { ...this.textDefaults };
    const next = {
      id: crypto.randomUUID(),
      type: "text",
      text: this.normalizeNewlines(String(textInput?.value || "")),
      fontFamily: fontInput?.value || "Arial",
      fontFallback: this.dataset.fontFallback || "sans-serif",
      fontSize: Number(fontSizeInput?.value || 24),
      color: textColorInput?.value || "#000000",
      textAlign: style.textAlign || "left",
      fontWeight: style.fontWeight || "normal",
      fontStyle: style.fontStyle || "normal",
      underline: Boolean(style.underline),
      strikethrough: Boolean(style.strikethrough),
      x: this.canvas.width / 2,
      y: this.canvas.height / 2,
      width: 220,
      height: 60,
      scale: 1,
      flipX: 1,
      flipY: 1,
      rotation: 0,
      ...overrides,
    };
    this.readTextOutlineEffectFromFormInto(next);
    return next;
  }

  async syncTextFromTextareaInput() {
    const textInput = this.querySelector("[data-text-input]");
    const fontInput = this.querySelector("[data-font-input]");
    if (!textInput) {
      return;
    }

    const selectedElement = this.getSelectedElement();
    if (selectedElement?.type === "text") {
      selectedElement.text = this.normalizeNewlines(textInput.value);
      this.render();
      this.updateHiddenProperties();
      return;
    }

    if (!String(textInput.value || "").length) {
      return;
    }

    await this.ensureGoogleFontLoaded(fontInput?.value, { redraw: false });
    const element = this.buildTextElementFromForm();
    this.elements.push(element);
    this.selectedElementId = element.id;
    this.setActiveTool("text");
    this.toggleToolPanels("text");
    this.syncControlInputs();
    this.render();
    this.updatePrice();
  }

  async placeNewTextAtCanvasPoint(canvasX, canvasY) {
    const fontInput = this.querySelector("[data-font-input]");
    const textInput = this.querySelector("[data-text-input]");
    if (textInput) {
      textInput.value = "";
    }
    await this.ensureGoogleFontLoaded(fontInput?.value, { redraw: false });
    const element = this.buildTextElementFromForm({
      x: canvasX,
      y: canvasY,
      text: "",
    });
    this.elements.push(element);
    this.selectedElementId = element.id;
    this.setActiveTool("text");
    this.toggleToolPanels("text");
    this.syncControlInputs();
    this.render();
    this.updatePrice();
    textInput?.focus({ preventScroll: true });
  }

  async tryAddTextFromForm() {
    const textInput = this.querySelector("[data-text-input]");
    const fontInput = this.querySelector("[data-font-input]");
    const textValue = this.normalizeNewlines(
      String(textInput?.value || ""),
    ).trim();
    if (!textValue) {
      return;
    }

    const existing = this.getSelectedElement();
    const existingNorm =
      existing?.type === "text"
        ? this.normalizeNewlines(existing.text || "").trim()
        : "";
    if (existing?.type === "text" && existingNorm === textValue) {
      return;
    }

    await this.ensureGoogleFontLoaded(fontInput?.value, { redraw: false });

    const element = this.buildTextElementFromForm({
      text: textValue,
    });

    this.elements.push(element);
    this.selectedElementId = element.id;
    this.syncControlInputs();
    this.render();
    this.updatePrice();
  }

  syncAlignmentControls(activeAlign) {
    const value = activeAlign || this.textDefaults.textAlign || "left";
    this.querySelectorAll("[data-text-align]").forEach((button) => {
      const align = button.getAttribute("data-text-align");
      const on = align === value;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  syncFormatToolbars() {
    const element = this.getSelectedElement();
    const source = element?.type === "text" ? element : this.textDefaults;
    this.setFormatButtonState(
      "[data-format-bold]",
      source.fontWeight === "bold",
    );
    this.setFormatButtonState(
      "[data-format-italic]",
      source.fontStyle === "italic",
    );
    this.setFormatButtonState(
      "[data-format-underline]",
      Boolean(source.underline),
    );
    this.setFormatButtonState(
      "[data-format-strikethrough]",
      Boolean(source.strikethrough),
    );
  }

  setFormatButtonState(selector, isOn) {
    const button = this.querySelector(selector);
    if (!button) {
      return;
    }
    button.classList.toggle("is-active", isOn);
    button.setAttribute("aria-pressed", isOn ? "true" : "false");
  }

  isCustomerLoggedIn() {
    return this.dataset.customerLoggedIn === "true";
  }

  getDraftApiEndpoint() {
    const raw = String(this.dataset.draftApiEndpoint || "").trim();
    return raw || "";
  }

  getDraftStorageKey() {
    const sectionId = this.dataset.sectionId || "global";
    const productId = this.dataset.productId || "unknown-product";
    return `custom-cover-drafts:v${CUSTOMIZER_DRAFTS_STORAGE_VERSION}:${sectionId}:${productId}`;
  }

  readLocalDrafts() {
    try {
      const raw = window.localStorage.getItem(this.getDraftStorageKey());
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  writeLocalDrafts(drafts) {
    try {
      window.localStorage.setItem(
        this.getDraftStorageKey(),
        JSON.stringify(drafts),
      );
    } catch (error) {
      this.setDraftNotice("Could not persist drafts in browser storage.");
    }
  }

  setDraftNotice(message) {
    this.draftNotice = message || "";
    const noticeEl = this.querySelector("[data-drafts-notice]");
    if (!noticeEl) {
      return;
    }
    noticeEl.textContent = this.draftNotice;
    noticeEl.hidden = !this.draftNotice;
  }

  sortDraftsNewestFirst(drafts) {
    return [...drafts].sort(
      (a, b) =>
        new Date(b.updatedAt || 0).getTime() -
        new Date(a.updatedAt || 0).getTime(),
    );
  }

  mergeDraftLists(localDrafts, remoteDrafts) {
    const mergedById = new Map();
    [...localDrafts, ...remoteDrafts].forEach((draft) => {
      if (!draft?.id) {
        return;
      }
      const existing = mergedById.get(draft.id);
      if (!existing) {
        mergedById.set(draft.id, draft);
        return;
      }
      const existingTime = new Date(existing.updatedAt || 0).getTime();
      const nextTime = new Date(draft.updatedAt || 0).getTime();
      mergedById.set(draft.id, nextTime >= existingTime ? draft : existing);
    });
    return this.sortDraftsNewestFirst([...mergedById.values()]);
  }

  async fetchRemoteDrafts() {
    const endpoint = this.getDraftApiEndpoint();
    if (!endpoint || !this.isCustomerLoggedIn()) {
      return [];
    }
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const drafts = Array.isArray(data?.drafts) ? data.drafts : [];
      return drafts;
    } catch (error) {
      return [];
    }
  }

  async saveRemoteDraft(draft) {
    const endpoint = this.getDraftApiEndpoint();
    if (!endpoint || !this.isCustomerLoggedIn()) {
      return null;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ draft }),
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data?.draft || draft;
    } catch (error) {
      return null;
    }
  }

  async deleteRemoteDraft(draftId) {
    const endpoint = this.getDraftApiEndpoint();
    if (!endpoint || !this.isCustomerLoggedIn()) {
      return false;
    }
    try {
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ id: draftId }),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  formatDraftDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Just now";
    }
    return parsed.toLocaleString();
  }

  renderDraftsList() {
    const list = this.querySelector("[data-drafts-list]");
    const empty = this.querySelector("[data-drafts-empty]");
    if (!list || !empty) {
      return;
    }
    list.replaceChildren();
    const drafts = this.sortDraftsNewestFirst(this.drafts);
    drafts.forEach((draft) => {
      const row = document.createElement("article");
      row.className = "custom-cover-customizer__draft-item";
      row.setAttribute("role", "listitem");
      row.setAttribute("tabindex", "0");
      row.setAttribute("data-draft-item-id", draft.id);

      if (draft.previewDataUrl) {
        const previewWrap = document.createElement("div");
        previewWrap.className = "custom-cover-customizer__draft-preview";

        const previewImage = document.createElement("img");
        previewImage.className = "custom-cover-customizer__draft-preview-image";
        previewImage.src = draft.previewDataUrl;
        previewImage.alt = `${draft.title || "Draft"} preview`;
        previewImage.loading = "lazy";
        previewImage.decoding = "async";
        previewWrap.appendChild(previewImage);
        row.appendChild(previewWrap);
      }

      const title = document.createElement("p");
      title.className = "custom-cover-customizer__draft-title";
      title.textContent = draft.title || "Untitled draft";

      const meta = document.createElement("p");
      meta.className = "custom-cover-customizer__draft-meta";
      const scope = draft.syncState === "synced" ? "Account" : "Local";
      meta.textContent = `${scope} • Updated ${this.formatDraftDate(draft.updatedAt)}`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "custom-cover-customizer__draft-delete";
      deleteBtn.setAttribute("aria-label", "Remove draft");
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      deleteBtn.setAttribute("data-draft-delete-id", draft.id);

      row.append(title, meta, deleteBtn);
      list.appendChild(row);
    });
    empty.hidden = drafts.length > 0;
  }

  getCurrentCustomizerPayload() {
    this.updateHiddenProperties();
    const jsonTarget = this.form?.querySelector("[data-customizer-json]");
    if (!jsonTarget?.value) {
      return null;
    }
    try {
      return JSON.parse(jsonTarget.value);
    } catch (error) {
      return null;
    }
  }

  createDraftFromCurrentState() {
    const now = new Date().toISOString();
    const payload = this.getCurrentCustomizerPayload();
    if (!payload) {
      return null;
    }
    const variantSelector = this.querySelector("[data-variant-selector]");
    const imprintSize = this.resolveImprintSizeForPayload();
    const imprintText = (
      this.querySelector("[data-imprint-text]")?.value || ""
    ).trim();
    const designTitleInput = this.closest(
      ".custom-cover-customizer",
    )?.querySelector("[data-design-title-input]");
    const title =
      String(designTitleInput?.value || "Untitled").trim() || "Untitled";
    return {
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      productId: this.dataset.productId || "",
      variantId: variantSelector?.value || "",
      imprintSize,
      imprintText,
      customizerPayload: payload,
      previewDataUrl: this.canvas.toDataURL("image/png", 0.8),
      sourceTemplate: this.lastTemplateSelection
        ? { ...this.lastTemplateSelection }
        : null,
      syncState: this.isCustomerLoggedIn() ? "synced" : "sync_pending",
    };
  }

  hydrateElementFromDraft(item) {
    const next = { ...item };
    this.ensureElementFlipState(next);
    if ((next.type === "image" || next.type === "clipart") && next.src) {
      const image = new Image();
      image.onload = () => this.render();
      image.src = next.src;
      next.image = image;
    }
    return next;
  }

  applyDraft(draft) {
    const payload = draft?.customizerPayload;
    if (!payload || !Array.isArray(payload.elements)) {
      this.setDraftNotice("Draft could not be loaded.");
      return;
    }
    this.elements = payload.elements.map((item) => {
      const el = this.hydrateElementFromDraft(item);
      if (el.type === "text") {
        this.ensureTextElementOutlineAndEffect(el);
      } else if (el.type === "shape") {
        this.ensureShapeElementOutline(el);
      }
      return el;
    });
    this.selectedElementId =
      this.elements[this.elements.length - 1]?.id || null;
    const variantSelector = this.querySelector("[data-variant-selector]");
    const imprintSizeSelector = this.querySelector("[data-imprint-size]");
    if (imprintSizeSelector && draft.imprintSize) {
      const opts = [...imprintSizeSelector.options];
      const normLoose = (s) =>
        String(s || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();
      const key = normLoose(draft.imprintSize);
      const exact = opts.find((opt) => opt.value === draft.imprintSize);
      const standardMatch =
        exact && !exact.hasAttribute("data-imprint-other-option")
          ? exact
          : opts.find((opt) => {
              if (!opt.value || opt.hasAttribute("data-imprint-other-option")) {
                return false;
              }
              const vLo = normLoose(opt.value);
              const tLo = normLoose(opt.textContent);
              return vLo === key || tLo === key;
            }) || null;

      if (standardMatch) {
        imprintSizeSelector.value = standardMatch.value;
      } else {
        let existing = opts.find((opt) => opt.value === draft.imprintSize);
        if (!existing) {
          const option = document.createElement("option");
          option.value = draft.imprintSize;
          option.textContent = draft.imprintSize;
          imprintSizeSelector.append(option);
          existing = option;
        }
        imprintSizeSelector.value = existing.value;
      }
    }
    const imprintTextInput = this.querySelector("[data-imprint-text]");
    if (imprintTextInput) {
      const v = draft.imprintText || "";
      const tag =
        imprintTextInput.tagName && imprintTextInput.tagName.toUpperCase();
      if (tag === "SELECT" && v) {
        let opt = [...imprintTextInput.options].find(
          (o) => String(o.value || "") === v,
        );
        if (!opt) {
          opt = document.createElement("option");
          opt.value = v;
          opt.textContent = v;
          imprintTextInput.append(opt);
        }
        imprintTextInput.value = v;
      } else {
        imprintTextInput.value = v;
      }
    }
    this.resolveVariantFromImprintSelections();
    if (variantSelector && draft.variantId) {
      const existing = [...variantSelector.options].find(
        (opt) => String(opt.value) === String(draft.variantId),
      );
      if (existing) {
        variantSelector.value = existing.value;
        variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    const designTitleInput = this.closest(
      ".custom-cover-customizer",
    )?.querySelector("[data-design-title-input]");
    if (designTitleInput) {
      designTitleInput.value = draft.title || designTitleInput.value;
      designTitleInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    this.syncControlInputs();
    this.render();
    this.updatePrice();
    this.updateHiddenProperties();
    if (typeof this.setMode === "function") {
      this.setMode("editor");
    }
    this.setDraftNotice("");
  }

  loadDraftById(id) {
    const draft = this.drafts.find((item) => item.id === id);
    if (!draft) {
      return;
    }
    this.applyDraft(draft);
  }

  async deleteDraftById(id) {
    const target = this.drafts.find((item) => item.id === id);
    if (!target) {
      return;
    }
    if (target.syncState === "synced") {
      const deletedRemotely = await this.deleteRemoteDraft(id);
      if (!deletedRemotely && this.isCustomerLoggedIn()) {
        this.setDraftNotice("Could not delete account draft. Try again.");
        return;
      }
    }
    this.drafts = this.drafts.filter((item) => item.id !== id);
    this.writeLocalDrafts(this.drafts);
    this.renderDraftsList();
  }

  async syncPendingDraftsToAccount() {
    if (!this.isCustomerLoggedIn() || this._draftSyncInFlight) {
      return;
    }
    if (!this.getDraftApiEndpoint()) {
      return;
    }
    const pending = this.drafts.filter(
      (draft) => draft.syncState === "sync_pending",
    );
    if (!pending.length) {
      return;
    }
    this._draftSyncInFlight = true;
    let syncFailed = false;
    for (const draft of pending) {
      const synced = await this.saveRemoteDraft({
        ...draft,
        syncState: "synced",
      });
      if (synced) {
        draft.syncState = "synced";
        draft.updatedAt = synced.updatedAt || draft.updatedAt;
      } else {
        syncFailed = true;
      }
    }
    this._draftSyncInFlight = false;
    this.writeLocalDrafts(this.drafts);
    this.renderDraftsList();
    this.setDraftNotice(
      syncFailed
        ? "Some drafts are still local. They will sync when the account endpoint is available."
        : "",
    );
  }

  async initializeDrafts() {
    const localDrafts = this.readLocalDrafts();
    this.drafts = this.sortDraftsNewestFirst(localDrafts);
    this.renderDraftsList();

    if (this.isCustomerLoggedIn()) {
      const remoteDrafts = await this.fetchRemoteDrafts();
      if (remoteDrafts.length) {
        this.drafts = this.mergeDraftLists(this.drafts, remoteDrafts).map(
          (draft) => ({
            ...draft,
            syncState: "synced",
          }),
        );
        this.writeLocalDrafts(this.drafts);
      }
      if (!this.getDraftApiEndpoint()) {
        this.setDraftNotice(
          "Draft API endpoint is not configured. Drafts are currently local only.",
        );
      }
      await this.syncPendingDraftsToAccount();
    }
    this.renderDraftsList();
  }

  async saveCurrentAsDraft() {
    const draft = this.createDraftFromCurrentState();
    if (!draft) {
      this.setDraftNotice("Could not save draft from current design.");
      return;
    }

    if (this.isCustomerLoggedIn() && this.getDraftApiEndpoint()) {
      const saved = await this.saveRemoteDraft({
        ...draft,
        syncState: "synced",
      });
      if (saved) {
        this.drafts = this.sortDraftsNewestFirst([
          { ...draft, ...saved, syncState: "synced" },
          ...this.drafts,
        ]);
        this.setDraftNotice("");
      } else {
        draft.syncState = "sync_pending";
        this.drafts = this.sortDraftsNewestFirst([draft, ...this.drafts]);
        this.setDraftNotice(
          "Draft saved locally. It will sync to your account when the endpoint is available.",
        );
      }
    } else {
      draft.syncState = this.isCustomerLoggedIn()
        ? "local_only"
        : "sync_pending";
      this.drafts = this.sortDraftsNewestFirst([draft, ...this.drafts]);
      if (this.isCustomerLoggedIn()) {
        this.setDraftNotice(
          "Account endpoint is missing. Draft saved locally only.",
        );
      } else {
        this.setDraftNotice("");
      }
    }

    this.writeLocalDrafts(this.drafts);
    this.renderDraftsList();
    if (typeof this.setMode === "function") {
      this.setMode("drafts");
    }
  }

  updateHiddenProperties() {
    const jsonTarget = this.form.querySelector("[data-customizer-json]");
    const statusTarget = this.form.querySelector("[data-safe-area-status]");
    const previewTarget = this.form.querySelector("[data-preview-image]");
    const previewTokenTarget = this.form.querySelector("[data-preview-token]");
    const imprintSizeProperty = this.form.querySelector(
      "[data-imprint-size-property]",
    );
    const imprintTextProperty = this.form.querySelector(
      "[data-imprint-text-property]",
    );

    const safeShape = this.getSafeAreaShape();
    const circleMetrics =
      safeShape === "circle" ? this.getCircleSafeMetrics() : null;

    const imprintTextRaw = (
      this.querySelector("[data-imprint-text]")?.value || ""
    ).trim();
    const imprintSizeResolved = this.resolveImprintSizeForPayload();
    /** Cart line props: imprint text when set; otherwise same measured size so both fields stay dimensional. */
    const imprintLineItemText = imprintTextRaw || imprintSizeResolved;

    const payload = {
      imprintSize: imprintSizeResolved,
      imprintText: imprintTextRaw,
      productColor: (this.dataset.productColor || "").trim(),
      elements: this.elements.map((element) => ({
        id: element.id,
        type: element.type,
        text: element.type === "text" ? element.text : "",
        fontFamily: element.type === "text" ? element.fontFamily : "",
        fontSize: element.type === "text" ? element.fontSize : "",
        color: element.type === "text" ? element.color : "",
        textAlign: element.type === "text" ? element.textAlign || "left" : "",
        fontWeight:
          element.type === "text" ? element.fontWeight || "normal" : "",
        fontStyle: element.type === "text" ? element.fontStyle || "normal" : "",
        underline: element.type === "text" ? Boolean(element.underline) : false,
        strikethrough:
          element.type === "text" ? Boolean(element.strikethrough) : false,
        outlineEnabled:
          element.type === "text" ? Boolean(element.outlineEnabled) : false,
        outlineWidth:
          element.type === "text" ? Number(element.outlineWidth) || 0 : "",
        outlineColor:
          element.type === "text" ? String(element.outlineColor || "") : "",
        textEffect:
          element.type === "text"
            ? this.normalizeTextEffectValue(element.textEffect)
            : "",
        curveRadius:
          element.type === "text" ? Number(element.curveRadius) || 0 : "",
        curveSpacing:
          element.type === "text" ? Number(element.curveSpacing) || 0 : "",
        arcRadius:
          element.type === "text" ? Number(element.arcRadius) || 0 : "",
        arcSpacing:
          element.type === "text" ? Number(element.arcSpacing) || 0 : "",
        stlLeft: element.type === "text" ? Number(element.stlLeft) || 0 : "",
        stlRight: element.type === "text" ? Number(element.stlRight) || 0 : "",
        ltsLeft: element.type === "text" ? Number(element.ltsLeft) || 0 : "",
        ltsRight: element.type === "text" ? Number(element.ltsRight) || 0 : "",
        bulgeLeft:
          element.type === "text" ? Number(element.bulgeLeft) || 0 : "",
        bulgeRight:
          element.type === "text" ? Number(element.bulgeRight) || 0 : "",
        shapeId: element.type === "shape" ? element.shapeId || "" : "",
        shapeKind: element.type === "shape" ? element.shapeKind || "" : "",
        fill: element.type === "shape" ? element.fill || "" : "",
        viewBox:
          element.type === "shape" && element.viewBox != null
            ? Number(element.viewBox)
            : "",
        paths:
          element.type === "shape" && element.paths?.length
            ? element.paths
            : [],
        fillRule: element.type === "shape" ? element.fillRule || "" : "",
        iconifyCollection:
          element.type === "shape" ? element.iconifyCollection || "" : "",
        iconifyIcon: element.type === "shape" ? element.iconifyIcon || "" : "",
        shapeVariant:
          element.type === "shape" ? element.shapeVariant || "" : "",
        strokeEnabled:
          element.type === "shape" ? Boolean(element.strokeEnabled) : false,
        strokeWidth:
          element.type === "shape" ? Number(element.strokeWidth) || 0 : "",
        strokeColor:
          element.type === "shape" ? String(element.strokeColor || "") : "",
        src:
          element.type === "image" || element.type === "clipart"
            ? element.src
            : "",
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width * element.scale),
        height: Math.round(element.height * element.scale),
        rotation: Math.round(element.rotation || 0),
        scale: Number((element.scale || 1).toFixed(2)),
      })),
      safeArea: this.safeArea,
      safeAreaShape: safeShape,
      safeAreaCircle: circleMetrics
        ? {
            cx: Math.round(circleMetrics.cx),
            cy: Math.round(circleMetrics.cy),
            r: Math.round(circleMetrics.r),
          }
        : null,
      safeAreaPass: this.elementsWithinSafeArea(),
      livePrice: this.moneyFormatter.format(this.getLiveTotalCents() / 100),
      imageRightsConfirmed:
        this.querySelector("[data-image-rights]")?.checked || false,
    };

    if (jsonTarget) {
      jsonTarget.value = JSON.stringify(payload);
    }
    if (imprintSizeProperty) {
      imprintSizeProperty.value = payload.imprintSize || "";
    }
    if (imprintTextProperty) {
      imprintTextProperty.value = imprintLineItemText || "";
    }
    if (statusTarget) {
      statusTarget.value = payload.safeAreaPass ? "PASS" : "FAIL";
    }
    const previewDataUrl = this.createCartPreviewDataUrl();
    const previewToken = this.ensurePreviewToken();
    this.savePreviewByToken(previewToken, previewDataUrl);
    if (previewTokenTarget) {
      previewTokenTarget.value = previewToken;
    }
    if (previewTarget) {
      previewTarget.value = previewDataUrl;
    }
  }

  handleSubmit(event) {
    this.ensureVariantIdForCart();
    const variantSelector = this.querySelector("[data-variant-selector]");
    if (!variantSelector?.value) {
      event.preventDefault();
      this.setWarning("Please select a color before saving.");
      return;
    }
    const blockOutside = this.dataset.blockOutsideSafeArea === "true";
    const safe = this.elementsWithinSafeArea();
    if (blockOutside && !safe) {
      event.preventDefault();
      this.setWarning((this.dataset.safeWarning || "").trim());
      return;
    }
    this.updateHiddenProperties();
  }
}

if (!customElements.get("custom-cover-customizer-component")) {
  customElements.define(
    "custom-cover-customizer-component",
    CustomCoverCustomizer,
  );
}
