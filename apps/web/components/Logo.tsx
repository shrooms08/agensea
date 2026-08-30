/**
 * AgenSea mark — canonical v2, transcribed verbatim from
 * design/agensea-mark-left.svg. Ten rounded cells, mass on the right
 * dissolving leftward. Do not redraw: regenerate from that file.
 *
 * DEPRECATED 30 Aug 2026 — the previous 7-cell square-grid mark
 * (`MarkSparse`, cells (6,0)(3,2)(5,3)(2,4)(4,5)(1,6)(6,6) on an 8x8 grid)
 * was superseded by this file on 30 Aug 2026 and must not be used anywhere.
 * The reduced 4-cell favicon variant is derived from a SUBSET of the cells
 * below by scripts-mkicons.py — see that file, not this one.
 *
 * Header uses the RAW framing of the source artboard (deliberately not
 * re-centred); apple-icon.png centres the content instead.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className}
         role="img" aria-label="AgenSea" fill="none">
      <g fill="currentColor">
      <rect x="354.5" y="217.2" width="89.6" height="83.6" rx="20.9" className="mark-cell" />
      <rect x="265.0" y="133.6" width="89.6" height="83.6" rx="20.9" className="mark-cell" />
      <rect x="265.0" y="300.8" width="89.6" height="89.6" rx="22.4" className="mark-cell" />
      <rect x="181.4" y="217.2" width="89.6" height="83.6" rx="20.9" className="mark-cell" />
      <rect x="199.3" y="56.0" width="65.7" height="77.6" rx="16.4" className="mark-cell" />
      <rect x="193.3" y="390.3" width="71.6" height="65.7" rx="16.4" className="mark-cell" />
      <rect x="109.7" y="151.5" width="71.6" height="65.7" rx="16.4" className="mark-cell" />
      <rect x="115.7" y="300.8" width="65.7" height="65.7" rx="16.4" className="mark-cell" />
      <rect x="67.9" y="109.7" width="47.8" height="41.8" rx="10.4" className="mark-cell" />
      <rect x="67.9" y="360.5" width="47.8" height="47.8" rx="11.9" className="mark-cell" />
      </g>
    </svg>
  );
}

/** Full wordmark, 404x100. Display face; pairs with Mark in the header. */
export function Wordmark({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <svg height={height} viewBox="0 0 404 100" className={className} role="img" aria-label="AgenSea">
      <text x="0" y="70" textLength="224" lengthAdjust="spacing" style={{ font: "700 100px 'Space Grotesk',sans-serif", letterSpacing: '-4px' }} fill="currentColor">Agen</text>
          <g fill="currentColor">
            <rect x="244" y="0" width="40" height="10" /><rect x="234" y="10" width="10" height="10" /><rect x="234" y="20" width="10" height="10" /><rect x="244" y="30" width="30" height="10" /><rect x="274" y="40" width="10" height="10" /><rect x="274" y="50" width="10" height="10" /><rect x="234" y="60" width="40" height="10" />
            <rect x="304" y="20" width="30" height="10" /><rect x="294" y="30" width="10" height="10" /><rect x="334" y="30" width="10" height="10" /><rect x="294" y="40" width="50" height="10" /><rect x="294" y="50" width="10" height="10" /><rect x="304" y="60" width="30" height="10" />
            <rect x="364" y="20" width="30" height="10" /><rect x="394" y="30" width="10" height="10" /><rect x="364" y="40" width="40" height="10" /><rect x="354" y="50" width="10" height="10" /><rect x="394" y="50" width="10" height="10" /><rect x="364" y="60" width="40" height="10" />
          </g>
    </svg>
  );
}
