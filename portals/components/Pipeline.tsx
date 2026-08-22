'use client';
import { motion } from 'motion/react';
import { IconCheck } from '@/components/icons';

export type Stage = { label: string; state: 'done' | 'active' | 'todo' };

// Horizontal deal-progress rail — named stages, not numbered steps. The active
// stage pulses; completed stages fill in. Scrolls on small screens.
export function Pipeline({ stages }: { stages: Stage[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex min-w-max items-center gap-1">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem] font-bold transition-colors ${
                  s.state === 'done'
                    ? 'bg-emerald-500 text-white'
                    : s.state === 'active'
                    ? 'bg-brand text-white animate-pulseRing'
                    : 'bg-slate-100 text-slate-400 ring-1 ring-inset ring-line'
                }`}
              >
                {s.state === 'done' ? <IconCheck size={15} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[0.7rem] font-medium ${s.state === 'todo' ? 'text-slate-400' : 'text-ink'}`}>
                {s.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className="mx-1 h-0.5 w-8 overflow-hidden rounded-full bg-line sm:w-12">
                <motion.div
                  initial={false}
                  animate={{ scaleX: s.state === 'done' ? 1 : 0 }}
                  style={{ originX: 0 }}
                  className="h-full w-full bg-emerald-500"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
