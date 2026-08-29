/**
 * AgenSea logo — SPARSE GRID direction.
 *
 * Transcribed from design/AgenSea_Design_System.html (symbol #ags-mark-sparse).
 * 7 filled cells on an 8x8 grid: (6,0), (3,2), (5,3), (2,4), (4,5), (1,6), (6,6).
 * The reference is explicit that "7 of 64 is a gesture at sparsity, not a
 * stated figure" — do not tie these cells to any live metric.
 *
 * Sizing floor from the reference: the sparse grid needs ~2.3px cells, so it
 * stops being legible below ~18px. Use MarkSparse at 20px+; the reference notes
 * the mark "does not survive a favicon" at 8x8 and drops to 4x5 at 3px cells.
 */
export function MarkSparse({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" className={className} role="img" aria-label="AgenSea">
      <g fill="currentColor" shapeRendering="crispEdges"><rect x="6" y="0" width="1" height="1" /><rect x="3" y="2" width="1" height="1" /><rect x="5" y="3" width="1" height="1" /><rect x="2" y="4" width="1" height="1" /><rect x="4" y="5" width="1" height="1" /><rect x="1" y="6" width="1" height="1" /><rect x="6" y="6" width="1" height="1" /></g>
    </svg>
  );
}

/** Full wordmark, 404x100. Display face; pairs with MarkSparse in the header. */
export function Wordmark({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <svg height={height} viewBox="0 0 404 100" className={className} role="img" aria-label="AgenSea">
      <text x="0" y="70" textLength="224" lengthAdjust="spacing" style="font:700 100px 'Space Grotesk',sans-serif;letter-spacing:-4px" fill="currentColor">Agen</text>
          <g fill="currentColor">
            <rect x="244" y="0" width="40" height="10" /><rect x="234" y="10" width="10" height="10" /><rect x="234" y="20" width="10" height="10" /><rect x="244" y="30" width="30" height="10" /><rect x="274" y="40" width="10" height="10" /><rect x="274" y="50" width="10" height="10" /><rect x="234" y="60" width="40" height="10" />
            <rect x="304" y="20" width="30" height="10" /><rect x="294" y="30" width="10" height="10" /><rect x="334" y="30" width="10" height="10" /><rect x="294" y="40" width="50" height="10" /><rect x="294" y="50" width="10" height="10" /><rect x="304" y="60" width="30" height="10" />
            <rect x="364" y="20" width="30" height="10" /><rect x="394" y="30" width="10" height="10" /><rect x="364" y="40" width="40" height="10" /><rect x="354" y="50" width="10" height="10" /><rect x="394" y="50" width="10" height="10" /><rect x="364" y="60" width="40" height="10" />
          </g>
    </svg>
  );
}
