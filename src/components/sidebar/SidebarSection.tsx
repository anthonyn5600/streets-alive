import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SidebarSectionProps {
  icon: React.ReactNode;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarSection({ icon, title, count, defaultOpen = true, children }: SidebarSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-sm font-display font-medium text-text-mid hover:text-text-bright hover:bg-panel-hover transition-colors rounded-md">
        <span className="text-teal/70 group-hover:text-teal transition-colors">{icon}</span>
        <span className="flex-1 text-left tracking-wide">{title}</span>
        {count !== undefined && (
          <span className="data-readout px-1.5 py-0.5 bg-teal-dim rounded text-teal font-medium">
            {count}
          </span>
        )}
        <ChevronDown className="size-4 text-text-dim transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="px-3 pb-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
