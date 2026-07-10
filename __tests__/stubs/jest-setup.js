// lib/supabase.ts creates its client at import time from EXPO_PUBLIC_* env
// vars. Point it at a dead local URL so transitive imports construct an
// inert client — unit tests never touch the network.
process.env.EXPO_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
