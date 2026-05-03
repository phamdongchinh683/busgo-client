export interface ChatBox {
  id: number;
  title: string;
  lastMessage?: string;
  lastMessageAt?: string;
  senderId?: number;
  receiverId?: number;
  senderMessageCount?: number;
  receiverMessageCount?: number;
  unreadReceiverCount?: number;
  unreadSenderCount?: number;
  lastMessageSenderId?: number;
  senderFullName?: string;
}

export interface ChatBoxListResponse {
  boxes: ChatBox[];
  next: number | null;
}

export interface CreateChatBoxBody {
  message: string;
  title: string;
  receiverId: number;
}

export interface ChatMessage {
  id: number;
  message: string;
  senderId: number;
  fullName: string;
  phone: string;
  email: string;
  createdAt: string;
}

export interface ChatMessageListResponse {
  messages: ChatMessage[];
  next: number | null;
}

export interface SendChatMessageBody {
  message: string;
}
