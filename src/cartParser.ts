import {
  CartModification,
  CartMutationResult,
  ExistingCartItem,
} from './types';

export interface RawCartArticle {
  productCode: string;
  quantity: number;
  entryNumber: number;
  itemPrice: number;
  itemDiscount: number;
  isOutOfStock: boolean;
}

export interface RawCartPage {
  articles: RawCartArticle[];
  bodyText: string;
  modificationsScript: string | null;
}

type ScriptValue = string | number | boolean;

const MODIFICATIONS_START = /miglog\.cart\.modifications\s*=\s*\[/;
const SCRIPT_TOKEN =
  /[{}\]]|(\w+)\s*:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[^,}\s]+)/;

function parseScriptValue(literal: string): ScriptValue {
  const quote = literal[0];
  if ((quote === "'" || quote === '"') && literal.endsWith(quote)) {
    return literal.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  if (literal === 'true' || literal === 'false') {
    return literal === 'true';
  }
  const number = Number(literal);
  return Number.isNaN(number) ? literal : number;
}

function parseScriptObjects(
  script: string,
  startIndex: number,
): Record<string, ScriptValue>[] {
  const objects: Record<string, ScriptValue>[] = [];
  let current: Record<string, ScriptValue> | null = null;
  const tokenPattern = new RegExp(SCRIPT_TOKEN.source, 'g');
  tokenPattern.lastIndex = startIndex;

  for (
    let match = tokenPattern.exec(script);
    match;
    match = tokenPattern.exec(script)
  ) {
    const [token, key, value] = match;
    if (key && value) {
      if (current) {
        current[key] = parseScriptValue(value);
      }
    } else if (token === '{') {
      current = {};
    } else if (token === '}') {
      if (current) {
        objects.push(current);
      }
      current = null;
    } else if (!current) {
      break;
    }
  }

  return objects;
}

export function parseCartModifications(script: string): CartModification[] {
  const start = MODIFICATIONS_START.exec(script);
  if (!start) {
    return [];
  }

  return parseScriptObjects(script, start.index + start[0].length).map(
    (raw) => ({
      productCode: String(raw['productCode'] ?? ''),
      statusCode: String(raw['statusCode'] ?? 'unknown'),
      entryNumber: typeof raw['entry'] === 'number' ? raw['entry'] : null,
      quantity: typeof raw['quantity'] === 'number' ? raw['quantity'] : null,
      rawData: raw,
    }),
  );
}

export function parseOrderInUpdateMode(text: string): string | null {
  const match = /עדכון הזמנה מס׳ (\d+)/.exec(text);
  return match ? match[1] : null;
}

const CONFIRMATION_URL_ORDER_CODE_PATTERNS = [
  /\/orderConfirmation\/(\d{6,})/,
  /[?&]orderCode=(\d{6,})/,
];

const CONFIRMATION_HTML_ORDER_CODE_PATTERNS = [
  /\/my-account\/orders?\/(\d{6,})/,
  /\/orderConfirmation\/(\d{6,})/,
  /["']?(?:orderCode|orderNumber|transaction_?[iI]d)["']?\s*[:=]\s*["']?(\d{6,})/,
  /(?:מספר\s+(?:ה)?הזמנה|הזמנה\s+מס(?:פר|['׳.])?)\D{0,30}(\d{6,})/,
];

export function parseOrderCodeFromConfirmation(
  url: string,
  html: string,
): string | null {
  for (const pattern of CONFIRMATION_URL_ORDER_CODE_PATTERNS) {
    const match = pattern.exec(url);
    if (match) {
      return match[1];
    }
  }
  for (const pattern of CONFIRMATION_HTML_ORDER_CODE_PATTERNS) {
    const match = pattern.exec(html);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function rawCartPageToCartMutationResult(
  page: RawCartPage,
): CartMutationResult {
  const items: ExistingCartItem[] = page.articles.map((article) => ({
    entryNumber: article.entryNumber,
    productCode: article.productCode,
    quantity: article.quantity,
    itemPrice: article.itemPrice,
    itemDiscount: article.itemDiscount,
    inStock: !article.isOutOfStock,
    rawData: article,
  }));

  return {
    items,
    orderInUpdateMode: parseOrderInUpdateMode(page.bodyText),
    modifications: page.modificationsScript
      ? parseCartModifications(page.modificationsScript)
      : [],
  };
}
