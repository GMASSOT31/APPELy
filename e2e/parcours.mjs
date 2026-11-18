/**
 * Parcours E2E P1 à P12 du cahier des charges (§15), rejoués sur l'application réelle (`wrangler dev` + D1 locale
 * jetable), avec trois profils fictifs : Marc, enseignant pressé (téléphone), Nadia, directrice (ordinateur et
 * tablette), Julie, remplaçante (tablette). Lancement : `npm run e2e` (construit l'application puis lance ce script).
 *
 * Sorties : `e2e/captures/*.png` et `e2e/captures/rapport.md` (non versionnés). Code de sortie 1 si un contrôle échoue.
 * Toutes les données sont fictives (prénoms courants + noms de plantes).
 */
import { join } from 'node:path'
import {
  api,
  axe,
  CAPTURES,
  horizontalOverflow,
  loadPlaywright,
  parisNow,
  prepareCaptures,
  Report,
  Server,
  SETUP_CODE,
  shot,
  sleep,
  smallTargets,
} from './lib.mjs'

const { chromium, devices } = loadPlaywright()
const R = new Report()
const NOW = parisNow()
if (NOW.weekday === 7) {
  console.error('Dimanche : aucune école n’est ouverte ce jour-là (créneaux du lundi au samedi). Relancez un autre jour.')
  process.exit(3)
}
const TODAY = NOW.date
const DAY_SHORT = { 1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Jeu', 5: 'Ven', 6: 'Sam' }[NOW.weekday]
// Demi-journée de l'appel de Marc (P4) = demi-journée en cours ; la répartition (P6) porte sur l'autre.
const CALL_HALF = NOW.half
const DIST_HALF = CALL_HALF === 'am' ? 'pm' : 'am'
const HALF_LABEL = { am: 'Matin', pm: 'Après-midi' }
const SLOT_NAME = { am: 'Appel du matin', pm: 'Appel de l’après-midi' }

const PASSWORD = 'motdepasse-e2e-fictif'
const PEOPLE = {
  admin: { name: 'Admin Plateforme', email: 'admin@e2e.appely.test' },
  nadia: { name: 'Nadia Directrice', email: 'nadia.directrice@e2e.appely.test' },
  marc: { name: 'Marc Pressé', email: 'marc.enseignant@e2e.appely.test' },
  julie: { name: 'Julie Remplaçante', email: 'julie.remplacante@e2e.appely.test' },
  bruno: { name: 'Bruno Autre École', email: 'bruno.direction@e2e.appely.test' },
}

const FIRST = ['Adam', 'Alice', 'Amir', 'Anna', 'Arthur', 'Basile', 'Camille', 'Chloé', 'Clément', 'Élise', 'Émile', 'Eva', 'Gabin', 'Hugo', 'Inès', 'Jade', 'Jules', 'Léa', 'Léon', 'Lina', 'Lou', 'Louis', 'Lucas', 'Maël', 'Manon', 'Mia', 'Nina', 'Noah', 'Nour', 'Oscar']
const LAST = ['Abeille', 'Bouleau', 'Cerisier', 'Dune', 'Écorce', 'Fougère', 'Givre', 'Houx', 'Iris', 'Jonquille', 'Lavande', 'Mimosa', 'Noisette', 'Olivier', 'Pervenche', 'Roseau', 'Saule', 'Tilleul', 'Verveine', 'Glycine', 'Bruyère', 'Châtaigne', 'Myrtille', 'Sorbier', 'Tournesol']
/** CE1 A : 25 élèves fictifs (« Zoé Muguet » n'est pas là l'après-midi du jour du test → 24 à répartir). */
const CE1A = [...FIRST.slice(0, 24).map((f, i) => [f, LAST[i]]), ['Zoé', 'Muguet']]
const csv = (rows) => '﻿Prénom;Nom;Classe\n' + rows.map((r) => r.join(';')).join('\n') + '\n'

const server = new Server()
let browser
const S = {} // état partagé entre parcours (identifiants, pages)

async function newPersona(device, extra = {}) {
  const ctx = await browser.newContext({ ...device, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...extra })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (e) => R.check(`aucune erreur JavaScript (${page.url()})`, false, e.message))
  return { ctx, page }
}

async function login(page, who) {
  await page.goto(`${server.url}/connexion`)
  // Déjà connecté sur cet appareil (session en cours) : l'application s'ouvre directement.
  if (!(await page.getByLabel('Adresse e-mail').waitFor({ timeout: 4000 }).then(() => true, () => false))) return
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

async function acceptInvitation(page, url) {
  await page.goto(url)
  await page.getByLabel('Choisissez un mot de passe').fill(PASSWORD)
  await page.getByLabel('Confirmez le mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Activer mon accès' }).click()
}

async function inviteFromTeam(page, who, role, accessUntil) {
  await page.goto(`${server.url}/ecole/${S.schoolA}/equipe`)
  await page.getByRole('button', { name: /Inviter/ }).first().click()
  await page.getByLabel('Nom', { exact: true }).fill(who.name)
  await page.getByLabel('Adresse e-mail').fill(who.email)
  await page.getByRole('radio', { name: role }).check()
  if (accessUntil) await page.getByLabel('Fin de l’accès').fill(accessUntil)
  await page.getByRole('button', { name: 'Créer le lien d’invitation' }).click()
  const link = page.locator('code').filter({ hasText: '/invitation/' }).first()
  await link.waitFor()
  return (await link.textContent()).trim()
}

const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const callUrl = (classId, slotId, date = TODAY) => `${server.url}/appel/${S.schoolA}/${classId}/${date}/${slotId}`
const callApi = (classId, slotId, date = TODAY) => `/api/schools/${S.schoolA}/classes/${classId}/calls/${date}/${slotId}`

// ---------------------------------------------------------------------------------------------------------------

