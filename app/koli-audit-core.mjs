export function isRice5KgProduct(productName) {
  const value = String(productName ?? "").trim().toUpperCase();
  return /\bBERAS\b/.test(value) && /(^|[^0-9])5\s*KG\b/.test(value);
}

export function taskContainsRice5Kg(task) {
  return (task?.lines ?? []).some((line) => isRice5KgProduct(line?.productName));
}
