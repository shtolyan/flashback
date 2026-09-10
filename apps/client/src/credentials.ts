let bearer: string | null = null;
export const getBearer = () => bearer;
export const setBearer = (value: string | null) => {
  bearer = value;
};
export const authInvalidated = new Set<() => void>();
export const authCleared = new Set<() => void>();
export function invalidateAuth() {
  for (const fn of authInvalidated) fn();
}
