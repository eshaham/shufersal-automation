import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

import { normalizeBarcode } from '../core/barcodes';
import { parsePackSize } from '../core/packSize';
import {
  AccountOrders,
  CartModification,
  DeliveryTimeSlot,
  ExistingCartItem,
  ItemDetails,
  OrderDetails,
  OrderInfo,
  OrderStatus,
  Product,
  SellingMethod,
} from '../core/types';
import {
  RamiLevyCartLine,
  RamiLevyCartResponse,
  RamiLevyDeliveryReservation,
  RamiLevyOrderDetails,
  RamiLevyOrderRow,
  RamiLevyProduct,
  RamiLevyStrip,
} from './types';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const ISRAEL_TIMEZONE = 'Asia/Jerusalem';
const IMAGE_BASE_URL = 'https://img.rami-levy.co.il';
const CANCELED_STATUSES = new Set(['canceled', 'pendingCancel']);
const EDITING_STATUS = 'editing';

export const SLOT_CODE_SEPARATOR = '|';

export function israelTimeToIso(dateTime: string): string {
  return dayjs.tz(dateTime, ISRAEL_TIMEZONE).toISOString();
}

export function formatPrice(price: number): string {
  return `₪${price.toFixed(2)}`;
}

function namedEntity(
  entity: { id: number; name: string } | null,
): Product['mainCategory'] {
  return entity ? { code: String(entity.id), name: entity.name } : null;
}

export function ramiLevyProductToProduct(
  product: RamiLevyProduct,
  storeId?: string,
): Product {
  const brandName = product.gs?.BrandName?.trim();
  const image = product.images?.original ?? product.images?.small;
  const isWeighed = product.prop.by_kilo === 1 || product.prop.sw_shakil === 1;
  const inStore =
    storeId === undefined || product.available_in.includes(Number(storeId));
  return {
    code: String(product.id),
    name: product.name,
    description: product.short_desc ?? product.full_desc ?? '',
    brand: brandName ? { code: brandName, name: brandName } : null,
    mainCategory: namedEntity(product.department),
    subCategory: namedEntity(product.group),
    sellingMethod: isWeighed ? SellingMethod.Weight : SellingMethod.Unit,
    imageUrl: image ? `${IMAGE_BASE_URL}${image}` : undefined,
    inStock: inStore,
    purchasable: inStore,
    price: product.price.price,
    formattedPrice: formatPrice(product.price.price),
    priceWithoutDiscount: product.price.price,
    promotionCodes: product.sale.map((sale) => String(sale.code)),
    barcode: normalizeBarcode(String(product.barcode)),
    quantityStep: product.multiplication,
    packSize: parsePackSize(product.name),
    rawData: product,
  };
}

export function cartLines(cart: RamiLevyCartResponse): RamiLevyCartLine[] {
  return cart.items.filter((line) => !line.is_delivery);
}

export function cartLineToExistingCartItem(
  line: RamiLevyCartLine,
  index: number,
): ExistingCartItem {
  return {
    productCode: String(line.id),
    quantity: line.quantity,
    entryNumber: index,
    itemPrice: line.FormatedTotalPrice,
    itemDiscount: line.FormatedSavePrice,
    inStock: true,
    rawData: line,
  };
}

export function cartModifications(
  requested: [productCode: string, quantity: number][],
  items: ExistingCartItem[],
): CartModification[] {
  return requested.map(([productCode, quantity]) => {
    const item = items.find((existing) => existing.productCode === productCode);
    if (quantity > 0 && !item) {
      return {
        productCode,
        statusCode: 'noStock',
        entryNumber: null,
        quantity: 0,
        rawData: {},
      };
    }
    return {
      productCode,
      statusCode: 'success',
      entryNumber: item?.entryNumber ?? null,
      quantity: item?.quantity ?? 0,
      rawData: {},
    };
  });
}

