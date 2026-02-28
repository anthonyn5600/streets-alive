import { useState, useCallback, useEffect } from 'react';
import { MapCanvas } from '@/components/MapCanvas';
import { AppSidebar } from '@/components/AppSidebar';
import { StatusPill } from '@/components/StatusPill';
import { RuntimeTestPanel } from '@/components/RuntimeTestPanel';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MapEngine } from '@/map/engine';
import type { SimCarInfo, HouseholdInfo, MapState, RuntimeTestResult } from '@/map/types';

const defaultState: MapState = {
  loading: false,
  loadingTiles: 0,
  totalTiles: 0,
  cursorLatLng: null,
  cameraLatLng: null,
  zoomLevel: 0,
};

function App() {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [mapState, setMapState] = useState<MapState>(defaultState);
  const [cars, setCars] = useState<SimCarInfo[]>([]);
  const [households, setHouseholds] = useState<HouseholdInfo[]>([]);
  const [testResults, setTestResults] = useState<RuntimeTestResult[]>([]);
  const [showTests, setShowTests] = useState(false);

  const handleEngineReady = useCallback((eng: MapEngine) => {
    setEngine(eng);
  }, []);

  const handleStateChange = useCallback((state: MapState) => {
    setMapState(state);
  }, []);

  useEffect(() => {
    if (!engine) return;
    engine.setOnCarStateChange(setCars);
    engine.setOnHouseholdChange(setHouseholds);
    engine.setOnTestResults(setTestResults);
    engine.setParkingDebug(false);
    return () => {
      engine.setOnCarStateChange(() => {});
      engine.setOnHouseholdChange(() => {});
      engine.setOnTestResults(() => {});
    };
  }, [engine]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        setShowTests(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <TooltipProvider>
      <div className="relative w-full h-full">
        <MapCanvas onEngineReady={handleEngineReady} onStateChange={handleStateChange} />
        <AppSidebar engine={engine} cars={cars} households={households} />
        <RuntimeTestPanel results={testResults} visible={showTests} />
        <StatusPill
          mapState={mapState}
          engine={engine}
          testResults={testResults}
          onToggleTests={() => setShowTests(prev => !prev)}
        />
      </div>
    </TooltipProvider>
  );
}

export default App;
