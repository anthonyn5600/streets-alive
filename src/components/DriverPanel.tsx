import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MapEngine } from '@/map/engine';
import type { CarInfo } from '@/map/types';

interface DriverPanelProps {
  engine: MapEngine | null;
  cars: CarInfo[];
}

const ROAD_TYPE_LABELS: Record<string, string> = {
  motorway: 'Hwy',
  motorway_link: 'Hwy',
  trunk: 'Trunk',
  trunk_link: 'Trunk',
  primary: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
  residential: 'Local',
  unclassified: 'Local',
  living_street: 'Local',
  service: 'Service',
};

function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

export function DriverPanel({ engine, cars }: DriverPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const handleCarClick = (carId: number) => {
    if (!engine) return;

    const car = cars.find(c => c.id === carId);
    if (car?.selected) {
      engine.deselectCar();
    } else {
      engine.selectCarById(carId);
      const pos = engine.getCarPosition(carId);
      if (pos) {
        engine.flyToScenePos(pos.x, pos.z);
      }
    }
  };

  const handleDeselect = (e: React.MouseEvent) => {
    e.stopPropagation();
    engine?.deselectCar();
  };

  return (
    <div className="absolute top-4 right-4 z-10 w-56">
      <Card className="bg-white/90 backdrop-blur-sm shadow-lg">
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Drivers ({cars.length})</span>
            <span className="text-xs text-muted-foreground">{collapsed ? '+' : '-'}</span>
          </CardTitle>
        </CardHeader>
        {!collapsed && (
          <CardContent className="pt-0 pb-2">
            <div className="max-h-80 overflow-y-auto space-y-1">
              {cars.map(car => (
                <button
                  key={car.id}
                  onClick={() => handleCarClick(car.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                    car.selected
                      ? 'bg-blue-100 border border-blue-300'
                      : 'hover:bg-gray-100 border border-transparent'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorToHex(car.color) }}
                  />
                  <span className="font-medium flex-1">Car #{car.id}</span>
                  <span className="text-[10px] px-1 py-0.5 bg-gray-200 rounded">
                    {ROAD_TYPE_LABELS[car.roadType] ?? car.roadType}
                  </span>
                  <span className="text-muted-foreground w-8 text-right">
                    {Math.round(car.speed)}
                  </span>
                  {car.selected && (
                    <span
                      onClick={handleDeselect}
                      className="text-muted-foreground hover:text-red-500 cursor-pointer ml-1"
                    >
                      x
                    </span>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
