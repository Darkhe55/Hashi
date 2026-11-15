import { chromium } from 'playwright-core'
import { browserPath } from './_browser.mjs'
import { PORT } from './_port.mjs'



const browser = await chromium.launch({ headless: true, executablePath: browserPath() })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
const results = await page.evaluate(() => {
  const a = window.__game.adapter
  return a.builtinPuzzles.map((p) => {
    const st = a.createEmptyState(p)
    const t = performance.now()
    const plan = a.planLogicSolve(p, st)
    const dt = Math.round(performance.now() - t)
    const vr = plan.finalState ? a.validate(plan.finalState, p) : null
    return {
      name: p.name,
      size: `${p.width}x${p.height}`,
      frames: plan.frames.length,
      finalSolved: vr?.solved ?? false,
      saturated: plan.saturated,
      ms: dt,
    }
  })
})
console.log(results)
await browser.close()


