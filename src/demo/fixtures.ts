/**
 * Données STRICTEMENT FICTIVES (cahier des charges §02) : prénoms inventés,
 * aucune donnée réelle d'élève ne doit jamais apparaître dans ce dépôt.
 */
export const DEMO_SCHOOL = 'École des Tilleuls (fictive)'

export const DEMO_CLASS = {
  name: 'CP A',
  slot: 'Appel du matin',
  message: 'Pensez à la réunion de ce soir à 17 h 30.',
  students: [
    'Adam', 'Emma', 'Lina', 'Noah', 'Inès', 'Louis', 'Jade', 'Gabin', 'Rose', 'Malo',
    'Alba', 'Sacha', 'Lou', 'Nino', 'Iris', 'Tom', 'Mia', 'Eden', 'Zoé', 'Hugo',
    'Léna', 'Owen', 'Anna', 'Milo',
  ].map((firstName, i) => ({ id: `demo-${i + 1}`, firstName })),
}
