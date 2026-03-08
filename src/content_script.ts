// Generic video detection content script (all pages except YouTube)

const BUTTON_ID_ATTR = "data-warpdl-btn";

function createOverlayButton(video: HTMLVideoElement): HTMLDivElement {
  const btn = document.createElement("div");
  btn.setAttribute(BUTTON_ID_ATTR, "1");
  btn.textContent = "\u2B07 WarpDL";
  Object.assign(btn.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    padding: "6px 12px",
    background: "rgba(90, 90, 255, 0.9)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: "600",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: "6px",
    cursor: "pointer",
    zIndex: "2147483647",
    opacity: "0",
    transition: "opacity 0.2s",
    pointerEvents: "auto",
    lineHeight: "1",
    userSelect: "none",
  } as CSSStyleDeclaration);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = getVideoSrc(video);
    if (!src) return;

    chrome.runtime.sendMessage({
      type: "DOWNLOAD_VIDEO",
      url: src,
      pageUrl: window.location.href,
    });

    btn.textContent = "\u2713 Sent!";
    setTimeout(() => {
      btn.textContent = "\u2B07 WarpDL";
    }, 2000);
  });

  return btn;
}

function getVideoSrc(video: HTMLVideoElement): string | null {
  // Direct src
  if (video.src && !video.src.startsWith("blob:")) {
    return video.src;
  }
  // Check <source> children
  const source = video.querySelector("source[src]") as HTMLSourceElement | null;
  if (source?.src && !source.src.startsWith("blob:")) {
    return source.src;
  }
  // currentSrc fallback
  if (video.currentSrc && !video.currentSrc.startsWith("blob:")) {
    return video.currentSrc;
  }
  return null;
}

function wrapVideo(video: HTMLVideoElement): void {
  if (video.hasAttribute(BUTTON_ID_ATTR)) return;
  video.setAttribute(BUTTON_ID_ATTR, "wrapped");

  // Ensure parent is positioned for absolute overlay
  const parent = video.parentElement;
  if (!parent) return;

  const parentPos = getComputedStyle(parent).position;
  if (parentPos === "static" || parentPos === "") {
    parent.style.position = "relative";
  }

  const btn = createOverlayButton(video);
  parent.appendChild(btn);

  // Show on hover
  parent.addEventListener("mouseenter", () => {
    if (getVideoSrc(video)) {
      btn.style.opacity = "1";
    }
  });
  parent.addEventListener("mouseleave", () => {
    btn.style.opacity = "0";
  });

  // Watch for src changes (lazy-loaded players)
  const observer = new MutationObserver(() => {
    // Button visibility is handled by hover, no action needed on src change
  });
  observer.observe(video, { attributes: true, attributeFilter: ["src"] });
}

function scanForVideos(): void {
  document.querySelectorAll("video").forEach((video) => {
    wrapVideo(video as HTMLVideoElement);
  });
}

// Initial scan
scanForVideos();

// Observe DOM for dynamically added videos
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLVideoElement) {
        wrapVideo(node);
      } else if (node instanceof HTMLElement) {
        node.querySelectorAll("video").forEach((v) => {
          wrapVideo(v as HTMLVideoElement);
        });
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
