"use client";

import { ChevronLeft, ChevronRight, Gauge, Pause, Play, RefreshCw, RotateCcw, X } from "lucide-react";
import type { Speed } from "../config/impactConfig";

type DemoControlsProps = {
  paused: boolean;
  rotationPaused: boolean;
  speed: Speed;
  activeIndex: number;
  totalViews: number;
  onPauseSimulation: () => void;
  onPauseRotation: () => void;
  onRestartSimulation: () => void;
  onRestartPresentation: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onView: (index: number) => void;
  onSpeed: (speed: Speed) => void;
  onClose: () => void;
};

export function DemoControls(props: DemoControlsProps) {
  return (
    <aside className="demo-controls" aria-label="Demonstration controls">
      <div className="demo-control-group">
        <span>Presentation</span>
        <button type="button" onClick={props.onPrevious} aria-label="Previous view"><ChevronLeft size={16} /></button>
        <button type="button" onClick={props.onPauseRotation} aria-label={props.rotationPaused ? "Resume presentation" : "Pause presentation"}>
          {props.rotationPaused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button type="button" onClick={props.onNext} aria-label="Next view"><ChevronRight size={16} /></button>
        <button type="button" onClick={props.onRestartPresentation} aria-label="Restart presentation"><RotateCcw size={15} /></button>
      </div>
      <div className="view-jump" aria-label="Jump to view">
        {Array.from({ length: props.totalViews }, (_, index) => (
          <button key={index} type="button" className={index === props.activeIndex ? "selected" : ""} onClick={() => props.onView(index)} aria-label={`Show view ${index + 1}`}>{index + 1}</button>
        ))}
      </div>
      <div className="demo-control-group">
        <span>Simulation</span>
        <button type="button" onClick={props.onPauseSimulation} aria-label={props.paused ? "Resume simulation" : "Pause simulation"}>
          {props.paused ? <Play size={15} /> : <Gauge size={15} />}
        </button>
        <button type="button" onClick={props.onRestartSimulation} aria-label="Restart simulation"><RefreshCw size={15} /></button>
        <div className="speed-options" aria-label="Simulation speed">
          {([1, 5, 10] as Speed[]).map((option) => (
            <button key={option} type="button" className={props.speed === option ? "selected" : ""} onClick={() => props.onSpeed(option)} aria-label={`Set speed to ${option} times`}>{option}×</button>
          ))}
        </div>
      </div>
      <button className="demo-controls__close" type="button" onClick={props.onClose} aria-label="Hide demonstration controls"><X size={15} /></button>
    </aside>
  );
}