export function stripToTimeSlot(strip: RamiLevyStrip): DeliveryTimeSlot {
  return {
    code: [strip.date, String(strip.stripId)].join(SLOT_CODE_SEPARATOR),
    dateTime: israelTimeToIso(`${strip.date} ${strip.fromHour}`),
    cutoffDateTime: israelTimeToIso(`${strip.date} ${strip.orderUntilHour}`),
    deliveryFee: strip.deliveryCost,
    rawData: strip,
  };
}

export function reservationToTimeSlot(
  reservation: RamiLevyDeliveryReservation,
): DeliveryTimeSlot {
  const fromHour = reservation.hour.split('-')[0].trim();
  return {
    code: [reservation.supply_date_no_time, String(reservation.strip_id)].join(
      SLOT_CODE_SEPARATOR,
    ),
    dateTime: israelTimeToIso(`${reservation.supply_date_no_time} ${fromHour}`),
    cutoffDateTime: israelTimeToIso(reservation.order_until_hour),
    deliveryFee: reservation.price,
    rawData: reservation,
  };
}

function orderStatus(order: RamiLevyOrderRow, now: Date): OrderStatus {
  if (CANCELED_STATUSES.has(order.status_api)) {
    return OrderStatus.Canceled;
  }
  const deliveryEnd = new Date(
    israelTimeToIso(`${order.supply_at.slice(0, 10)} ${order.to_hour}`),
  );
  return deliveryEnd < now ? OrderStatus.Delivered : OrderStatus.Active;
}

export function orderRowToOrderInfo(
  order: RamiLevyOrderRow,
  editOrderId: number | null,
  now: Date = new Date(),
): OrderInfo {
  const status = orderStatus(order, now);
  const isActive = status === OrderStatus.Active;
  const details = order as Partial<RamiLevyOrderDetails>;
  return {
    code: String(order.id),
    deliveryDateTime: israelTimeToIso(order.supply_at),
    updateableUntilDateTime: null,
    totalPrice: order.final_price,
    status,
    isUpdatable: details.isCanUpdate ?? isActive,
    isActive,
    isCancelable: details.isCanCancel ?? isActive,
    isBeingUpdated:
      order.status_api === EDITING_STATUS || editOrderId === order.id,
    rawData: order,
  };
}

export function splitOrders(
  orders: RamiLevyOrderRow[],
  editOrderId: number | null,
  now: Date = new Date(),
): AccountOrders {
  const infos = orders.map((order) =>
    orderRowToOrderInfo(order, editOrderId, now),
  );
  return {
    activeOrders: infos.filter((order) => order.isActive),
    closedOrders: infos.filter((order) => !order.isActive),
  };
}

export function orderDetailsToOrderDetails(
  order: RamiLevyOrderDetails,
  products: Map<string, Product>,
  editOrderId: number | null,
  now: Date = new Date(),
): OrderDetails {
  const items: ItemDetails[] = order.lines.map((line) => {
    const productCode = String(line.item_id);
    const pricePerUnit = Number(line.price);
    const discountAmount = Number(line.discount);
    const product = products.get(productCode) ?? {
      code: productCode,
      name: line.name,
      description: '',
      brand: null,
      mainCategory: null,
      subCategory: null,
      sellingMethod: Number.isInteger(line.quantity)
        ? SellingMethod.Unit
        : SellingMethod.Weight,
      inStock: false,
      purchasable: false,
      price: pricePerUnit,
      formattedPrice: formatPrice(pricePerUnit),
      priceWithoutDiscount: pricePerUnit,
      promotionCodes: [],
      rawData: line,
    };
    return {
      productCode,
      quantity: line.quantity,
      product,
      pricePerUnit,
      actualPricePerUnit:
        line.quantity > 0 ? Number(line.final_price) / line.quantity : 0,
      discountAmount: discountAmount || undefined,
      promotions: [],
      outOfStock: false,
      rawData: line,
    };
  });
  return {
    ...orderRowToOrderInfo(order, editOrderId, now),
    items,
  };
}
