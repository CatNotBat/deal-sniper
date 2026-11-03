import { z } from "zod/v4";

const CATEGORIES = [
  "phone",
  "laptop",
  "desktop",
  "tablet",
  "monitor",
  "gpu",
  "console",
  "camera",
  "audio",
  "watch",
  "other",
] as const;

const CONFIDENCES = ["low", "medium", "high"] as const;

const isFacebookHttpsUrl = (v: string): boolean => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
};

export const ListingSchema = z.object({
  id: z.string().max(2000),
  title: z.string().max(300),
  price: z.number().nullable(),
  previousPrice: z.number().nullable(),
  currency: z.string().max(2000),
  priceText: z.string().max(2000),
  location: z.string().max(2000),
  url: z.string().max(2000).refine(isFacebookHttpsUrl, "url must be an https facebook.com URL"),
  imageUrl: z
    .string()
    .max(2000)
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "imageUrl must be empty or an https URL"),
  condition: z.string().max(2000),
  listedAge: z.string().max(2000),
});

export const ListingsSchema = z.array(ListingSchema).max(2000);

// Structured-output schema for the screening call: use .nullable() (never .optional()),
// and no min/max/regex constraints (structured outputs reject some JSON-schema keywords).
export const ScreenItemSchema = z.object({
  id: z.string(),
  skip: z.boolean(),
  skipReason: z.string(),
  product: z.string(),
  category: z.enum(CATEGORIES),
  marketLow: z.number().nullable(),
  marketHigh: z.number().nullable(),
  confidence: z.enum(CONFIDENCES),
  reasoning: z.string(),
});

export const ScreenBatchSchema = z.object({
  items: z.array(ScreenItemSchema),
});

export type ScreenItem = z.infer<typeof ScreenItemSchema>;
export type ScreenBatch = z.infer<typeof ScreenBatchSchema>;

// Parsed by hand from verification text, so real constraints are fine here.
export const VerifySchema = z
  .object({
    marketLow: z.number().min(0),
    marketHigh: z.number().min(0),
    summary: z.string(),
    redFlags: z.array(z.string()),
  })
  .refine((d) => d.marketLow <= d.marketHigh, {
    message: "marketLow must be <= marketHigh",
  });
