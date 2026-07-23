"use client";

type LiveNumberProps = {
  value: string;
  unit?: string;
  className?: string;
  label: string;
};

export function LiveNumber({ value, unit, className = "", label }: LiveNumberProps) {
  return (
    <span className={`live-number ${className}`} aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <span className="live-number__value">{value}</span>
      {unit && <span className="live-number__unit">{unit}</span>}
    </span>
  );
}

export function formatImpact(value: number, type: "mass" | "volume" | "count") {
  if (type === "mass") {
    if (value >= 1000) return { value: (value / 1000).toFixed(value >= 10_000 ? 1 : 2), unit: "kg" };
    return { value: Math.round(value).toLocaleString("en-GB"), unit: "g" };
  }
  if (type === "volume") {
    if (value >= 1000) return { value: (value / 1000).toFixed(value >= 10_000 ? 1 : 2), unit: "litres" };
    return { value: Math.round(value).toLocaleString("en-GB"), unit: "ml" };
  }
  return { value: Math.round(value).toLocaleString("en-GB"), unit: undefined };
}
