import { z } from 'zod';

// ─── Shared field helpers ────────────────────────────────────────────────────

const hebrewOrLatinName = z
  .string()
  .min(2, 'שם חייב להכיל לפחות 2 תווים')
  .max(100, 'שם ארוך מדי (מקסימום 100 תווים)')
  .regex(
    /^[\u0590-\u05FFa-zA-Z\s'-]+$/,
    'שם יכול להכיל אותיות עברית, לטינית, רווחים, גרש וקו מפריד בלבד'
  );

const israeliPhone = z
  .string()
  .min(9, 'מספר טלפון אינו תקין')
  .max(15, 'מספר טלפון אינו תקין')
  .regex(
    /^[\+]?[0-9\-\s()]{9,15}$/,
    'אנא הזן מספר טלפון ישראלי תקין (לדוגמה: 050-1234567)'
  );

const emailOptional = z
  .string()
  .email('כתובת אימייל אינה תקינה')
  .max(254, 'כתובת אימייל ארוכה מדי')
  .optional()
  .or(z.literal(''));

const messageText = z
  .string()
  .min(10, 'הודעה חייבת להכיל לפחות 10 תווים')
  .max(2000, 'הודעה ארוכה מדי (מקסימום 2000 תווים)');

// ─── Inquiry / practice area enum ───────────────────────────────────────────

export const INQUIRY_TYPES = [
  'real_estate',        // נדל"ן
  'family_law',         // דיני משפחה
  'labor_law',          // דיני עבודה
  'criminal_law',       // פלילי
  'civil_litigation',   // ליטיגציה אזרחית
  'corporate',          // דיני חברות
  'contracts',          // חוזים
  'other',              // אחר
] as const;

export type InquiryType = (typeof INQUIRY_TYPES)[number];

// ─── Lead / Contact form schema ──────────────────────────────────────────────

export const leadSchema = z.object({
  full_name: hebrewOrLatinName,
  phone: israeliPhone,
  email: emailOptional,
  inquiry_type: z.enum(INQUIRY_TYPES, {
    errorMap: () => ({ message: 'אנא בחר תחום משפטי מהרשימה' }),
  }),
  message: messageText,
  consent: z
    .boolean()
    .refine((val) => val === true, {
      message: 'יש לאשר את תנאי הפרטיות כדי להמשיך',
    }),
  source: z
    .enum(['website_form', 'whatsapp', 'phone', 'referral', 'other'])
    .optional()
    .default('website_form'),
});

export type LeadInput = z.infer<typeof leadSchema>;

// ─── Consultation booking schema (extended) ──────────────────────────────────

export const consultationSchema = leadSchema.extend({
  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'תאריך אינו תקין (YYYY-MM-DD)')
    .optional(),
  preferred_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'שעה אינה תקינה (HH:MM)')
    .optional(),
});

export type ConsultationInput = z.infer<typeof consultationSchema>;

// ─── Newsletter / soft-capture schema ────────────────────────────────────────

export const newsletterSchema = z.object({
  email: z
    .string()
    .email('כתובת אימייל אינה תקינה')
    .max(254, 'כתובת אימייל ארוכה מדי'),
  full_name: hebrewOrLatinName.optional(),
});

export type NewsletterInput = z.infer<typeof newsletterSchema>;
