import { z } from "zod";

const toBool = (v: unknown) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['true','t','1','yes','y'].includes(s)) return true;
  if (['false','f','0','no','n'].includes(s)) return false;
  return Boolean(v);
};

const toNullIfEmpty = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

export const CanonicalRow = z.object({
  word: z.string(),
  is_clueable: z.union([z.string(), z.boolean(), z.null()]).transform(toBool).nullable(),
  zipf: z.union([z.string(), z.number(), z.null()]).transform((v) => {
    if (v === null || v === '') return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  }).nullable(),
  pos: z.union([z.string(), z.null()]).transform(toNullIfEmpty).nullable(),
  flags: z.union([z.string(), z.null()]).transform(toNullIfEmpty).nullable(),
  theme_tags: z.union([z.string(), z.null()]).transform(toNullIfEmpty).nullable(),
  banned: z.union([z.string(), z.boolean()]).transform(toBool),
  in_must_keep: z.union([z.string(), z.boolean()]).transform(toBool),
  sources: z.string()
});

export type CanonicalRowT = z.infer<typeof CanonicalRow>;
