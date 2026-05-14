// Inline SVG echoing the Zoodealio brand: a green map-pin paired with the blue
// wordmark and a "PM" subtitle. Self-contained — no remote asset, no copyrighted
// mascot.

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <svg
        width={28}
        height={28}
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M16 2c-5.5 0-10 4.3-10 9.6 0 6.9 8.4 16.2 9.3 17.2.4.4 1 .4 1.4 0 .9-1 9.3-10.3 9.3-17.2C26 6.3 21.5 2 16 2z"
          fill="#a3b231"
        />
        <circle cx="16" cy="12" r="4" fill="#fdfdfa" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-base font-semibold tracking-tight text-[color:var(--brand-blue)]">
          Zoodealio
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          PM Dashboard
        </span>
      </div>
    </div>
  );
}
