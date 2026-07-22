"use client";

import { Pause, Play, RefreshCw, X } from "lucide-react";
import type { Speed } from "../config/impactConfig";

type DemoControlsProps = {
  paused: boolean;
  speed: Speed;
  onPause: () => void;
  onRestart: () => void;
  onSpeed: (speed: Speed) => void;
  onClose: () => void;
};

export function DemoControls({ paused, speed, onPause, onRestart, onSpeed, onClose }: DemoControlsProps) {
  return (
    <aside className="demo-controls" aria-label="Demonstration controls">
      <span>Demo</span>
      <button type="button" onClick={onPause} aria-label={paused ? "Resume demonstration" : "Pause demonstration"}>
        {paused ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <button type="button" onClick={onRestart} aria-label="Restart demonstration"><RefreshCw size={15} /></button>
      <div className="speed-options" aria-label="Demonstration speed">
        {([1, 5, 10] as Speed[]).map((option) => (
          <button key={option} type="button" className={speed === option ? "selected" : ""} onClick={() => onSpeed(option)} aria-label={`Set speed to ${option} times`}>
            {option}×
          </button>
        ))}
      </div>
      <button type="button" onClick={onClose} aria-label="Hide demonstration controls"><X size={15} /></button>
    </aside>
  );
}
