import "dotenv/config";
import { sendRecommendations } from "./send.js";

// Manual one-off runner for testing:
//   npx tsx src/cli.ts morning [--dry-run]
//   npx tsx src/cli.ts evening [--dry-run]
const slot = (process.argv[2] === "evening" ? "evening" : "morning") as "morning" | "evening";
const dryRun = process.argv.includes("--dry-run");

sendRecommendations(slot, dryRun).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
});
