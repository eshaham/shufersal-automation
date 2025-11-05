import {
  ReceiptDetails,
  ReceiptItem,
  ReceiptPromotion,
  SellingMethod,
} from '~/types';

interface ParsedItemLine {
  totalPrice: number;
  price: number;
  suppliedQty: number;
  orderedQty: number;
  sellingMethod: string;
  description: string;
  code: string;
  barcode?: string;
}

function convertToSellingMethod(sellingMethod: string): SellingMethod {
  if (sellingMethod === 'יח') {
    return SellingMethod.Unit;
  }
  return SellingMethod.Weight;
}

function extractOrderNumber(lines: string[]): string {
  const startIndex = lines.findIndex((line) => line.includes('תעודת משלוח'));
  if (startIndex === -1) {
    throw new Error('Could not find delivery document section');
  }

  const labels: string[] = [];
  let labelsEndIndex = -1;

  for (let i = startIndex + 1; i < lines.length && i < startIndex + 20; i++) {
    const line = lines[i].trim();
    if (line.endsWith(':')) {
      labels.push(line);
      if (line === 'מס. הזמנה:') {
        labelsEndIndex = i;
        break;
      }
    }
  }

  if (labelsEndIndex === -1 || labels.length === 0) {
    throw new Error('Could not find order number label');
  }

  const orderLabelIndex = labels.indexOf('מס. הזמנה:');
  if (orderLabelIndex === -1) {
    throw new Error('Order number label not found in labels list');
  }

  const values: string[] = [];
  for (
    let i = labelsEndIndex + 1;
    i < lines.length && i < labelsEndIndex + 20;
    i++
  ) {
    const line = lines[i].trim();
    if (line.includes('ת. הזמנה:') || line.includes('ת. אספקה:')) {
      break;
    }
    if (line) {
      values.push(line);
    }
  }

  if (values.length !== labels.length) {
    throw new Error(
      `Label/value mismatch: ${String(labels.length)} labels, ${String(values.length)} values`,
    );
  }

  const orderNumber = values[orderLabelIndex];
  if (!orderNumber || !/^\d+$/.test(orderNumber)) {
    throw new Error('Could not parse order number');
  }

  return orderNumber.padStart(8, '0');
}

function extractDates(lines: string[]): {
  orderDate: string;
  deliveryDate: string;
} {
  const orderDateLabelIndex = lines.findIndex((line) =>
    line.trim().includes('ת. הזמנה:'),
  );
  const deliveryDateLabelIndex = lines.findIndex((line) =>
    line.trim().includes('ת. אספקה:'),
  );

  if (orderDateLabelIndex === -1 || deliveryDateLabelIndex === -1) {
    throw new Error('Date labels not found in receipt');
  }

  const dateRegex = /[\d:]+\s+[\d/]+/;
  let orderDate: string | null = null;
  let deliveryDate: string | null = null;

  const startSearch = Math.max(orderDateLabelIndex, deliveryDateLabelIndex) + 1;
  for (let i = startSearch; i < lines.length && i < startSearch + 10; i++) {
    const line = lines[i].trim();
    if (dateRegex.test(line)) {
      if (!orderDate) {
        orderDate = line;
      } else {
        deliveryDate = line;
        break;
      }
    }
  }

  if (!orderDate || !deliveryDate) {
    throw new Error('Could not parse dates');
  }

  return { orderDate, deliveryDate };
}

function extractCustomerInfo(lines: string[]): {
  customerName: string;
  customerPhone: string;
} {
  const nameLabelIndex = lines.findIndex((line) => line.trim() === 'שם לקוח:');
  const phoneLabelIndex = lines.findIndex(
    (line, idx) => idx > nameLabelIndex && line.trim() === 'טלפון:',
  );
  const addressLabelIndex = lines.findIndex(
    (line, idx) => idx > phoneLabelIndex && line.trim() === 'כתובת:',
  );

  if (
    nameLabelIndex === -1 ||
    phoneLabelIndex === -1 ||
    addressLabelIndex === -1
  ) {
    throw new Error('Could not find customer info labels');
  }

  const startSearch =
    Math.max(nameLabelIndex, phoneLabelIndex, addressLabelIndex) + 1;
  let customerName: string | null = null;
  let customerPhone: string | null = null;

  for (let i = startSearch; i < lines.length && i < startSearch + 10; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    if (!customerName && line.length > 0 && !/^\d+$/.test(line)) {
      customerName = line;
    } else if (/^\d+$/.test(line)) {
      customerPhone = line;
      break;
    }
  }

  if (!customerName || !customerPhone) {
    throw new Error('Could not parse customer info');
  }

  return { customerName, customerPhone };
}

