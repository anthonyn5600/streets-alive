import { Layers } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { SidebarSection } from './SidebarSection';
import type { MapEngine } from '@/map/engine';

interface LayersSectionProps {
  engine: MapEngine | null;
}

export function LayersSection({ engine }: LayersSectionProps) {
  return (
    <SidebarSection icon={<Layers className="size-4" />} title="Layers">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="buildings" className="text-xs">Buildings</Label>
          <Switch
            id="buildings"
            defaultChecked
            onCheckedChange={v => engine?.setLayerVisibility('buildings', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="roads" className="text-xs">Roads</Label>
          <Switch
            id="roads"
            defaultChecked
            onCheckedChange={v => engine?.setLayerVisibility('roads', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="labels" className="text-xs">Road Labels</Label>
          <Switch
            id="labels"
            defaultChecked
            onCheckedChange={v => engine?.setLayerVisibility('labels', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="parking-debug" className="text-xs">Parking Debug</Label>
          <Switch
            id="parking-debug"
            onCheckedChange={v => engine?.setParkingDebug(v)}
          />
        </div>
        <div className="pt-2 border-t space-y-1">
          <Label className="text-xs text-muted-foreground">Building Height</Label>
          <Slider
            defaultValue={[1]}
            min={0.1}
            max={3}
            step={0.1}
            onValueChange={([v]) => engine?.setHeightMultiplier(v)}
          />
        </div>
      </div>
    </SidebarSection>
  );
}
