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
    };
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

  bindFields() {
    const addTextButton = this.querySelector("[data-add-text]");
    const uploadInput = this.querySelector("[data-upload-input]");
    const uploadTrigger = this.querySelector("[data-trigger-upload]");
    const openClipart = this.querySelector("[data-open-clipart]");
    const openShapes = this.querySelector("[data-open-shapes]");
    const imageRights = this.querySelector("[data-image-rights]");
    const uploadDropzone = this.querySelector("[data-upload-dropzone]");
    const toolButtons = this.querySelectorAll("[data-tool-button]");
    const clipartButtons = this.querySelectorAll("[data-add-clipart]");
    const variantSelector = this.querySelector("[data-variant-selector]");
    const idField = this.form.querySelector('input[name="id"]');
    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textInput = this.querySelector("[data-text-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");
    const rotateInput = this.querySelector("[data-rotate-input]");
    const scaleInput = this.querySelector("[data-scale-input]");

    addTextButton?.addEventListener("click", () => {
      this.setActiveTool("text");
      const textValue = String(textInput?.value || "").trim();
      if (!textValue) {
        return;
      }

      const element = {
        id: crypto.randomUUID(),
        type: "text",
        text: textValue,
        fontFamily: fontInput?.value || "Arial",
        fontFallback: this.dataset.fontFallback || "sans-serif",
        fontSize: Number(fontSizeInput?.value || 24),
        color: textColorInput?.value || "#000000",
        x: this.canvas.width / 2,
        y: this.canvas.height / 2,
        width: 220,
        height: 60,
        scale: 1,
        rotation: 0,
      };

      this.elements.push(element);
      this.selectedElementId = element.id;
      this.syncControlInputs();
      this.render();
      this.updatePrice();
    });

    uploadInput?.addEventListener("change", (event) => this.handleUpload(event));
    uploadTrigger?.addEventListener("click", () => {
      this.setActiveTool("image");
      this.toggleToolPanels("image");
    });
    uploadDropzone?.addEventListener("click", () => uploadInput?.click());
    uploadDropzone?.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadDropzone.classList.add("is-dragover");
    });
    uploadDropzone?.addEventListener("dragleave", () => uploadDropzone.classList.remove("is-dragover"));
    uploadDropzone?.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadDropzone.classList.remove("is-dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        this.handleUploadFile(file);
      }
    });

    openClipart?.addEventListener("click", () => {
      this.setActiveTool("clipart");
      this.toggleToolPanels("clipart");
      const clipartArea = this.querySelector(".custom-cover-customizer__clipart-list");
      clipartArea?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    openShapes?.addEventListener("click", () => {
      this.setActiveTool("shapes");
      this.toggleToolPanels("shapes");
      this.setWarning("Shapes tool is coming soon.");
    });

    toolButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.getAttribute("data-tool-button");
        if (tool) {
          this.setActiveTool(tool);
        }
      });
    });

    clipartButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.setActiveTool("clipart");
        const src = button.getAttribute("data-src");
        if (!src) {
          return;
        }
        this.addImageElement(src, "clipart");
      });
    });

    variantSelector?.addEventListener("change", () => {
      const selected = variantSelector.options[variantSelector.selectedIndex];
      if (idField) {
        idField.value = selected.value;
      }
      this.variantPriceCents = Number(selected.getAttribute("data-price") || 0);
      this.updatePrice();
    });

    textInput?.addEventListener("input", () => {
      const selectedElement = this.getSelectedElement();
      if (!selectedElement || selectedElement.type !== "text") {
        return;
      }
      selectedElement.text = textInput.value;
      this.render();
      this.updateHiddenProperties();
    });

    fontInput?.addEventListener("change", () => this.updateSelectedTextStyle());
    fontSizeInput?.addEventListener("input", () => this.updateSelectedTextStyle());
    textColorInput?.addEventListener("input", () => this.updateSelectedTextStyle());

    rotateInput?.addEventListener("input", () => {
      const element = this.getSelectedElement();
      if (!element) {
        return;
      }
      element.rotation = Number(rotateInput.value || 0);
      this.render();
      this.updateHiddenProperties();
    });

    scaleInput?.addEventListener("input", () => {
      const element = this.getSelectedElement();
      if (!element) {
        return;
      }
      element.scale = Number(scaleInput.value || 100) / 100;
      this.render();
      this.updateHiddenProperties();
    });

    imageRights?.addEventListener("change", () => this.updateHiddenProperties());

    this.canvas.addEventListener("mousedown", (event) => this.handlePointerDown(event));
    window.addEventListener("mousemove", (event) => this.handlePointerMove(event));
    window.addEventListener("mouseup", () => this.handlePointerUp());

    this.canvas.addEventListener("touchstart", (event) => this.handlePointerDown(event), { passive: true });
    window.addEventListener("touchmove", (event) => this.handlePointerMove(event), { passive: false });
    window.addEventListener("touchend", () => this.handlePointerUp());

    this.form.addEventListener("submit", (event) => this.handleSubmit(event));
    this.toggleToolPanels("text");
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
      this.setWarning(this.dataset.uploadWarning || "Image file is too large for upload.");
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

      this.elements.push(element);
      this.selectedElementId = element.id;
      this.syncControlInputs();
      this.render();
      this.updatePrice();
    };
    img.src = src;
  }

  handlePointerDown(event) {
    const point = this.getPointer(event);
    const hit = this.findElementAtPoint(point.x, point.y);
    if (!hit) {
      this.selectedElementId = null;
      this.render();
      this.syncControlInputs();
      return;
    }

    this.selectedElementId = hit.id;
    this.dragState = {
      elementId: hit.id,
      offsetX: point.x - hit.x,
      offsetY: point.y - hit.y,
    };
    this.syncControlInputs();
    this.render();
  }

  handlePointerMove(event) {
    if (!this.dragState) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const point = this.getPointer(event);
    const element = this.elements.find((item) => item.id === this.dragState.elementId);
    if (!element) {
      return;
    }

    element.x = point.x - this.dragState.offsetX;
    element.y = point.y - this.dragState.offsetY;
    this.render();
    this.updateHiddenProperties();
  }

  handlePointerUp() {
    this.dragState = null;
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

  findElementAtPoint(x, y) {
    for (let index = this.elements.length - 1; index >= 0; index -= 1) {
      const element = this.elements[index];
      const bounds = this.getElementBounds(element);
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        return element;
      }
    }
    return null;
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
    const element = this.getSelectedElement();
    if (!element || element.type !== "text") {
      return;
    }

    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");

    element.fontFamily = fontInput?.value || element.fontFamily;
    element.fontSize = Number(fontSizeInput?.value || element.fontSize);
    element.color = textColorInput?.value || element.color;
    this.render();
    this.updateHiddenProperties();
  }

  getSelectedElement() {
    if (!this.selectedElementId) {
      return null;
    }
    return this.elements.find((element) => element.id === this.selectedElementId) || null;
  }

  syncControlInputs() {
    const element = this.getSelectedElement();
    const rotateInput = this.querySelector("[data-rotate-input]");
    const scaleInput = this.querySelector("[data-scale-input]");
    const textInput = this.querySelector("[data-text-input]");
    const fontInput = this.querySelector("[data-font-input]");
    const fontSizeInput = this.querySelector("[data-font-size-input]");
    const textColorInput = this.querySelector("[data-text-color-input]");

    if (!element) {
      if (rotateInput) rotateInput.value = "0";
      if (scaleInput) scaleInput.value = "100";
      return;
    }

    if (rotateInput) rotateInput.value = String(Math.round(element.rotation || 0));
    if (scaleInput) scaleInput.value = String(Math.round((element.scale || 1) * 100));

    if (element.type === "text") {
      if (textInput) textInput.value = element.text || "";
      if (fontInput) fontInput.value = element.fontFamily || fontInput.value;
      if (fontSizeInput) fontSizeInput.value = String(element.fontSize || 24);
      if (textColorInput) textColorInput.value = element.color || "#000000";
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const safeBounds = this.getSafeAreaBounds();
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(255, 77, 77, 0.85)";
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 6]);
    this.ctx.strokeRect(safeBounds.left, safeBounds.top, safeBounds.width, safeBounds.height);
    this.ctx.restore();

    this.elements.forEach((element) => {
      this.ctx.save();
      this.ctx.translate(element.x, element.y);
      this.ctx.rotate((element.rotation * Math.PI) / 180);
      this.ctx.scale(element.scale, element.scale);

      if (element.type === "text") {
        this.ctx.fillStyle = element.color || "#000000";
        this.ctx.textBaseline = "top";
        this.ctx.font = `${element.fontSize || 24}px ${element.fontFamily || "Arial"}, ${element.fontFallback || "sans-serif"}`;
        this.ctx.fillText(element.text || "", 0, 0);
        const metrics = this.ctx.measureText(element.text || "");
        element.width = Math.max(metrics.width, 20);
        element.height = Math.max((element.fontSize || 24) * 1.2, 24);
      } else if (element.image) {
        this.ctx.drawImage(element.image, 0, 0, element.width, element.height);
      }

      this.ctx.restore();

      if (element.id === this.selectedElementId) {
        const bounds = this.getElementBounds(element);
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(14, 54, 116, 0.9)";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        this.ctx.restore();
      }
    });

    const safe = this.elementsWithinSafeArea();
    this.setWarning(safe ? "" : (this.dataset.safeWarning || "Can’t print up to the edge. Keep your design in the safe area."));
    this.updateHiddenProperties();
  }

  getSafeAreaBounds() {
    return {
      left: (this.safeArea.x / 100) * this.canvas.width,
      top: (this.safeArea.y / 100) * this.canvas.height,
      width: (this.safeArea.width / 100) * this.canvas.width,
      height: (this.safeArea.height / 100) * this.canvas.height,
      right: ((this.safeArea.x + this.safeArea.width) / 100) * this.canvas.width,
      bottom: ((this.safeArea.y + this.safeArea.height) / 100) * this.canvas.height,
    };
  }

  elementsWithinSafeArea() {
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

  updatePrice() {
    const textCount = this.elements.filter((element) => element.type === "text").length;
    const imageCount = this.elements.filter((element) => element.type === "image").length;
    const clipartCount = this.elements.filter((element) => element.type === "clipart").length;
    const addonCents =
      textCount * this.priceAdjustments.text +
      imageCount * this.priceAdjustments.image +
      clipartCount * this.priceAdjustments.clipart;

    const totalCents = this.variantPriceCents + addonCents;
    const priceTarget = this.querySelector("[data-live-price]");
    if (!priceTarget) {
      return;
    }
    priceTarget.textContent = this.moneyFormatter.format(totalCents / 100);
    this.updateHiddenProperties();
  }

  setWarning(message) {
    if (!this.warningOutput) {
      return;
    }
    this.warningOutput.textContent = message || "";
  }

  setActiveTool(tool) {
    const buttons = this.querySelectorAll("[data-tool-button]");
    buttons.forEach((button) => {
      const isActive = button.getAttribute("data-tool-button") === tool;
      button.classList.toggle("is-active", isActive);
    });
  }

  toggleToolPanels(tool) {
    const imagePanel = this.querySelector('[data-tool-panel="image"]');
    const clipartPanel = this.querySelector('[data-tool-panel="clipart"]');
    if (imagePanel) {
      imagePanel.hidden = tool !== "image";
    }
    if (clipartPanel) {
      clipartPanel.hidden = tool !== "clipart";
    }
  }

  updateHiddenProperties() {
    const jsonTarget = this.form.querySelector("[data-customizer-json]");
    const statusTarget = this.form.querySelector("[data-safe-area-status]");
    const previewTarget = this.form.querySelector("[data-preview-image]");

    const payload = {
      imprintSize: this.querySelector("[data-imprint-size]")?.value || "",
      elements: this.elements.map((element) => ({
        id: element.id,
        type: element.type,
        text: element.type === "text" ? element.text : "",
        fontFamily: element.type === "text" ? element.fontFamily : "",
        fontSize: element.type === "text" ? element.fontSize : "",
        color: element.type === "text" ? element.color : "",
        src: element.type === "image" || element.type === "clipart" ? element.src : "",
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width * element.scale),
        height: Math.round(element.height * element.scale),
        rotation: Math.round(element.rotation || 0),
        scale: Number((element.scale || 1).toFixed(2)),
      })),
      safeArea: this.safeArea,
      safeAreaPass: this.elementsWithinSafeArea(),
      livePrice: this.querySelector("[data-live-price]")?.textContent || "",
      imageRightsConfirmed: this.querySelector("[data-image-rights]")?.checked || false,
    };

    if (jsonTarget) {
      jsonTarget.value = JSON.stringify(payload);
    }
    if (statusTarget) {
      statusTarget.value = payload.safeAreaPass ? "PASS" : "FAIL";
    }
    if (previewTarget) {
      previewTarget.value =
        this.dataset.includePreview === "true"
          ? this.canvas.toDataURL("image/png", 0.8).slice(0, 65000)
          : "";
    }
  }

  handleSubmit(event) {
    const blockOutside = this.dataset.blockOutsideSafeArea === "true";
    const safe = this.elementsWithinSafeArea();
    if (blockOutside && !safe) {
      event.preventDefault();
      this.setWarning(this.dataset.safeWarning || "Can’t print up to the edge. Keep your design in the safe area.");
      return;
    }
    this.updateHiddenProperties();
  }
}

if (!customElements.get("custom-cover-customizer-component")) {
  customElements.define("custom-cover-customizer-component", CustomCoverCustomizer);
}
