export interface ChatRealtimeMessage {
  senderId: number;
  body: string;
  boxId: number | string;
  createdAt?: string;
  senderName: string;
  title?: string;
}

export interface ChatUnreadCountPayload {
  boxId: number | string;
  count?: number;
  unreadCount?: number;
  unreadReceiverCount?: number;
  unreadSenderCount?: number;
  lastMessage?: string;
}

export interface ChatTypingPayload {
  userId: number;
  boxId: number | string;
}

export type ChatCallType = 'voice' | 'video';

export interface ChatCallStartPayload {
  userId: number;
  boxId: number | string;
  callType: ChatCallType;
}

export interface ChatCallActivePayload extends ChatCallStartPayload {
  startedAt?: number;
}

export interface ChatCallSignalPayload<T = unknown> {
  userId: number;
  boxId: number | string;
  payload: T;
}
