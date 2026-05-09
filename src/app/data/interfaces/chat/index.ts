export interface ChatBox {
  id: number;
  lastMessage?: string;
  senderId?: number;
  receiverId?: number;
  senderMessageCount?: number;
  receiverMessageCount?: number;
  unreadReceiverCount?: number;
  unreadSenderCount?: number;
  lastMessageSenderId?: number;
  displayName?: string;
}

export interface ChatBoxListResponse {
  boxes: ChatBox[];
  next: number | null;
}

export interface CreateChatBoxBody {
  message: string;
  receiverId: number;
}

export interface ChatMessage {
  id: number;
  message: string;
  senderId: number;
  fullName: string;
  createdAt: string;
  phone?: string;
  email?: string;
}

export interface ChatMessagesListResponse {
  messages: ChatMessage[];
  next: number | null;
}

export interface SendChatMessageBody {
  message: string;
}
