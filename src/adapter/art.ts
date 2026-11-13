// Card art is never bundled or copied. The bot puts ArkhamDB's own image URL in the embed and Discord fetches it.
// Point it somewhere else (or switch it off) with CARD_IMAGE_BASE / CARD_IMAGES=off.
// Checked against ArkhamDB's public API: every card (investigator, location, agenda, asset...) has imagesrc `/bundles/cards/<code>.png`;
// double-sided cards also have `<code>b.png` for the other side, which the bot does not show yet.
export interface ArtConfig { enabled: boolean; base: string; ext: string }

let cfg: ArtConfig = { enabled: true, base: 'https://arkhamdb.com/bundles/cards/', ext: '.png' };

export function configureArt(env: Record<string, string | undefined>): ArtConfig {
  cfg = {
    enabled: (env.CARD_IMAGES ?? 'on').toLowerCase() !== 'off',
    base: (env.CARD_IMAGE_BASE ?? cfg.base).replace(/\/?$/, '/'),
    ext: env.CARD_IMAGE_EXT ?? cfg.ext,
  };
  return cfg;
}
export const artConfig = (): ArtConfig => cfg;
/** Link to a card's face, or undefined when art is off or the code looks wrong. */
export function cardArt(code: string | undefined): string | undefined {
  if (!cfg.enabled || !code || !/^\d{5}[a-z]?$/.test(code)) return undefined;
  return `${cfg.base}${code}${cfg.ext}`;
}
