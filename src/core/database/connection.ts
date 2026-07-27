import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@config/env';
import type { Database } from './supabase.types';

// Supabase Client (usado para todas las operaciones de datos vía REST/PostgREST + RPC)
let supabaseClient: SupabaseClient<Database> | null = null;

export const createSupabaseClient = (): SupabaseClient<Database> => {
  if (supabaseClient) {
    return supabaseClient;
  }

  supabaseClient = createClient<Database>(
    env.supabase.url,
    env.supabase.serviceRoleKey, // Usar service role en backend (bypassea RLS)
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  console.log(`✅ Supabase client created - ${env.supabase.url}`);
  return supabaseClient;
};

export const getSupabaseClient = (): SupabaseClient<Database> => {
  if (!supabaseClient) {
    // Auto-inicializar si aún no se ha creado (útil en tests o scripts)
    return createSupabaseClient();
  }
  return supabaseClient;
};

export const closeSupabaseClient = async (): Promise<void> => {
  supabaseClient = null;
};

/**
 * Helper para lanzar un Error legible cuando una operación de Supabase falla.
 * Uso: const { data, error } = await supabase.from(...); throwIfError(error);
 */
export const throwIfError = (error: { message: string } | null): void => {
  if (error) {
    throw new Error(error.message);
  }
};
