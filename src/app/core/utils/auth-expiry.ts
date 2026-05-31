export function clearStoredCredentials(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('currentDeviceId');
}

export function textIndicatesExpiredSession(text: string): boolean {
  const t = text.toLowerCase();
  if (t.includes('401')) return true;
  if (t.includes('unauthorized')) return true;
  if (t.includes('token expired')) return true;
  if (t.includes('jwt') && (t.includes('expired') || t.includes('invalid'))) return true;
  if (t.includes('invalid') && t.includes('jwt')) return true;
  if (t.includes('forbidden') && (t.includes('jwt') || t.includes('token'))) return true;
  return false;
}
