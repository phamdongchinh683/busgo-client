export interface ChatRealtimeMessage {
  senderId: number;
  body: string;
  boxId: string;
  createdAt?: string;
  senderName: string;
  title?: string;
}

export interface ChatUnreadCountPayload {
  boxId:  string;
  count?: number;
  unreadCount?: number;
  unreadReceiverCount?: number;
  unreadSenderCount?: number;
  lastMessage?: string;
}

export interface ChatTypingPayload {
  userId: number;
  boxId: string;
}

export interface ChatMessageRecalledPayload {
  boxId: string;
  messageId: number | string;
  body: string;
  senderId: number;
  receiverId?: number;
  updatedAt?: string;
}

export type ChatCallType = 'voice' | 'video';

export interface ChatCallStartPayload {
  userId: number;
  boxId: string;
  callType: ChatCallType;
}

export interface ChatCallActivePayload extends ChatCallStartPayload {
  startedAt?: number;
}

export interface ChatCallSignalPayload<T = unknown> {
  userId: number;
  boxId: string;
  payload: T;
}
