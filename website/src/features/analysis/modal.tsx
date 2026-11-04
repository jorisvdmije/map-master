import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, close, children, className = "", descriptionId }: { title: string; close: () => void; children: ReactNode; className?: string; descriptionId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={`an-dialog ${className}`} aria-labelledby="analysis-dialog-title" aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="an-panel-title"><h2 id="analysis-dialog-title">{title}</h2><button className="an-icon" aria-label="Close dialog" onClick={close}><X size={18} /></button></div>
    {children}
  </dialog>;
}
