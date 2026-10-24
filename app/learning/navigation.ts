/** Catalogue state belongs in the URL, independently of saved learning evidence. */
export function catalogueParams(hash = typeof window === "undefined" ? "" : window.location.hash) {
  return new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
}

export function catalogueRoute(path: string, values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value && value !== "all") params.set(key, value.slice(0, 200));
  }
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function replaceCatalogueParams(values: Record<string, string>) {
  if (typeof window === "undefined") return;
  const path = window.location.hash.slice(1).split("?")[0];
  // Replacing the current entry avoids one history entry/remount per keystroke.
  window.history.replaceState(window.history.state, "", `#${catalogueRoute(path, values)}`);
}

export function focusStudyHeading(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return () => {};
  const frame = window.requestAnimationFrame(() => {
    if (!element.isConnected) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "start" });
  });
  return () => window.cancelAnimationFrame(frame);
}
