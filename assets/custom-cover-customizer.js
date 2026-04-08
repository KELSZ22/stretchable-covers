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
  }

  connectedCallback() {
    const section = this.closest(".custom-cover-customizer");
    this.canvas = section?.querySelector("[data-customizer-canvas]");
    this.form = this.querySelector("form");
    this.warningOutput = this.querySelector("[data-warning-output]");

    if (!this.canvas || !this.form) {
      return;
    }

    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) {
      return;
    }

    this.setupMoneyFormatter();
    this.bindFields();
    this.seedVariantPrice();
    this.render();
    this.updatePrice();
    void this.preloadGoogleFontsForCanvas();
  }

  disconnectedCallback() {
    if (this._onDesignKeydown) {
      window.removeEventListener("keydown", this._onDesignKeydown);
      this._onDesignKeydown = null;
    }
    if (this._onOutsideCanvasPointerDown) {
      window.removeEventListener("mousedown", this._onOutsideCanvasPointerDown);
      window.removeEventListener(
        "touchstart",
        this._onOutsideCanvasPointerDown,
      );
      this._onOutsideCanvasPointerDown = null;
    }
    this._stopCaretBlinkLoop();
  }

  /** Normalize textarea newlines for canvas layout and storage. */
  normalizeNewlines(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
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
    const variantSizeHelper = this.querySelector(
      '[data-size-helper="variant"]',
    );
    const imprintSizeHelper = this.querySelector(
      '[data-size-helper="imprint"]',
    );
    const idField = this.form.querySelector('input[name="id"]');
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
    const copyBtn = sectionRoot?.querySelector("[data-design-copy]");
    const undoBtn = sectionRoot?.querySelector("[data-design-undo]");
    const redoBtn = sectionRoot?.querySelector("[data-design-redo]");
    const deleteBtn = sectionRoot?.querySelector("[data-design-delete]");
    const downloadBtn = sectionRoot?.querySelector("[data-design-download]");
    const loadBtn = sectionRoot?.querySelector("[data-design-load]");
    const shareBtn = sectionRoot?.querySelector("[data-design-share]");
    const saveDraftBtn = sectionRoot?.querySelector("[data-save-draft]");
    const draftsList = this.querySelector("[data-drafts-list]");
    const draftsEmpty = this.querySelector("[data-drafts-empty]");
    const draftsNotice = this.querySelector("[data-drafts-notice]");

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
    };
    this.setMode = setMode;

    modeTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const mode = tab.getAttribute("data-mode-tab");
        if (!mode) {
          return;
        }
        setMode(mode);
      });
    });

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

    let productCatalog = this.readProductCatalog();

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
      placeholderOption.textContent = "Select product size";
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
        return;
      }
      this.dataset.productId = String(selectedProduct.id);
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
      if (idField) {
        idField.value = "";
      }
      const firstAvailableVariant = selectedProduct.variants.find(
        (variant) => variant.available,
      );
      // Keep Product size unselected in UI, but preserve previous temporary pricing behavior.
      this.variantPriceCents = Number(firstAvailableVariant?.price || 0);
      this.updatePrice();
    };

    productSelector?.addEventListener("change", () => {
      populateVariantsForProduct(productSelector.value);
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
      if (idField) {
        idField.value = selected.value;
      }
      this.variantPriceCents = Number(selected.getAttribute("data-price") || 0);
      this.updatePrice();
    });
    imprintSizeSelector?.addEventListener("change", () =>
      this.updateHiddenProperties(),
    );

    variantSizeHelper?.addEventListener("click", () => {
      if (!variantSelector) {
        return;
      }
      const raw = window.prompt(
        "Enter a product size to find (example: 12x18 or Large).",
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
        this.setWarning(
          "No matching product size found. Please pick from the list.",
        );
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
    copyBtn?.addEventListener("click", () => this.duplicateSelectedElement());
    undoBtn?.addEventListener("click", () => this.undoLastChange());
    redoBtn?.addEventListener("click", () => this.redoLastChange());
    deleteBtn?.addEventListener("click", () => this.deleteSelectedElement());
    downloadBtn?.addEventListener("click", () => this.downloadCanvasPng());
    loadBtn?.addEventListener("click", () => {
      this.setActiveTool("image");
      this.toggleToolPanels("image");
      uploadInput?.click();
    });
    shareBtn?.addEventListener("click", async () => {
      const pageUrl = window.location.href;
      const copied = await this.copyTextToClipboard(pageUrl);
      this.showShareTooltip(shareBtn, copied ? "Copied" : "Copy failed");
    });
    saveDraftBtn?.addEventListener("click", () => {
      void this.saveCurrentAsDraft();
    });
    draftsList?.addEventListener("click", (event) => {
      const loadBtn = event.target.closest("[data-draft-load-id]");
      if (loadBtn) {
        const id = loadBtn.getAttribute("data-draft-load-id");
        if (id) {
          this.loadDraftById(id);
        }
        return;
      }
      const deleteDraftBtn = event.target.closest("[data-draft-delete-id]");
      if (deleteDraftBtn) {
        const id = deleteDraftBtn.getAttribute("data-draft-delete-id");
        if (id) {
          void this.deleteDraftById(id);
        }
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
      });
    }
    populateVariantsForProduct(productSelector?.value || "");
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
    button.setAttribute("data-tooltip", message);
    button.classList.add("is-tooltip-visible");
    if (this._shareTooltipTimer) {
      clearTimeout(this._shareTooltipTimer);
    }
    this._shareTooltipTimer = window.setTimeout(() => {
      button.classList.remove("is-tooltip-visible");
      button.removeAttribute("data-tooltip");
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
          variants: Array.isArray(product?.variants)
            ? product.variants.map((variant) => ({
                id: variant?.id,
                title: String(variant?.title || "").trim(),
                price: Number(variant?.price || 0),
                available: Boolean(variant?.available),
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
          variants: Array.isArray(product?.variants)
            ? product.variants.map((variant) => ({
                id: variant?.id,
                title: String(variant?.title || "").trim(),
                price: Number(variant?.price || 0),
                available:
                  variant?.available !== false &&
                  variant?.inventory_quantity !== 0,
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
    const maxBytes = Number(this.dataset.maxUploadBytes || 0);
    if (maxBytes > 0 && file.size > maxBytes) {
      this.setWarning(
        this.dataset.uploadWarning || "Image file is too large for upload.",
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
      rotation: 0,
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
    this.ctx.fillStyle = element.fill || "#333333";

    if (element.paths?.length) {
      const vb = element.viewBox || 24;
      const rule = element.fillRule || "nonzero";
      this.ctx.scale(w / vb, h / vb);
      for (const d of element.paths) {
        const p = new Path2D(d);
        this.ctx.fill(p, rule);
      }
      return;
    }

    const def = element.shapeId ? this._shapeById.get(element.shapeId) : null;

    if (def?.kind === "builtin") {
      const b = def.builtin;
      if (b === "rectangle") {
        this.ctx.fillRect(0, 0, w, h);
      } else if (b === "ellipse") {
        this.ctx.beginPath();
        this.ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        this.ctx.fill();
      } else if (b === "triangle") {
        this.ctx.beginPath();
        this.ctx.moveTo(w / 2, 0);
        this.ctx.lineTo(w, h);
        this.ctx.lineTo(0, h);
        this.ctx.closePath();
        this.ctx.fill();
      } else {
        this.ctx.fillRect(0, 0, w, h);
      }
      return;
    }

    if (def?.kind === "path" && def.paths?.length) {
      const vb = def.viewBox || 24;
      this.ctx.scale(w / vb, h / vb);
      const rule = def.fillRule || "nonzero";
      for (const d of def.paths) {
        const p = new Path2D(d);
        this.ctx.fill(p, rule);
      }
      return;
    }

    const kind = element.shapeKind || "rectangle";
    if (kind === "rectangle") {
      this.ctx.fillRect(0, 0, w, h);
    } else if (kind === "ellipse") {
      this.ctx.beginPath();
      this.ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (kind === "triangle") {
      this.ctx.beginPath();
      this.ctx.moveTo(w / 2, 0);
      this.ctx.lineTo(w, h);
      this.ctx.lineTo(0, h);
      this.ctx.closePath();
      this.ctx.fill();
    } else {
      this.ctx.fillRect(0, 0, w, h);
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
      Object.assign(this.textDefaults, {
        textAlign: el.textAlign || "left",
        fontWeight: el.fontWeight || "normal",
        fontStyle: el.fontStyle || "normal",
        underline: Boolean(el.underline),
        strikethrough: Boolean(el.strikethrough),
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
      const centerX = (el.width || 0) / 2;
      const centerY = (el.height || 0) / 2;
      const startDist = Math.max(
        8,
        Math.hypot(local.x - centerX, local.y - centerY),
      );
      this.dragState = {
        mode: "scale",
        elementId: el.id,
        startScale: el.scale || 1,
        startDist,
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
      const local = this.canvasToLocal(point.x, point.y, element);
      const centerX = (element.width || 0) / 2;
      const centerY = (element.height || 0) / 2;
      const nowDist = Math.max(
        8,
        Math.hypot(local.x - centerX, local.y - centerY),
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
    return {
      x: (dx * cos + dy * sin) / s + centerX,
      y: (-dx * sin + dy * cos) / s + centerY,
    };
  }

  localToCanvas(lx, ly, el) {
    const centerX = (el.width || 0) / 2;
    const centerY = (el.height || 0) / 2;
    const rad = ((el.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const s = el.scale || 1;
    const sx = (lx - centerX) * s;
    const sy = (ly - centerY) * s;
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
    this.updateColorChrome();
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
      this.syncFormatToolbars();
      this.syncAlignmentControls(this.textDefaults.textAlign);
      this.updateColorChrome();
      this.updateShapeFillChrome();
    } else {
      if (textInput) {
        textInput.value = "";
      }
      this.syncFormatToolbars();
      this.syncAlignmentControls(this.textDefaults.textAlign);
      this.updateColorChrome();
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.elements.forEach((element) => {
      this.ctx.save();
      this.ctx.translate(element.x, element.y);
      this.ctx.translate(element.width / 2, element.height / 2);
      this.ctx.rotate((element.rotation * Math.PI) / 180);
      this.ctx.scale(element.scale, element.scale);
      this.ctx.translate(-element.width / 2, -element.height / 2);

      if (element.type === "text") {
        const fontPx = element.fontSize || 24;
        const family = element.fontFamily || "Arial";
        const fallback = element.fontFallback || "sans-serif";
        const weight = element.fontWeight === "bold" ? "bold" : "normal";
        const fontStyle = element.fontStyle === "italic" ? "italic" : "normal";
        const text = this.normalizeNewlines(element.text || "");
        const lineHeight = fontPx * 1.2;
        const lines = text.length > 0 ? text.split("\n") : [""];
        this.ctx.textBaseline = "top";
        this.ctx.font = `${fontStyle} ${weight} ${fontPx}px ${family}, ${fallback}`;
        let maxW = 20;
        for (const line of lines) {
          maxW = Math.max(maxW, this.ctx.measureText(line).width);
        }
        element.width = maxW;
        element.height = Math.max(lineHeight, lines.length * lineHeight);
        const rawAlign = element.textAlign || "left";
        const canvasAlign = rawAlign === "justify" ? "left" : rawAlign;
        this.ctx.textAlign = canvasAlign;
        this.ctx.fillStyle = element.color || "#000000";

        lines.forEach((line, lineIndex) => {
          const y = lineIndex * lineHeight;
          const lineW = this.ctx.measureText(line).width;
          let drawX = 0;
          if (canvasAlign === "center") {
            drawX = element.width / 2;
          } else if (canvasAlign === "right") {
            drawX = element.width;
          }
          this.ctx.fillText(line, drawX, y);

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

          if (element.underline && line) {
            const underlineY = y + fontPx * 1.12;
            this.ctx.strokeStyle = element.color || "#000000";
            this.ctx.lineWidth = Math.max(1, fontPx / 14);
            this.ctx.beginPath();
            this.ctx.moveTo(x1, underlineY);
            this.ctx.lineTo(x2, underlineY);
            this.ctx.stroke();
          }
          if (element.strikethrough && line) {
            const strikeY = y + fontPx * 0.55;
            this.ctx.strokeStyle = element.color || "#000000";
            this.ctx.lineWidth = Math.max(1, fontPx / 14);
            this.ctx.beginPath();
            this.ctx.moveTo(x1, strikeY);
            this.ctx.lineTo(x2, strikeY);
            this.ctx.stroke();
          }
        });
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
    this.setWarning(
      safe
        ? ""
        : this.dataset.safeWarning ||
            "Can’t print up to the edge. Keep your design in the safe area.",
    );
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
      return restored;
    });
    this.selectedElementId = snapshot.selectedElementId || null;
    this.syncControlInputs();
    this.render();
    this.updatePrice();
    this.updateHiddenProperties();
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
    const priceOutput = sectionRoot?.querySelector(
      ".custom-cover-customizer__preview-footer-price",
    );
    if (priceOutput) {
      const total = this.moneyFormatter.format(this.getLiveTotalCents() / 100);
      priceOutput.textContent = `Total: ${total}`;
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
    return {
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
      rotation: 0,
      ...overrides,
    };
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

      const title = document.createElement("p");
      title.className = "custom-cover-customizer__draft-title";
      title.textContent = draft.title || "Untitled draft";

      const meta = document.createElement("p");
      meta.className = "custom-cover-customizer__draft-meta";
      const scope = draft.syncState === "synced" ? "Account" : "Local";
      meta.textContent = `${scope} • Updated ${this.formatDraftDate(draft.updatedAt)}`;

      const actions = document.createElement("div");
      actions.className = "custom-cover-customizer__draft-actions";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "custom-cover-customizer__draft-action";
      loadBtn.textContent = "Load";
      loadBtn.setAttribute("data-draft-load-id", draft.id);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className =
        "custom-cover-customizer__draft-action custom-cover-customizer__draft-action--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.setAttribute("data-draft-delete-id", draft.id);

      actions.append(loadBtn, deleteBtn);
      row.append(title, meta, actions);
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
    const imprintSize = this.querySelector("[data-imprint-size]")?.value || "";
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
    this.elements = payload.elements.map((item) =>
      this.hydrateElementFromDraft(item),
    );
    this.selectedElementId =
      this.elements[this.elements.length - 1]?.id || null;
    const variantSelector = this.querySelector("[data-variant-selector]");
    if (variantSelector && draft.variantId) {
      const existing = [...variantSelector.options].find(
        (opt) => opt.value === draft.variantId,
      );
      if (existing) {
        variantSelector.value = draft.variantId;
        variantSelector.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    const imprintSizeSelector = this.querySelector("[data-imprint-size]");
    if (imprintSizeSelector && draft.imprintSize) {
      const existing = [...imprintSizeSelector.options].find(
        (opt) => opt.value === draft.imprintSize,
      );
      if (!existing) {
        const option = document.createElement("option");
        option.value = draft.imprintSize;
        option.textContent = draft.imprintSize;
        imprintSizeSelector.append(option);
      }
      imprintSizeSelector.value = draft.imprintSize;
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

    const safeShape = this.getSafeAreaShape();
    const circleMetrics =
      safeShape === "circle" ? this.getCircleSafeMetrics() : null;

    const payload = {
      imprintSize: this.querySelector("[data-imprint-size]")?.value || "",
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
    const variantSelector = this.querySelector("[data-variant-selector]");
    if (!variantSelector?.value) {
      event.preventDefault();
      this.setWarning("Please select a product size before saving.");
      return;
    }
    const blockOutside = this.dataset.blockOutsideSafeArea === "true";
    const safe = this.elementsWithinSafeArea();
    if (blockOutside && !safe) {
      event.preventDefault();
      this.setWarning(
        this.dataset.safeWarning ||
          "Can’t print up to the edge. Keep your design in the safe area.",
      );
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
