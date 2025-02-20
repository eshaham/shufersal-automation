// Order History

export interface ShufersalPrice {
  currencyIso: string;
  value: number;
  priceType: string;
  formattedValue: string;
  minQuantity?: number | null;
  maxQuantity?: number | null;
}

export interface ShufersalStatus {
  code: string;
  type: string;
}

export interface ShufersalImage {
  uuid?: string | null;
  code: string;
  url: string;
  downloadUrl: string;
  mime: string;
  description?: string | null;
}

export interface ShufersalCity {
  code: string;
  name: string;
  hasStreets: boolean;
  zipCode?: string | null;
}

export interface ShufersalStreet {
  code: string;
  name: string;
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

export interface ShufersalPaymentMode {
  code: string;
  description: string;
  name: string;
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
  cardTypeData: {
    code: string;
    name?: string | null;
  };
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  saved: boolean;
  defaultPaymentInfo: boolean;
  billingAddress?: ShufersalAddress | null;
  paymentMode: string;
  paymentModeData: ShufersalPaymentMode;
  cvv?: string | null;
  ccNumber: string;
  brand: string;
}

export interface ShufersalConsignment {
  code: string;
  trackingID?: string | null;
  status: ShufersalStatus;
  statusDate?: string | null;
  shippingAddress: ShufersalAddress;
  deliveryPointOfService?: {
    name: string;
    displayName: string;
    geoPoint: {
      latitude: number;
      longitude: number;
    };
    address: ShufersalAddress;
  };
  deliveryMode?: string;
  timeSlotStartTime?: number;
  timeSlotEndTime?: number;
}

export interface ShufersalOrder {
  code: string;
  net: boolean;
  totalPriceWithTax: ShufersalPrice;
  totalPrice: ShufersalPrice;
  totalTax: ShufersalPrice;
  subTotal: ShufersalPrice;
  subTotalWithoutQuoteDiscounts: ShufersalPrice;
  deliveryCost?: ShufersalPrice | null;
  totalItems: number;
  deliveryMode?: string | null;
  deliveryAddress: ShufersalAddress;
  paymentInfo: ShufersalPaymentInfo;
  productDiscounts: ShufersalPrice;
  orderDiscounts: ShufersalPrice;
  quoteDiscounts: ShufersalPrice;
  totalDiscounts: ShufersalPrice;
  totalDiscountsWithQuoteDiscounts: ShufersalPrice;
  subTotalWithDiscounts: ShufersalPrice;
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
  status: ShufersalStatus;
  statusDisplay: string;
  created: number;
  createdString: string;
  salesApplication: ShufersalStatus;
  customerStatus: ShufersalStatus;
  deliveredDate: number;
  deliveredDateString: string;
  isUpdatable: boolean;
  isActive: boolean;
  isCancelable: boolean;
  consignments?: ShufersalConsignment[] | null;
}

export interface ShufersalAccountOrders {
  activeOrders: ShufersalOrder[];
  closedOrders: ShufersalOrder[];
}

// Order Details

export interface ShufersalProductStock {
  stockLevelStatus: ShufersalStatus;
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

export interface ShufersalProductImage {
  imageType: string;
  format: string;
  url: string;
  altText: string;
  galleryIndex?: number;
  code?: string | null;
}

export interface ShufersalProductCategory {
  code: string;
  name: string;
}

export interface ShufersalProduct {
  code: string;
  name: string;
  url: string;
  description: string;
  purchasable: boolean;
  stock: ShufersalProductStock;
  futureStocks?: ShufersalProductStock[] | null;
  availableForPickup?: boolean | null;
  averageRating?: number | null;
  numberOfReviews?: number | null;
  summary?: string | null;
  manufacturer?: string | null;
  variantType?: string | null;
  price: ShufersalPrice;
  baseProduct?: string | null;
  images: ShufersalProductImage[];
  categories?: string[] | null;
  volumePricesFlag?: boolean | null;
  firstCategoryNameList?: string[] | null;
  multidimensional?: boolean | null;
  configurable?: boolean;
  keywords?: string[] | null;
  genders?: string[] | null;
  sku?: string;
  commercialDepartment?: {
    code: string;
    name: string;
  };
  brand?: {
    code: string;
    name: string;
  };
  brandName?: string;
  deliveryItem: boolean;
  associatedDeiveryItem?: ShufersalProduct | null;
  inventoryManagement?: string;
  sellingMethod: {
    code: string;
    type: string;
  };
  groupingCode?: string | null;
  country?: {
    isocode: string;
    name: string;
  };
  manufacturerInfo?: string | null;
  privateLabel?: boolean;
  newProduct?: boolean;
  showOnSite?: boolean;
  showOnMobile?: boolean;
  searchable?: boolean;
  indexable?: boolean;
  packagingType?: string | null;
  sourceOfSupply?: string;
  productType?: string;
  adultsOnly?: boolean;
  giftProduct?: boolean;
  minOrderWeight?: number | null;
  maxOrderWeight?: number | null;
  minOrderQuantity?: number | null;
  maxOrderQuantity?: number | null;
  food: boolean;
  ignoreERPCategory?: string | null;
  stockReservationMethod?: string;
  ean?: string | null;
  popularityRanking?: number | null;
  pricePerUnit: ShufersalPrice;
  categoryPrice: ShufersalPrice;
  pricePerUnitWithoutDiscount?: ShufersalPrice;
  valueForComparison?: number;
  unitForComparison?: string;
  unitDescription?: string;
  depositPrice?: number;
  gallery360Images?: ShufersalProductImage[] | null;
  gallery360Link?: string | null;
  galleryAudios?: string[] | null;
  galleryPdfs?: string[] | null;
  galleryVideos?: string[] | null;
  generalVideos?: string[] | null;
  icon?: string | null;
  numberContentUnits?: number;
  unit: {
    code: string;
    name: string;
    conversion: number;
    type: string;
  };
  deliveryTime?: string | null;
  commercialCategoryGroup: ShufersalProductCategory;
  commercialCategorySubGroup: ShufersalProductCategory;
  productPriceGroup?: string | null;
  secondLevelCategory?: string;
  cartStatus?: {
    inCart: boolean;
    qty?: number | null;
    sellingMethod?: string | null;
    comment?: string | null;
    cartEntryNumber?: number | null;
  };
  promotionsDisplay?: string | null;
  promotionMsg?: string | null;
  promotionCharacteristicsImg?: string | null;
  promotionCodes?: string[];
  mainPromotionCode?: string | null;
  promotionCount?: number | null;
  promotionCharacteristicDescription?: string | null;
  allCategoryCodes?: string[];
  effectiveMinQuantity?: number;
  effectivePrice: number;
  effectivePricePerUnit: number;
  remarks?: string | null;
  weightConversion?: number | null;
  baseProductImageLarge?: string | null;
  baseProductImageMedium?: string | null;
  baseProductImageSmall?: string | null;
  baseProductDescription?: string | null;
  coordinationType?: string | null;
  canonical?: string | null;
  supply?: string | null;
  responsibility?: string | null;
  noIndex?: boolean | null;
  longTail?: boolean;
  isBeProduct?: boolean;
  leafletLink?: string | null;
  modifiable?: boolean;
  calories?: number | null;
  fats?: number | null;
  healthy?: boolean;
  sodium?: number | null;
  sugar?: number | null;
  weightIncrement?: number;
  maxWeight?: number | null;
  minWeight?: number | null;
  healthAttributes?: string[];
  healthRecommendation?: string | null;
}

export interface ShufersalOrderEntry {
  entryNumber: number;
  quantity: number;
  basePrice: ShufersalPrice;
  totalPrice: ShufersalPrice;
  product: ShufersalProduct;
  updateable: boolean;
}

export interface ShufersalOrderDetails extends ShufersalOrder {
  entries: ShufersalOrderEntry[];
  paymentType?: {
    code: string;
    displayName?: string | null;
  };
  b2bCustomerData?: {
    uid: string;
    name: string;
    profilePicture?: string | null;
    defaultBillingAddress?: ShufersalAddress;
    defaultShippingAddress?: ShufersalAddress;
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
}

// Cart

export interface ShufersalCartItem {
  entryNumber: number;
  productCode: string;
  productName: string;
  cartyQty: number;
}

export interface ShufersalCartItemAdd {
  productCode: string;
  frontQuantity: number;
  quantity: number;
  sellingMethod: 'BY_UNIT' | 'BY_WEIGHT';
  comment?: string;
  longTail: boolean;
}

export interface ShufersalProductSearchResult {
  code: string;
  name: string;
  url: string;
  description: string;
  purchasable?: boolean | null;
  stock: ShufersalProductStock;
  price: ShufersalPrice;
  baseProduct?: string;
  images: ShufersalProductImage[];
  brand?: {
    code?: string | null;
    name: string;
  };
  deliveryItem?: boolean | null;
  sellingMethod?: {
    code: string;
    type: string;
  };
  categoryPrice?: ShufersalPrice;
  pricePerUnit?: ShufersalPrice;
  unitForComparison?: string;
  unitDescription?: string;
  promotions?: string[] | null;
  promotionMsg?: string | null;
  cartStatus?: {
    inCart: boolean;
    qty?: number;
    sellingMethod?: string;
    comment?: string;
    cartEntryNumber?: number;
  };
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

export interface Category {
  code: string;
  name: string;
}

export interface Product {
  code: string;
  name: string;
  mainCategory: Category;
  subCategory: Category;
}

export interface Item {
  productCode: string;
  quantity: number;
}

export interface ItemDetails extends Item {
  product: Product;
  pricePerUnit: number;
}

export interface OrderInfo {
  code: string;
  date: string;
}

export interface AccountOrders {
  activeOrders: OrderInfo[];
  closedOrders: OrderInfo[];
}

export interface OrderDetails extends OrderInfo {
  items: Item[];
}
