-- Run in Supabase SQL editor (project: fucklike / catsino-casino edoprprqqtvtezexskpr)
-- Live user generation request queue

CREATE TABLE IF NOT EXISTS public.generation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  persona_name text NOT NULL,
  spec jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  error_msg text,
  drive_file_ids text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_genq_status ON public.generation_queue(status);
CREATE INDEX IF NOT EXISTS idx_genq_user ON public.generation_queue(user_id);

ALTER TABLE public.generation_queue ENABLE ROW LEVEL SECURITY;

-- Users can create and read their own requests
CREATE POLICY "users own queue rows"
  ON public.generation_queue
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can update status (Colab/Apps Script uses service key)
-- No extra policy needed — service role bypasses RLS
