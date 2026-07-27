import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('No JWT_SECRET found in .env');
  process.exit(1);
}

async function test() {
  console.log('=== TEST API WITH DIRECT JWT SIGNING (NATIVE FETCH) ===');

  // Vivi: storeId = mrp2zm0x-fdedo8vzo3
  const tokenVivi = jwt.sign(
    {
      userId: 'mrp22gl8-qjapxyye3hf',
      email: 'vivi@gmail.com',
      role: 'Administrador de Drogueria',
      storeId: 'mrp2zm0x-fdedo8vzo3',
      storeName: 'Drogueria Diana',
    },
    secret,
    { expiresIn: '1h' }
  );

  // Admin Principal: storeId = store-default
  const tokenAdmin = jwt.sign(
    {
      userId: 'user-admin',
      email: 'admin@drogueria.com',
      role: 'Administrador de Drogueria',
      storeId: 'store-default',
      storeName: 'Droguería Principal',
    },
    secret,
    { expiresIn: '1h' }
  );

  try {
    console.log('\n--- 1. Querying as Vivi (Store: Drogueria Diana) ---');
    const resVivi = await fetch('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${tokenVivi}` },
    });
    console.log('HTTP Status:', resVivi.status);
    const dataVivi = await resVivi.json();
    console.log('Products found:', dataVivi.data?.map(p => ({ name: p.name, storeId: p.storeId })));

    console.log('\n--- 2. Querying as Admin Principal (Store: Droguería Principal) ---');
    const resAdmin = await fetch('http://localhost:3000/api/products', {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    console.log('HTTP Status:', resAdmin.status);
    const dataAdmin = await resAdmin.json();
    console.log('Products found:', dataAdmin.data?.map(p => ({ name: p.name, storeId: p.storeId })));

  } catch (err) {
    console.error('Error during HTTP request:', err.message);
  }
}

test();
