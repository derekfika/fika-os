/* eslint-disable @next/next/no-img-element */

export function ImpactHeader() {
  return (
    <header className="impact-header">
      <a className="fika-lockup" href="#top" aria-label="FIKA Impact home">
        <img src="/fika-logo.png" alt="FIKA — A fresh force for good" />
        <span className="fika-product">Impact</span>
      </a>
      <div className="impact-header__place">
        <span>One Liverpool Street</span>
        <span>London</span>
      </div>
      <div className="live-status"><i aria-hidden="true" /> Live service</div>
    </header>
  );
}
