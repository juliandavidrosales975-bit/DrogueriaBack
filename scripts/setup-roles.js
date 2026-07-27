import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  try {
    console.log('🔄 Inicializando configuracion de roles...');

    // 1. Crear o verificar rol Super Administrador
    let { data: superAdminRole } = await supabase
      .from('roles')
      .select('*')
      .eq('name', 'Super Administrador')
      .maybeSingle();

    if (!superAdminRole) {
      console.log('➕ Creando rol "Super Administrador"...');
      const { data: newRole, error } = await supabase
        .from('roles')
        .insert({ id: 'role-super-admin', name: 'Super Administrador' })
        .select()
        .single();
      if (error) throw error;
      superAdminRole = newRole;
      console.log('✅ Rol "Super Administrador" creado.');
    } else {
      console.log('ℹ️  El rol "Super Administrador" ya existe.');
    }

    // 2. Renombrar "Administrador" -> "Administrador de Drogueria"
    const { data: adminRole } = await supabase
      .from('roles')
      .select('*')
      .eq('name', 'Administrador')
      .maybeSingle();

    if (adminRole) {
      console.log('🔄 Renombrando rol "Administrador" a "Administrador de Drogueria"...');
      const { error } = await supabase
        .from('roles')
        .update({ name: 'Administrador de Drogueria' })
        .eq('id', adminRole.id);
      if (error) throw error;
      console.log('✅ Rol renombrado correctamente.');
    } else {
      const { data: existing } = await supabase
        .from('roles')
        .select('*')
        .eq('name', 'Administrador de Drogueria')
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase
          .from('roles')
          .insert({ id: 'role-admin', name: 'Administrador de Drogueria' });
        if (error) throw error;
        console.log('✅ Rol "Administrador de Drogueria" creado.');
      } else {
        console.log('ℹ️  El rol "Administrador de Drogueria" ya existe.');
      }
    }
    // 3. Crear roles para Tiendas Generales
    const newRoles = [
      { id: 'role-store-admin', name: 'Administrador de Tienda' },
      { id: 'role-seller', name: 'Vendedor' },
    ];

    for (const r of newRoles) {
      const { data: existing } = await supabase.from('roles').select('id').eq('name', r.name).maybeSingle();
      if (!existing) {
        console.log(`➕ Creando rol "${r.name}"...`);
        const { error } = await supabase.from('roles').insert(r);
        if (error) console.warn(`Nota al insertar rol ${r.name}:`, error.message);
        else console.log(`✅ Rol "${r.name}" creado.`);
      } else {
        console.log(`ℹ️ El rol "${r.name}" ya existe.`);
      }
    }
    // 3. Obtener ID del rol Super Administrador
    const { data: finalSuperRole, error: roleErr } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'Super Administrador')
      .single();
    if (roleErr) throw roleErr;

    // 4. Crear/actualizar usuario Super Admin
    const superEmail = 'juliandrosalesp@gmail.com';
    const superPassword = '1193051330 Jr';
    const passwordHash = await bcrypt.hash(superPassword, 10);

    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', superEmail)
      .maybeSingle();

    if (!existingUser) {
      console.log(`➕ Creando usuario Super Admin (${superEmail})...`);
      const { error } = await supabase.from('users').insert({
        id: 'user-super-admin',
        email: superEmail,
        username: 'superadmin',
        full_name: 'Julian Rodriguez',
        password_hash: passwordHash,
        role_id: finalSuperRole.id,
        status: 'ACTIVE',
      });
      if (error) throw error;
      console.log('✅ Usuario Super Admin creado.');
    } else {
      console.log(`🔄 Actualizando usuario Super Admin existente (${superEmail})...`);
      const { error } = await supabase
        .from('users')
        .update({
          password_hash: passwordHash,
          role_id: finalSuperRole.id,
          status: 'ACTIVE',
          full_name: 'Julian Rodriguez',
        })
        .eq('email', superEmail);
      if (error) throw error;
      console.log('✅ Usuario Super Admin actualizado.');
    }

    console.log('\n🎉 Configuracion completada correctamente.');
    console.log('');
    console.log('📋 Credenciales Super Admin:');
    console.log(`   Email:    ${superEmail}`);
    console.log(`   Password: ${superPassword}`);
    console.log('');
  } catch (error) {
    console.error('❌ Error configurando roles:', error);
    process.exit(1);
  }
}

run();
