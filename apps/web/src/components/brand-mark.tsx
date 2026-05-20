export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 256 256" role="img">
        <defs>
          <linearGradient id="brand-bg" x1="36" y1="28" x2="220" y2="232" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2b1b3f" />
            <stop offset="0.52" stopColor="#8b2f2f" />
            <stop offset="1" stopColor="#d7a85b" />
          </linearGradient>
          <linearGradient id="brand-page" x1="61" y1="82" x2="195" y2="202" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff9ec" />
            <stop offset="1" stopColor="#e6d0ad" />
          </linearGradient>
          <linearGradient id="brand-gate" x1="92" y1="56" x2="164" y2="150" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f6d58a" />
            <stop offset="1" stopColor="#b76a35" />
          </linearGradient>
        </defs>
        <rect width="256" height="256" rx="56" fill="url(#brand-bg)" />
        <path
          d="M54 78c30 2 55 10 74 28 19-18 44-26 74-28v112c-29 2-54 11-74 28-20-17-45-26-74-28V78Z"
          fill="url(#brand-page)"
        />
        <path d="M128 106v112" fill="none" stroke="#7a4734" strokeWidth="8" strokeLinecap="round" />
        <path
          d="M72 101c20 3 36 10 49 20M72 128c18 3 33 8 45 17M184 101c-20 3-36 10-49 20M184 128c-18 3-33 8-45 17"
          fill="none"
          stroke="#9b7654"
          strokeWidth="7"
          strokeLinecap="round"
          opacity=".55"
        />
        <path
          d="M95 69h66c7 0 13 6 13 13v61c0 7-6 13-13 13H95c-7 0-13-6-13-13V82c0-7 6-13 13-13Z"
          fill="#21162f"
          opacity=".9"
        />
        <path
          d="M104 145V89c0-5 4-9 9-9h30c5 0 9 4 9 9v56"
          fill="none"
          stroke="url(#brand-gate)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path d="M115 144c5-18 21-18 26 0" fill="none" stroke="#f3c46d" strokeWidth="8" strokeLinecap="round" />
        <path d="M86 62c-8 20-7 40 3 60" fill="none" stroke="#d54d4d" strokeWidth="10" strokeLinecap="round" />
        <path d="M170 62c8 20 7 40-3 60" fill="none" stroke="#d54d4d" strokeWidth="10" strokeLinecap="round" />
        <circle cx="128" cy="45" r="7" fill="#fff3c7" />
        <path d="M128 29v7M128 54v7M112 45h7M137 45h7" stroke="#fff3c7" strokeWidth="5" strokeLinecap="round" />
        <circle cx="198" cy="58" r="4" fill="#fff3c7" opacity=".9" />
        <circle cx="62" cy="205" r="4" fill="#fff3c7" opacity=".8" />
      </svg>
    </span>
  );
}
