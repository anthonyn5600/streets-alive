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
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                  isExpanded
                    ? 'bg-teal-dim border border-teal/25 text-text-bright'
                    : 'hover:bg-panel-hover border border-transparent text-text-mid'
                }`}
              >
                <span className="font-mono font-medium flex-1 text-[11px]">#{h.id}</span>
                <span className="data-readout text-text-dim">{h.members.length}p</span>
                {h.carActive ? (
                  <span className="data-readout px-1.5 py-0.5 bg-amber-dim rounded text-amber border border-amber/15">Car Out</span>
                ) : (
                  <span className="data-readout px-1.5 py-0.5 bg-teal-dim rounded text-teal border border-teal/15">At Home</span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-3 mr-2 mt-1 mb-2 space-y-1.5">
                  <div className="flex items-center gap-1 data-readout text-text-dim">
                    <span>Food:</span>
                    <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${h.foodSupply}%`,
                          backgroundColor: h.foodSupply > 40 ? '#00d4aa' : h.foodSupply > 15 ? '#f5a623' : '#ff6b8a',
                        }}
                      />
                    </div>
                    <span className="text-text-mid">{Math.round(h.foodSupply)}</span>
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
