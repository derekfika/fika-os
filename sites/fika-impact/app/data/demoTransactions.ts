export type DemoTransaction = {
  id: number;
  drink: string;
  coffee: boolean;
  milk: boolean;
};

const FIXED_DRINK_SEQUENCE: Omit<DemoTransaction, "id">[] = [
  { drink: "Flat white", coffee: true, milk: true },
  { drink: "Americano", coffee: true, milk: false },
  { drink: "Oat latte", coffee: true, milk: true },
  { drink: "Cappuccino", coffee: true, milk: true },
  { drink: "Tea", coffee: false, milk: false },
  { drink: "Latte", coffee: true, milk: true },
  { drink: "Espresso", coffee: true, milk: false },
  { drink: "Flat white", coffee: true, milk: true },
  { drink: "Filter coffee", coffee: true, milk: false },
  { drink: "Oat latte", coffee: true, milk: true },
  { drink: "Latte", coffee: true, milk: true },
  { drink: "Cappuccino", coffee: true, milk: true },
  { drink: "Flat white", coffee: true, milk: true },
  { drink: "Americano", coffee: true, milk: false },
  { drink: "Oat latte", coffee: true, milk: true },
  { drink: "Tea", coffee: false, milk: false },
  { drink: "Latte", coffee: true, milk: true },
  { drink: "Flat white", coffee: true, milk: true },
];

export function transactionAt(index: number): DemoTransaction {
  return { ...FIXED_DRINK_SEQUENCE[index % FIXED_DRINK_SEQUENCE.length], id: index };
}
