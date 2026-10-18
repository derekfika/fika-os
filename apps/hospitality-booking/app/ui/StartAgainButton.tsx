"use client";

import type { Ref } from "react";
import { RefreshCw } from "lucide-react";

export default function StartAgainButton({
  className,
  onClick,
  buttonRef,
}: {
  className: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      className={className}
      type="button"
      aria-label="Start again"
      onClick={onClick}
    >
      <RefreshCw aria-hidden="true" focusable="false" size={19} strokeWidth={2} />
    </button>
  );
}
