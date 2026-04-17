-- ============================================================
-- Migration: 002_leads.sql
-- Purpose:   Create leads table for Aviv Iasso Law Firm
--            contact form submissions, with RLS policies.
-- ============================================================

-- 1. Enable UUID extension (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Inquiry type enum
DO $$ BEGIN
  CREATE TYPE inquiry_type_enum AS ENUM (
    'real_estate',
    'family_law',
    'labor_law',
    'criminal_law',
    'civil_litigation',
    'corporate',
    'contracts',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Lead source enum
DO $$ BEGIN
  CREATE TYPE lead_source_enum AS ENUM (
    'website_form',
    'whatsapp',
    'phone',
    'referral',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Lead status enum
DO $$ BEGIN
  CREATE TYPE lead_status_enum AS ENUM (
    'new',
    'contacted',
    'consultation_scheduled',
    'retained',
    'closed_won',
    'closed_lost'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5. Leads table
CREATE TABLE IF NOT EXISTS public.leads (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name         TEXT              NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  phone             TEXT              NOT NULL CHECK (char_length(phone) BETWEEN 9 AND 15),
  email             TEXT              CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  inquiry_type      inquiry_type_enum NOT NULL,
  message           TEXT              NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  consent_given     BOOLEAN           NOT NULL DEFAULT FALSE,
  source            lead_source_enum  NOT NULL DEFAULT 'website_form',
  status            lead_status_enum  NOT NULL DEFAULT 'new',
  ip_address        TEXT,
  notes             TEXT,                          -- internal staff notes
  assigned_to       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- 6. Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 7. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_leads_status       ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_inquiry_type ON public.leads (inquiry_type);
CREATE INDEX IF NOT EXISTS idx_leads_created_at   ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to  ON public.leads (assigned_to);

-- 8. Enable Row Level Security
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies

-- 9a. Anonymous / public users can INSERT (submit the contact form)
--     but cannot SELECT, UPDATE, or DELETE their own or others' rows.
DROP POLICY IF EXISTS "leads_insert_anon" ON public.leads;
CREATE POLICY "leads_insert_anon"
  ON public.leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    consent_given = TRUE          -- enforce consent at DB level too
  );

-- 9b. Authenticated staff can SELECT all leads
DROP POLICY IF EXISTS "leads_select_staff" ON public.leads;
CREATE POLICY "leads_select_staff"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    -- Optionally restrict to a specific role:
    -- AND EXISTS (
    --   SELECT 1 FROM public.staff_profiles
    --   WHERE user_id = auth.uid() AND role IN ('admin', 'lawyer', 'staff')
    -- )
  );

-- 9c. Authenticated staff can UPDATE leads (e.g. change status, add notes)
DROP POLICY IF EXISTS "leads_update_staff" ON public.leads;
CREATE POLICY "leads_update_staff"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- 9d. Only admins can DELETE leads (no automatic delete for regular staff)
--     Implement via a specific role check if using custom claims.
--     For now, deny all deletes from client-side.
DROP POLICY IF EXISTS "leads_delete_deny" ON public.leads;
CREATE POLICY "leads_delete_deny"
  ON public.leads
  FOR DELETE
  TO anon, authenticated
  USING (FALSE);  -- no one can delete via client SDK; use service role only

-- 10. Grant table-level permissions
GRANT INSERT ON public.leads TO anon;
GRANT INSERT, SELECT, UPDATE ON public.leads TO authenticated;

-- 11. Comment for documentation
COMMENT ON TABLE public.leads IS
  'Contact form submissions and lead inquiries for Aviv Iasso Law Firm. '
  'Inserted by anonymous visitors via /api/leads. Managed by authenticated staff.';
