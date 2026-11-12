// Legacy clients may omit an ID.
export function sessionId(value, fallback) {
  if (value === undefined || value === null) return fallback();
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (id.length < 3 || id.length > 32 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw Object.assign(new Error('Session ID must be 3–32 letters, numbers or hyphens, with no spaces.'), { status: 400 });
  }
  return id;
}
