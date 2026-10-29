"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./Sheet.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/** Side drawer on wide screens, bottom sheet on phones. Built on <dialog>. */
export function Sheet({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.inner}>
          <span className={styles.grabber} aria-hidden="true" />
          <header className={styles.header}>
            <h2 id={titleId}>{title}</h2>
            <button type="button" className={`button ${styles.close}`} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