function extractAddress(lines: string[]): string {
  const floorLineIndex = lines.findIndex((line) => line.includes('קומה.:'));
  const apartmentLineIndex = lines.findIndex((line) => line.includes('דירה.:'));

  if (floorLineIndex === -1 || apartmentLineIndex === -1) {
    throw new Error('Could not find address information');
  }

  const floorLine = lines[floorLineIndex];
  const apartmentLine = lines[apartmentLineIndex];

  const floorMatch = floorLine.match(/קומה\.: (\d+)\s+(.+)/);
  const apartmentMatch = apartmentLine.match(/דירה\.: (\d+)\s+(.+)/);

  if (!floorMatch || !apartmentMatch) {
    throw new Error('Could not parse address');
  }

  const floor = floorMatch[1];
  const streetAddress = floorMatch[2];
  const apartment = apartmentMatch[1];
  const cityAndPostal = apartmentMatch[2];

  return `${streetAddress} ${cityAndPostal}, קומה ${floor}, דירה ${apartment}`;
}

function parseItemLine(line: string): ParsedItemLine | null {
  const weightItemWithBarcodeRegex =
    /^([\d.]+|-{4})\s+([\d.]+|-{4})\s+קג\s+([\d.]+)\s+([\d.]+)\s+ימ\s+(\d{13})\s+(.+)$/;
  const weightItemWithCodeRegex =
    /^([\d.]+|-{4})\s+([\d.]+|-{4})\s+קג\s+([\d.]+)\s+([\d.]+)\s+ימ\s+(.+?)\s+(\d+)$/;
  const itemWithCodeRegex =
    /^([\d.]+|-{4})\s+([\d.]+|-{4})\s+(\d+)\s+(\d+)\s+(יח|קג|ימ)\s+(.+?)\s+(\d+)$/;
  const itemWithBarcodeRegex =
    /^([\d.]+|-{4})\s+([\d.]+|-{4})\s+(\d+)\s+(\d+)\s+(יח|קג|ימ)\s+([A-Z]+\s+)?(\d{13})\s+(.+)$/;

  let match = line.match(weightItemWithBarcodeRegex);
  let hasBarcode = false;
  let isWeight = false;

  if (match) {
    hasBarcode = true;
    isWeight = true;
  } else {
    match = line.match(weightItemWithCodeRegex);
    if (match) {
      isWeight = true;
    } else {
      match = line.match(itemWithBarcodeRegex);
      if (match) {
        hasBarcode = true;
      } else {
        match = line.match(itemWithCodeRegex);
      }
    }
  }

  if (!match) {
    return null;
  }

  const totalPriceStr = match[1];
  const unitPriceStr = match[2];
  let suppliedQtyStr: string;
  let orderedQtyStr: string;
  let unit: string;
  let code: string;
  let description: string;
  let barcode: string | undefined;

  if (isWeight) {
    suppliedQtyStr = match[3];
    orderedQtyStr = match[4];
    unit = 'קג';
    if (hasBarcode) {
      barcode = match[5];
      description = match[6];
      code = barcode;
    } else {
      description = match[5];
      code = match[6];
    }
  } else {
    suppliedQtyStr = match[3];
    orderedQtyStr = match[4];
    unit = match[5];
    if (hasBarcode) {
      const prefix = match[6] || '';
      barcode = match[7];
      description = prefix + match[8];
      code = barcode;
    } else {
      description = match[6];
      code = match[7];

      const barcodeMatch = description.match(/^(\d{13})\s+(.+)/);
      if (barcodeMatch) {
        barcode = barcodeMatch[1];
      }
    }
  }

  const totalPrice = totalPriceStr === '----' ? 0 : parseFloat(totalPriceStr);
  const unitPrice = unitPriceStr === '----' ? 0 : parseFloat(unitPriceStr);
  const suppliedQty = parseFloat(suppliedQtyStr);
  const orderedQty = parseFloat(orderedQtyStr);

  return {
    totalPrice,
    price: unitPrice,
    suppliedQty,
    orderedQty,
    sellingMethod: unit,
    description,
    code,
    barcode,
  };
}

