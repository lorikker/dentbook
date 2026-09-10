export interface StatTileProps {
  value: string;
  label: string;
}

export function StatTile({ value, label }: StatTileProps) {
  return (
    <div>
      <div className="font-display text-3xl font-bold tracking-tight text-cream">
        {value}
      </div>
      <div className="mt-1.5 text-xs font-semibold tracking-[0.1em] text-muted-2">
        {label}
      </div>
    </div>
  );
}
