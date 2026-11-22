export type OutboxMessage = {
  id: string;
  kind: "payment_info" | "claim_code";
  to: string;
  subject: string;
  body: string;
  createdAt: string;
  orderId: string;
  showbuyId: string;
};

const messages: OutboxMessage[] = [];

export function clearOutbox(): void {
  messages.length = 0;
}

export function listOutbox(): readonly OutboxMessage[] {
  return [...messages];
}

export function pushOutbox(message: Omit<OutboxMessage, "id" | "createdAt">): OutboxMessage {
  const entry: OutboxMessage = {
    ...message,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  messages.unshift(entry);
  return entry;
}
