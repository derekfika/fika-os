"use client";

type PresentationFrameProps = {
  children: React.ReactNode;
  activeIndex: number;
  total: number;
  tone: "warm" | "purple" | "ink";
  onRevealControls: () => void;
};

export function PresentationFrame({ children, activeIndex, total, tone, onRevealControls }: PresentationFrameProps) {
  const dark = tone !== "warm";
  return (
    <main className={`presentation presentation--${tone}`}>
      <header className="presentation-header">
        <div className="presentation-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dark ? "/fika-logo-white.png" : "/fika-logo.png"} alt="FIKA — A fresh force for good" />
          <span>Impact</span>
        </div>
        <div className="presentation-location"><strong>One Liverpool Street</strong><span>London</span></div>
        <div className="presentation-live"><i aria-hidden="true" /> Live service</div>
      </header>

      <div className="presentation-stage">{children}</div>

      <footer className="presentation-footer">
        <span className="presentation-counter">{String(activeIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
        <div className="presentation-progress" aria-label={`View ${activeIndex + 1} of ${total}`}>
          {Array.from({ length: total }, (_, index) => <i key={index} className={index === activeIndex ? "active" : index < activeIndex ? "complete" : ""} />)}
        </div>
        <span className="presentation-note">Live demonstration · modelled service data</span>
      </footer>
      <button className="control-reveal" type="button" aria-label="Reveal demonstration controls" onClick={onRevealControls} />
    </main>
  );
}
