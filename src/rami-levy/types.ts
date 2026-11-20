export interface RamiLevyNamedEntity {
  id: number;
  name: string;
  slug?: string;
  sort?: number;
}

export interface RamiLevySale {
  code: number;
  type: number;
  cmt: number | null;
  scm: number | null;
  sw_kefel: number;
  name: string;
  max_in_doc: number | null;
  is_club: number;
  from: string;
  to: string;
}

export interface RamiLevyProduct {
  id: number;
  barcode: number;
  name: string;
  short_desc?: string;
  full_desc?: string;
  price: { price: number };
  prop: {
    unit: number | null;
    sw_shakil: number;
    by_kilo: number;
    by_kilo_content: number;
    status: number;
  };
  multiplication: number;
  department: RamiLevyNamedEntity | null;
  group: RamiLevyNamedEntity | null;
  subGroup: RamiLevyNamedEntity | null;
  images: { small?: string | null; original?: string | null } | null;
  available_in: number[];
  gs?: { BrandName?: string | null } | null;
  sale: RamiLevySale[];
}

export interface RamiLevyCatalogResponse {
  status: number;
  total: number;
  data: RamiLevyProduct[];
}

export interface RamiLevyCartLine {
  id: number;
  name: string;
  price: number;
  quantity: number;
  FormatedTotalPrice: number;
  FormatedSavePrice: number;
  is_delivery: boolean;
}

export interface RamiLevyCartResponse {
  items: RamiLevyCartLine[];
  price: number;
  quantity: number;
  status: number;
}

export interface RamiLevyAddress {
  id: number;
  city: string | null;
  city_id: number | null;
  street: string | null;
  street_id: number | null;
  street_number: string | null;
  entrance: string | null;
  apartment: string | null;
  floor: string | null;
  default: number | null;
  name: string | null;
  zip: string | null;
  area: string | null;
  area_id: number | null;
  store_id: number | null;
}

export interface RamiLevyDeliveryReservation {
  id: number;
  order_id: number | null;
  strip_id: number;
  hour: string;
  supply_date: string;
  supply_date_no_time: string;
  order_until_hour: string;
  expires_at: string | null;
  price: number;
  store_id: string;
}

export interface RamiLevyCustomer {
  id: number;
  name: string;
  email: string;
  store_id: string | null;
  edit_order: number | null;
  addresses: Record<string, RamiLevyAddress>;
}

export interface RamiLevyCustomerResponse {
  user: RamiLevyCustomer;
  deliveryTimesCustomer: RamiLevyDeliveryReservation | null;
  cart: { items: Record<string, number> } | null;
}

export interface RamiLevyStrip {
  storeId: number;
  stripId: number;
  fromHour: string;
  toHour: string;
  date: string;
  orderUntilHour: string;
  active: boolean;
  deliveryCost: number;
}

export interface RamiLevySupplyDatesResponse {
  status: number;
  data: Record<string, RamiLevyStrip[]>;
}

export interface RamiLevyOrderRow {
  id: number;
  status_api: string;
  final_price: number;
  supply_at: string;
  from_hour: string;
  to_hour: string;
  items: number[];
}

export interface RamiLevyOrdersResponse {
  data: {
    data: {
      current_page: number;
      last_page: number;
      data: RamiLevyOrderRow[];
    };
    editOrderId: number | null;
  };
}

export interface RamiLevyOrderLine {
  id: number;
  item_id: number;
  name: string;
  price: string;
  quantity: number;
  final_price: string;
  total_price: string;
  discount: string;
}

export interface RamiLevyOrderDetails extends RamiLevyOrderRow {
  delivery_price: number;
  isCanUpdate: boolean;
  isCanCancel: boolean;
  lines: RamiLevyOrderLine[];
}

export interface RamiLevyOrderDetailsResponse {
  data: RamiLevyOrderDetails;
}

export interface RamiLevyReservationResponse {
  success: boolean;
  data: RamiLevyDeliveryReservation | null;
}
