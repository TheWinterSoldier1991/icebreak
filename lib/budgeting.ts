export type BudgetCategory = {
  id: string;
  name: string;
  icon: string;
  color: string;
  targetPercent: number;
  targetCents: number;
  spentCents: number;
  balanceCents: number;
  kind: "spending" | "savings";
};

export type DepositAllocation = {
  categoryId: string;
  amountCents: number;
};

export function parseMoneyToCents(value: string): number | null {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [dollars, fraction = ""] = normalized.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatMoney(cents: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(cents / 100);
}

export function splitDeposit(
  depositCents: number,
  categories: Pick<BudgetCategory, "id" | "targetPercent">[],
): { allocations: DepositAllocation[]; unallocatedCents: number } {
  if (!Number.isSafeInteger(depositCents) || depositCents <= 0) {
    throw new Error("Deposit must be a positive amount in whole cents.");
  }

  const totalPercent = categories.reduce((sum, category) => sum + category.targetPercent, 0);
  if (categories.some((category) => category.targetPercent < 0) || totalPercent > 100) {
    throw new Error("Category percentages must total 100% or less.");
  }

  const rawShares = categories.map((category) => depositCents * category.targetPercent / 100);
  const shares = rawShares.map(Math.floor);
  const targetAllocated = Math.floor(depositCents * totalPercent / 100);
  const remainingPennies = targetAllocated - shares.reduce((sum, amount) => sum + amount, 0);
  const remainderOrder = rawShares
    .map((share, index) => ({ index, remainder: share - shares[index] }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let index = 0; index < remainingPennies; index += 1) {
    shares[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  const allocated = shares.reduce((sum, amount) => sum + amount, 0);
  return {
    allocations: categories.map((category, index) => ({ categoryId: category.id, amountCents: shares[index] })),
    unallocatedCents: depositCents - allocated,
  };
}

export function validateCategoryPercentages(
  categories: Pick<BudgetCategory, "id" | "targetPercent">[],
  categoryId: string | null,
  nextPercent: number,
): boolean {
  if (!Number.isFinite(nextPercent) || nextPercent < 0 || nextPercent > 100) return false;
  const currentTotal = categories
    .filter((category) => category.id !== categoryId)
    .reduce((sum, category) => sum + category.targetPercent, 0);
  return currentTotal + nextPercent <= 100;
}
