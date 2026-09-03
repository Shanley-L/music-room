-- Story 1.2 — Migration: renommage de l'enum VoteLicense.GEO_TIME_RESTRICTED -> GEO_RESTRICTED
--
-- Contexte :
--   - Le schéma Prisma renomme la valeur `GEO_TIME_RESTRICTED` -> `GEO_RESTRICTED`
--     (la plage horaire `voteStartAt`/`voteEndAt` est hors licence, deferred).
--   - Les lignes existantes `license = 'GEO_TIME_RESTRICTED'` doivent être backfillées.
--   - L'absence de licence vaut `TOUT_LE_MONDE` (EVERYONE) : une ligne non backfillée
--     serait lue « tout le monde » -> exactement ce que la vérification post-migration empêche.
--
-- Pourquoi ce fichier recrée le type au lieu de `ALTER TYPE ... DROP VALUE` :
--   PostgreSQL ne supporte PAS `DROP VALUE` sur un enum (erreur de syntaxe). Prisma lui-même
--   recrée le type entier (CREATE TYPE _new + ALTER COLUMN TYPE USING + RENAME + DROP old),
--   comme le génère `npx prisma migrate diff`. Une fois ce fichier appliqué, l'enum en base
--   correspond exactement au schéma et `npx prisma db push` (déjà lancé par `npm start`) est
--   un no-op pour l'enum — on évite ainsi de devoir passer `--accept-data-loss`.
--
-- Notes d'exécution :
--   - `ON_ERROR_STOP` : toute erreur (y compris une exception de vérification) interrompt
--     le script — un état non conforme ne laisse jamais la migration se poursuivre.
--   - Le backfill, la vérification et la recréation du type sont atomiques (une seule
--     transaction). Le lock ACCESS EXCLUSIVE bloque les écritures concurrentes sur "Room"
--     entre le backfill et l'échange de type : un INSERT concurrent utilisant l'ancienne
--     valeur casserait le CAST `license::text::"VoteLicense_new"`.
--   - Comparaisons via `license::text` : indifférent à l'existence du label dans l'enum,
--     ce qui rend le fichier ré-exécutable (no-op sûr sur une base déjà migrée).
--   - `ALTER TYPE ... ADD VALUE` ne peut pas s'exécuter dans un bloc transactionnel et la
--     nouvelle valeur ne peut pas être utilisée dans la transaction qui l'ajoute -> il est
--     exécuté en autocommit, avant la transaction.

\set ON_ERROR_STOP on

-- 1) Ajout de la nouvelle valeur (autocommit, hors transaction)
ALTER TYPE "VoteLicense" ADD VALUE IF NOT EXISTS 'GEO_RESTRICTED';

BEGIN;

-- 2) Verrouillage : bloque toute écriture concurrente sur "Room" entre le backfill et
--    l'échange de type (un INSERT concurrent avec l'ancienne valeur casserait le CAST).
LOCK TABLE "Room" IN ACCESS EXCLUSIVE MODE;

-- 3) Backfill des lignes existantes (comparaison en texte pour rester ré-exécutable)
UPDATE "Room" SET license = 'GEO_RESTRICTED' WHERE license::text = 'GEO_TIME_RESTRICTED';

-- 4) Vérification post-migration — RAISE EXCEPTION en cas d'état non conforme.
--    Équivaut aux comptages suivants, conservés en commentaire pour la lecture :
--      SELECT COUNT(*) AS unmapped_rows
--      FROM "Room"
--      WHERE license::text = 'GEO_TIME_RESTRICTED';
--      -- Doit renvoyer 0.
--
--      SELECT COUNT(*) AS geo_restricted_without_zone
--      FROM "Room"
--      WHERE license = 'GEO_RESTRICTED'
--        AND (latitude IS NULL OR longitude IS NULL OR "radiusM" IS NULL);
--      -- Doit renvoyer 0.
DO $$
DECLARE
  unmapped_count INTEGER;
  bad_zone_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmapped_count
  FROM "Room"
  WHERE license::text = 'GEO_TIME_RESTRICTED';

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Migration incomplète : % ligne(s) encore en license GEO_TIME_RESTRICTED (backfill requis)', unmapped_count;
  END IF;

  SELECT COUNT(*) INTO bad_zone_count
  FROM "Room"
  WHERE license = 'GEO_RESTRICTED'
    AND (latitude IS NULL OR longitude IS NULL OR "radiusM" IS NULL);

  IF bad_zone_count > 0 THEN
    RAISE EXCEPTION 'Invariant AC #5 violé : % salle(s) GEO_RESTRICTED sans zone (latitude/longitude/"radiusM" requis)', bad_zone_count;
  END IF;
END $$;

-- 5) Recréation du type pour retirer GEO_TIME_RESTRICTED (équivalent au SQL de Prisma).
--    Le `DROP TYPE IF EXISTS` rend cette étape idempotente en cas de re-exécution.
DROP TYPE IF EXISTS "VoteLicense_new";
CREATE TYPE "VoteLicense_new" AS ENUM ('EVERYONE', 'INVITED_ONLY', 'GEO_RESTRICTED');
ALTER TABLE "Room" ALTER COLUMN "license" DROP DEFAULT;
ALTER TABLE "Room" ALTER COLUMN "license" TYPE "VoteLicense_new" USING ("license"::text::"VoteLicense_new");
ALTER TYPE "VoteLicense" RENAME TO "VoteLicense_old";
ALTER TYPE "VoteLicense_new" RENAME TO "VoteLicense";
DROP TYPE "VoteLicense_old";
ALTER TABLE "Room" ALTER COLUMN "license" SET DEFAULT 'EVERYONE';

COMMIT;

-- ROLLBACK (documenté) :
--   1) Backfill inverse AVANT l'échange de type (obligatoire : le CAST
--      `license::text::"VoteLicense_new"` échouerait sur des lignes encore en
--      'GEO_RESTRICTED', valeur absente de l'enum recréé) :
--      BEGIN;
--      LOCK TABLE "Room" IN ACCESS EXCLUSIVE MODE;
--      UPDATE "Room" SET license = 'GEO_TIME_RESTRICTED' WHERE license::text = 'GEO_RESTRICTED';
--      DROP TYPE IF EXISTS "VoteLicense_new";
--      CREATE TYPE "VoteLicense_new" AS ENUM ('EVERYONE', 'INVITED_ONLY', 'GEO_TIME_RESTRICTED');
--      ALTER TABLE "Room" ALTER COLUMN "license" DROP DEFAULT;
--      ALTER TABLE "Room" ALTER COLUMN "license" TYPE "VoteLicense_new" USING ("license"::text::"VoteLicense_new");
--      ALTER TYPE "VoteLicense" RENAME TO "VoteLicense_old";
--      ALTER TYPE "VoteLicense_new" RENAME TO "VoteLicense";
--      DROP TYPE "VoteLicense_old";
--      ALTER TABLE "Room" ALTER COLUMN "license" SET DEFAULT 'EVERYONE';
--      COMMIT;
--   2) Restaurer la valeur dans le schéma Prisma (GEO_TIME_RESTRICTED) puis relancer
--      `npx prisma db push` pour resynchroniser.