import { Construction } from 'lucide-react';

export function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl bg-panel text-2xl font-bold text-muted">
      <Construction className="size-16" />
      {text}
    </div>
  );
}
