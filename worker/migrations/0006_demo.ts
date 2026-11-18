// Lot 7 : école de démonstration (données fictives, recréable par le superadmin).
export default /* sql */ `

-- 1 = école de démonstration : seule une école marquée ainsi peut être supprimée entièrement.
ALTER TABLE schools ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
`
