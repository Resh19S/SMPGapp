import { useCallback, useRef } from "react";

/** Guards against out-of-order responses. Call `begin()` when starting a load;
 * it returns `isLatest()`, which is false once a newer load has started — so a
 * slow answer for an old filter/month can't overwrite the current one.
 *
 *   const begin = useLatestRequest();
 *   const isLatest = begin();
 *   fetchX().then((data) => { if (isLatest()) setData(data); });
 */
export function useLatestRequest() {
  const counter = useRef(0);
  return useCallback(() => {
    const id = ++counter.current;
    return () => id === counter.current;
  }, []);
}
