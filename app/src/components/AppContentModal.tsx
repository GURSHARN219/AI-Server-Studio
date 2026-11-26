import type { ReactNode } from "react";

interface AppContentModalProps {
  children: ReactNode;
  onBackdropClick: () => void;
  labelledBy?: string;
  contentClassName?: string;
}

/**
 * Modal layer for content-area dialogs. It is absolute rather than fixed so
 * the persistent title and status bars remain outside the overlay's stacking
 * and hit-test region.
 */
export default function AppContentModal({ children, onBackdropClick, labelledBy, contentClassName = "max-w-5xl" }: AppContentModalProps) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-8"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        className={`w-full ${contentClassName} max-h-full bg-background/95 border border-border/50 rounded-xl shadow-2xl overflow-hidden flex flex-col backdrop-blur-xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
