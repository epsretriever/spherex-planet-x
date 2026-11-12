/**
 * Driftnet's mark: one object caught twice, a dashed ring where it was and a solid dot where it is.
 * The favicon (src/app/icon.svg) draws the same thing on a blue plate.
 */
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="8 9 46 46" aria-hidden="true" focusable="false">
      <path d="M25.5 37.5 L35.5 27.5" stroke="var(--track)" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 6" />
      <circle cx="20" cy="43" r="8" fill="none" stroke="var(--track)" strokeWidth="3" strokeDasharray="4.2 3.2" />
      <circle cx="42" cy="21" r="8.5" fill="var(--text)" />
    </svg>
  );
}
