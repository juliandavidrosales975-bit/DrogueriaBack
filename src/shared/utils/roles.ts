/**
 * Constantes de roles del sistema.
 * Centralizar aquí evita strings hardcodeados dispersos en cada archivo de rutas.
 */

/** Roles exclusivos para droguerías */
export const PHARMACY_ADMIN = 'Administrador de Drogueria';
export const PHARMACY_CASHIER = 'Cajero';

/** Roles exclusivos para tiendas generales */
export const STORE_ADMIN = 'Administrador de Tienda';
export const STORE_SELLER = 'Vendedor';

/** Super Administrador (gestiona todo el sistema) */
export const SUPER_ADMIN = 'Super Administrador';

/** Todos los administradores del sistema (Super Admin + Administradores de establecimiento) */
export const SYSTEM_ADMINS = [SUPER_ADMIN, PHARMACY_ADMIN, STORE_ADMIN] as const;

/** Todos los roles de administrador por tipo de establecimiento */
export const ALL_ADMINS = [PHARMACY_ADMIN, STORE_ADMIN] as const;



/** Todos los roles de operación (cajero/vendedor) por tipo de establecimiento */
export const ALL_OPERATORS = [PHARMACY_CASHIER, STORE_SELLER] as const;

/** Todos los roles de negocio (administradores + operadores de cualquier tipo) */
export const ALL_BUSINESS_ROLES = [
  PHARMACY_ADMIN,
  PHARMACY_CASHIER,
  STORE_ADMIN,
  STORE_SELLER,
] as const;

/** Roles "cajero" — usados para restricciones de visibilidad (solo ver propias ventas/caja) */
export const OPERATOR_ROLES = [PHARMACY_CASHIER, STORE_SELLER] as const;
