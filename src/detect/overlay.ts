import type { OverlayOption } from "../types";

export interface OverlayHandle {
  setOptions(options: OverlayOption[]): void;
  destroy(): void;
}

const Z_INDEX = "2147483647";

export function mountOverlay(deps: {
  video: HTMLVideoElement;
  options: OverlayOption[];
  onSelect: (opt: OverlayOption) => void;
}): OverlayHandle {
  const parent = deps.video.parentElement;
  if (!parent) {
    return { setOptions: () => {}, destroy: () => {} };
  }

  if (getComputedStyle(parent).position === "static" || parent.style.position === "") {
    parent.style.position = "relative";
  }

  let currentOptions: OverlayOption[] = deps.options.slice();
  let dropdown: HTMLDivElement | null = null;

  const btn = document.createElement("div");
  btn.setAttribute("data-warpdl-overlay-btn", "1");
  Object.assign(btn.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    padding: "6px 12px",
    background: "rgba(90, 90, 255, 0.92)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: "600",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: "6px",
    cursor: "pointer",
    zIndex: Z_INDEX,
    pointerEvents: "auto",
    lineHeight: "1",
    userSelect: "none",
  } as CSSStyleDeclaration);
  renderBtnLabel();
  parent.appendChild(btn);

  function renderBtnLabel(): void {
    btn.textContent = currentOptions.length === 0 ? "⬇ Detecting…" : "⬇ WarpDL ▾";
  }

  function toggleDropdown(): void {
    if (dropdown) { closeDropdown(); return; }
    if (currentOptions.length === 0) return;
    dropdown = document.createElement("div");
    dropdown.setAttribute("data-warpdl-overlay-dropdown", "1");
    Object.assign(dropdown.style, {
      position: "absolute",
      top: "44px",
      right: "12px",
      background: "#1a1a2e",
      border: "1px solid #2a2a4a",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      zIndex: Z_INDEX,
      maxHeight: "400px",
      overflowY: "auto",
      minWidth: "220px",
      color: "#e0e0e0",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: "12px",
    } as CSSStyleDeclaration);

    const groups = new Map<string, OverlayOption[]>();
    for (const o of currentOptions) {
      const g = o.group ?? "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(o);
    }

    for (const [groupName, opts] of groups) {
      if (groupName) {
        const header = document.createElement("div");
        header.setAttribute("data-warpdl-overlay-group", "1");
        header.textContent = groupName;
        Object.assign(header.style, {
          padding: "8px 14px 4px",
          fontSize: "11px",
          fontWeight: "600",
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        } as CSSStyleDeclaration);
        dropdown.appendChild(header);
      }
      for (const o of opts) {
        const item = document.createElement("div");
        item.setAttribute("data-warpdl-overlay-item", "1");
        Object.assign(item.style, {
          padding: "8px 14px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        } as CSSStyleDeclaration);
        const mainLine = document.createElement("div");
        mainLine.textContent = o.label;
        item.appendChild(mainLine);
        if (o.sublabel) {
          const sub = document.createElement("div");
          sub.textContent = o.sublabel;
          Object.assign(sub.style, { color: "#888", fontSize: "11px" } as CSSStyleDeclaration);
          item.appendChild(sub);
        }
        item.addEventListener("mouseenter", () => { item.style.background = "#3a3a5a"; });
        item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          deps.onSelect(o);
          closeDropdown();
        });
        dropdown.appendChild(item);
      }
    }

    parent!.appendChild(dropdown);
  }

  function closeDropdown(): void {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
  }

  const btnClick = (e: MouseEvent): void => {
    e.stopPropagation();
    toggleDropdown();
  };

  const outsideClick = (e: MouseEvent): void => {
    if (!dropdown) return;
    if (e.target instanceof Node && (dropdown.contains(e.target) || btn.contains(e.target))) return;
    closeDropdown();
  };

  btn.addEventListener("click", btnClick);
  document.addEventListener("click", outsideClick, true);

  return {
    setOptions(next: OverlayOption[]): void {
      currentOptions = next.slice();
      renderBtnLabel();
      if (dropdown) {
        closeDropdown();
        toggleDropdown();
      }
    },
    destroy(): void {
      btn.removeEventListener("click", btnClick);
      document.removeEventListener("click", outsideClick, true);
      closeDropdown();
      btn.remove();
    },
  };
}
