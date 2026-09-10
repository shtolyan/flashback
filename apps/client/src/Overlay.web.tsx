import React, { useEffect, useRef } from "react";
import type { OverlayProps } from "./Overlay";
export default function Overlay({
  children,
  onClose,
  label,
  center,
}: OverlayProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={label}
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: center ? "auto" : "100%",
          maxHeight: center ? "90dvh" : undefined,
        }}
      >
        {children}
      </div>
    </dialog>
  );
}
