"use client";

export default function AuthErrorActions({ denied, hubUrl }: { denied: boolean; hubUrl: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "28px" }}>
      {!denied && <button type="button" onClick={() => window.location.reload()}>Try again</button>}
      <a href={hubUrl}>Back to FIKA OS</a>
    </div>
  );
}
