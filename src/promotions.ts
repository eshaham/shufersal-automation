import {
  PromotionConditions,
  PromotionInfo,
  PromotionType,
  ShufersalPromotionOrderEntry,
} from './types';

export function inferPromotionType(
  message: string,
  couponCode?: string | null,
): PromotionType {
  if (couponCode && couponCode !== '0') {
    return PromotionType.PERSONAL_COUPON;
  }
  if (/\d\+\d/.test(message)) {
    return PromotionType.BUY_X_GET_Y;
  }
  if (/\dב\d+/.test(message) || /\d יח/.test(message)) {
    return PromotionType.X_FOR_Y;
  }
  if (/^\d+\.\d+\s/.test(message) || /ישיר$/.test(message)) {
    return PromotionType.SIMPLE_DISCOUNT;
  }
  return PromotionType.UNKNOWN;
}

export function parsePromotionConditions(
  message: string,
  type: PromotionType,
  basePrice: number,
  actualPrice: number,
  quantity: number,
  couponCode?: string | null,
): PromotionConditions {
  const conditions: PromotionConditions = { type };

  switch (type) {
    case PromotionType.SIMPLE_DISCOUNT:
      conditions.originalPrice = basePrice;
      conditions.discountedPrice = actualPrice;
      conditions.discountPercent =
        ((basePrice - actualPrice) / basePrice) * 100;
      break;

    case PromotionType.X_FOR_Y: {
      const match = message.match(/(\d+)ב(\d+)/);
      if (match) {
        conditions.requiredQuantity = parseInt(match[1], 10);
        conditions.bundlePrice = parseFloat(match[2]);
        conditions.effectivePricePerUnit =
          conditions.bundlePrice / conditions.requiredQuantity;
      }
      break;
    }

    case PromotionType.BUY_X_GET_Y: {
      const match = message.match(/(\d+)\+(\d+)/);
      if (match) {
        conditions.buyQuantity = parseInt(match[1], 10);
        conditions.getQuantity = parseInt(match[2], 10);
        conditions.effectiveDiscount =
          (conditions.getQuantity /
            (conditions.buyQuantity + conditions.getQuantity)) *
          100;
      }
      break;
    }

    case PromotionType.PERSONAL_COUPON:
      conditions.couponCode = couponCode || undefined;
      conditions.discountAmount = basePrice * quantity - actualPrice;
      break;
  }

  return conditions;
}

export function extractPromotionInfo(
  promotionEntry: ShufersalPromotionOrderEntry,
  basePricePerUnit: number,
  actualPricePerUnit: number,
  quantity: number,
): PromotionInfo {
  const type = inferPromotionType(
    promotionEntry.promotionMessage,
    promotionEntry.couponCode,
  );
  const conditions = parsePromotionConditions(
    promotionEntry.promotionMessage,
    type,
    basePricePerUnit,
    actualPricePerUnit,
    quantity,
    promotionEntry.couponCode,
  );

  return {
    code: promotionEntry.promotionCode,
    message: promotionEntry.promotionMessage,
    type,
    conditions,
    couponCode: promotionEntry.couponCode,
  };
}
