export interface Event {
  readonly id: string;
  readonly name: string;
  readonly storeName: string;
  readonly storeAddress: string;
  readonly storeWebsite: string;
  readonly storeEmail: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly format: string;
  readonly category: string;
  readonly meetingType: string;
  readonly capacity: { readonly registered: number; readonly max: number };
  readonly isFree: boolean;
  readonly costAmount: number | null;
  readonly costCurrency: string;
  readonly locatorUrl: string;
  // riftfound-specific fields (set to defaults by the old-API mapper)
  readonly eventType: string;
  readonly price: string;
  readonly description: string;
  readonly imageUrl: string;
  readonly externalUrl: string | null;
  readonly locatorEventId?: number;
}
