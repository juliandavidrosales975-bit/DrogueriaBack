import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runMigrations() {
  let connection;
  
  try {
    console.log('🔄 Conectando a MySQL...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    // Crear base de datos si no existe
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    console.log(`✅ Base de datos "${process.env.DB_NAME}" lista`);

    await connection.query(`USE ${process.env.DB_NAME}`);

    // Leer archivos de migración
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();

    console.log(`\n📦 Ejecutando ${files.length} migraciones...\n`);

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      console.log(`   → ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      // Dividir por statements
      const statements = sql
        .split(';')
        .filter(s => s.trim())
        .map(s => s.trim() + ';');

      for (const statement of statements) {
        await connection.query(statement);
      }
    }

    console.log('\n✅ Migraciones completadas exitosamente\n');

  } catch (error) {
    console.error('❌ Error ejecutando migraciones:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runMigrations();
