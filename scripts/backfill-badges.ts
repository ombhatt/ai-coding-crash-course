// Awards badges students already earned before badges existed, dated to the
// completions that earned them. Safe to run again. `npm run db:seed` runs the
// same backfill after inserting seed data.
import { backfillBadges } from "../app/services/badgeService";

const awarded = backfillBadges();
console.log(`Backfilled ${awarded} badges.`);