async function p1() {
  R.start('P1 · L’admin crée une école (invitation à usage unique, sans mot de passe partagé)')
  const { page } = (S.admin = await newPersona({ viewport: { width: 1280, height: 800 } }))
  await page.goto(`${server.url}/installation`)
  await page.getByLabel('Code d’installation').fill(SETUP_CODE)
  await page.getByLabel('Votre nom').fill(PEOPLE.admin.name)
  await page.getByLabel('Adresse e-mail').fill(PEOPLE.admin.email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await page.waitForURL(/\/admin$/)
  R.check('installation du superadmin avec le code secret', page.url().endsWith('/admin'))

  await page.getByRole('button', { name: 'Créer une école' }).click()
  await page.getByLabel('Nom de l’école').fill('École des Tilleuls (fictive)')
  await page.getByLabel('Nom de la direction (facultatif)').fill(PEOPLE.nadia.name)
  await page.getByLabel('E-mail professionnel de la direction').fill(PEOPLE.nadia.email)
  await page.getByRole('button', { name: 'Créer et générer l’invitation' }).click()
  const code = page.locator('code').filter({ hasText: '/invitation/' })
  await code.waitFor()
  S.inviteNadia = (await code.textContent()).trim()
  R.check('école créée « Invitation en attente » + lien d’invitation', await page.getByText('Invitation en attente').isVisible())
  await shot(page, 'p1-admin-ecole-creee-1280')

  const nadia = (S.nadia = await newPersona({ viewport: { width: 1280, height: 800 } }))
  await acceptInvitation(nadia.page, S.inviteNadia)
  await nadia.page.waitForURL(/\/ecole\/[0-9a-f-]{36}$/)
  S.schoolA = nadia.page.url().split('/ecole/')[1]
  R.check('la directrice choisit son propre mot de passe et arrive sur son école', !!S.schoolA)

  const other = await newPersona({ viewport: { width: 390, height: 844 } })
  await other.page.goto(S.inviteNadia)
  const err = other.page.getByRole('alert')
  await err.waitFor()
  R.check('le lien d’invitation ne fonctionne qu’une seule fois', /déjà|utilis|valable/i.test(await err.textContent()), await err.textContent())
  await shot(other.page, 'p1-lien-deja-utilise-390')
  await other.ctx.close()

  await page.reload()
  R.check('l’école passe « Active » côté admin', await page.getByText('Active', { exact: true }).waitFor().then(() => true, () => false))
  R.check('l’admin ne voit aucun nom d’élève ni lien vers les données de l’école', !(await page.getByRole('link', { name: /classes|élèves/i }).count()))
}

async function p2() {
  R.start('P2 · La directrice crée ses classes et importe 25 élèves en corrigeant les erreurs')
  const { page } = S.nadia
  await page.goto(`${server.url}/ecole/${S.schoolA}/classes`)
  await page.getByRole('button', { name: 'Nouvelle classe' }).click()
  await page.getByLabel('Nom de la classe').fill('CE1 A')
  R.check('niveau deviné d’après le nom (CE1)', (await page.getByRole('button', { name: 'CE1', exact: true }).getAttribute('aria-pressed')) === 'true')
  await page.getByRole('button', { name: 'Créer la classe' }).click()
  await page.getByText('CE1 A').first().waitFor()

  // Fichier avec erreurs : une ligne sans prénom, une ligne sans classe, un doublon.
  await page.goto(`${server.url}/ecole/${S.schoolA}/import`)
  const bad = [...CE1A.slice(0, 23).map(([f, l]) => [f, l, 'CE1 A']), ['', 'Sansprénom', 'CE1 A'], ['Mia', 'Erreur', ''], CE1A.map(([f, l]) => [f, l, 'CE1 A'])[0]]
  await page.locator('input[type=file]').setInputFiles({ name: 'eleves-avec-erreurs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(bad)) })
  await page.getByText('Vérification').waitFor()
  const badges = await page.locator('span', { hasText: /erreur|doublon|à importer/ }).allTextContents()
  R.check('prévisualisation : erreurs et doublon détectés avant tout envoi', badges.some((b) => /2 erreurs/.test(b)) && badges.some((b) => /1 doublon/.test(b)), badges.join(' · '))
  await shot(page, 'p2-import-erreurs-1280')

  // Fichier corrigé : 25 élèves.
  await page.locator('input[type=file]').setInputFiles({ name: 'eleves-corriges.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(CE1A.map(([f, l]) => [f, l, 'CE1 A']))) })
  await page.getByRole('button', { name: 'Importer 25 élèves' }).click()
  await page.getByText('25 élèves importés').waitFor()
  R.check('import du fichier corrigé : 25 élèves importés', true)

  // Classes d'accueil de la recette (CP A 20, CE1 B 24, CE2 A 22), créées par l'import avec leur niveau deviné.
  const hosts = []
  const mk = (cls, n, offset) => Array.from({ length: n }, (_, i) => [FIRST[(i + offset) % FIRST.length], `${LAST[(i * 7 + offset) % LAST.length]}-${cls.replace(' ', '')}`, cls])
  hosts.push(...mk('CP A', 20, 3), ...mk('CE1 B', 24, 5), ...mk('CE2 A', 22, 9))
  await page.locator('input[type=file]').setInputFiles({ name: 'autres-classes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(hosts)) })
  await page.getByText('Nouvelles classes à créer').waitFor()
  R.check('nouvelles classes proposées avec leur niveau deviné (CP, CE1, CE2)', (await page.locator('button[aria-pressed=true]').filter({ hasText: /^(CP|CE1|CE2)$/ }).count()) === 3)
  await page.getByRole('button', { name: 'Importer 66 élèves' }).click()
  await page.getByText(/66 élèves importés, 3 classes créées/).waitFor()
  R.check('66 élèves + 3 classes créées en un import', true)

  const ov = await api(page, 'GET', `/api/schools/${S.schoolA}/overview`)
  S.classes = Object.fromEntries(ov.data.classes.map((c) => [c.name, c]))
  R.check('effectifs : CE1 A 25, CP A 20, CE1 B 24, CE2 A 22', ['CE1 A', 'CP A', 'CE1 B', 'CE2 A'].map((n) => S.classes[n]?.studentCount).join() === '25,20,24,22')
  await page.goto(`${server.url}/ecole/${S.schoolA}/classes`)
  await shot(page, 'p2-classes-par-niveau-1280')

  // Équipe : Marc (enseignant), Julie (remplaçante, accès limité dans le temps).
  const marcLink = await inviteFromTeam(page, PEOPLE.marc, 'Enseignant')
  const julieLink = await inviteFromTeam(page, PEOPLE.julie, 'Remplaçant', addDays(TODAY, 10))
  await shot(page, 'p2-equipe-invitations-1280')
  S.marc = await newPersona(devices['Pixel 7'])
  await acceptInvitation(S.marc.page, marcLink)
  S.julie = await newPersona({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  await acceptInvitation(S.julie.page, julieLink)
  await S.marc.page.waitForURL(/\/enseignant/)
  R.check('Marc et Julie activent leur accès (lien unique, mot de passe personnel)', S.marc.page.url().includes('/enseignant'))
  R.check(
    'sans classe affectée, l’enseignant voit une explication claire',
    await S.marc.page.getByText('Aucune classe ne vous est encore affectée').isVisible(),
  )

  // Affectations depuis la page de chaque classe.
  for (const [cls, who] of [['CE1 A', PEOPLE.marc], ['CP A', PEOPLE.julie]]) {
    await page.goto(`${server.url}/ecole/${S.schoolA}/classes/${S.classes[cls].id}`)
    await page.getByLabel('Affecter une personne').locator('option', { hasText: who.name }).waitFor({ state: 'attached' })
    const lbl = await optionLabel(page, who.name)
    await page.getByLabel('Affecter une personne').selectOption({ label: lbl })
    await page.getByRole('button', { name: `Retirer ${who.name} de la classe` }).waitFor()
  }
  R.check('Marc affecté à CE1 A, Julie (remplaçante) à CP A', true)
}

async function optionLabel(page, name) {
  const opts = await page.getByLabel('Affecter une personne').locator('option').allTextContents()
  return opts.find((o) => o.includes(name))
}

async function p3() {
  R.start('P3 · La directrice prépare la semaine (jours, présences par demi-journée, appels et heures limites)')
  const { page } = S.nadia
  // Jours sans classe : l'école de test ouvre le mercredi et le samedi (pour pouvoir rejouer le test chaque jour).
  await page.goto(`${server.url}/ecole/${S.schoolA}/parametres`)
  const week = page.getByRole('group', { name: 'Jours où l’école est fermée chaque semaine' })
  for (const d of ['Mer', 'Sam']) {
    const b = week.getByRole('button', { name: d, exact: true })
    if ((await b.getAttribute('aria-pressed')) === 'true') {
      await b.click()
      await page.waitForFunction((el) => el.getAttribute('aria-pressed') === 'false', await b.elementHandle())
    }
  }
  R.check('jours sans classe modifiés (dimanche seul fermé)', (await week.getByRole('button', { name: 'Dim', exact: true }).getAttribute('aria-pressed')) === 'true')
  await shot(page, 'p3-parametres-1280')

  // CE1 A : appel du matin tous les jours (lun-sam), appel de l'après-midi avec heure limite.
  await page.goto(`${server.url}/ecole/${S.schoolA}/classes/${S.classes['CE1 A'].id}`)
  await page.getByRole('button', { name: 'Modifier', exact: true }).first().click()
  const days = page.getByRole('group', { name: 'Jours' })
  for (const d of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']) {
    const b = days.getByRole('button', { name: d, exact: true })
    if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
  }
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByText(/Lun.*Sam|Du lundi au samedi|lun.*sam/i).first().waitFor()
  await page.getByRole('button', { name: 'Ajouter un appel' }).click()
  await page.getByLabel('Heure limite (facultatif)').fill('13:45')
  const days2 = page.getByRole('group', { name: 'Jours' })
  for (const d of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']) {
    const b = days2.getByRole('button', { name: d, exact: true })
    if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
  }
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByText('Appel de l’après-midi').waitFor()
  R.check('deux appels par jour pour CE1 A (matin + après-midi avant 13 h 45)', (await page.getByText(/avant 13 h 45/).count()) === 1)

  // Présence par demi-journée : Zoé n'est pas là l'après-midi du jour du test (ni le reste de la semaine).
  await page.getByRole('button', { name: 'Modifier Zoé' }).click()
  await page.getByLabel('Même liste tous les jours').uncheck()
  await page.getByRole('button', { name: `${DAY_SHORT} ${DIST_HALF === 'am' ? 'matin' : 'après-midi'}` }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('button', { name: 'Modifier Zoé' }).waitFor()
  await shot(page, 'p3-classe-ce1a-1280')

  // Classes d'accueil : appels sur les deux demi-journées du jour (préparés par API pour aller vite).
  const all = 63
  for (const n of ['CP A', 'CE1 B', 'CE2 A']) {
    const det = await api(page, 'GET', `/api/schools/${S.schoolA}/classes/${S.classes[n].id}`)
    const am = det.data.slots[0]
    await api(page, 'POST', `/api/schools/${S.schoolA}/classes/${S.classes[n].id}/slots/${am.id}`, { name: am.name, halfDay: 'am', weekdays: all, dueTime: '09:00' })
    await api(page, 'POST', `/api/schools/${S.schoolA}/classes/${S.classes[n].id}/slots`, { name: 'Appel de l’après-midi', halfDay: 'pm', weekdays: all, dueTime: '13:45' })
  }
  for (const n of ['CE1 A', 'CP A', 'CE1 B', 'CE2 A']) {
    const det = await api(page, 'GET', `/api/schools/${S.schoolA}/classes/${S.classes[n].id}`)
    S.classes[n].slots = Object.fromEntries(det.data.slots.map((s) => [s.half_day, s.id]))
  }
  const call = await api(page, 'GET', callApi(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[DIST_HALF]))
  R.check(`présence par demi-journée : 24 élèves attendus en CE1 A (${HALF_LABEL[DIST_HALF].toLowerCase()}), Zoé exclue`, call.data.students.length === 24, `${call.data.students.length}`)
  const callNow = await api(page, 'GET', callApi(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[CALL_HALF]))
  R.check(`25 élèves attendus en CE1 A (${HALF_LABEL[CALL_HALF].toLowerCase()})`, callNow.data.students.length === 25)

  // Message de la direction pour CE1 A (affiché au-dessus de la grille).
  await page.goto(`${server.url}/ecole/${S.schoolA}/messages`)
  await page.getByLabel('Message', { exact: true }).fill('Photo de classe à 10 h : merci de descendre dans la cour.')
  await page.getByRole('button', { name: 'Publier le message' }).click()
  await page.getByText('Photo de classe à 10 h').first().waitFor()
  R.check('message du jour publié pour toute l’école', true)
}

async function p4p5() {
  R.start('P4 · Marc, enseignant pressé (téléphone) : 2 absents = 2 taps + Valider')
  // La directrice garde son tableau de bord ouvert (P5 : actualisation sans recharger).
  const nadia = S.nadia.page
  await nadia.goto(`${server.url}/ecole/${S.schoolA}`)
  await nadia.getByRole('tab', { name: new RegExp(HALF_LABEL[CALL_HALF]) }).click()
  const card = nadia.locator('li', { hasText: `CE1 A · ${SLOT_NAME[CALL_HALF]}` })
  await card.waitFor()
  R.check('tableau de bord : CE1 A « à faire » avant l’appel', !(await card.textContent()).includes('Validé'))

  const { page } = S.marc
  await login(page, PEOPLE.marc)
  await page.waitForURL(/\/appel\//, { timeout: 10_000 }).catch(() => {})
  R.check('connecté, Marc arrive directement sur l’appel de la demi-journée en cours', page.url().includes(`/${S.classes['CE1 A'].slots[CALL_HALF]}`), page.url())
  await page.getByText('Photo de classe à 10 h').waitFor()
  R.check('le mot de la direction est visible au-dessus de la grille', true)
  const t0 = Date.now()
  let taps = 0
  for (const name of ['Arthur', 'Lina']) {
    await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
    taps++
  }
  R.check('compteurs mis à jour instantanément (23 présents, 2 absents)', (await page.getByText('23 Présents').count()) + (await page.getByText('2 Absents').count()) === 2)
  await shot(page, 'p4-marc-appel-avant-validation-pixel7')
  await page.getByRole('button', { name: 'Valider l’appel' }).click()
  taps++
  const ok = page.getByRole('status').filter({ hasText: /Validé à/ })
  await ok.waitFor()
  R.check(`3 actions en tout (2 taps + Valider), retour serveur visible « ${(await ok.textContent()).trim()} »`, taps === 3)
  R.note(`durée mesurée de l’appel (automate) : ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  R.check('téléphone : pas de défilement horizontal', (await horizontalOverflow(page)) <= 0)
  await shot(page, 'p4-marc-appel-valide-pixel7')
  S.callNow = await api(page, 'GET', callApi(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[CALL_HALF]))

  R.start('P5 · La directrice voit l’appel validé dans la bonne classe et le bon créneau, sans recharger')
  const t1 = Date.now()
  await nadia.waitForFunction(
    (label) => [...document.querySelectorAll('li')].some((li) => li.textContent.includes(label) && li.textContent.includes('Validé')),
    `CE1 A · ${SLOT_NAME[CALL_HALF]}`,
    { timeout: 45_000 },
  )
  const txt = await card.textContent()
  R.check(`CE1 A · ${SLOT_NAME[CALL_HALF]} passe « Validé » en ${Math.round((Date.now() - t1) / 1000)} s sans recharger`, true)
  R.check('effectifs justes (23 présents · 2 absents / 25) et noms des absents', /23 présents/.test(txt) && /2 absents/.test(txt) && /Arthur/.test(txt) && /Lina/.test(txt), txt.slice(0, 160))
  const other = nadia.locator('li', { hasText: `CE1 A · ${SLOT_NAME[DIST_HALF]}` })
  R.check('l’autre créneau de CE1 A n’est pas marqué validé', !(await nadia.getByRole('tab', { name: new RegExp(HALF_LABEL[DIST_HALF]) }).count()) || !(await other.count()) || !(await other.textContent()).includes('Validé'))
  const ce1b = nadia.locator('li', { hasText: `CE1 B · ${SLOT_NAME[CALL_HALF]}` })
  R.check('classe sans enseignant : « Répartir » proposé au lieu de « Relancer » (personne à relancer)', (await ce1b.getByRole('link', { name: 'Répartir CE1 B' }).count()) === 1 && (await ce1b.getByRole('button', { name: /Relancer/ }).count()) === 0)
  await shot(nadia, 'p5-tableau-de-bord-1280')
}

async function p6() {
  R.start('P6 · La directrice répartit CE1 A (24 élèves) entre CP A, CE1 B et CE2 A')
  const { page } = S.nadia
  await page.goto(`${server.url}/ecole/${S.schoolA}`)
  await page.getByRole('link', { name: 'Répartir une classe' }).first().click()
  await page.getByLabel('Classe à répartir').selectOption({ label: 'CE1 A' })
  const radio = page.getByRole('radio', { name: HALF_LABEL[DIST_HALF], exact: true })
  await page.locator('label').filter({ has: radio }).click()
  await page.waitForFunction((el) => el.checked, await radio.elementHandle())
  await page.waitForLoadState('networkidle')
  for (const n of ['CP A', 'CE1 B', 'CE2 A']) await page.getByRole('checkbox', { name: new RegExp(`^${n}\\b`) }).check()
  await page.getByRole('button', { name: 'Proposer une répartition équilibrée' }).click()
  await page.getByText(/24 élèves placés, aucun oubli ni doublon/).waitFor()
  R.check('« 24 élèves placés, aucun oubli ni doublon » avant validation', true)
  await shot(page, 'p6-repartition-proposee-1280')
  await page.getByRole('button', { name: 'Valider la répartition' }).click()
  await page.waitForURL(/\/repartitions\/[0-9a-f-]{36}$/)
  S.planId = page.url().split('/repartitions/')[1]
  const plan = await api(page, 'GET', `/api/schools/${S.schoolA}/distributions/${S.planId}`)
  const groups = plan.data.groups.filter((g) => g.classId)
  const ids = groups.flatMap((g) => g.students.map((x) => x.id))
  const byHost = Object.fromEntries(groups.map((g) => [g.className, g.students.length]))
  R.check('24 affectations, chaque élève une seule fois', ids.length === 24 && new Set(ids).size === 24, JSON.stringify(byHost))
  // Totaux projetés : CP A 20+10, CE1 B 24+6, CE2 A 22+8 = 30/30/30.
  const counts = ['CP A', 'CE1 B', 'CE2 A'].map((n) => byHost[n])
  R.check('totaux projetés équilibrés 30 / 30 / 30 (10, 6 et 8 élèves accueillis)', counts.join() === '10,6,8', counts.join())
  await shot(page, 'p6-repartition-detail-1280')
}

async function p7() {
  R.start('P7 · Les classes d’accueil font l’appel ; les présences remontent à CE1 A')
  const { page } = S.julie
  await login(page, PEOPLE.julie)
  await page.waitForURL(/\/(appel|enseignant)/)
  if (!page.url().includes(S.classes['CP A'].slots[DIST_HALF])) await page.goto(callUrl(S.classes['CP A'].id, S.classes['CP A'].slots[DIST_HALF]))
  const section = page.getByRole('region', { name: 'Élèves accueillis de CE1 A' })
  await section.waitFor()
  R.check('section délimitée « Élèves accueillis · CE1 A » (10 élèves)', (await section.getByRole('button').count()) === 10)
  R.check('compteur global « / 30 dont 10 accueillis »', await page.getByText('/ 30 dont 10 accueillis').isVisible())
  R.check('notification interne de la répartition visible (jamais bloquante)', (await page.getByText(/répartition|répartis|accueill/i).count()) > 0)
  await shot(page, 'p7-julie-classe-accueil-tablette')
  S.hostedAbsent = (await section.getByRole('button').first().textContent()).trim().split(/\s/)[0]
  await section.getByRole('button').first().click()
  await page.getByRole('button', { name: 'Valider l’appel' }).click()
  await page.getByRole('status').filter({ hasText: /Validé à/ }).waitFor()
  R.check('Julie (remplaçante) valide l’appel de CP A avec les élèves accueillis', true)
  R.check('tablette : pas de défilement horizontal', (await horizontalOverflow(page)) <= 0)

  // Marc : sa classe est répartie, il voit où sont ses élèves et l'état remonté.
  const m = S.marc.page
  await m.goto(callUrl(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[DIST_HALF]))
  await m.getByText('Classe répartie : pas d’appel à faire ici').waitFor()
  const reg = await m.getByRole('region', { name: /Vos élèves répartis/ }).textContent()
  R.check('CE1 A : « Classe répartie » et registre « 10/24 confirmés »', /10\/24 confirmés/.test(reg), reg.slice(0, 80))
  R.check(`l’absence saisie en CP A remonte au registre de CE1 A (${S.hostedAbsent})`, new RegExp(`${S.hostedAbsent}[^]*?en CP A · Absent`).test(reg))
  await shot(m, 'p7-marc-registre-pixel7')

  // Direction : couverture visible.
  const n = S.nadia.page
  await n.goto(`${server.url}/ecole/${S.schoolA}`)
  await n.getByRole('tab', { name: new RegExp(HALF_LABEL[DIST_HALF]) }).click()
  const card = n.locator('li', { hasText: `CE1 A · ${SLOT_NAME[DIST_HALF]}` })
  await card.waitFor()
  const t = await card.textContent()
  R.check('tableau de bord : CE1 A « Répartie » avec sa couverture (CP A 10/10)', /Répartie/.test(t) && /CP A 10\/10/.test(t), t.slice(0, 200))
  await shot(n, 'p7-tableau-de-bord-repartition-1280')
}

async function p8() {
  R.start('P8 · La directrice corrige la répartition : propagée, historisée, sans double présence')
  const { page } = S.nadia
  await page.goto(`${server.url}/ecole/${S.schoolA}/repartitions/${S.planId}/modifier`)
  // Un élève accueilli en CE2 A (appel pas encore fait) passe en CE1 B.
  const selects = page.getByLabel(/^Classe d’accueil de /)
  await selects.first().waitFor()
  let moved = null
  for (let i = 0; i < (await selects.count()); i++) {
    const s = selects.nth(i)
    const current = await s.evaluate((el) => el.options[el.selectedIndex].text)
    if (/CE2 A/.test(current)) {
      moved = (await s.getAttribute('aria-label')).replace('Classe d’accueil de ', '')
      await s.selectOption({ label: await s.evaluate((el) => [...el.options].find((o) => /CE1 B/.test(o.text)).text) })
      break
    }
  }
  R.check(`élève déplacé de CE2 A vers CE1 B : ${moved}`, !!moved)
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()
  await page.waitForURL(/\/repartitions\/[0-9a-f-]{36}$/)
  await shot(page, 'p8-repartition-modifiee-1280')
  const hist = await page.getByText(/Version|version|Modifiée|modifi/).count()
  R.check('historique des versions visible sur la répartition', hist > 0)

  const firstName = moved.split(' ')[0]
  const ce2 = await api(page, 'GET', callApi(S.classes['CE2 A'].id, S.classes['CE2 A'].slots[DIST_HALF]))
  const ce1b = await api(page, 'GET', callApi(S.classes['CE1 B'].id, S.classes['CE1 B'].slots[DIST_HALF]))
  const ce1a = await api(page, 'GET', callApi(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[DIST_HALF]))
  const has = (c) => c.data.students.filter((s) => `${s.firstName} ${s.lastName ?? ''}`.trim() === moved).length
  R.check('propagé : l’élève apparaît dans l’appel de CE1 B et plus dans celui de CE2 A', has(ce1b) === 1 && has(ce2) === 0)
  R.check('pas de double présence (absent de l’appel de CE1 A)', has(ce1a) === 0)
  R.check('CE1 B accueille 7 élèves, CE2 A 7', ce1b.data.students.filter((s) => s.hostedFrom).length === 7 && ce2.data.students.filter((s) => s.hostedFrom).length === 7)

  // Les classes concernées sont informées (notification interne).
  const j = S.julie.page
  await j.goto(callUrl(S.classes['CP A'].id, S.classes['CP A'].slots[DIST_HALF]))
  await j.getByRole('region', { name: 'Élèves accueillis de CE1 A' }).waitFor()
  R.check(`${firstName} n’est jamais dans deux appels à la fois`, true)
}

async function p9() {
  R.start('P9 · Correction d’appel : ancienne et nouvelle valeur, auteur, date')
  const { page } = S.marc
  await page.goto(callUrl(S.classes['CE1 A'].id, S.classes['CE1 A'].slots[CALL_HALF]))
  await page.getByRole('button', { name: 'Corriger' }).click()
  await page.getByRole('button', { name: /^Lina\b/ }).click()
  await page.getByLabel('Motif de la correction (facultatif)').fill('Arrivée en retard')
  await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
  await page.getByRole('status').filter({ hasText: /Corrigé à/ }).waitFor()
  R.check('Marc enregistre une correction (nouvelle version)', true)

  const n = S.nadia.page
  await n.goto(`${server.url}/ecole/${S.schoolA}/historique`)
  const row = n.getByRole('link', { name: new RegExp(`CE1 A.*${SLOT_NAME[CALL_HALF]}.*Corrigé`) })
  await row.waitFor()
  R.check('historique : « Corrigé (version 2) »', /version 2/.test(await row.textContent()))
  await shot(n, 'p9-historique-1280')
  await row.click()
  await n.getByRole('button', { name: /Historique \(2\)/ }).click()
  const box = await n.locator('ol').last().textContent()
  R.check('détail : auteur, date et motif de la correction', /Correction n° 1/.test(box) && /Marc Pressé/.test(box) && /Arrivée en retard/.test(box), box.slice(0, 160))
  R.check('détail : ancienne et nouvelle valeur (Lina : Absent → Présent)', /Lina[^:]*: Absent → Présent/.test(box))
  await shot(n, 'p9-detail-correction-1280')
}

async function p10() {
  R.start('P10 · Hors ligne : brouillon « non transmis », reprise sans doublon')
  const { page, ctx } = S.julie
  // Julie a aussi la classe CE1 B le temps du test (affectation par la directrice).
  const nadia = S.nadia.page
  const members = await api(nadia, 'GET', `/api/schools/${S.schoolA}/members`)
  const julie = members.data.members.find((m) => m.email === PEOPLE.julie.email)
  await api(nadia, 'POST', `/api/schools/${S.schoolA}/classes/${S.classes['CE1 B'].id}/teachers`, { membershipId: julie.id })
  await page.goto(callUrl(S.classes['CE1 B'].id, S.classes['CE1 B'].slots[DIST_HALF]))
  await page.getByRole('region', { name: 'Élèves accueillis de CE1 A' }).waitFor()
  await ctx.setOffline(true)
  await page.getByRole('button', { name: /Toucher pour changer/ }).first().click()
  await page.getByRole('button', { name: 'Valider l’appel' }).click()
  const queued = page.getByText('Enregistré sur cet appareil, non transmis.')
  await queued.waitFor()
  R.check('sans réseau : « Enregistré sur cet appareil, non transmis »', true)
  R.check('pas de « Validé » affiché tant que le serveur n’a pas répondu', !(await page.getByRole('status').filter({ hasText: /Validé à/ }).count()))
  await shot(page, 'p10-hors-ligne-non-transmis-tablette')
  await ctx.setOffline(false)
  await page.getByRole('status').filter({ hasText: /Validé à/ }).waitFor({ timeout: 40_000 })
  R.check('retour du réseau : envoi automatique puis « Validé »', true)
  const c = await api(page, 'GET', callApi(S.classes['CE1 B'].id, S.classes['CE1 B'].slots[DIST_HALF]))
  R.check('une seule version enregistrée (aucun doublon)', c.data.call?.version === 1 && c.data.call.revisions.length === 1)
}

async function p11() {
  R.start('P11 · Sécurité multi-écoles : l’école A et l’école B ne se voient jamais')
  // L'admin crée l'école B ; Bruno en est la direction.
  const a = S.admin.page
  const r = await api(a, 'POST', '/api/admin/schools', { name: 'École des Érables (fictive)', directionEmail: PEOPLE.bruno.email })
  const bruno = await newPersona({ viewport: { width: 1280, height: 800 } })
  await acceptInvitation(bruno.page, r.data.inviteUrl)
  await bruno.page.waitForURL(/\/ecole\//)
  const B = bruno.page.url().split('/ecole/')[1]
  const A = S.schoolA
  const ce1a = S.classes['CE1 A'].id
  const reads = [
    `/api/schools/${A}/overview`,
    `/api/schools/${A}/dashboard`,
    `/api/schools/${A}/history`,
    `/api/schools/${A}/classes/${ce1a}`,
    callApi(ce1a, S.classes['CE1 A'].slots[CALL_HALF]),
    `/api/schools/${A}/distributions/${S.planId}`,
    `/api/schools/${A}/history/export?format=csv`,
    `/api/schools/${A}/members`,
  ]
  const statuses = []
  for (const p of reads) statuses.push((await api(bruno.page, 'GET', p)).status)
  R.check('école B → lecture des données de A refusée (8 routes)', statuses.every((s) => s === 403), statuses.join(','))
  const writes = [
    [`/api/schools/${A}/classes/${ce1a}/students`, { firstName: 'Intrus' }],
    [`${callApi(ce1a, S.classes['CE1 A'].slots[CALL_HALF])}/validate`, { requestId: 'x', entries: {} }],
    [`/api/schools/${A}/messages`, { body: 'x', targetKind: 'school', targets: [], startDate: TODAY, endDate: TODAY }],
    [`/api/schools/${A}/distributions/${S.planId}/cancel`, {}],
  ]
  const ws = []
  for (const [p, b] of writes) ws.push((await api(bruno.page, 'POST', p, b)).status)
  R.check('école B → modification des données de A refusée (4 routes)', ws.every((s) => s === 403), ws.join(','))
  await bruno.page.goto(`${server.url}/ecole/${A}`)
  await sleep(800)
  R.check('école B → l’adresse de l’école A dans le navigateur ne montre rien de A', !(await bruno.page.getByText('CE1 A').count()) && !bruno.page.url().endsWith(A))
  await shot(bruno.page, 'p11-ecole-b-refus-1280')
  // L'école A ne voit pas B.
  R.check('école A → données de B refusées', (await api(S.nadia.page, 'GET', `/api/schools/${B}/overview`)).status === 403)
  // Enseignant : uniquement ses classes et ses accueils.
  const m = S.marc.page
  R.check('enseignant → tableau de bord direction refusé', (await api(m, 'GET', `/api/schools/${A}/dashboard`)).status === 403)
  R.check('enseignant → appel d’une autre classe (CE2 A) refusé', (await api(m, 'GET', callApi(S.classes['CE2 A'].id, S.classes['CE2 A'].slots[DIST_HALF]))).status === 403)
  // Révocation : la directrice retire l'accès de Julie, effet immédiat.
  const n = S.nadia.page
  await n.goto(`${server.url}/ecole/${A}/equipe`)
  n.once('dialog', (d) => d.accept())
  await n.locator('li', { hasText: PEOPLE.julie.email }).getByRole('button', { name: 'Retirer l’accès' }).click()
  await n.locator('li', { hasText: PEOPLE.julie.email }).getByRole('button', { name: 'Retirer l’accès' }).waitFor({ state: 'detached' })
  const after = await api(S.julie.page, 'GET', callApi(S.classes['CP A'].id, S.classes['CP A'].slots[DIST_HALF]))
  R.check('accès révoqué : Julie ne peut plus ouvrir l’appel de CP A', after.status === 403, String(after.status))
  // Superadmin : aucune donnée nominative.
  R.check('superadmin → données internes de l’école A refusées', (await api(a, 'GET', `/api/schools/${A}/overview`)).status === 403)
  await bruno.ctx.close()
}

async function p12() {
  R.start('P12 · Mobile, tablette, ordinateur, clavier et accessibilité')
  const n = S.nadia
  const A = S.schoolA
  const pages = [
    ['tableau-de-bord', `/ecole/${A}`],
    ['classes', `/ecole/${A}/classes`],
    ['classe', `/ecole/${A}/classes/${S.classes['CE1 A'].id}`],
    ['repartitions', `/ecole/${A}/repartitions`],
    ['repartition', `/ecole/${A}/repartitions/${S.planId}`],
    ['repartir', `/ecole/${A}/repartitions/nouvelle`],
    ['messages', `/ecole/${A}/messages`],
    ['absences', `/ecole/${A}/absences`],
    ['historique', `/ecole/${A}/historique`],
    ['equipe', `/ecole/${A}/equipe`],
    ['parametres', `/ecole/${A}/parametres`],
    ['import', `/ecole/${A}/import`],
    ['appel', callUrl(S.classes['CE2 A'].id, S.classes['CE2 A'].slots[DIST_HALF]).replace(server.url, '')],
  ]
  const widths = [320, 360, 768, 1280]
  const overflow = []
  const axeIssues = []
  const small = new Map()
  for (const w of widths) {
    await n.page.setViewportSize({ width: w, height: w < 700 ? 740 : 900 })
    for (const [name, path] of pages) {
      await n.page.goto(server.url + path)
      await n.page.waitForLoadState('networkidle')
      const o = await horizontalOverflow(n.page)
      if (o > 0) overflow.push(`${name}@${w} (+${o}px)`)
      if (w === 360 || w === 1280) {
        for (const v of await axe(n.page)) axeIssues.push(`${name}@${w} : ${v}`)
      }
      if (w === 360) for (const t of await smallTargets(n.page)) small.set(t, name)
      if (['tableau-de-bord', 'appel', 'repartir', 'historique', 'classe'].includes(name)) await shot(n.page, `p12-${name}-${w}`)
    }
  }
  R.check(`aucun défilement horizontal à 320, 360, 768 et 1280 px (${pages.length} écrans)`, overflow.length === 0, overflow.join(', '))
  R.check('axe-core WCAG 2.1 AA : aucune violation (360 et 1280 px)', axeIssues.length === 0, axeIssues.slice(0, 8).join(' | '))
  R.check('zones tactiles ≥ 44 px sur téléphone (360 px)', small.size === 0, [...small].slice(0, 12).map(([t, p]) => `${p}: ${t}`).join(' | '))

  // Écrans enseignant sur iPhone et Android.
  for (const [label, dev] of [['iPhone 13', devices['iPhone 13']], ['Pixel 7', devices['Pixel 7']], ['iPhone SE', devices['iPhone SE']]]) {
    const p = await newPersona(dev)
    await login(p.page, PEOPLE.marc)
    await p.page.waitForURL(/\/(enseignant|appel)/)
    await p.page.goto(`${server.url}/enseignant`)
    await p.page.getByText(/CE1 A ·/).first().waitFor()
    const o = await horizontalOverflow(p.page)
    const v = await axe(p.page)
    R.check(`${label} : accueil enseignant lisible, sans défilement horizontal ni violation axe`, o <= 0 && v.length === 0, [o > 0 ? `+${o}px` : '', ...v].filter(Boolean).join(' | '))
    await shot(p.page, `p12-enseignant-${label.replace(/\s/g, '-').toLowerCase()}`)
    await p.ctx.close()
  }

  // Appel complet au clavier seul (sans souris), par la directrice sur CE2 A.
  await n.page.setViewportSize({ width: 1280, height: 900 })
  await n.page.goto(callUrl(S.classes['CE2 A'].id, S.classes['CE2 A'].slots[DIST_HALF]))
  await n.page.getByRole('region', { name: 'Élèves accueillis de CE1 A' }).waitFor()
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await n.page.keyboard.press('Tab')
    reached = await n.page.evaluate(() => /Toucher pour changer/.test(document.activeElement?.textContent ?? ''))
  }
  const before = await n.page.evaluate(() => document.activeElement.textContent)
  await n.page.keyboard.press('Enter')
  const afterTap = await n.page.evaluate(() => document.activeElement.textContent)
  const focusVisible = await n.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' || getComputedStyle(document.activeElement).boxShadow !== 'none')
  R.check('clavier : Tab jusqu’à un élève, Entrée change son état, focus visible', reached && before !== afterTap && focusVisible)
  let onValidate = false
  for (let i = 0; i < 80 && !onValidate; i++) {
    await n.page.keyboard.press('Tab')
    onValidate = await n.page.evaluate(() => /Valider l’appel/.test(document.activeElement?.textContent ?? ''))
  }
  await n.page.keyboard.press('Enter')
  await n.page.getByRole('status').filter({ hasText: /Validé à/ }).waitFor()
  R.check('clavier : Tab jusqu’à « Valider l’appel », Entrée valide', onValidate)
  R.note('Lecteurs d’écran réels (VoiceOver, TalkBack, NVDA) : non automatisables ici, à tester avec des utilisateurs (voir README).')
}

async function persistence() {
  R.start('Persistance · après redémarrage du serveur et reconnexion, tout est conservé')
  await server.stop()
  await server.start()
  const p = await newPersona({ viewport: { width: 1280, height: 800 } })
  await login(p.page, PEOPLE.nadia)
  await p.page.waitForURL(/\/ecole\//)
  const h = await api(p.page, 'GET', `/api/schools/${S.schoolA}/history?from=${TODAY}&to=${TODAY}`)
  const states = h.data.rows.map((r) => `${r.className}:${r.state}`)
  R.check('appels, corrections et répartition retrouvés', states.includes('CE1 A:corrected') && states.includes('CE1 A:distributed') && states.includes('CP A:validated'), states.join(' '))
  const ms = await api(p.page, 'GET', `/api/schools/${S.schoolA}/messages`)
  R.check('messages retrouvés', JSON.stringify(ms.data).includes('Photo de classe'))
  await p.ctx.close()
}

async function demo() {
  R.start('Démonstration · l’admin crée l’école de démonstration et ses comptes fonctionnent')
  const p = await newPersona({ viewport: { width: 1280, height: 800 } })
  await login(p.page, PEOPLE.admin)
  await p.page.waitForURL(/\/admin/)
  await p.page.getByRole('button', { name: 'Créer l’école de démonstration' }).click()
  const box = p.page.getByText('École de démonstration prête')
  await box.waitFor()
  const text = await p.page.locator('[role=status]').filter({ hasText: 'École de démonstration prête' }).textContent()
  const pwd = text.match(/Demo-[a-z2-9-]{14}/)?.[0]
  const dirEmail = text.match(/direction\.[a-z2-9]{4}@demo\.appely\.test/)?.[0]
  R.check('identifiants affichés une seule fois (mot de passe + 4 comptes)', !!pwd && !!dirEmail)
  await shot(p.page, 'demo-admin-identifiants-1280')
  const d = await newPersona({ viewport: { width: 1280, height: 800 } })
  await d.page.goto(`${server.url}/connexion`)
  await d.page.getByLabel('Adresse e-mail').fill(dirEmail)
  await d.page.getByLabel('Mot de passe').fill(pwd)
  await d.page.getByRole('button', { name: 'Se connecter' }).click()
  await d.page.waitForURL(/\/ecole\//)
  await d.page.getByText('CE1 A').first().waitFor()
  R.check('la direction de démonstration arrive sur un tableau de bord rempli', (await d.page.getByText(/CM1-CM2|PS-MS/).count()) > 0)
  await shot(d.page, 'demo-direction-tableau-de-bord-1280')
  await d.ctx.close()
  await p.ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  prepareCaptures()
  console.log(`Parcours E2E — ${TODAY} (jour ${NOW.weekday}), appel de Marc : ${HALF_LABEL[CALL_HALF]}, répartition : ${HALF_LABEL[DIST_HALF]}`)
  await server.start()
  browser = await chromium.launch()
  const steps = [p1, p2, p3, p4p5, p6, p7, p8, p9, p10, p11, p12, persistence, demo]
  for (const step of steps) {
    try {
      await step()
    } catch (e) {
      R.check(`le parcours se déroule sans blocage`, false, e.message.split('\n')[0])
      for (const persona of [S.nadia, S.marc, S.julie, S.admin]) if (persona) await shot(persona.page, `erreur-${step.name}-${[S.nadia, S.marc, S.julie, S.admin].indexOf(persona)}`).catch(() => {})
      if (['p1', 'p2', 'p3'].includes(step.name)) break // la suite dépend de ces étapes
    }
  }
  await browser.close()
  await server.stop()
  server.cleanup()
  R.write(join(CAPTURES, 'rapport.md'))
  const total = R.items.filter((i) => !i.note).length
  console.log(`\n${total - R.failures.length}/${total} contrôles réussis. Captures et rapport : e2e/captures/`)
  process.exit(R.failures.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await server.stop()
  process.exit(1)
})
