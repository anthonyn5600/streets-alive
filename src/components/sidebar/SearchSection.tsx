import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { MapEngine } from '@/map/engine';

const PRESETS: Record<string, [number, number]> = {
  'Downtown LA': [34.0522, -118.2437],
  'Hollywood': [34.0928, -118.3287],
  'Santa Monica': [34.0195, -118.4912],
  'San Francisco': [37.7749, -122.4194],
  'San Diego': [32.7157, -117.1611],
  'Sacramento': [38.5816, -121.4944],
};

interface SearchSectionProps {
  engine: MapEngine | null;
}

export function SearchSection({ engine }: SearchSectionProps) {
  const [value, setValue] = useState('');

  const handleGo = () => {
    for (const [name, coords] of Object.entries(PRESETS)) {
      if (value.toLowerCase().includes(name.toLowerCase())) {
        engine?.flyTo(coords[0], coords[1]);
        return;
      }
    }
    const parts = value.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        engine?.flyTo(lat, lng);
      }
    }
  };

  return (
    <div className="px-3 pb-2 space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="lat, lng or city name"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGo()}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={handleGo} className="h-8 px-3">Go</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(PRESETS).map(([name, [lat, lng]]) => (
          <button
            key={name}
            onClick={() => engine?.flyTo(lat, lng)}
            className="text-[10px] px-1.5 py-0.5 bg-muted rounded hover:bg-accent transition-colors"
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
