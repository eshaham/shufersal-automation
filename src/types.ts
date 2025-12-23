// Order History

export interface ShufersalBase {
  code: string;
  name: string;
}

export interface ShufersalPrice {
  currencyIso: string;
  value: number;
  priceType: string;
  formattedValue: string;
}

export interface ShufersalStockStatus {
  code: 'inStock' | 'outOfStock';
  type: 'StockLevelStatus';
}

export interface ShufersalImage {
  uuid?: string | null;
  code: string;
  url: string;
  downloadUrl: string;
  mime: string;
  description?: string | null;
}

export interface ShufersalCity extends ShufersalBase {
  hasStreets: boolean;
  zipCode?: string | null;
}

export interface ShufersalStreet extends ShufersalBase {
  cityCode: string;
}

export interface ShufersalZipcode {
  code: string;
  fromNumber: number;
  toNumber: number;
  streetCode: string;
  cityCode: string;
}

export interface ShufersalAddress {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string | null;
  line1?: string | null;
  line2?: string | null;
  town?: string | null;
  region?: string | null;
  postalCode?: string;
  phone?: string;
  email?: string | null;
  country: {
    isocode: string;
    name: string;
  };
  shippingAddress: boolean;
  billingAddress: boolean;
  defaultAddress: boolean;
  visibleInAddressBook: boolean;
  formattedAddress?: string;
  editable: boolean;
  addressName?: string | null;
  city?: ShufersalCity;
  street?: ShufersalStreet;
  streetNumber?: string;
  isBuilding?: boolean;
  entrance?: string | null;
  apartmentNumber?: string | null;
  floor?: number | null;
  isElevator?: boolean | null;
  zipcode?: ShufersalZipcode;
}

export interface ShufersalConsignment {
  code: string;
  trackingID: string | null;
  status: {
    code: string;
    type: string;
  };
  statusDate: string | null;
  shippingAddress: ShufersalAddress;
  statusDisplay: string | null;
  region: string | null;
  sourceOfSupply: string;
  deliveryItemCode: string | null;
  deliveryCost: number | null;
  timeSlotStartTime: number;
  timeSlotStartTimeString: string;
  timeSlotStartHoursString: string;
  timeSlotStartDateString: string;
  timeSlotEndTime: number;
  timeSlotEndHoursString: string;
  timeSlotType: string;
  consignmentCustomerStatus: {
    code: string;
    type: string;
  };
  count: number;
  noteForSupplier: string | null;
  supportsShipping: boolean;
  deliveryMode: string;
  additionalTime: string | null;
}

export interface ShufersalPaymentMode extends ShufersalBase {
  description: string;
  image: ShufersalImage;
  type: string;
  creditCardType: string;
  validationRegex?: {
    code: string;
    regexList: string[];
    operator: string;
  };
}

export interface ShufersalPaymentInfo {
  id: string;
  accountHolderName: string;
  cardType: string;
  cardTypeData: ShufersalBase;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  saved: boolean;
  defaultPaymentInfo: boolean;
  billingAddress?: ShufersalAddress | null;
  paymentMode: string;
  paymentModeData: ShufersalPaymentMode;
  brand: string;
}

export interface ShufersalOrderStatus {
  code:
    | 'RECEIVED'
    | 'PICKING'
    | 'ON_THE_WAY'
    | 'DELIVERED'
    | 'CANCELLED_SENT_TO_ERP';
  type: 'OrderStatus';
}

export interface ShufersalOrder {
  code: string;
  totalPriceWithTax: ShufersalPrice;
  totalPrice: ShufersalPrice;
  totalTax: ShufersalPrice;
  subTotal: ShufersalPrice;
  subTotalWithoutQuoteDiscounts: ShufersalPrice;
  totalItems: number;
  deliveryAddress: ShufersalAddress;
  paymentInfo: ShufersalPaymentInfo;
  guid: string;
  user: {
    uid: string;
    name: string;
    profilePicture?: string | null;
    asm: boolean;
  };
  consignments: ShufersalConsignment[];
  created: number;
  status: ShufersalOrderStatus;
  createdString: string;
  deliveredDate: number;
  deliveredDateString: string | null;
  updateToDateString: string | null;
  updateToHourString: string | null;
  isUpdatable: boolean;
  isActive: boolean;
  isCancelable: boolean;
}

export interface ShufersalAccountOrders {
  activeOrders: ShufersalOrder[];
  closedOrders: ShufersalOrder[];
}

// Order Details

export interface ShufersalProductStock {
  stockLevelStatus: ShufersalStockStatus;
}

export interface ShufersalProductImage {
  imageType: string;
  format: string;
  url: string;
  altText: string;
  galleryIndex?: number;
  code?: string | null;
}

export enum ShufersalSellingMethod {
  Unit = 'BY_UNIT',
  Weight = 'BY_WEIGHT',
  Package = 'BY_PACKAGE',
}

export interface ShufersalProductUnit extends ShufersalBase {
  conversion: number;
  type: string;
}

