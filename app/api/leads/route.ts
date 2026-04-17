import { NextRequest, NextResponse } from 'next/server';
import { leadSchema } from '@/lib/validation';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { ZodError } from 'zod';

// ─── Simple in-memory rate limiter (per IP, per minute) ─────────────────────
// For production, replace with Redis-backed limiter (e.g. @upstash/ratelimit)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 5;       // max 5 submissions
const RATE_LIMIT_WINDOW = 60;   // per 60 seconds

function getRateLimitHeaders(ip: string): {
  headers: Record<string, string>;
  blocked: boolean;
} {
  const now = Math.floor(Date.now() / 1000);
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': String(RATE_LIMIT_MAX - 1),
        'X-RateLimit-Reset': String(now + RATE_LIMIT_WINDOW),
      },
      blocked: false,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      headers: {
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(entry.resetAt),
        'Retry-After': String(entry.resetAt - now),
      },
      blocked: true,
    };
  }

  entry.count += 1;
  rateLimitMap.set(ip, entry);

  return {
    headers: {
      'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
      'X-RateLimit-Remaining': String(RATE_LIMIT_MAX - entry.count),
      'X-RateLimit-Reset': String(entry.resetAt),
    },
    blocked: false,
  };
}

// ─── POST /api/leads ──────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // 1. Resolve client IP
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  // 2. Rate limit check
  const { headers: rateLimitHeaders, blocked } = getRateLimitHeaders(ip);

  if (blocked) {
    return NextResponse.json(
      {
        success: false,
        error: 'יותר מדי בקשות. אנא המתן מספר דקות ונסה שוב.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: rateLimitHeaders }
    );
  }

  // 3. Parse request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'גוף הבקשה אינו JSON תקין.',
        code: 'INVALID_JSON',
      },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  // 4. Validate with Zod
  const parseResult = leadSchema.safeParse(rawBody);

  if (!parseResult.success) {
    const fieldErrors = parseResult.error.flatten().fieldErrors;
    return NextResponse.json(
      {
        success: false,
        error: 'נתונים שהוזנו אינם תקינים. אנא בדוק את הטופס.',
        code: 'VALIDATION_ERROR',
        fields: fieldErrors,
      },
      { status: 422, headers: rateLimitHeaders }
    );
  }

  const validated = parseResult.data;

  // 5. Insert into Supabase (parameterized via Supabase client — safe by default)
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('leads')
    .insert([
      {
        full_name: validated.full_name,
        phone: validated.phone,
        email: validated.email || null,
        inquiry_type: validated.inquiry_type,
        message: validated.message,
        consent_given: validated.consent,
        source: validated.source,
        ip_address: ip,
        created_at: new Date().toISOString(),
        status: 'new',
      },
    ])
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[POST /api/leads] Supabase insert error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'אירעה שגיאה בשמירת הפנייה. אנא נסה שוב או פנה אלינו ישירות.',
        code: 'DB_ERROR',
      },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  // 6. Success
  return NextResponse.json(
    {
      success: true,
      message: 'הפנייה התקבלה בהצלחה! ניצור איתך קשר בהקדם.',
      data: {
        id: data.id,
        created_at: data.created_at,
      },
    },
    { status: 201, headers: rateLimitHeaders }
  );
}

// ─── GET /api/leads — not allowed publicly ────────────────────────────────────
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
    },
    {
      status: 405,
      headers: {
        Allow: 'POST',
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW),
      },
    }
  );
}
