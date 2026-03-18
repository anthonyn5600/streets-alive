import { useRef, useEffect, useCallback } from 'react';
import { MapEngine } from '@/map/engine';
import type { MapState } from '@/map/types';

interface MapCanvasProps {
  onEngineReady: (engine: MapEngine) => void;
  onStateChange: (state: MapState) => void;
}

export function MapCanvas({ onEngineReady, onStateChange }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MapEngine | null>(null);

  const stateChangeRef = useRef(onStateChange);
  stateChangeRef.current = onStateChange;

  const engineReadyRef = useRef(onEngineReady);
  engineReadyRef.current = onEngineReady;

  const stableStateChange = useCallback((state: MapState) => {
    stateChangeRef.current(state);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new MapEngine();
    engineRef.current = engine;
    engine.init(canvas, stableStateChange);
    engineReadyRef.current(engine);

    // Resize observer
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          engine.resize(width, height);
        }
      }
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, [stableStateChange]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      onContextMenu={e => e.preventDefault()}
    />
  );
}
