import type { ReactNode } from "react";

/** Small stroke icon set for the driver shell. Decorative: always aria-hidden; the adjacent text carries the meaning. */
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}
type P = { size?: number };
export const MenuIcon = (p: P) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const TruckIcon = (p: P) => <Icon {...p}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></Icon>;
export const CalendarIcon = (p: P) => <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></Icon>;
export const PinIcon = (p: P) => <Icon {...p}><path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></Icon>;
export const BoxIcon = (p: P) => <Icon {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></Icon>;
export const ArrowUpRightIcon = (p: P) => <Icon {...p}><path d="M7 17L17 7M8 7h9v9" /></Icon>;
export const AlertIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></Icon>;
export const CheckIcon = (p: P) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const PlayIcon = (p: P) => <Icon {...p}><path d="M8 5.5v13l10-6.5z" /></Icon>;
export const ArrowRightIcon = (p: P) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const ArrowLeftIcon = (p: P) => <Icon {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>;
export const ChevronRightIcon = (p: P) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>;
export const MapIcon = (p: P) => <Icon {...p}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" /></Icon>;
export const BellIcon = (p: P) => <Icon {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 20h4" /></Icon>;
export const MoreIcon = (p: P) => <Icon {...p}><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></Icon>;
export const NoteIcon = (p: P) => <Icon {...p}><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4M10 12h6M10 16h6" /></Icon>;
