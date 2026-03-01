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
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors rounded-md">
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {count !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground font-normal">
            {count}
          </span>
        )}
        <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="px-3 pb-3">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
