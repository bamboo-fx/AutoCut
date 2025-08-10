import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number;
}

export const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(({ className, value = 0, ...props }, ref) => (
  <ProgressPrimitive.Root ref={ref} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-white/10', className)} {...props}>
    <ProgressPrimitive.Indicator className="h-full bg-red-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </ProgressPrimitive.Root>
));
Progress.displayName = 'Progress'; 