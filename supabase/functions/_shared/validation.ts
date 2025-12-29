/**
 * Shared validation utilities for Edge Functions
 * Provides zod-like schema validation and safe error handling
 */

// =============================================================================
// Type Definitions
// =============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

// =============================================================================
// Validators
// =============================================================================

/**
 * Validate that a value is a non-empty string with max length
 */
export function validateString(
  value: unknown,
  field: string,
  options: { minLength?: number; maxLength?: number; optional?: boolean } = {}
): ValidationResult<string> {
  const { minLength = 1, maxLength = 1000, optional = false } = options;

  if (value === undefined || value === null || value === '') {
    if (optional) {
      return { success: true, data: undefined as unknown as string };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'string') {
    return { success: false, errors: [{ field, message: `${field} must be a string` }] };
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength) {
    return { success: false, errors: [{ field, message: `${field} must be at least ${minLength} characters` }] };
  }

  if (trimmed.length > maxLength) {
    return { success: false, errors: [{ field, message: `${field} must be at most ${maxLength} characters` }] };
  }

  return { success: true, data: trimmed };
}

/**
 * Validate that a value is a valid URL
 */
export function validateUrl(
  value: unknown,
  field: string,
  options: { maxLength?: number; optional?: boolean; allowedProtocols?: string[] } = {}
): ValidationResult<string> {
  const { maxLength = 2000, optional = false, allowedProtocols = ['http:', 'https:'] } = options;

  if (value === undefined || value === null || value === '') {
    if (optional) {
      return { success: true, data: undefined as unknown as string };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'string') {
    return { success: false, errors: [{ field, message: `${field} must be a string` }] };
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    return { success: false, errors: [{ field, message: `${field} must be at most ${maxLength} characters` }] };
  }

  try {
    const url = new URL(trimmed);
    if (!allowedProtocols.includes(url.protocol)) {
      return { success: false, errors: [{ field, message: `${field} must use ${allowedProtocols.join(' or ')}` }] };
    }
    return { success: true, data: trimmed };
  } catch {
    return { success: false, errors: [{ field, message: `${field} must be a valid URL` }] };
  }
}

/**
 * Validate that a value is one of allowed values (enum)
 */
export function validateEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: readonly T[],
  options: { optional?: boolean } = {}
): ValidationResult<T> {
  const { optional = false } = options;

  if (value === undefined || value === null || value === '') {
    if (optional) {
      return { success: true, data: undefined as unknown as T };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'string') {
    return { success: false, errors: [{ field, message: `${field} must be a string` }] };
  }

  if (!allowedValues.includes(value as T)) {
    return { success: false, errors: [{ field, message: `${field} must be one of: ${allowedValues.join(', ')}` }] };
  }

  return { success: true, data: value as T };
}

/**
 * Validate that a value is a positive integer
 */
export function validatePositiveInt(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; optional?: boolean } = {}
): ValidationResult<number> {
  const { min = 1, max = Number.MAX_SAFE_INTEGER, optional = false } = options;

  if (value === undefined || value === null) {
    if (optional) {
      return { success: true, data: undefined as unknown as number };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { success: false, errors: [{ field, message: `${field} must be an integer` }] };
  }

  if (value < min) {
    return { success: false, errors: [{ field, message: `${field} must be at least ${min}` }] };
  }

  if (value > max) {
    return { success: false, errors: [{ field, message: `${field} must be at most ${max}` }] };
  }

  return { success: true, data: value };
}

/**
 * Validate that a value is a boolean
 */
export function validateBoolean(
  value: unknown,
  field: string,
  options: { optional?: boolean; defaultValue?: boolean } = {}
): ValidationResult<boolean> {
  const { optional = false, defaultValue } = options;

  if (value === undefined || value === null) {
    if (defaultValue !== undefined) {
      return { success: true, data: defaultValue };
    }
    if (optional) {
      return { success: true, data: undefined as unknown as boolean };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'boolean') {
    return { success: false, errors: [{ field, message: `${field} must be a boolean` }] };
  }

  return { success: true, data: value };
}

/**
 * Validate that a value is a UUID
 */
export function validateUuid(
  value: unknown,
  field: string,
  options: { optional?: boolean } = {}
): ValidationResult<string> {
  const { optional = false } = options;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (value === undefined || value === null || value === '') {
    if (optional) {
      return { success: true, data: undefined as unknown as string };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (typeof value !== 'string') {
    return { success: false, errors: [{ field, message: `${field} must be a string` }] };
  }

  if (!uuidRegex.test(value)) {
    return { success: false, errors: [{ field, message: `${field} must be a valid UUID` }] };
  }

  return { success: true, data: value };
}

/**
 * Validate that a value is an array of UUIDs
 */
export function validateUuidArray(
  value: unknown,
  field: string,
  options: { minLength?: number; maxLength?: number; optional?: boolean } = {}
): ValidationResult<string[]> {
  const { minLength = 1, maxLength = 100, optional = false } = options;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (value === undefined || value === null) {
    if (optional) {
      return { success: true, data: undefined as unknown as string[] };
    }
    return { success: false, errors: [{ field, message: `${field} is required` }] };
  }

  if (!Array.isArray(value)) {
    return { success: false, errors: [{ field, message: `${field} must be an array` }] };
  }

  if (value.length < minLength) {
    return { success: false, errors: [{ field, message: `${field} must have at least ${minLength} item(s)` }] };
  }

  if (value.length > maxLength) {
    return { success: false, errors: [{ field, message: `${field} must have at most ${maxLength} items` }] };
  }

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== 'string' || !uuidRegex.test(item)) {
      return { success: false, errors: [{ field, message: `${field}[${i}] must be a valid UUID` }] };
    }
  }

  return { success: true, data: value as string[] };
}

// =============================================================================
// Error Handling Utilities
// =============================================================================

/**
 * Safe error logging that doesn't expose internal details
 */
export function logSafeError(context: string, error: unknown): void {
  const safeInfo: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    context,
  };

  if (error instanceof Error) {
    safeInfo.errorType = error.name;
    // Only log error code for Supabase errors, not full message
    if ('code' in error && typeof (error as Record<string, unknown>).code === 'string') {
      safeInfo.errorCode = (error as Record<string, unknown>).code;
    }
    // Log hint if available (usually safe)
    if ('hint' in error && typeof (error as Record<string, unknown>).hint === 'string') {
      safeInfo.hint = (error as Record<string, unknown>).hint;
    }
  } else {
    safeInfo.errorType = 'Unknown';
  }

  console.error(JSON.stringify(safeInfo));
}

/**
 * Create a generic error response for 500 errors
 * Does not expose internal error details to clients
 */
export function createGenericErrorResponse(
  corsHeaders: Record<string, string>,
  statusCode: number = 500
): Response {
  const message = statusCode >= 500 
    ? 'An unexpected error occurred. Please try again later.'
    : 'Unable to process request';

  return new Response(
    JSON.stringify({ error: message }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Create a validation error response (400)
 */
export function createValidationErrorResponse(
  corsHeaders: Record<string, string>,
  errors: ValidationError[]
): Response {
  const message = errors.length === 1 
    ? errors[0].message 
    : errors.map(e => e.message).join('; ');

  return new Response(
    JSON.stringify({ error: message, validationErrors: errors }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// =============================================================================
// Schema Builder (Fluent API)
// =============================================================================

export interface SchemaDefinition {
  [key: string]: {
    type: 'string' | 'url' | 'enum' | 'int' | 'boolean' | 'uuid' | 'uuidArray';
    options?: Record<string, unknown>;
    allowedValues?: readonly string[];
  };
}

export function validateSchema<T extends Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition
): ValidationResult<T> {
  if (typeof data !== 'object' || data === null) {
    return { success: false, errors: [{ field: 'body', message: 'Request body must be an object' }] };
  }

  const result: Record<string, unknown> = {};
  const errors: ValidationError[] = [];
  const record = data as Record<string, unknown>;

  for (const [field, def] of Object.entries(schema)) {
    const value = record[field];
    const opts = def.options || {};
    let validation: ValidationResult<unknown>;

    switch (def.type) {
      case 'string':
        validation = validateString(value, field, opts as Parameters<typeof validateString>[2]);
        break;
      case 'url':
        validation = validateUrl(value, field, opts as Parameters<typeof validateUrl>[2]);
        break;
      case 'enum':
        validation = validateEnum(value, field, def.allowedValues || [], opts as Parameters<typeof validateEnum>[3]);
        break;
      case 'int':
        validation = validatePositiveInt(value, field, opts as Parameters<typeof validatePositiveInt>[2]);
        break;
      case 'boolean':
        validation = validateBoolean(value, field, opts as Parameters<typeof validateBoolean>[2]);
        break;
      case 'uuid':
        validation = validateUuid(value, field, opts as Parameters<typeof validateUuid>[2]);
        break;
      case 'uuidArray':
        validation = validateUuidArray(value, field, opts as Parameters<typeof validateUuidArray>[2]);
        break;
      default:
        errors.push({ field, message: `Unknown validation type for ${field}` });
        continue;
    }

    if (!validation.success) {
      errors.push(...(validation.errors || []));
    } else if (validation.data !== undefined) {
      result[field] = validation.data;
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, data: result as T };
}
