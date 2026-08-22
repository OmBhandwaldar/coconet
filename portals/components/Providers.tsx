'use client';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

// Honour the OS "reduce motion" setting globally; keep one shared spring feel.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
      {children}
    </MotionConfig>
  );
}
