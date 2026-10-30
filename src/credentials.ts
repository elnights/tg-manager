export type ApiCredentials = {apiId: number; apiHash: string};

export function parseCredentials(apiId: string, apiHash: string): ApiCredentials {
  const id = Number(apiId.trim());
  const hash = apiHash.trim();
  if (!/^\d+$/.test(apiId.trim()) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('API ID must be a positive whole number.');
  }
  if (!/^[a-f\d]{32}$/i.test(hash)) {
    throw new Error('API hash must contain exactly 32 hexadecimal characters.');
  }
  return {apiId: id, apiHash: hash};
}
