import { z } from "zod";

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const decimal = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (value) => /^\d+(\.\d{1,4})?$/.test(value) && Number(value) >= 0,
    "Expected a nonnegative decimal",
  );
export const positiveDecimal = decimal.refine(
  (value) => Number(value) > 0,
  "Expected a positive decimal",
);

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(50),
  currentStock: decimal,
  leadTimeDays: z.number().int().nonnegative(),
  safetyStock: decimal,
  unitCost: decimal,
});

export const updateProductSchema = createProductSchema
  .omit({ currentStock: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const settingsSchema = z.object({
  movingAverageWindow: z.number().int().positive(),
  forecastHorizonDays: z.number().int().positive(),
  targetCoverDays: z.number().int().nonnegative(),
  minimumHistoryWeeks: z.number().int().positive(),
  minimumNonzeroDays: z.number().int().positive(),
  topNProducts: z.number().int().positive(),
  cvFolds: z.number().int().min(2),
  timezone: z.string().trim().min(1),
});

export const saleSchema = z.object({
  productId: uuid,
  saleDate: isoDate,
  quantity: positiveDecimal,
});
export const movementSchema = z.object({
  productId: uuid,
  movementDate: isoDate,
  movementType: z.enum(["opening_balance", "receipt", "adjustment", "return", "write_off"]),
  quantityDelta: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (value) => /^-?\d+(\.\d{1,3})?$/.test(value) && Number(value) !== 0,
      "Expected a nonzero decimal",
    ),
  note: z.string().trim().max(500).nullable().optional().default(null),
});
