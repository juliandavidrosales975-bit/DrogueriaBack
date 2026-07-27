# 🏥 Sistema de Droguería - Backend

Backend monolítico para sistema de gestión de droguería con **Supabase** y PostgreSQL.

## 📁 Estructura del Proyecto

```
backend/
├── src/
│   ├── config/          # Configuraciones
│   ├── core/            # Núcleo (DB, utils)
│   ├── modules/         # Módulos de negocio
│   │   ├── auth/
│   │   ├── users/
│   │   ├── products/
│   │   ├── sales/
│   │   ├── purchases/
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── inventory/
│   │   ├── reports/
│   │   └── settings/
│   ├── shared/          # Código compartido
│   └── server.ts        # Entry point
├── database/            # Migraciones SQL
└── scripts/             # Scripts de utilidad
```

## 🏗️ Arquitectura

### Patrón de Capas (Layered Architecture)

```
Controller → Service → Repository → Database
```

- **Controllers**: Manejo de peticiones HTTP
- **Services**: Lógica de negocio
- **Repositories**: Acceso a datos (SQL queries)
- **Models**: Tipos TypeScript

## 🚀 Instalación

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Configurar base de datos en .env

# Ejecutar migraciones
npm run db:migrate

# Cargar datos de prueba
npm run db:seed
```

## 💻 Desarrollo

```bash
# Modo desarrollo con hot-reload
npm run dev

# Build para producción
npm run build

# Ejecutar en producción
npm start
```

## 🔧 Tecnologías

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: MySQL (mysql2)
- **Auth**: JWT + bcryptjs
- **Validation**: Zod
- **Documentation**: Swagger
- **WebSocket**: Socket.io

## 📊 Base de Datos

Usa MySQL con queries SQL nativos (sin ORM).
Ver migraciones en `database/migrations/`.

## 🔐 Seguridad

- JWT para autenticación
- Bcrypt para passwords
- Helmet para headers HTTP
- Rate limiting
- CORS configurado
- Validación de inputs con Zod

## 📝 API Documentation

Swagger UI disponible en: `http://localhost:3000/api-docs`

## 🧪 Testing

```bash
npm test
```

## 📦 Deploy

```bash
npm run build
NODE_ENV=production npm start
```
