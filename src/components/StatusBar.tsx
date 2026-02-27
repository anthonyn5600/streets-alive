import type { MapState } from '@/map/types';
import type { MapEngine } from '@/map/engine';
import { useEffect, useState } from 'react';

interface StatusBarProps {
  mapState: MapState;
  engine: MapEngine | null;
}

export function StatusBar({ mapState, engine }: StatusBarProps) {
  const [cursorPos, setCursorPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!engine) return;
    engine.setOnCursorChange(setCursorPos);
    return () => engine.setOnCursorChange(() => {});
  }, [engine]);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 bg-white/90 backdrop-blur-sm border-t border-border px-4 py-1.5 flex items-center gap-6 text-xs text-muted-foreground">
      {mapState.loading && (
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading {mapState.loadingTiles} tile{mapState.loadingTiles !== 1 ? 's' : ''}...</span>
        </div>
      )}
      <span>
        Tiles: {mapState.totalTiles - mapState.loadingTiles}/{mapState.totalTiles}
      </span>
      <span>
        Zoom: {mapState.zoomLevel.toFixed(1)}
      </span>
      {cursorPos && (
        <span>
          {cursorPos.lat.toFixed(5)}, {cursorPos.lng.toFixed(5)}
        </span>
      )}
    </div>
  );
}
