export function pickStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function chatPeerLabel(o: Record<string, unknown>): string {
  return pickStr(o, 'displayName') ?? pickStr(o, 'title') ?? pickStr(o, 'senderName') ?? '';
}

export function chatConversationTitle(o: Record<string, unknown>): string | undefined {
  return pickStr(o, 'displayName') ?? pickStr(o, 'title');
}

export function chatSenderName(o: Record<string, unknown>): string {
  return pickStr(o, 'senderName') ?? '';
}

export function chatLastMessagePreview(o: Record<string, unknown>): string | undefined {
  return pickStr(o, 'lastMessage');
}

export function viewerFullNameFromStorage(): string {
  try {
    const u = JSON.parse(localStorage.getItem('user') ?? '{}') as {
      fullName?: string;
    };
    return u.fullName?.trim() || '';
  } catch {
    return '';
  }
}
