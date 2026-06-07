import { existsSync } from "node:fs";
import { join } from "node:path";
import { ScriptType, ScriptTypeLabel } from "../lib/constants";
import { getScriptTheme } from "../lib/script-themes";

const scriptTypes = Object.values(ScriptType);
const projectRoot = process.cwd();

for (const scriptType of scriptTypes) {
  const theme = getScriptTheme(scriptType);

  if (!theme.id) {
    throw new Error(`${scriptType} theme is missing an id`);
  }

  if (!theme.name) {
    throw new Error(`${scriptType} theme is missing a display name`);
  }

  if (!theme.image.startsWith("/script-themes/")) {
    throw new Error(`${scriptType} image must be a local /script-themes asset`);
  }

  if (!theme.accentRgb.match(/^\d{1,3}, \d{1,3}, \d{1,3}$/)) {
    throw new Error(`${scriptType} accentRgb must be formatted as "r, g, b"`);
  }

  const imagePath = join(projectRoot, "public", theme.image);
  if (!existsSync(imagePath)) {
    throw new Error(`${scriptType} image file does not exist: ${imagePath}`);
  }

  console.log(`verified ${scriptType}: ${ScriptTypeLabel[scriptType]} -> ${theme.image}`);
}
