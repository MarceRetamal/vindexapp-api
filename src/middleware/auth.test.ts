import { describe, expect, it } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import { verificarAccessJWT } from './auth';

const AUDIENCIA = 'aud-de-prueba';

async function crearJWKSDePrueba() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'clave-de-prueba';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, jwks };
}

async function firmarToken(
  privateKey: CryptoKey,
  opciones: { email?: string; commonName?: string; audiencia?: string; expiracionUnix?: number }
) {
  const ahora = Math.floor(Date.now() / 1000);
  const claims: Record<string, string> = {};
  if (opciones.email) claims.email = opciones.email;
  if (opciones.commonName) claims.common_name = opciones.commonName;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience(opciones.audiencia ?? AUDIENCIA)
    .setExpirationTime(opciones.expiracionUnix ?? ahora + 300)
    .sign(privateKey);
}

describe('verificarAccessJWT', () => {
  it('acepta un token valido y devuelve el email', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, { email: 'abogada@vindexlegal.com.ar' });

    const resultado = await verificarAccessJWT(token, jwks, AUDIENCIA);

    expect(resultado.email).toBe('abogada@vindexlegal.com.ar');
  });

  it('rechaza un token expirado', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const ahora = Math.floor(Date.now() / 1000);
    const token = await firmarToken(privateKey, {
      email: 'abogada@vindexlegal.com.ar',
      expiracionUnix: ahora - 60,
    });

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('rechaza un token con audiencia incorrecta', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, {
      email: 'abogada@vindexlegal.com.ar',
      audiencia: 'otra-audiencia',
    });

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('rechaza un token malformado', async () => {
    const { jwks } = await crearJWKSDePrueba();

    await expect(verificarAccessJWT('esto-no-es-un-jwt', jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('acepta un token de Service Token (common_name, sin email) y devuelve commonName', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, { commonName: 'n8n-vindex' });

    const resultado = await verificarAccessJWT(token, jwks, AUDIENCIA);

    expect(resultado.commonName).toBe('n8n-vindex');
    expect(resultado.email).toBeNull();
  });

  it('rechaza un token valido sin claim de email', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, {});

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow(
      'El token no incluye un email ni un common_name válido.'
    );
  });
});
