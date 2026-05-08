export function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 skeleton-shimmer" style={{ minHeight: '100px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }} />
  );
}

export function SkeletonTableRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '0.75rem 1rem' }}>
          <div className="skeleton-shimmer rounded" style={{ height: '14px', background: 'rgba(255,255,255,0.06)' }} />
        </td>
      ))}
    </tr>
  );
}
