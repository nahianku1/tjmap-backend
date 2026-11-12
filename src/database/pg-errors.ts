import { ConflictException } from '@nestjs/common';

/** PostgreSQL unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

/** Runs a query, translating a unique-constraint conflict into a clean 409. */
export async function guardDuplicate<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictException(message);
    throw error;
  }
}
