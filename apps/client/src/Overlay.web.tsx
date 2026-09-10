import React, { useEffect, useRef } from "react";
import type { OverlayProps } from "./Overlay";
import { c } from "./ui";

// iOS can expose the document canvas behind the status bar/home indicator.
// Match the topmost open panel, and restore the page color after closing it.
function syncCanvas() {
  const panels = document.querySelectorAll<HTMLDialogElement>(
    "dialog.flashback-panel[open]",
  );
  const panel = panels.item(panels.length - 1);
  const color = panel ? getComputedStyle(panel).backgroundColor : c.bg;
  document.documentElement.style.setProperty("--flashback-canvas", color);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", color);
}
export default function Overlay({
  children,
  onClose,
  label,
  center,
  backgroundColor = c.surface,
}: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement;
    dialog.showModal();
    syncCanvas();
    return () => {
      dialog.close();
      syncCanvas();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      style={{ backgroundColor }}
      className={"flashback-panel" + (center ? " center" : "")}
      onCancel={(e) => {
        e.preventDefault();
        callback.current();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            callback.current();
        }
      }}
    >
      <div className="flashback-panel-content">{children}</div>
    </dialog>
  );
}
