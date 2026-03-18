import { memo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchSection } from '@/components/sidebar/SearchSection';
import { LayersSection } from '@/components/sidebar/LayersSection';
import { DriversSection } from '@/components/sidebar/DriversSection';
import { HouseholdsSection } from '@/components/sidebar/HouseholdsSection';
import { TestsSection } from '@/components/sidebar/TestsSection';
import type { MapEngine } from '@/map/engine';
import type { SimCarInfo, HouseholdInfo, RuntimeTestResult } from '@/map/types';

interface AppSidebarProps {
  engine: MapEngine | null;
  cars: SimCarInfo[];
  households: HouseholdInfo[];
  testResults: RuntimeTestResult[];
  showTests: boolean;
  onToggleTests: () => void;
}

export const AppSidebar = memo(function AppSidebar({ engine, cars, households, testResults, showTests, onToggleTests }: AppSidebarProps) {
  return (
    <div className="absolute top-4 left-4 z-10 w-80 max-h-[calc(100vh-2rem)] flex flex-col panel-glass panel-accent noise-overlay rounded-lg overflow-hidden">
      <SearchSection engine={engine} />
      <div className="section-divider" />
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
          <LayersSection engine={engine} />
          <div className="section-divider" />
          <DriversSection engine={engine} cars={cars} />
          {households.length > 0 && (
            <>
              <div className="section-divider" />
              <HouseholdsSection engine={engine} households={households} />
            </>
          )}
          <div className="section-divider" />
          <TestsSection testResults={testResults} showTests={showTests} onToggleTests={onToggleTests} />
        </div>
      </ScrollArea>
    </div>
  );
});
