import { useState, useCallback, useEffect } from 'react';
import { MapCanvas } from '@/components/MapCanvas';
import { AppSidebar } from '@/components/AppSidebar';
import { StatusPill } from '@/components/StatusPill';
import { RoutePanel } from '@/components/RoutePanel';
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
  const [simTime, setSimTime] = useState('');

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
    engine.setOnSimTimeChange(setSimTime);
    engine.setParkingDebug(false);
    return () => {
      engine.setOnCarStateChange(() => {});
      engine.setOnHouseholdChange(() => {});
      engine.setOnTestResults(() => {});
      engine.setOnSimTimeChange(() => {});
    };
  }, [engine]);

  useEffect(() => {
    engine?.setTestRunnerEnabled(showTests);
  }, [engine, showTests]);

  const handleToggleTests = useCallback(() => setShowTests(prev => !prev), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        handleToggleTests();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTests]);

  return (
    <TooltipProvider>
      <div className="relative w-full h-full">
        <MapCanvas onEngineReady={handleEngineReady} onStateChange={handleStateChange} />
        <AppSidebar engine={engine} cars={cars} households={households} testResults={testResults} showTests={showTests} onToggleTests={handleToggleTests} />
        <RoutePanel engine={engine} cars={cars} />
        <StatusPill mapState={mapState} engine={engine} simTime={simTime} />
      </div>
    </TooltipProvider>
  );
}

export default App;
