import { useEffect, useState } from "react";
import { ApiError, createBed, createProperty, listBeds, listProperties, updateBed } from "../api/client";
import type { Bed, BedRentState, Property } from "../types/contract";
import { BedGrid, RENT_STATE_LABEL, RENT_STATE_ORDER } from "../components/properties/BedGrid";
import { BedFormModal } from "../components/properties/BedFormModal";
import { EditRentModal } from "../components/properties/EditRentModal";
import formStyles from "../components/common/Form.module.css";
import pageStyles from "./PageLayout.module.css";

export function PropertiesPage() {
  const [property, setProperty] = useState<Property | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [isBedModalOpen, setIsBedModalOpen] = useState(false);
  const [editingBed, setEditingBed] = useState<Bed | null>(null);
  const [highlight, setHighlight] = useState<BedRentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newPropertyName, setNewPropertyName] = useState("");
  const [newPropertyAddress, setNewPropertyAddress] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const properties = await listProperties();
      const first = properties[0] ?? null;
      setProperty(first);
      if (first) setBeds(await listBeds(first.id));
      setError(null);
    } catch {
      setError("Could not load property data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreateProperty() {
    if (!newPropertyName.trim()) {
      setCreateError("Give the property a name.");
      return;
    }
    setCreateError(null);
    try {
      const prop = await createProperty({ name: newPropertyName.trim(), address: newPropertyAddress.trim() });
      setProperty(prop);
      setBeds([]);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create the property. Please try again.");
    }
  }

  async function handleAddBed(data: { roomNumber: string; bedLabel: string; rentAmount: number }) {
    if (!property) return;
    const bed = await createBed({ propertyId: property.id, ...data });
    setBeds((prev) => [...prev, bed]);
  }

  async function handleUpdateRent(bedId: number, rentAmount: number) {
    const updated = await updateBed(bedId, { rentAmount });
    setBeds((prev) => prev.map((b) => (b.id === bedId ? updated : b)));
  }

  if (isLoading) return <p className={pageStyles.loading}>Loading rooms…</p>;
  if (error) return <p className={pageStyles.error}>{error}</p>;

  if (!property) {
    return (
      <div>
        <h1 className={pageStyles.title}>Rooms & Beds</h1>
        <p className={pageStyles.subtitle}>No property set up yet. Add your building to start tracking rooms.</p>
        <div style={{ maxWidth: 360, marginTop: "var(--space-4)" }}>
          {createError && <div className={formStyles.error}>{createError}</div>}
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="prop-name">Property name</label>
            <input id="prop-name" className={formStyles.input} value={newPropertyName} onChange={(e) => setNewPropertyName(e.target.value)} />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="prop-address">Address</label>
            <input id="prop-address" className={formStyles.input} value={newPropertyAddress} onChange={(e) => setNewPropertyAddress(e.target.value)} />
          </div>
          <button className={formStyles.buttonPrimary} onClick={handleCreateProperty}>Create property</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Rooms & Beds</h1>
          <p className={pageStyles.subtitle}>
            {property.name} — {property.address}. Colour shows each bed's rent for this month; click a bed for details.
          </p>
        </div>
        <button className={pageStyles.primaryAction} onClick={() => setIsBedModalOpen(true)}>
          + Add bed
        </button>
      </div>

      <div className={pageStyles.filterBar} role="group" aria-label="Highlight beds by rent state">
        {RENT_STATE_ORDER.map((state) => {
          const count = beds.filter((b) => b.rentState === state).length;
          if (count === 0) return null;
          const isActive = highlight === state;
          return (
            <button
              key={state}
              className={`${pageStyles.chip} ${isActive ? pageStyles.chipActive : ""}`}
              aria-pressed={isActive}
              onClick={() => setHighlight(isActive ? null : state)}
            >
              <span className={`${pageStyles.chipSwatch} ${pageStyles[`swatch-${state}`]}`} />
              {RENT_STATE_LABEL[state]} <span className={pageStyles.chipCount}>{count}</span>
            </button>
          );
        })}
        {highlight && (
          <button className={pageStyles.chipClear} onClick={() => setHighlight(null)}>
            Show all
          </button>
        )}
      </div>

      <BedGrid beds={beds} highlight={highlight} onSelect={setEditingBed} />

      {isBedModalOpen && <BedFormModal onClose={() => setIsBedModalOpen(false)} onSubmit={handleAddBed} />}
      {editingBed && (
        <EditRentModal
          bed={editingBed}
          onClose={() => setEditingBed(null)}
          onSubmit={(rent) => handleUpdateRent(editingBed.id, rent)}
        />
      )}
    </div>
  );
}
