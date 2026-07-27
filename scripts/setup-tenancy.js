/**
 * Script para ejecutar la migración de multi-tenancy en Supabase
 * Uso: node scripts/setup-tenancy.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function runMigration() {
  console.log('🔄 Ejecutando migración de multi-tenancy...\n');

  // Leer el SQL de migración
  const sqlPath = path.join(__dirname, '..', 'database', 'migrations', '006_multi_tenant.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  // Dividir en statements individuales (separados por ;)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    try {
      // Intentar ejecutar via RPC exec_sql si existe
      const { error } = await supabase.rpc('exec_sql', { sql: stmt + ';' });
      if (error) {
        // Si no existe la función, mostramos el SQL para ejecución manual
        console.warn(`⚠️  No se pudo ejecutar automáticamente. Error: ${error.message}`);
        errorCount++;
      } else {
        successCount++;
      }
    } catch {
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 INSTRUCCIONES PARA EJECUTAR LA MIGRACIÓN MANUALMENTE:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard');
    console.log('2. Selecciona tu proyecto y ve a "SQL Editor"');
    console.log('3. Crea una nueva consulta (New query)');
    console.log('4. Copia y pega el contenido del archivo:');
    console.log(`   ${sqlPath}`);
    console.log('5. Haz clic en "Run" para ejecutar la migración\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } else {
    console.log(`✅ Migración completada: ${successCount} statements ejecutados`);
  }
}

runMigration().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
