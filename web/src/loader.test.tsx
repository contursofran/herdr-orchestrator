import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BRAILLE_FRAMES, BRAILLE_MS } from '@core/braille.js'
import { BrailleLoader, LoadingText } from './loader.tsx'

test('the Braille loader cycles through the shared frames and keeps its accessible name', () => {
  const markup = renderToStaticMarkup(<BrailleLoader label="Working" />)
  expect(markup).toContain('role="img" aria-label="Working"')
  expect(markup).toContain('<span aria-hidden="true" class="braille-loader-track"')
  expect(markup).toContain(`animation-duration:${BRAILLE_FRAMES.length * BRAILLE_MS}ms`)
  expect(markup).toContain(`steps(${BRAILLE_FRAMES.length}, end)`)
  expect(markup).toContain(BRAILLE_FRAMES.map((frame) => `<span>${frame}</span>`).join(''))
})

test('a loader with visible status text hides the animation from screen readers', () => {
  const markup = renderToStaticMarkup(<LoadingText>Loading…</LoadingText>)
  expect(markup).toContain('class="braille-loader" aria-hidden="true"')
  expect(markup).toContain('Loading…</span>')
})
