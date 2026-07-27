import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runSeeds() {
  let connection;
  
  try {
    console.log('🔄 Conectando a MySQL...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    console.log('✅ Conectado a la base de datos\n');

    // Leer archivos de seeds
    const seedsDir = path.join(__dirname, '..', 'database', 'seeds');
    const files = fs.readdirSync(seedsDir).sort();

    console.log(`📦 Ejecutando ${files.length} seeds...\n`);

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      console.log(`   → ${file}`);
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
      
      // Dividir por statements
      const statements = sql
        .split(';')
        .filter(s => s.trim() && !s.trim().startsWith('--'))
        .map(s => s.trim() + ';');

      for (const statement of statements) {
        await connection.query(statement);
      }
    }

    console.log('\n✅ Seeds completados exitosamente\n');
    console.log('👤 Usuario de prueba:');
    console.log('   Email: admin@drogueria.com');
    console.log('   Password: Admin123!\n');

  } catch (error) {
    console.error('❌ Error ejecutando seeds:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runSeeds();
