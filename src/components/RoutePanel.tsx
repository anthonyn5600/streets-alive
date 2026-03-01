import { X } from 'lucide-react';
import { colorToHex } from '@/components/shared/sim-display';
import type { MapEngine } from '@/map/engine';
import type { SimCarInfo } from '@/map/types';

const ACTIVITY_LABELS: Record<string, string> = {
  home: 'At Home',
  work: 'Working',
  shopping: 'Shopping',
  social: 'Socializing',
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
      className="flex items-center gap-1.5 w-full text-left hover:bg-black/5 rounded px-1 py-0.5 transition-colors"
    >
      <span
        className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
      <span className="truncate text-muted-foreground">
        {address || 'Unknown street'}
      </span>
    </button>
  );
}

export function RoutePanel({ engine, cars }: RoutePanelProps) {
  const selected = cars.filter(c => c.selected);
  if (selected.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-10 bg-white/90 backdrop-blur-sm shadow-md rounded-lg p-3 text-xs min-w-[220px] max-w-[280px]">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">Selected Routes</span>
        <button
          onClick={() => engine?.deselectCar()}
          className="text-muted-foreground hover:text-red-500 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-2.5">
        {selected.map(car => (
          <div key={car.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: colorToHex(car.color) }}
              />
              <span className="font-medium whitespace-nowrap">Car #{car.id}</span>
              <div className="flex-1 min-w-0">
                {car.state === 'driving' && car.routeProgress >= 0 ? (
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(car.routeProgress * 100, 100)}%` }}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground truncate block">
                    {ACTIVITY_LABELS[car.activity ?? ''] ?? 'Parked'}
                  </span>
                )}
              </div>
              <button
                onClick={() => engine?.deselectCar(car.id)}
                className="text-muted-foreground hover:text-red-500 flex-shrink-0 transition-colors"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="pl-4 space-y-0.5">
              <LocationRow
                label="A"
                color="#22a855"
                address={car.originAddress}
                onClick={() => {
                  if (car.originPos) engine?.flyToScenePos(car.originPos.x, car.originPos.z);
                }}
              />
              <LocationRow
                label="B"
                color="#dd3333"
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
}
