import { create } from "zustand";
import { listProperties } from "../api/client";
import type { Property } from "../types/contract";

/** The building this account manages. Loaded once after sign-in and used for
 * the sidebar brand, receipts and WhatsApp messages — never hardcoded. */
interface PropertyState {
  property: Property | null;
  load: () => Promise<void>;
  set: (property: Property) => void;
}

export const usePropertyStore = create<PropertyState>((set) => ({
  property: null,
  load: async () => {
    try {
      const properties = await listProperties();
      set({ property: properties[0] ?? null });
    } catch {
      /* the page that needs it shows its own error */
    }
  },
  set: (property) => set({ property }),
}));

export function propertyInitials(name: string | undefined): string {
  if (!name) return "PG";
  const words = name.split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map((w) => w[0]!.toUpperCase()).join("");
}
