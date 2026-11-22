import type { PackSize, PackUnit } from './types';

const UNITS: Array<{ pattern: string; unit: PackUnit; multiplier: number }> = [
  { pattern: 'ק["״]ג', unit: 'g', multiplier: 1000 },
  { pattern: 'גרם', unit: 'g', multiplier: 1 },
  { pattern: 'ליטר', unit: 'ml', multiplier: 1000 },
  { pattern: 'מ["״]ל', unit: 'ml', multiplier: 1 },
  {
    pattern: "יחידות|יח['׳]?|טבליות|כמוסות|גלילים",
    unit: 'unit',
    multiplier: 1,
  },
];

const NUMBER = '(\\d+(?:\\.\\d+)?)';

export function parsePackSize(
  description: string | null | undefined,
): PackSize | undefined {
  if (!description) {
    return undefined;
  }
  for (const { pattern, unit, multiplier } of UNITS) {
    const multipack = new RegExp(
      `${NUMBER}\\s*[*×x]\\s*${NUMBER}\\s*(?:${pattern})`,
    ).exec(description);
    if (multipack) {
      return {
        amount: Number(multipack[1]) * Number(multipack[2]) * multiplier,
        unit,
      };
    }
    const single = new RegExp(`${NUMBER}\\s*(?:${pattern})`).exec(description);
    if (single) {
      return { amount: Number(single[1]) * multiplier, unit };
    }
  }
  return undefined;
}
