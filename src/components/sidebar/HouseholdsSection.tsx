import { useState, useCallback, memo } from 'react';
import { Home } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import { PersonCard } from '@/components/shared/sim-display';
import type { MapEngine } from '@/map/engine';
import type { HouseholdInfo } from '@/map/types';

interface HouseholdsSectionProps {
  engine: MapEngine | null;
  households: HouseholdInfo[];
}

export const HouseholdsSection = memo(function HouseholdsSection({ engine, households }: HouseholdsSectionProps) {
  const [expandedHouseholdId, setExpandedHouseholdId] = useState<number | null>(null);

  if (households.length === 0) return null;

  const handleHouseholdClick = useCallback((h: HouseholdInfo) => {
    setExpandedHouseholdId(prev => prev === h.id ? null : h.id);
    if (engine) {
      const pos = engine.getBuildingPosition(h.buildingId);
      if (pos) engine.flyToScenePos(pos.x, pos.z);
    }
  }, [engine]);

  const handlePersonClick = useCallback((e: React.MouseEvent, personId: number) => {
    e.stopPropagation();
    engine?.flyToPersonLocation(personId);
  }, [engine]);

  return (
    <SidebarSection icon={<Home className="size-4" />} title="Households" count={households.length}>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {households.map(h => {
          const isExpanded = expandedHouseholdId === h.id;
          return (
            <div key={h.id}>
              <button
                onClick={() => handleHouseholdClick(h)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                  isExpanded
                    ? 'bg-blue-100 border border-blue-300'
                    : 'hover:bg-gray-100 border border-transparent'
                }`}
              >
                <span className="font-medium flex-1">Household #{h.id}</span>
                <span className="text-[10px] text-muted-foreground">{h.members.length}p</span>
                {h.carActive ? (
                  <span className="text-[10px] px-1 py-0.5 bg-amber-200 rounded">Car Out</span>
                ) : (
                  <span className="text-[10px] px-1 py-0.5 bg-green-200 rounded">At Home</span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-3 mr-2 mt-1 mb-2 space-y-1.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span>Food:</span>
                    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${h.foodSupply}%`,
                          backgroundColor: h.foodSupply > 40 ? '#22c55e' : h.foodSupply > 15 ? '#eab308' : '#ef4444',
                        }}
                      />
                    </div>
                    <span>{Math.round(h.foodSupply)}</span>
                  </div>
                  {h.members.map(person => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      onClick={(e) => handlePersonClick(e, person.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
});
