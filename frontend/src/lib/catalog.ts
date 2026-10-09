import type { Category } from '../types';

const moneyFormatter = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' });

export function money(value: number): string {
  return moneyFormatter.format(value);
}

export function getCategoryHierarchyIds(categoryId: number, allCategories: Category[]): number[] {
  const ids = [categoryId];
  let current = allCategories.find((category) => category.id === categoryId);
  while (current?.parentId != null) {
    ids.push(current.parentId);
    current = allCategories.find((category) => category.id === current?.parentId);
  }
  return ids;
}
