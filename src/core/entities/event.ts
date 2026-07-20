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
}
