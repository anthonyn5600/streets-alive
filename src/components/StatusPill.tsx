import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { MapEngine } from '@/map/engine';
import type { MapState } from '@/map/types';

interface StatusPillProps {
  mapState: MapState;
  engine: MapEngine | null;
  simTime: string;
}

export function StatusPill({ mapState, engine, simTime }: StatusPillProps) {
  const [cursorPos, setCursorPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!engine) return;
    engine.setOnCursorChange(setCursorPos);
    return () => engine.setOnCursorChange(() => {});
  }, [engine]);

  const loaded = mapState.totalTiles - mapState.loadingTiles;

  return (
    <div className="absolute bottom-4 right-4 z-10">
      <div className="panel-glass rounded-full px-4 py-2 flex items-center gap-3 data-readout text-text-mid">
        {mapState.loading && (
          <Loader2 className="size-3 text-teal glow-dot" style={{ animationDuration: '1.5s' }} />
        )}
        {simTime && (
          <>
            <span className="text-teal font-medium tracking-wider">{simTime}</span>
            <span className="text-text-dim">|</span>
          </>
        )}
        <span>
          <span className="text-text-bright">{loaded}</span>
          <span className="text-text-dim">/{mapState.totalTiles}</span>
        </span>
        <span className="text-text-dim">|</span>
        <span>z<span className="text-text-bright">{mapState.zoomLevel.toFixed(1)}</span></span>
        {cursorPos && (
          <>
            <span className="text-text-dim">|</span>
            <span>{cursorPos.lat.toFixed(5)}, {cursorPos.lng.toFixed(5)}</span>
          </>
        )}
      </div>
    </div>
  );
}
