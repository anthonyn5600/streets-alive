import { useState } from 'react';
import { Car, X } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import { NeedBars, LocationBadge, PersonCard, colorToHex } from '@/components/shared/sim-display';
import type { MapEngine } from '@/map/engine';
import type { SimCarInfo } from '@/map/types';

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

const ACTIVITY_LABELS: Record<string, string> = {
  home: 'At Home',
  work: 'Working',
  shopping: 'Shopping',
  social: 'Socializing',
};

interface DriversSectionProps {
  engine: MapEngine | null;
  cars: SimCarInfo[];
}

export function DriversSection({ engine, cars }: DriversSectionProps) {
  const [expandedCarId, setExpandedCarId] = useState<number | null>(null);

  const handleCarClick = (carId: number) => {
    if (!engine) return;
    const car = cars.find(c => c.id === carId);
    if (car?.selected) {
      engine.deselectCar();
      setExpandedCarId(null);
    } else {
      engine.selectCarById(carId);
      setExpandedCarId(carId);
      const pos = engine.getCarPosition(carId);
      if (pos) engine.flyToScenePos(pos.x, pos.z);
    }
  };

  const handleDeselect = (e: React.MouseEvent) => {
    e.stopPropagation();
    engine?.deselectCar();
    setExpandedCarId(null);
  };

  return (
    <SidebarSection icon={<Car className="size-4" />} title="Drivers" count={cars.length}>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {cars.map(car => {
          const isExpanded = expandedCarId === car.id && car.selected;
          return (
            <div key={car.id}>
              <button
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
                {car.state === 'parked' ? (
                  <span className="text-[10px] px-1 py-0.5 bg-amber-200 rounded">
                    {ACTIVITY_LABELS[car.activity ?? ''] ?? 'Parked'}
                  </span>
                ) : (
                  <>
                    <span className="text-[10px] px-1 py-0.5 bg-gray-200 rounded">
                      {ROAD_TYPE_LABELS[car.roadType] ?? car.roadType}
                    </span>
                    <span className="text-muted-foreground w-8 text-right">
                      {Math.round(car.speed)}
                    </span>
                  </>
                )}
                {car.selected && (
                  <span
                    onClick={handleDeselect}
                    className="text-muted-foreground hover:text-red-500 cursor-pointer ml-1"
                  >
                    <X className="size-3" />
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-5 mr-2 mt-1 mb-2 space-y-2">
                  {car.state === 'parked' && car.activity && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{ACTIVITY_LABELS[car.activity]}</span>
                        <span>{Math.ceil(car.dwellRemaining)}s</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${car.dwellProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {car.occupants.length > 0 && (
                    <div className="space-y-1.5">
                      {car.occupants.map(person => (
                        <PersonCard key={person.id} person={person} />
                      ))}
                    </div>
                  )}

                  {car.guestOccupants.length > 0 && (
                    <div className="space-y-1.5 mt-1">
                      <div className="text-[10px] text-muted-foreground font-medium">Guests</div>
                      {car.guestOccupants.map(person => (
                        <div key={person.id} className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="font-medium">{person.name}</span>
                            <span className="text-[9px] px-1 py-0 bg-purple-100 rounded text-purple-700">
                              {person.job}
                            </span>
                            <LocationBadge location={person.location} />
                          </div>
                          <NeedBars needs={person.needs} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
}
