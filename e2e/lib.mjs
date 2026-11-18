/**
 * Outils des parcours E2E (lot 7) : serveur `wrangler dev` sur une base D1 locale jetable,
 * navigateur Playwright, contrôles notés, captures, largeur mobile, audit axe-core, zones tactiles.
 * Aucune donnée réelle : tous les noms sont fictifs.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CAPTURES = join(ROOT, 'e2e', 'captures')
export const SETUP_CODE = 'code-local-e2e'

/** Playwright : celui du projet s'il est installé, sinon celui de la machine (NODE_PATH). */
export function loadPlaywright() {
  try {
    return require('playwright')
  } catch {
    console.error('Playwright est introuvable : installez-le (npm i -D playwright && npx playwright install chromium).')
    process.exit(2)
  }
}

// ---------- Serveur ----------

export class Server {
  constructor(port = Number(process.env.E2E_PORT ?? 8787)) {
    this.port = port
    this.url = `http://localhost:${port}`
    this.persist = mkdtempSync(join(tmpdir(), 'appely-e2e-'))
    this.proc = null
  }
  async start() {
    const args = ['wrangler', 'dev', '--port', String(this.port), '--persist-to', this.persist, '--var', `ADMIN_SETUP_CODE:${SETUP_CODE}`]
    this.proc = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, CI: '1' } })
    this.log = ''
    this.proc.stdout.on('data', (d) => (this.log += d))
    this.proc.stderr.on('data', (d) => (this.log += d))
    const until = Date.now() + 90_000
    while (Date.now() < until) {
      try {
        const r = await fetch(`${this.url}/api/setup`)
        if (r.ok) return
      } catch {
        /* pas encore prêt */
      }
      await sleep(500)
    }
    throw new Error(`wrangler dev ne répond pas :\n${this.log.slice(-2000)}`)
  }
  async stop() {
    if (!this.proc) return
    try {
      process.kill(-this.proc.pid, 'SIGTERM')
    } catch {
      /* déjà arrêté */
    }
    await sleep(1500)
    this.proc = null
  }
  cleanup() {
    rmSync(this.persist, { recursive: true, force: true })
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Journal des contrôles ----------

export class Report {
  constructor() {
    this.items = []
    this.section = ''
  }
  start(section) {
    this.section = section
    console.log(`\n▶ ${section}`)
  }
  check(label, ok, detail = '') {
    this.items.push({ section: this.section, label, ok: !!ok, detail })
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
    return !!ok
  }
  note(text) {
    this.items.push({ section: this.section, label: text, ok: true, note: true })
    console.log(`  · ${text}`)
  }
  get failures() {
    return this.items.filter((i) => !i.ok)
  }
  write(file) {
    const lines = ['# Rapport des parcours E2E', '', `Date : ${new Date().toISOString()}`, '']
    let current = ''
    for (const i of this.items) {
      if (i.section !== current) lines.push('', `## ${(current = i.section)}`, '')
      lines.push(i.note ? `- ${i.label}` : `- ${i.ok ? '✅' : '❌'} ${i.label}${i.detail ? ` — ${i.detail}` : ''}`)
    }
    const total = this.items.filter((i) => !i.note).length
    lines.push('', `**${total - this.failures.length}/${total} contrôles réussis.**`, '')
    writeFileSync(file, lines.join('\n'))
  }
}

// ---------- Pages ----------

export function prepareCaptures() {
  rmSync(CAPTURES, { recursive: true, force: true })
  mkdirSync(CAPTURES, { recursive: true })
}

export async function shot(page, name) {
  await page.screenshot({ path: join(CAPTURES, `${name}.png`), fullPage: true })
}

/** Aucun défilement horizontal de la page (rendu correct aux faibles largeurs). */
export async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Audit axe-core WCAG 2.1 A/AA de la page courante : liste des violations. */
export async function axe(page) {
  // Évaluation directe (protocole du navigateur) : la CSP stricte de l'application interdit les scripts en ligne.
  await page.evaluate(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'))
  const r = await page.evaluate(async () =>
    (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(
      (v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`,
    ),
  )
  return r
}

/**
 * Zones tactiles trop petites (< 44 px de haut ou de large) parmi les éléments actionnables visibles.
 * Les liens au fil du texte sont exclus (WCAG 2.5.8 : exception « en ligne »).
 */
export async function smallTargets(page) {
  return page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, a[href], select, input:not([type=hidden]), [role=tab], summary')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || el.closest('.sr-only')) continue
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        // Case à cocher : c'est l'étiquette englobante qui sert de zone tactile.
        const lab = el.closest('label')
        if (lab) {
          const lr = lab.getBoundingClientRect()
          if (lr.height >= 43.5) continue
        }
        if (el.classList.contains('sr-only')) continue
      }
      // Lien « carte entière » : sa zone cliquable est la carte (pseudo-élément ::after étendu).
      if (getComputedStyle(el, '::after').position === 'absolute') continue
      if (el.tagName === 'A' && style.display === 'inline' && el.parentElement && el.parentElement.textContent.trim() !== el.textContent.trim()) continue
      if (r.height < 43.5 || r.width < 43.5) {
        const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 40)
        out.push(`${el.tagName.toLowerCase()} « ${label} » ${Math.round(r.width)}×${Math.round(r.height)}`)
      }
    }
    return [...new Set(out)]
  })
}

/** Appel d'API depuis le contexte d'une page (même session, même origine). */
export async function api(page, method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p, {
        method: m,
        headers: b === undefined ? undefined : { 'content-type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      })
      let data = null
      try {
        data = await r.json()
      } catch {
        /* pas de JSON */
      }
      return { status: r.status, data }
    },
    [method, path, body],
  )
}

/** Date du jour à Paris (AAAA-MM-JJ) et demi-journée en cours. */
export function parisNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t).value
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7
  return { date, weekday: wd, half: Number(get('hour')) < 12 ? 'am' : 'pm' }
}
