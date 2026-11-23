import { useId } from 'react';

type YCodeLogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
};

// Pixel coordinates (col, row) for the golden pixelated "Y" and "</>" emblem
// matching the official YFactory Code luxury gold-on-black visual identity.
const Y_PIXELS: ReadonlyArray<readonly [number, number]> = [
  // Left upper diagonal
  [0, 0], [1, 0], [2, 0],
  [1, 1], [2, 1], [3, 1],
  [2, 2], [3, 2], [4, 2],
  [3, 3], [4, 3], [5, 3],
  // Right upper diagonal
  [9, 0], [10, 0], [11, 0],
  [8, 1], [9, 1], [10, 1],
  [7, 2], [8, 2], [9, 2],
  [6, 3], [7, 3], [8, 3],
  // Center join & stem
  [4, 4], [5, 4], [6, 4], [7, 4],
  [4, 5], [5, 5], [6, 5], [7, 5],
  [4, 6], [5, 6], [6, 6], [7, 6],
  [4, 7], [5, 7], [6, 7], [7, 7],
  [4, 8], [5, 8], [6, 8], [7, 8],
  [4, 9], [5, 9], [6, 9], [7, 9],
  [4, 10], [5, 10], [6, 10], [7, 10],
];

const CODE_PIXELS: ReadonlyArray<readonly [number, number]> = [
  // "<"
  [1, 1], [0, 2], [1, 3],
  // "/"
  [5, 0], [4, 1], [4, 2], [3, 3], [3, 4],
  // ">"
  [7, 1], [8, 2], [7, 3],
];

export default function YCodeLogo({
  size = 22,
  showWordmark = false,
  className = '',
}: YCodeLogoProps) {
  const uid = useId().replace(/:/g, '');
  const gradGold = `ycode-gold-${uid}`;
  const gradBg = `ycode-bg-${uid}`;
  const gradSheen = `ycode-sheen-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradGold} x1="12" y1="8" x2="108" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF0A8" />
          <stop offset="38%" stopColor="#F5BD38" />
          <stop offset="72%" stopColor="#D99018" />
          <stop offset="100%" stopColor="#FFE17D" />
        </linearGradient>
        <linearGradient id={gradBg} x1="10" y1="10" x2="110" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1C1914" />
          <stop offset="55%" stopColor="#0C0B0A" />
          <stop offset="100%" stopColor="#19140B" />
        </linearGradient>
        <linearGradient id={gradSheen} x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFE89E" stopOpacity="0.22" />
          <stop offset="48%" stopColor="#FFE89E" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Rounded glossy dark badge with luminous gold border */}
      <rect
        x="4"
        y="4"
        width="112"
        height="112"
        rx="26"
        fill={`url(#${gradBg})`}
        stroke={`url(#${gradGold})`}
        strokeWidth="4.2"
      />
      <path
        d="M28 7H92C103.5 7 113 16.5 113 28V42L7 104V28C7 16.5 16.5 7 28 7Z"
        fill={`url(#${gradSheen})`}
      />

      {/* Pixelated Y */}
      <g transform={showWordmark ? 'translate(16, 18)' : 'translate(15, 25)'}>
        {Y_PIXELS.map(([cx, cy], idx) => (
          <rect
            key={`y-${idx}`}
            x={cx * 4.4}
            y={cy * 4.4}
            width="3.6"
            height="3.6"
            rx="0.6"
            fill={`url(#${gradGold})`}
          />
        ))}
      </g>

      {/* Pixelated </> */}
      <g transform={showWordmark ? 'translate(66, 38)' : 'translate(65, 45)'}>
        {CODE_PIXELS.map(([cx, cy], idx) => (
          <rect
            key={`c-${idx}`}
            x={cx * 4.3}
            y={cy * 4.3}
            width="3.5"
            height="3.5"
            rx="0.6"
            fill={`url(#${gradGold})`}
          />
        ))}
      </g>

      {/* Optional luxury golden Code wordmark */}
      {showWordmark && (
        <text
          x="60"
          y="102"
          textAnchor="middle"
          fill={`url(#${gradGold})`}
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
          fontSize="24"
          fontWeight="700"
          letterSpacing="-0.5"
        >
          Code
        </text>
      )}
    </svg>
  );
}
