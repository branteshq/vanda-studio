interface CustomerLookupError {
  code?: string;
  message?: string;
}

interface CustomerLookupResult<Customer> {
  data: Customer | null;
  error: CustomerLookupError | null;
}

/** A missing Autumn customer is the normal state before their first checkout. */
export const customerOrNull = <Customer>(
  result: CustomerLookupResult<Customer>,
): Customer | null => {
  if (!result.error) return result.data;
  if (result.error.code === "customer_not_found") return null;
  throw new Error(result.error.message || "Failed to load customer");
};
