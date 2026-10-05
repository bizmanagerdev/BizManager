/**
 * `promise`'s result, stamped with when it arrived (Date.now()). A page passes
 * it to its list so the list can tell, when it's finally shown, how old its
 * rows are — Next may show a page it fetched ahead of the click minutes later
 * (see useInfiniteScroll's `loadedAt`).
 */
export async function withLoadedAt<T extends object>(promise: Promise<T>): Promise<T & { loadedAt: number }> {
  const value = await promise;
  return { ...value, loadedAt: Date.now() };
}
