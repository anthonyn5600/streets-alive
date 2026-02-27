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

interface SearchBarProps {
  engine: MapEngine | null;
}

export function SearchBar({ engine }: SearchBarProps) {
  const [value, setValue] = useState('');

  const handleGo = () => {
    // Check presets first
    for (const [name, coords] of Object.entries(PRESETS)) {
      if (value.toLowerCase().includes(name.toLowerCase())) {
        engine?.flyTo(coords[0], coords[1]);
        return;
      }
    }
    // Try lat,lng
    const parts = value.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        engine?.flyTo(lat, lng);
      }
    }
  };

  const goTo = (lat: number, lng: number) => {
    engine?.flyTo(lat, lng);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          placeholder="lat, lng or city name"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGo()}
          className="bg-white/90 backdrop-blur-sm shadow-md text-sm"
        />
        <Button size="sm" onClick={handleGo} className="shadow-md">Go</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(PRESETS).map(([name, [lat, lng]]) => (
          <button
            key={name}
            onClick={() => goTo(lat, lng)}
            className="text-[10px] px-1.5 py-0.5 bg-white/80 backdrop-blur-sm rounded shadow-sm hover:bg-white transition-colors border border-border"
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
