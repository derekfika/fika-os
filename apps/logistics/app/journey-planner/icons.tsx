import type { ReactNode } from "react";

/** Small stroke icon set for the Journey Planner. Decorative by default (aria-hidden); pair with a text label or aria-label on the control. */
function Icon({ children, size = 20, filled = false }: { children: ReactNode; size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}
type P = { size?: number };
export const CalendarIcon = ({ size }: P) => <Icon size={size}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></Icon>;
export const ChevronLeftIcon = ({ size }: P) => <Icon size={size}><path d="m14.5 6-6 6 6 6" /></Icon>;
export const ChevronRightIcon = ({ size }: P) => <Icon size={size}><path d="m9.5 6 6 6-6 6" /></Icon>;
export const ChevronDownIcon = ({ size }: P) => <Icon size={size}><path d="m6 9.5 6 6 6-6" /></Icon>;
export const ChevronUpIcon = ({ size }: P) => <Icon size={size}><path d="m6 14.5 6-6 6 6" /></Icon>;
export const SearchIcon = ({ size }: P) => <Icon size={size}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>;
export const PlusIcon = ({ size }: P) => <Icon size={size}><path d="M12 5v14M5 12h14" /></Icon>;
export const MinusIcon = ({ size }: P) => <Icon size={size}><path d="M5 12h14" /></Icon>;
export const CloseIcon = ({ size }: P) => <Icon size={size}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
export const MoreIcon = ({ size }: P) => <Icon size={size} filled><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></Icon>;
export const TruckIcon = ({ size }: P) => <Icon size={size}><path d="M3 6.5h11v9H3zM14 9.5h4l3 3v3h-7" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></Icon>;
export const BoxIcon = ({ size }: P) => <Icon size={size}><path d="m12 3 8 4v10l-8 4-8-4V7zM4 7l8 4 8-4M12 11v10" /></Icon>;
export const BuildingIcon = ({ size }: P) => <Icon size={size}><path d="M5 20.5V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M15 10h3a1 1 0 0 1 1 1v9.5M3.5 20.5h17M8.5 8.5h3M8.5 12h3M8.5 15.5h3" /></Icon>;
export const CpuIcon = ({ size }: P) => <Icon size={size}><path d="M3.5 20.5V10l8.5-5 8.5 5v10.5M9 20.5v-6h6v6M3.5 20.5h17" /></Icon>;
export const LockIcon = ({ size }: P) => <Icon size={size}><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></Icon>;
export const PencilIcon = ({ size }: P) => <Icon size={size}><path d="m15 5 4 4L8.5 19.5 4 20l.5-4.5z" /></Icon>;
export const InfoIcon = ({ size }: P) => <Icon size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.2" /></Icon>;
export const TrashIcon = ({ size }: P) => <Icon size={size}><path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" /></Icon>;
export const ArrowRightIcon = ({ size }: P) => <Icon size={size}><path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" /></Icon>;
export const ArrowUpIcon = ({ size }: P) => <Icon size={size}><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></Icon>;
export const ArrowDownIcon = ({ size }: P) => <Icon size={size}><path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" /></Icon>;
export const ClockIcon = ({ size }: P) => <Icon size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>;
/** Six-dot drag handle. */
export const GripIcon = ({ size = 14 }: P) => <svg width={size} height={size * 1.5} viewBox="0 0 10 15" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="2.5" cy="2.5" r="1.3" /><circle cx="7.5" cy="2.5" r="1.3" /><circle cx="2.5" cy="7.5" r="1.3" /><circle cx="7.5" cy="7.5" r="1.3" /><circle cx="2.5" cy="12.5" r="1.3" /><circle cx="7.5" cy="12.5" r="1.3" /></svg>;
