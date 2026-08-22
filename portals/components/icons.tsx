import type { SVGProps } from 'react';

// A small, consistent Lucide-style icon set (stroke 1.75, 24px grid) — no emoji.
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export const IconBuyer = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 10h.01M15 10h.01" /></svg>
);
export const IconSupplier = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 21V9l6 3V9l6 3V9l6 3v9" /><path d="M3 21h18" /><path d="M8 17h2M14 17h2" /></svg>
);
export const IconLender = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 10l9-6 9 6" /><path d="M4 10v9M20 10v9M9 10v9M15 10v9" /><path d="M3 21h18" /></svg>
);
export const IconDoc = (p: IconProps) => (
  <svg {...base(p)}><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6M9 17h4" /></svg>
);
export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></svg>
);
export const IconScan = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M4 12h16" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconClock = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconCoins = (p: IconProps) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="5" /><path d="M18.09 10.37A5 5 0 1 1 16 18.9" /><path d="M7 6h1v4M16.71 13.88l.7.71-2.82 2.82" /></svg>
);
export const IconShield = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3l7 3v6c0 4.5-3 7.3-7 9-4-1.7-7-4.5-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconTruck = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></svg>
);
export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
);
export const IconLink = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 12h6" /><path d="M10 8H8a4 4 0 0 0 0 8h2M14 8h2a4 4 0 0 1 0 8h-2" /></svg>
);
export const IconFinance = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /></svg>
);
export const IconReceipt = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2Z" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
);
