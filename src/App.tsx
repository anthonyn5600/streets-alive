import { useState, useCallback, useEffect } from 'react';
import { MapCanvas } from '@/components/MapCanvas';
import { Sidebar } from '@/components/Sidebar';
import { StatusBar } from '@/components/StatusBar';
import { SearchBar } from '@/components/SearchBar';
import { DriverPanel } from '@/components/DriverPanel';
import type { MapEngine } from '@/map/engine';
import type { CarInfo, MapState } from '@/map/types';

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
  const [cars, setCars] = useState<CarInfo[]>([]);

  const handleEngineReady = useCallback((eng: MapEngine) => {
    setEngine(eng);
  }, []);

  const handleStateChange = useCallback((state: MapState) => {
    setMapState(state);
  }, []);

  useEffect(() => {
    if (!engine) return;
    engine.setOnCarStateChange(setCars);
    return () => engine.setOnCarStateChange(() => {});
  }, [engine]);

  return (
    <div className="relative w-full h-full">
      <MapCanvas onEngineReady={handleEngineReady} onStateChange={handleStateChange} />
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3 w-72">
        <SearchBar engine={engine} />
        <Sidebar engine={engine} />
      </div>
      <DriverPanel engine={engine} cars={cars} />
      <StatusBar mapState={mapState} engine={engine} />
    </div>
  );
}

export default App;
