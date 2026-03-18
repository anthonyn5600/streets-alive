import { memo, useMemo } from 'react';
import { X } from 'lucide-react';
import { colorToHex } from '@/components/shared/sim-display';
import type { MapEngine } from '@/map/engine';
import type { SimCarInfo } from '@/map/types';

const ACTIVITY_LABELS: Record<string, string> = {
  home: 'At Home',
  work: 'Working',
  mall: 'At Mall',
  social: 'Socializing',
  restaurant: 'Eating',
  supermarket: 'Shopping',
};

interface RoutePanelProps {
  engine: MapEngine | null;
  cars: SimCarInfo[];
}

function LocationRow({ label, color, address, onClick }: {
  label: string;
  color: string;
  address: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left hover:bg-panel-hover rounded px-1.5 py-1 transition-colors group"
    >
      <span
        className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-[9px] font-bold font-mono"
        style={{ backgroundColor: color, color: '#0d0f12' }}
      >
        {label}
      </span>
      <span className="truncate text-text-mid group-hover:text-text-bright transition-colors data-readout">
        {address || 'Unknown street'}
      </span>
    </button>
  );
}

export const RoutePanel = memo(function RoutePanel({ engine, cars }: RoutePanelProps) {
  const selected = useMemo(() => cars.filter(c => c.selected), [cars]);
  if (selected.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-20 panel-glass panel-accent noise-overlay rounded-lg p-3 text-xs min-w-[220px] max-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-semibold text-sm text-text-bright tracking-wide">Routes</span>
        <button
          onClick={() => engine?.deselectCar()}
          className="text-text-dim hover:text-rose transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3">
        {selected.map(car => (
          <div key={car.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
                style={{ backgroundColor: colorToHex(car.color) }}
              />
              <span className="font-mono text-[11px] font-medium text-text-bright whitespace-nowrap">#{car.id}</span>
              <div className="flex-1 min-w-0">
                {car.state === 'driving' && car.routeProgress >= 0 ? (
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(car.routeProgress * 100, 100)}%`,
                        background: 'linear-gradient(90deg, #00d4aa, #3b9eff)',
                      }}
                    />
                  </div>
                ) : (
                  <span className="text-amber data-readout block truncate">
                    {ACTIVITY_LABELS[car.activity ?? ''] ?? 'Parked'}
                  </span>
                )}
              </div>
              <button
                onClick={() => engine?.deselectCar(car.id)}
                className="text-text-dim hover:text-rose flex-shrink-0 transition-colors"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="pl-4 space-y-0.5">
              <LocationRow
                label="A"
                color="#00d4aa"
                address={car.originAddress}
                onClick={() => {
                  if (car.originPos) engine?.flyToScenePos(car.originPos.x, car.originPos.z);
                }}
              />
              <LocationRow
                label="B"
                color="#ff6b8a"
                address={car.destinationAddress}
                onClick={() => {
                  if (car.destinationPos) engine?.flyToScenePos(car.destinationPos.x, car.destinationPos.z);
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
