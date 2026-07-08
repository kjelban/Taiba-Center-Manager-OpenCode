# Security Specification

## Data Invariants
1. All users of this application are considered employees/admins of the store.
2. We require authentication to access any data. 
3. Only verified users can read/write data in collections.

## Dirty Dozen Payloads

1. **Unauthenticated Access**: Attempting to read or write without a valid auth token.
2. **Missing required fields (Product)**: Creating a product without a costPrice.
3. **Invalid type (Product)**: Creating a product with a string for costPrice.
4. **Invalid size (Product)**: Creating a product with an extremely large name string (> 200 chars).
5. **Missing required fields (Sale)**: Creating a sale without items.
6. **Invalid type (Sale)**: Creating a sale with items as a string instead of an array.
7. **Invalid Sale item array size**: Creating a sale with more than 500 items.
8. **Invalid size (Expense)**: Creating an expense with a negative amount.
9. **Missing required fields (Employee)**: Creating an employee without permissions.
10. **Invalid type (Employee)**: Creating an employee with permissions as a string instead of an array.
11. **Invalid ID**: Creating a document with a massive ID.
12. **Modifying System Fields**: Trying to overwrite migration_status metadata.

## Test Runner
(We will generate this in firestore.rules.test.ts)
