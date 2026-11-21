import clsx from 'clsx'
import type { ReactNode } from 'react'
import { BRAILLE_FRAMES, BRAILLE_MS } from '@core/braille.js'

export function BrailleLoader({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={clsx('braille-loader', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span aria-hidden className="braille-loader-track" style={{
        animationDuration: `${BRAILLE_FRAMES.length * BRAILLE_MS}ms`,
        animationTimingFunction: `steps(${BRAILLE_FRAMES.length}, end)`,
      }}>
        {BRAILLE_FRAMES.map((frame) => <span key={frame}>{frame}</span>)}
      </span>
    </span>
  )
}

export function LoadingText({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 align-middle"><BrailleLoader />{children}</span>
}
