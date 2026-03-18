import { useState, useCallback, memo } from 'react';
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
  mall: 'At Mall',
  social: 'Socializing',
  restaurant: 'Eating',
  supermarket: 'Shopping',
};

interface DriversSectionProps {
  engine: MapEngine | null;
  cars: SimCarInfo[];
}

export const DriversSection = memo(function DriversSection({ engine, cars }: DriversSectionProps) {
  const [expandedCarId, setExpandedCarId] = useState<number | null>(null);

  const handleCarClick = useCallback((carId: number) => {
    if (!engine) return;
    const car = cars.find(c => c.id === carId);
    if (car?.selected) {
      engine.deselectCar(carId);
      setExpandedCarId(prev => prev === carId ? null : prev);
    } else {
      engine.selectCarById(carId);
      setExpandedCarId(carId);
      const pos = engine.getCarPosition(carId);
      if (pos) engine.flyToScenePos(pos.x, pos.z);
    }
  }, [engine, cars]);

  const handleDeselect = useCallback((e: React.MouseEvent, carId: number) => {
    e.stopPropagation();
    engine?.deselectCar(carId);
    setExpandedCarId(prev => prev === carId ? null : prev);
  }, [engine]);

  return (
    <SidebarSection icon={<Car className="size-4" />} title="Drivers" count={cars.length}>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {cars.map(car => {
          const isExpanded = expandedCarId === car.id && car.selected;
          return (
            <div key={car.id}>
              <button
                onClick={() => handleCarClick(car.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                  car.selected
                    ? 'bg-teal-dim border border-teal/25 text-text-bright'
                    : 'hover:bg-panel-hover border border-transparent text-text-mid'
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/10"
                  style={{ backgroundColor: colorToHex(car.color) }}
                />
                <span className="font-mono font-medium flex-1 text-[11px]">#{car.id}</span>
                {car.state === 'parked' ? (
                  <span className="data-readout px-1.5 py-0.5 bg-amber-dim rounded text-amber border border-amber/15">
                    {ACTIVITY_LABELS[car.activity ?? ''] ?? 'Parked'}
                  </span>
                ) : (
                  <>
                    <span className="data-readout px-1.5 py-0.5 bg-white/[0.04] rounded text-text-dim border border-white/[0.06]">
                      {ROAD_TYPE_LABELS[car.roadType] ?? car.roadType}
                    </span>
                    <span className="data-readout text-text-dim w-8 text-right">
                      {Math.round(car.speed)}
                    </span>
                  </>
                )}
                {car.selected && (
                  <span
                    onClick={(e) => handleDeselect(e, car.id)}
                    className="text-text-dim hover:text-rose cursor-pointer ml-1 transition-colors"
                  >
                    <X className="size-3" />
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-5 mr-2 mt-1 mb-2 space-y-2">
                  {car.state === 'parked' && car.activity && (
                    <div className="data-readout text-amber">
                      {ACTIVITY_LABELS[car.activity]}
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
                      <div className="data-readout text-text-dim font-medium uppercase tracking-wider">Guests</div>
                      {car.guestOccupants.map(person => (
                        <div key={person.id} className="space-y-0.5">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="font-display font-medium text-text-bright">{person.name}</span>
                            <span className="data-readout px-1 py-0 bg-purple-500/15 rounded text-purple-400 border border-purple-500/20">
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
});
