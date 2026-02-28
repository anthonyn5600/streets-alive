import { useEffect, useState } from 'react';
import { Loader2, FlaskConical } from 'lucide-react';
import type { MapEngine } from '@/map/engine';
import type { MapState, RuntimeTestResult } from '@/map/types';

interface StatusPillProps {
  mapState: MapState;
  engine: MapEngine | null;
  testResults: RuntimeTestResult[];
  onToggleTests: () => void;
}

export function StatusPill({ mapState, engine, testResults, onToggleTests }: StatusPillProps) {
  const [cursorPos, setCursorPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!engine) return;
    engine.setOnCursorChange(setCursorPos);
    return () => engine.setOnCursorChange(() => {});
  }, [engine]);

  const loaded = mapState.totalTiles - mapState.loadingTiles;

  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
      {testResults.length > 0 && (
        <button
          onClick={onToggleTests}
          className="bg-white/90 backdrop-blur-sm shadow-md rounded-full p-1.5 hover:bg-white transition-colors"
          title="Toggle test panel (Ctrl+Shift+T)"
        >
          <FlaskConical className="size-3.5 text-muted-foreground" />
        </button>
      )}
      <div className="bg-white/90 backdrop-blur-sm shadow-md rounded-full px-3 py-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        {mapState.loading && <Loader2 className="size-3 animate-spin" />}
        <span>{loaded}/{mapState.totalTiles}</span>
        <span className="text-border">|</span>
        <span>z{mapState.zoomLevel.toFixed(1)}</span>
        {cursorPos && (
          <>
            <span className="text-border">|</span>
            <span>{cursorPos.lat.toFixed(5)}, {cursorPos.lng.toFixed(5)}</span>
          </>
        )}
      </div>
    </div>
  );
}
