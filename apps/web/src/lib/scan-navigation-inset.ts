const INSET_PROPERTY = "--scan-navigation-inset";

export function keepScanFocusVisible(
  control: HTMLElement,
  navigation: HTMLElement,
) {
  // Keep pointer clicks in place; only correct keyboard-visible focus.
  // https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible
  if (!control.matches(":focus-visible")) return;
  const target = control.getBoundingClientRect();
  const bar = navigation.getBoundingClientRect();
  if (
    bar.height > 0 &&
    target.left < bar.right &&
    target.right > bar.left &&
    target.bottom > bar.top - 12
  ) {
    // Native focus scrolling does not consistently respect CSS scroll padding.
    // https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
    control.scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    });
  }
}

export function observeScanNavigationInset(
  navigation: HTMLElement,
  root: HTMLElement,
): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const previous = root.style.getPropertyValue(INSET_PROPERTY);
  const priority = root.style.getPropertyPriority(INSET_PROPERTY);
  let active = true;
  const update = () => {
    const height = navigation.getBoundingClientRect().height;
    if (active && Number.isFinite(height) && height > 0) {
      root.style.setProperty(INSET_PROPERTY, `${Math.ceil(height) + 12}px`);
    }
  };
  // Text sizing can change the navigation height without a viewport resize.
  // https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
  const observer = new ResizeObserver(update);
  observer.observe(navigation, { box: "border-box" });
  update();
  return () => {
    active = false;
    observer.disconnect();
    if (previous) root.style.setProperty(INSET_PROPERTY, previous, priority);
    else root.style.removeProperty(INSET_PROPERTY);
  };
}
