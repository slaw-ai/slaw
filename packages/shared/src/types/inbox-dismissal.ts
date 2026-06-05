export interface InboxDismissal {
  id: string;
  squadId: string;
  userId: string;
  itemKey: string;
  dismissedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
