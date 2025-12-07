import { createClient } from '@supabase/supabase-js';

// Clés en dur (100 % safe pour devnet)
const SUPABASE_URL = 'https://lrzxrciozsujfpxbazmq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyenhyY2lvenN1amZweGJhem1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwOTM0NTIsImV4cCI6MjA4MDY2OTQ1Mn0.cEttd9IpqpPuAyV1jOsnZftnGH2w35tkslouNWHGs44';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
