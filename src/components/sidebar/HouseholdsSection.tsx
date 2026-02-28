import { useState } from 'react';
import { Home } from 'lucide-react';
import { SidebarSection } from './SidebarSection';
import { PersonCard } from '@/components/shared/sim-display';
import type { MapEngine } from '@/map/engine';
import type { HouseholdInfo } from '@/map/types';

interface HouseholdsSectionProps {
  engine: MapEngine | null;
  households: HouseholdInfo[];
}

export function HouseholdsSection({ engine, households }: HouseholdsSectionProps) {
  const [expandedHouseholdId, setExpandedHouseholdId] = useState<number | null>(null);

  if (households.length === 0) return null;

  const handleHouseholdClick = (h: HouseholdInfo) => {
    if (expandedHouseholdId === h.id) {
      setExpandedHouseholdId(null);
    } else {
      setExpandedHouseholdId(h.id);
      const pos = engine?.getBuildingPosition(h.buildingId);
      if (pos) engine?.flyToScenePos(pos.x, pos.z);
    }
  };

  const handlePersonClick = (e: React.MouseEvent, personId: number) => {
    e.stopPropagation();
    engine?.flyToPersonLocation(personId);
  };

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
}
