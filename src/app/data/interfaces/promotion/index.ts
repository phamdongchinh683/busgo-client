export interface PromotionItem {
  id: number;
  title: string;
  content: string;
  imageUrl: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
}

export interface PromotionListResponse {
  items: PromotionItem[];
  next: number | null;
}

export interface PromotionUpsertBody {
  title: string;
  content: string;
  imageUrl: string;
  isActive: boolean;
  startDate: string;
  endDate: string;
}

export interface PromotionUpsertResponse {
  item: PromotionItem;
}
