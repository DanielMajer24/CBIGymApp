#!/bin/sh
# Generates the browser-visible Supabase configuration during a static-host build.
# The anon key is safe to expose; never substitute a service_role key here.
set -e

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Set SUPABASE_URL and SUPABASE_ANON_KEY in the deployment environment." >&2
  exit 1
fi

printf 'window.CBI_CONFIG = { supabaseUrl: "%s", supabaseAnonKey: "%s" };\n' \
  "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > app-config.js
