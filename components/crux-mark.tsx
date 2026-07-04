/**
 * The Crux mark: two contour paths — echoing the topographic background —
 * crossing at a single node. The crossing is the product: the point where the
 * agent decides whether money moves. Violet + teal carry the brand; the
 * emerald node is the money semantic used across the app.
 */
export default function CruxMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 27C11 23 13 19.5 16 16C19 12.5 21 9 27 5"
        stroke="url(#crux-violet)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M5 5C11 9 13 12.5 16 16C19 19.5 21 23 27 27"
        stroke="url(#crux-teal)"
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.9"
      />
      <circle cx="16" cy="16" r="3.4" fill="#050509" />
      <circle cx="16" cy="16" r="2.2" fill="#34d399" />
      <defs>
        <linearGradient id="crux-violet" x1="5" y1="27" x2="27" y2="5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
        <linearGradient id="crux-teal" x1="5" y1="5" x2="27" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#99f6e4" />
        </linearGradient>
      </defs>
    </svg>
  );
}
