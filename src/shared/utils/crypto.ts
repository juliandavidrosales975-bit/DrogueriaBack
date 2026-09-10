/**
 * Utilidades criptográficas: Cifrado César + Cifrado Asimétrico RSA (2048 bits)
 * Usado para proteger la transmisión de datos entre backend y frontend.
 */

export const RSA_CONFIG = {
  n: BigInt('0x94b1bc38dec46665c8e49a1bbdc9f4a2dd604423eeb0785c9947b8b7a0d23cf2592b317de6c3dfb06a019660951b8ccbedf9a1d8aacf7d8aa7fdc96a4803d9967023510b8431cefd4ef01eba6c7ca2c203909cce24f1cc665ecc5422f0aa8dfbace4181d16545652d958a017b60741f36813d2a01a939a7b76a029f915e8a7fffa19c00525123811367351a0a61652f0eee03c828fd179924a93112c35f4ede1d5e53e29e19fd945762a86e9eb1c6adb7f328c144f8a9ca460240ad0238fcde9310fff5de185809f8f3e090427b351236e736057954d3d623e2528e5967856453c64d6243a2309ba70584d24d8eab09ce36b3efd3940ca39e9957898170f41c9'),
  e: 65537n,
  d: BigInt('0x0c29acb087325000efe9991c7f4e037b85f9afa133cf4e0d1f01a19fada13cd88308383468f9a934bc3b1482a277be30d92eb3f92de1aa8e7ab6d4f0a362e33bbdc0f9ca641e11e520fd9db9d8916a5bcde0589f3920e93c0f718dc94cdfda9cd553d4101f0937856fdf62bb05c9fab04f195dff78250e3c1ea433c2baf2ccb910dfe89cabbd27e06f7dc1a930ad33c9feff66da246824e4050adbe6ed686e6786a34c2e1e60047a563ee062ce4dccaeda3bbe7f1ed1406a1ebd7abd601ead389fa83b0315214bd2b5dd1b67cde561988cda9f9a25b02395bbcd15f66bec1479b93a34555b6130d2fcbdf91408476276aee5ab7af8a5ba9fc1d0a7a6408ec281'),
};

/** Exponenciación modular: (base^exp) % mod */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let res = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % mod;
    base = (base * base) % mod;
    exp = exp / 2n;
  }
  return res;
}

/** Cifrado César sobre bytes UTF-8 */
export function caesarEncrypt(str: string, shift: number): string {
  const bytes = Buffer.from(str, 'utf8');
  const shifted = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    shifted[i] = (bytes[i] + shift) % 256;
  }
  return shifted.toString('base64');
}

/** Descifrado César */
export function caesarDecrypt(base64: string, shift: number): string {
  const bytes = Buffer.from(base64, 'base64');
  const unshifted = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    unshifted[i] = (bytes[i] - shift + 256) % 256;
  }
  return unshifted.toString('utf8');
}

export type EncryptedEnvelope = {
  success?: boolean;
  encrypted: true;
  rsaEnvelope: string;
  data: string;
};

/**
 * Cifra un objeto mediante el sobre híbrido:
 * 1. Genera un desplazamiento César aleatorio (clave de sesión).
 * 2. Cifra el JSON con Cifrado César.
 * 3. Cifra la clave César asimétricamente usando RSA.
 */
export function encryptEnvelope(dataObj: any): EncryptedEnvelope {
  const shift = Math.floor(Math.random() * 200) + 15;
  const json = JSON.stringify(dataObj);
  const caesarData = caesarEncrypt(json, shift);
  const rsaEnvelope = modPow(BigInt(shift), RSA_CONFIG.e, RSA_CONFIG.n).toString(16);

  return {
    success: true,
    encrypted: true,
    rsaEnvelope,
    data: caesarData,
  };
}

/**
 * Descifra un sobre recibido:
 * 1. Descifra la clave César usando la clave privada RSA.
 * 2. Descifra el contenido con Cifrado César.
 * 3. Parsea el JSON original.
 */
export function decryptEnvelope<T = any>(envelope: EncryptedEnvelope): T {
  const shift = Number(modPow(BigInt('0x' + envelope.rsaEnvelope), RSA_CONFIG.d, RSA_CONFIG.n));
  const json = caesarDecrypt(envelope.data, shift);
  return JSON.parse(json) as T;
}