function parsePromotionLine(line: string): ReceiptPromotion | null {
  const promoRegex =
    /^([\d.]+)-\s+([\d.]+)-\s+(?:[\d.]+\s+)?מבצע:\s+(\d+)\s+(.+)$/;
  const match = line.match(promoRegex);

  if (!match) {
    return null;
  }

  const [, , discountAmountStr, promoCode, description] = match;

  return {
    code: promoCode,
    description: description.trim(),
    discountAmount: parseFloat(discountAmountStr),
  };
}

function parseReceiptItems(lines: string[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  let currentItem: ReceiptItem | null = null;

  const headerLine = 'הערות סה"כ מחיר סופק הוזמן תאור קוד פריט';
  const endMarker = 'סך הכל';

  const sections: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(headerLine)) {
      const start = i + 2;
      let end = lines.length;

      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].includes(endMarker) || lines[j].includes(headerLine)) {
          end = j;
          break;
        }
      }

      sections.push({ start, end });
    }
  }

  if (sections.length === 0) {
    throw new Error('Could not find items section in receipt');
  }

  for (const section of sections) {
    for (let i = section.start; i < section.end; i++) {
      const line = lines[i].trim();

      if (!line || (line.startsWith('-') && !line.includes(' '))) {
        continue;
      }

      const itemData = parseItemLine(line);
      if (itemData) {
        if (currentItem) {
          items.push(currentItem);
        }

        const productName = itemData.barcode
          ? itemData.description.replace(/^\d{13}\s+/, '')
          : itemData.description;

        currentItem = {
          productCode: `P_${itemData.code}`,
          productName,
          ...(itemData.barcode ? { barcode: itemData.barcode } : {}),
          orderedQuantity: itemData.orderedQty,
          suppliedQuantity: itemData.suppliedQty,
          sellingMethod: convertToSellingMethod(itemData.sellingMethod),
          price: itemData.price,
          totalPrice: itemData.totalPrice,
          promotions: [],
        };
        continue;
      }

      const promoData = parsePromotionLine(line);
      if (promoData && currentItem) {
        currentItem.promotions = currentItem.promotions || [];
        currentItem.promotions.push(promoData);
      }
    }
  }

  if (currentItem) {
    items.push(currentItem);
  }

  return items;
}

function parseSummary(lines: string[]): {
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  deliveryFee: number;
} {
  const subTotalLine = lines.find((line) => line.includes('סך הכל'));
  const deliveryLine = lines.find(
    (line) => line.includes('דמי') && line.includes('משלוח'),
  );
  const totalLine = lines.find((line) => line.includes('סכום לתשלום'));
  const vatLine = lines.find(
    (line) => line.includes('%') && line.includes('מע"מ'),
  );

  if (!totalLine) {
    throw new Error('Could not find total in receipt');
  }

  let subtotal = 0;
  if (subTotalLine) {
    const match = subTotalLine.match(/^([\d.]+)\s*:/);
    if (match) {
      subtotal = parseFloat(match[1]);
    }
  }

  let deliveryFee = 0;
  if (deliveryLine) {
    const match = deliveryLine.match(/^([\d.]+)\s*:/);
    if (match) {
      deliveryFee = parseFloat(match[1]);
    }
  }

  const totalMatch = totalLine.match(/^([\d.]+)\s/);
  if (!totalMatch) {
    throw new Error('Could not parse total');
  }
  const totalAmount = parseFloat(totalMatch[1]);

  let vatAmount = 0;
  if (vatLine) {
    const vatMatch = vatLine.match(/^([\d.]+)\s*:/);
    if (vatMatch) {
      vatAmount = parseFloat(vatMatch[1]);
    }
  }

  return {
    subtotal,
    vatAmount,
    totalAmount,
    deliveryFee,
  };
}

export function parseReceipt(receiptText: string): ReceiptDetails {
  const lines = receiptText.split('\n');

  const orderCode = extractOrderNumber(lines);
  const { orderDate, deliveryDate } = extractDates(lines);
  const { customerName, customerPhone } = extractCustomerInfo(lines);
  const address = extractAddress(lines);
  const items = parseReceiptItems(lines);
  const { subtotal, vatAmount, totalAmount, deliveryFee } = parseSummary(lines);

  return {
    orderCode,
    orderDate,
    deliveryDate,
    customerName,
    customerPhone,
    address,
    items,
    subtotal,
    vatAmount,
    deliveryFee,
    totalAmount,
  };
}
