export interface NamedEntity {
  code: string;
  name: string;
}

export enum SellingMethod {
  Unit = 'UNIT',
  Weight = 'WEIGHT',
}

export enum OrderStatus {
  Active = 'ACTIVE',
  Shipped = 'SHIPPED',
  Delivered = 'DELIVERED',
  Canceled = 'CANCELED',
}

export type PackUnit = 'g' | 'ml' | 'unit';

export interface PackSize {
  amount: number;
  unit: PackUnit;
}

export interface Product {
  code: string;
  name: string;
  description: string;
  brand: NamedEntity | null;
  mainCategory: NamedEntity | null;
  subCategory: NamedEntity | null;
  sellingMethod: SellingMethod;
  imageUrl?: string;
  inStock: boolean;
  purchasable: boolean;
  price: number;
  formattedPrice: string;
  priceWithoutDiscount: number;
  depositPrice?: number;
  promotionCodes: string[];
  barcode?: string;
  quantityStep?: number;
  packSize?: PackSize;
  rawData: unknown;
}

export interface Item {
  productCode: string;
  quantity: number;
  rawData: unknown;
}

export interface ExistingCartItem extends Item {
  entryNumber: number;
  itemPrice: number;
  itemDiscount: number;
  inStock: boolean;
}

export interface CartState {
  items: ExistingCartItem[];
  orderInUpdateMode: string | null;
}

export interface CartModification {
  productCode: string;
  statusCode: string;
  entryNumber: number | null;
  quantity: number | null;
  rawData: Record<string, string | number | boolean>;
}

export interface CartMutationResult extends CartState {
  modifications: CartModification[];
}

export interface CartItemToAdd extends Omit<Item, 'rawData'> {
  sellingMethod: SellingMethod;
}

export interface CartItemToRemove {
  productCode: string;
  entryNumber?: number;
}

export enum PromotionType {
  SIMPLE_DISCOUNT = 'SIMPLE_DISCOUNT',
  X_FOR_Y = 'X_FOR_Y',
  BUY_X_GET_Y = 'BUY_X_GET_Y',
  PERSONAL_COUPON = 'PERSONAL_COUPON',
  UNKNOWN = 'UNKNOWN',
}

export interface PromotionConditions {
  type: PromotionType;
  originalPrice?: number;
  discountedPrice?: number;
  discountPercent?: number;
  requiredQuantity?: number;
  bundlePrice?: number;
  effectivePricePerUnit?: number;
  buyQuantity?: number;
  getQuantity?: number;
  effectiveDiscount?: number;
  couponCode?: string;
  discountAmount?: number;
}

export interface PromotionInfo {
  code: string;
  message: string;
  type: PromotionType;
  conditions: PromotionConditions;
  couponCode?: string | null;
  participatingProducts?: string[];
}

export interface ScrapedPromotionDetails {
  regularPrice?: number;
  promotionalPrice?: number;
  validFrom?: Date;
  validUntil?: Date;
  eligibleProductCodes?: string[];
  description?: string;
}

export interface ItemDetails extends Item {
  product: Product;
  pricePerUnit: number;
  basePricePerUnit?: number;
  actualPricePerUnit?: number;
  discountAmount?: number;
  depositPrice?: number;
  promotions: PromotionInfo[];
  outOfStock: boolean;
}

export interface OrderInfo {
  code: string;
  deliveryDateTime: string;
  updateableUntilDateTime: string | null;
  totalPrice: number;
  status: OrderStatus;
  isUpdatable: boolean;
  isActive: boolean;
  isCancelable: boolean;
  isBeingUpdated: boolean;
  rawData: unknown;
}

export interface AccountOrders {
  activeOrders: OrderInfo[];
  closedOrders: OrderInfo[];
}

export interface OrderDetails extends OrderInfo {
  items: ItemDetails[];
}

export interface DeliveryTimeSlot {
  code: string;
  dateTime: string;
  cutoffDateTime?: string;
  deliveryFee?: number;
  rawData: unknown;
}

export interface SearchResults {
  results: Product[];
  totalResults: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
}

export interface SessionCredentials {
  token: string;
  expiresAt?: string;
}

export interface SerializedSessionData {
  cookies: unknown[];
  credentials?: SessionCredentials;
  context?: Record<string, string>;
}

export interface ReceiptPromotion {
  code: string;
  description: string;
  discountAmount: number;
}

export interface ReceiptItem {
  productCode: string;
  productName: string;
  barcode?: string;
  orderedQuantity: number;
  suppliedQuantity: number;
  sellingMethod: SellingMethod;
  price: number;
  totalPrice: number;
  promotions?: ReceiptPromotion[];
}

export interface ReceiptDetails {
  orderCode: string;
  orderDate: string;
  deliveryDate: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: ReceiptItem[];
  subtotal: number;
  vatAmount: number;
  deliveryFee: number;
  totalAmount: number;
}

export interface OrderLookupOptions {
  detectUpdateMode?: boolean;
}

export interface CreateOrderOptions {
  removeMissingItems: boolean;
  mergePendingCart?: boolean;
  discardPendingCart?: boolean;
}
