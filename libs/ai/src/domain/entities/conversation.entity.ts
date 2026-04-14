export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  orgId: string;
  userId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}
