import type { DiagnosableSession } from './SessionProxy';
import type {
  AccountOrders,
  CartItemToAdd,
  CartMutationResult,
  CartState,
  DeliveryTimeSlot,
  ExistingCartItem,
  OrderDetails,
  OrderInfo,
  OrderLookupOptions,
  Product,
  ScrapedPromotionDetails,
  SearchResults,
  SerializedSessionData,
} from './types';

export interface GrocerySession extends DiagnosableSession {
  performLogin(): Promise<void>;
  restore(): Promise<void>;
  verifySessionAlive(): Promise<void>;
  serialize(): Promise<SerializedSessionData>;
  close(): Promise<void>;

  searchProducts(
    query: string,
    limit?: number,
    page?: number,
  ): Promise<SearchResults>;
  getProductByCode(productCode: string): Promise<Product | null>;

  getOrders(options?: OrderLookupOptions): Promise<AccountOrders>;
  getOrderDetails(
    code: string,
    options?: OrderLookupOptions,
  ): Promise<OrderDetails | undefined>;

  addToCart(items: CartItemToAdd[]): Promise<CartMutationResult>;
  setCartItemQuantities(items: CartItemToAdd[]): Promise<CartMutationResult>;
  clearCart(): Promise<void>;
  getCartState(): Promise<CartState>;
  getCartItems(): Promise<ExistingCartItem[]>;

  getAvailableTimeSlots(): Promise<DeliveryTimeSlot[]>;
  getSelectedTimeSlot(): Promise<DeliveryTimeSlot | null>;
  selectTimeSlot(timeSlotOrCode: string | DeliveryTimeSlot): Promise<void>;

  createOrder(removeMissingItems: boolean): Promise<OrderInfo>;
}

export interface OrderUpdateSupport {
  putOrderInUpdateMode(code: string): Promise<void>;
  getOrderInUpdateMode(): Promise<string | null>;
}

export interface OrderCancelSupport {
  cancelOrder(code: string): Promise<void>;
}

export interface ReceiptEmailSupport {
  sendReceipt(orderNumber: string, email: string): Promise<void>;
}

export interface PromotionLookupSupport {
  getPromotionDetails(
    promotionCode: string,
  ): Promise<ScrapedPromotionDetails | null>;
  getPromotionsByProduct(
    productCode: string,
  ): Promise<ScrapedPromotionDetails | null>;
}

export interface PaymentForm {
  url: string;
  amount: number;
  messageOrigin: string;
  cardLastDigits?: string;
}

export interface PaymentReference {
  id: string;
  amount: number;
}

export interface InteractivePaymentSupport {
  preparePayment(): Promise<PaymentForm>;
  registerPayment(message: unknown): Promise<PaymentReference>;
  discardPayment(payment: PaymentReference): Promise<void>;
}
