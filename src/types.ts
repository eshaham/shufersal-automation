// Order History

export interface Price {
  currencyIso: string;
  value: number;
  priceType: string;
  formattedValue: string;
  minQuantity?: number | null;
  maxQuantity?: number | null;
}

export interface Status {
  code: string;
  type: string;
}

export interface Image {
  uuid?: string | null;
  code: string;
  url: string;
  downloadUrl: string;
  mime: string;
  description?: string | null;
}

export interface City {
  code: string;
  name: string;
  hasStreets: boolean;
  zipCode?: string | null;
}

export interface Street {
  code: string;
  name: string;
  cityCode: string;
}

export interface Zipcode {
  code: string;
  fromNumber: number;
  toNumber: number;
  streetCode: string;
  cityCode: string;
}

export interface Address {
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
  city?: City;
  street?: Street;
  streetNumber?: string;
  isBuilding?: boolean;
  entrance?: string | null;
  apartmentNumber?: string | null;
  floor?: number | null;
  isElevator?: boolean | null;
  zipcode?: Zipcode;
}

export interface PaymentMode {
  code: string;
  description: string;
  name: string;
  image: Image;
  type: string;
  creditCardType: string;
  validationRegex?: {
    code: string;
    regexList: string[];
    operator: string;
  };
}

export interface PaymentInfo {
  id: string;
  accountHolderName: string;
  cardType: string;
  cardTypeData: {
    code: string;
    name?: string | null;
  };
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  saved: boolean;
  defaultPaymentInfo: boolean;
  billingAddress?: Address | null;
  paymentMode: string;
  paymentModeData: PaymentMode;
  cvv?: string | null;
  ccNumber: string;
  brand: string;
}

export interface Consignment {
  code: string;
  trackingID?: string | null;
  status: Status;
  statusDate?: string | null;
  shippingAddress: Address;
  deliveryPointOfService?: {
    name: string;
    displayName: string;
    geoPoint: {
      latitude: number;
      longitude: number;
    };
    address: Address;
  };
  deliveryMode?: string;
  timeSlotStartTime?: number;
  timeSlotEndTime?: number;
}

export interface Order {
  code: string;
  net: boolean;
  totalPriceWithTax: Price;
  totalPrice: Price;
  totalTax: Price;
  subTotal: Price;
  subTotalWithoutQuoteDiscounts: Price;
  deliveryCost?: Price | null;
  totalItems: number;
  deliveryMode?: string | null;
  deliveryAddress: Address;
  paymentInfo: PaymentInfo;
  productDiscounts: Price;
  orderDiscounts: Price;
  quoteDiscounts: Price;
  totalDiscounts: Price;
  totalDiscountsWithQuoteDiscounts: Price;
  subTotalWithDiscounts: Price;
  site: string;
  store: string;
  guid: string;
  calculated: boolean;
  user: {
    uid: string;
    name: string;
    profilePicture?: string | null;
    asm: boolean;
  };
  totalUnitCount: number;
  status: Status;
  statusDisplay: string;
  created: number;
  createdString: string;
  salesApplication: Status;
  customerStatus: Status;
  deliveredDate?: number;
  deliveredDateString?: string;
  isUpdatable: boolean;
  isActive: boolean;
  isCancelable: boolean;
  consignments?: Consignment[] | null;
}

export interface AccountOrders {
  activeOrders: Order[];
  closedOrders: Order[];
}

// Order Details

export interface ProductStock {
  stockLevelStatus: Status;
  stockLevel?: number | null;
  stockThreshold?: number | null;
  available?: number | null;
  reserved?: number | null;
  invMethod?: string | null;
  inventoryManagement?: string | null;
  inventoryOnTheWay?: number | null;
  minimalThreshold1?: number | null;
  minimalThreshold2?: number | null;
  warehouse?: string | null;
  productCode?: string | null;
}

export interface ProductImage {
  imageType: string;
  format: string;
  url: string;
  altText: string;
  galleryIndex?: number;
  code?: string;
}

export interface Product {
  code: string;
  name: string;
  url: string;
  description: string;
  purchasable: boolean;
  stock: ProductStock;
  price: Price;
  images: ProductImage[];
  brand?: {
    code: string;
    name: string;
  };
  sku?: string;
  deliveryItem: boolean;
  food: boolean;
}

export interface OrderEntry {
  entryNumber: number;
  quantity: number;
  basePrice: Price;
  totalPrice: Price;
  product: Product;
  updateable: boolean;
}

export interface OrderDetails extends Order {
  entries: OrderEntry[];
  paymentType?: {
    code: string;
    displayName?: string | null;
  };
  b2bCustomerData?: {
    uid: string;
    name: string;
    profilePicture?: string | null;
    defaultBillingAddress?: Address;
    defaultShippingAddress?: Address;
    firstName: string;
    lastName: string;
    currency?: {
      isocode: string;
      name: string;
      symbol: string;
    };
    language?: {
      isocode: string;
      name: string;
    };
    contactNumber?: string;
  };
  deliveredDate?: number;
  deliveredDateString?: string;
}

// Cart

export interface CartItem {
  productCode: string;
  frontQuantity: number;
  quantity: number;
  sellingMethod: string;
  comment?: string;
  longTail: boolean;
}
