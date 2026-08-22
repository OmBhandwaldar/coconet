import type { CSSProperties } from 'react';

// CocoNet mark — two interlocking chain links (buyer↔supplier↔lender on one chain),
// left link brand-blue, right link link-orange, each with an inner node.
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  const h = size;
  const w = (size / 56) * 92;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 92 56"
      fill="none"
      className={className}
      role="img"
      aria-label="CocoNet"
    >
      <rect x="5" y="14" width="46" height="28" rx="14" stroke="#2F5CB8" strokeWidth="7" />
      <rect x="41" y="14" width="46" height="28" rx="14" stroke="#EC8B40" strokeWidth="7" />
      <circle cx="25" cy="28" r="5.5" fill="#2F5CB8" />
      <circle cx="67" cy="28" r="5.5" fill="#EC8B40" />
    </svg>
  );
}

export function Logo({
  size = 30,
  showWordmark = true,
  className = '',
  style,
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} style={style}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="text-[1.15rem] font-bold leading-none tracking-tight">
          <span className="text-ink">Coco</span>
          <span className="text-accent-dark">Net</span>
        </span>
      )}
    </span>
  );
}
