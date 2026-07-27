import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function debug() {
  console.log('=== DEBUG TENANCY ===');

  // 1. Mostrar droguerías
  const { data: stores } = await supabase.from('stores').select('*');
  console.log('\n--- Stores/Droguerías ---');
  console.table(stores);

  // 2. Mostrar usuarios con su rol y store
  const { data: users } = await supabase.from('users').select('id, email, role_id, store_id, roles(name), stores(name)');
  console.log('\n--- Users ---');
  console.log(JSON.stringify(users, null, 2));

  // 3. Mostrar productos con su store
  const { data: products } = await supabase.from('products').select('id, name, store_id, stores(name)');
  console.log('\n--- Products ---');
  console.log(JSON.stringify(products, null, 2));
}

debug().catch(console.error);
