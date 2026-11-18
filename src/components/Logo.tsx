export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="appely-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f86ff" />
          <stop offset="1" stopColor="#3f57e6" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#appely-g)" />
      <rect x="13" y="11" width="20" height="25" rx="4" fill="none" stroke="#fff" strokeWidth="2.6" />
      <rect x="18" y="8.5" width="10" height="5" rx="2" fill="#fff" />
      <path d="M17.5 20h11M17.5 25h7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="33" cy="33" r="7.5" fill="#24b89a" stroke="#fff" strokeWidth="2.4" />
      <path d="m29.7 33 2.2 2.2 4-4.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-bold tracking-tight text-night" style={{ fontSize: size * 0.7 }}>
        appel<span className="text-primary">y</span>
      </span>
    </span>
  )
}
