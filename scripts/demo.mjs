/**
 * Crée (ou recrée) l'école de démonstration sur un déploiement Appely, en ligne de commande.
 * Mêmes données que le bouton « Créer l'école de démonstration » de la page Écoles (superadmin).
 *
 *   APPELY_URL=https://appely.example.workers.dev APPELY_ADMIN_EMAIL=admin@exemple.fr npm run demo
 *
 * Le mot de passe superadmin est lu dans APPELY_ADMIN_PASSWORD ou demandé au clavier. Les identifiants fictifs
 * créés s'affichent à l'écran (ils ne sont stockés nulle part ailleurs : ne pas les versionner).
 */
import { createInterface } from 'node:readline/promises'

const base = (process.env.APPELY_URL ?? 'http://localhost:8787').replace(/\/$/, '')
const email = process.env.APPELY_ADMIN_EMAIL
if (!email) {
  console.error('Indiquez APPELY_ADMIN_EMAIL (adresse du superadmin).')
  process.exit(2)
}
let password = process.env.APPELY_ADMIN_PASSWORD
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  password = await rl.question('Mot de passe superadmin : ')
  rl.close()
}

let cookie = ''
async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { origin: base, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${data?.error?.message ?? ''}`)
  return data
}

await call('POST', '/api/auth/login', { email, password })
const { schools } = await call('GET', '/api/admin/schools')
const old = schools.find((s) => s.is_demo === 1)
if (old) {
  await call('POST', `/api/admin/schools/${old.id}/delete-demo`, {})
  console.log('Ancienne école de démonstration supprimée.')
}
const r = await call('POST', '/api/admin/demo-school', {})
console.log(`\n${r.school.name} créée : ${r.counts.classes} classes, ${r.counts.students} élèves fictifs, ${r.counts.calls} appels passés.`)
console.log(`Connexion : ${r.loginUrl}`)
console.log(`Mot de passe commun : ${r.password}`)
for (const a of r.accounts) console.log(`  - ${a.profile} : ${a.email}`)
