const DICEBEAR_STYLE = "adventurer-neutral";
const DICEBEAR_BACKGROUNDS = "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf";

export function getCharacterAvatarUrl(seed: string): string {
  const normalized = seed.trim() || "character";
  const params = new URLSearchParams({
    seed: normalized,
    radius: "50",
    backgroundColor: DICEBEAR_BACKGROUNDS,
  });
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/svg?${params.toString()}`;
}
