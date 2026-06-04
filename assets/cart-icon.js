import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent } from '@theme/events';

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubble - The cart bubble element.
 * @property {HTMLElement} cartBubbleText - The cart bubble text element.
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 *
 * @extends {Component<Refs>}
 */
class CartIcon extends Component {
  requiredRefs = ['cartBubble', 'cartBubbleText', 'cartBubbleCount'];

  /** @type {number} */
  get currentCartCount() {
    const rawValue = this.refs.cartBubbleCount.textContent?.trim() || '0';
    const parsedValue = parseInt(rawValue, 10);
    return Number.isNaN(parsedValue) ? 0 : parsedValue;
  }

  set currentCartCount(value) {
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    this.refs.cartBubbleCount.textContent = safeValue < 100 ? String(safeValue) : '99+';
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.addEventListener('pageshow', this.onPageShow);
    this.ensureCartBubbleIsCorrect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  /**
   * Handles the page show event when the page is restored from cache.
   * @param {PageTransitionEvent} event - The page show event.
   */
  onPageShow = (event) => {
    if (event.persisted) {
      this.ensureCartBubbleIsCorrect();
    }
  };

  /**
   * Handles the cart update event.
   * @param {CartUpdateEvent} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    const itemCount = Number(event.detail.data?.itemCount ?? 0);
    const comingFromProductForm = event.detail.data?.source === 'product-form-component';

    this.renderCartBubble(itemCount, comingFromProductForm);
  };

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   * @param {boolean} comingFromProductForm - Whether the cart update is coming from the product form.
   * @param {boolean} animate - Whether to animate the bubble.
   */
  renderCartBubble = async (itemCount, comingFromProductForm, animate = true) => {
    const currentCount = this.currentCartCount;
    const nextCount = comingFromProductForm ? currentCount + itemCount : itemCount;

    this.currentCartCount = nextCount;

    this.refs.cartBubbleCount.classList.toggle('hidden', nextCount === 0);
    this.refs.cartBubble.classList.toggle('visually-hidden', nextCount === 0);
    this.classList.toggle('header-actions__cart-icon--has-cart', nextCount > 0);

    sessionStorage.setItem(
      'cart-count',
      JSON.stringify({
        value: String(nextCount),
        timestamp: Date.now(),
      })
    );

    if (!animate || nextCount === 0) return;

    await new Promise((resolve) => requestAnimationFrame(resolve));

    this.refs.cartBubble.classList.add('cart-bubble--animating');
    await onAnimationEnd(this.refs.cartBubbleText);
    this.refs.cartBubble.classList.remove('cart-bubble--animating');
  };

  /**
   * Checks if the cart count is correct.
   */
  ensureCartBubbleIsCorrect = () => {
    if (!this.refs.cartBubbleCount) return;

    const sessionStorageCount = sessionStorage.getItem('cart-count');
    if (sessionStorageCount === null) return;

    const visibleCount = this.refs.cartBubbleCount.textContent?.trim() || '0';

    try {
      const { value, timestamp } = JSON.parse(sessionStorageCount);

      if (value === visibleCount) return;

      if (Date.now() - timestamp < 10000) {
        const count = parseInt(value, 10);

        if (!Number.isNaN(count) && count >= 0) {
          this.renderCartBubble(count, false, false);
        }
      }
    } catch (_) {
      // no-op
    }
  };
}

if (!customElements.get('cart-icon')) {
  customElements.define('cart-icon', CartIcon);
}