export interface ShufersalProduct extends ShufersalBase {
  url: string;
  description: string;
  stock: ShufersalProductStock;
  price: ShufersalPrice;
  images: ShufersalProductImage[];
  sku: string;
  commercialDepartment: ShufersalBase;
  brand: ShufersalBase;
  deliveryItem: boolean;
  sellingMethod: {
    code: ShufersalSellingMethod;
    type: string;
  };
  groupingCode: string | null;
  country: {
    isocode: string;
    name: string;
  };
  manufacturerInfo: ShufersalBase | null;
  privateLabel: boolean;
  newProduct: boolean;
  showOnSite: boolean;
  showOnMobile: boolean;
  searchable: boolean;
  indexable: boolean;
  packagingType: string | null;
  adultsOnly: boolean;
  minOrderWeight: number | null;
  maxOrderWeight: number | null;
  minOrderQuantity: number | null;
  maxOrderQuantity: number | null;
  pricePerUnit: ShufersalPrice;
  categoryPrice: ShufersalPrice;
  pricePerUnitWithoutDiscount: ShufersalPrice;
  valueForComparison: number;
  unitForComparison: string;
  unitDescription: string | null;
  depositPrice?: number;
  unit: ShufersalProductUnit;
  commercialCategoryGroup: ShufersalBase | null;
  commercialCategorySubGroup: ShufersalBase | null;
  secondLevelCategory: string | null;
  cartStatus: {
    inCart: boolean;
    qty: number | null;
    sellingMethod: string | null;
    comment: string | null;
    cartEntryNumber: number | null;
  };
  promotionCodes: string[];
  allCategoryCodes: string[];
  effectiveMinQuantity: number;
  effectivePrice: number;
  effectivePricePerUnit: number;
  remarks: string | null;
  longTail: boolean;
  isBeProduct: boolean | null;
  calories?: number | null;
  fats?: number | null;
  sodium?: number | null;
  sugar?: number | null;
  weightConversion?: number | null;
  weightIncrement?: number | null;
  maxWeight?: number | null;
  minWeight?: number | null;
  healthAttributes?: { code: string; type: string }[];
}

export interface ShufersalPromotionOrderEntry {
  fired: boolean;
  couponCode: string | null;
  conditionType: null;
  promotionCode: string;
  conditionValue: null;
  promotionMessage: string;
  conditionActualValue: null;
  conditionMissingValue: null;
}

export interface ShufersalOrderEntry {
  entryNumber: number;
  quantity: number;
  basePrice: ShufersalPrice;
  totalPrice: ShufersalPrice;
  priceAfterDiscount?: number;
  discount?: number;
  itemDiscount?: number;
  promotionOrderEntries?: ShufersalPromotionOrderEntry[];
  product: ShufersalProduct;
}

export interface ShufersalOrderDetails extends ShufersalOrder {
  entries: ShufersalOrderEntry[];
}

// Cart

export interface ShufersalCartItem {
  entryNumber: number;
  productCode: string;
  productName: string;
  cartyQty: number;
  recommendation:
    | 'NONE'
    | 'PROMOTION'
    | 'ADD_AND_SAVE'
    | 'SWITCH_AND_SAVE'
    | 'SWITCH';
}

export interface ShufersalCartItemAdd {
  productCode: string;
  frontQuantity: number;
  quantity: number;
  sellingMethod: ShufersalSellingMethod;
  comment?: string;
  longTail: boolean;
}

export interface ShufersalProductSearchResult extends ShufersalBase {
  url: string;
  description: string;
  purchasable?: boolean | null;
  stock: ShufersalProductStock;
  price: ShufersalPrice;
  baseProduct?: string;
  images: ShufersalProductImage[];
  brand: ShufersalBase | null;
  deliveryItem?: boolean | null;
  sellingMethod?: {
    code: string;
    type: string;
  };
  categoryPrice?: ShufersalPrice;
  pricePerUnit?: ShufersalPrice;
  pricePerUnitWithoutDiscount?: ShufersalPrice | null;
  unitForComparison?: string;
  unitDescription?: string;
  promotions?: string[] | null;
  promotionMsg?: string | null;
  promotionCodes?: string[] | null;
  effectivePrice?: number | null;
  effectivePricePerUnit?: number | null;
  depositPrice?: number | null;
  cartStatus?: {
    inCart: boolean;
    qty?: number;
    sellingMethod?: string;
    comment?: string;
    cartEntryNumber?: number;
  };
  commercialCategoryGroup: ShufersalBase | null;
  commercialCategorySubGroup: ShufersalBase | null;
  secondLevelCategory?: string | null;
}

export interface ShufersalProductSearchResponse {
  results: ShufersalProductSearchResult[];
  pagination: {
    pageSize: number;
    currentPage: number;
    sort: string;
    numberOfPages: number;
    totalNumberOfResults: number;
  };
  facets?: {
    code: string;
    name: string;
    priority: number;
    category: boolean;
    multiSelect: boolean;
    visible: boolean;
    values?: {
      code: string;
      name: string;
      count: number;
      query: {
        url: string;
        query: {
          value: string;
        };
      };
      selected: boolean;
    }[];
  }[];
}

export interface ShufersalTimeSlot {
  fromHour: number | null;
  toHour: number | null;
  dayType: string | null;
  customerType: string | null;
  sourceOfSupply: string | null;
  available: number;
  reserved: number;
  locked: number;
  price: ShufersalPrice | null;
  deliveryCostCode: string | null;
  code: string | null;
  selectable: boolean;
  selectableLongTail: boolean;
  fromHourString: string | null;
  isToday: boolean;
  deliveryZone?: {
    code: string;
  };
}

export interface ShufersalAvailableTimeSlotsResponse {
  [date: string]: ShufersalTimeSlot[];
}

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
  rawData: unknown;
}

export interface Item {
  productCode: string;
  quantity: number;
  rawData: unknown;
}

export interface ExistingCartItem extends Item {
  entryNumber: number;
  productName: string;
  inStock: boolean;
}

export interface CartItemToAdd extends Omit<Item, 'rawData'> {
  sellingMethod: SellingMethod;
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
  promotions: PromotionInfo[];
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
  rawData: unknown;
}

export interface SearchResults {
  results: Product[];
  totalResults: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
}

export interface SerializedSessionData {
  cookies: unknown[];
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
