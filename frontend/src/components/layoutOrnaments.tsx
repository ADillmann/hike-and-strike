/** Decorative crossed swords for fantasy layout chrome. */
export function CrossedSwords({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="26"
      height="26"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {/* Blade A */}
        <path d="M11 29 L27 9" />
        <path d="M24.5 7.5 L29.5 12.5" />
        <path d="M9 27 L13 31" />
        {/* Guard A */}
        <path d="M13.5 25.5 L9.5 28.5" />
        <path d="M25.5 11.5 L28.5 8.5" />
        {/* Blade B */}
        <path d="M29 29 L13 9" />
        <path d="M15.5 7.5 L10.5 12.5" />
        <path d="M31 27 L27 31" />
        {/* Guard B */}
        <path d="M26.5 25.5 L30.5 28.5" />
        <path d="M14.5 11.5 L11.5 8.5" />
      </g>
      <circle cx="20" cy="20" r="2" fill="currentColor" />
    </svg>
  );
}

/** Corner flourish for the fantasy header frame. */
export function FrameCorner({ className = '', flipX, flipY }: { className?: string; flipX?: boolean; flipY?: boolean }) {
  const transform = [
    flipX ? 'scaleX(-1)' : '',
    flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={transform ? { transform } : undefined}
    >
      <path
        d="M3 21 V8 Q3 3 8 3 H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 3 Q10 8 8 12"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.7"
      />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Hex chip mark for cyberpunk layout chrome. */
export function CyberHex({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="26"
      height="26"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20 4 L33 12 V28 L20 36 L7 28 V12 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M20 11 L27 15.5 V24.5 L20 29 L13 24.5 V15.5 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.85"
        strokeLinejoin="round"
      />
      {/* Circuit traces */}
      <path d="M20 4 V11" stroke="currentColor" strokeWidth="1.2" />
      <path d="M33 12 L27 15.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 12 L13 15.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M20 29 V36" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="2.2" fill="currentColor" />
      <circle cx="20" cy="4" r="1.2" fill="currentColor" />
      <circle cx="33" cy="12" r="1.2" fill="currentColor" />
      <circle cx="7" cy="12" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** Angular HUD bracket for the cyberpunk header frame. */
export function CyberCorner({ className = '', flipX, flipY }: { className?: string; flipX?: boolean; flipY?: boolean }) {
  const transform = [
    flipX ? 'scaleX(-1)' : '',
    flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={transform ? { transform } : undefined}
    >
      {/* Outer L-bracket with cut corner */}
      <path
        d="M3 21 V9 L9 3 H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* Inner parallel trace */}
      <path
        d="M7 21 V11 L11 7 H21"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />
      {/* Circuit spur + nodes */}
      <path d="M9 3 V7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M14 7 H17" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9" cy="7" r="1.3" fill="currentColor" />
      <circle cx="17" cy="7" r="1" fill="currentColor" />
      <rect x="3" y="14" width="2.5" height="2.5" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/** Heraldic shield mark for knight layout chrome. */
export function KnightShield({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      width="26"
      height="26"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 8 H32 V20 C32 28 26 33 20 36 C14 33 8 28 8 20 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 11 H28 V19.5 C28 25 24 29 20 31.5 C16 29 12 25 12 19.5 Z"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.7"
        strokeLinejoin="round"
      />
      {/* Cross charge */}
      <path d="M20 13 V28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 19 H26" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="20" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Armored plate corner for the knight header frame. */
export function KnightCorner({ className = '', flipX, flipY }: { className?: string; flipX?: boolean; flipY?: boolean }) {
  const transform = [
    flipX ? 'scaleX(-1)' : '',
    flipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={transform ? { transform } : undefined}
    >
      {/* Thick plate L */}
      <path
        d="M3 21 V6 H6 V3 H21"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* Rivets */}
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
      <circle cx="6" cy="13" r="1.1" fill="currentColor" />
      <circle cx="13" cy="6" r="1.1" fill="currentColor" />
      {/* Inner bevel */}
      <path
        d="M8 21 V10 H21"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />
    </svg>
  );
}
