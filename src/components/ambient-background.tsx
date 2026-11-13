export function AmbientBackground({ paused }: { paused: boolean }) {
  return (
    <div className="ambient-background" data-paused={paused} aria-hidden="true">
      <div className="ambient-background__glow ambient-background__glow--sage" />
      <div className="ambient-background__glow ambient-background__glow--mint" />
      <div className="ambient-background__grid" />
      <svg
        className="ambient-background__contours"
        viewBox="0 0 1440 1000"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <path d="M920-180C650 80 1430 150 1260 510S810 740 1060 1160" />
        <path d="M965-180C695 80 1475 150 1305 510S855 740 1105 1160" />
        <path d="M1010-180C740 80 1520 150 1350 510S900 740 1150 1160" />
        <circle cx="1275" cy="180" r="185" />
        <circle cx="1275" cy="180" r="205" />
      </svg>
    </div>
  );
}
