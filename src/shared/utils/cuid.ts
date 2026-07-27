/**
 * Generador simple de IDs únicos (similar a CUID)
 * Formato: [timestamp]-[random]
 */
export const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}`;
};
