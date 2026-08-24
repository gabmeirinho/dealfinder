import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode
} from "react";

import {
  ACTIVE_SEARCH_SOFT_LIMIT,
  SEARCH_RADIUS_OPTIONS_KM,
  type ConstraintStrength,
  type FuelType,
  type ManagedVehicleSearch,
  type SearchVerificationPreview,
  type SearchRadiusKm,
  type TransmissionType
} from "@dealfinder/domain";

import {
  searchVerificationApi,
  type SearchVerificationApiClient
} from "../../lib/api/search-verification.js";
import { useModalFocus } from "../../lib/modal-focus.js";
import {
  SearchApiError,
  searchApi,
  type SearchApiClient
} from "../../lib/api/searches.js";
import {
  createSearchForm,
  draftToSearchForm,
  searchFormToDraft,
  type SearchFormModel
} from "./form-model.js";
import { SearchVerificationDialog } from "./verification/SearchVerificationDialog.js";

export interface SearchDashboardProps {
  client?: SearchApiClient;
  initialSearches?: readonly ManagedVehicleSearch[];
  verificationClient?: SearchVerificationApiClient;
}

export interface EditorState {
  mode: "create" | "edit";
  searchId: string | null;
  form: SearchFormModel;
  fieldErrors: Readonly<Record<string, readonly string[]>>;
}

interface ConfirmationState {
  title: string;
  message: string;
  actionLabel: string;
  tone: "warning" | "danger";
  action(): Promise<void>;
}

const FUEL_OPTIONS: readonly { value: FuelType; label: string }[] = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Hybrid" },
  { value: "plug_in_hybrid", label: "Plug-in hybrid" },
  { value: "electric", label: "Electric" },
  { value: "lpg", label: "LPG" },
  { value: "other", label: "Other" }
];

const TRANSMISSION_OPTIONS: readonly { value: TransmissionType; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" }
];

export function SearchDashboard({
  client = searchApi,
  initialSearches,
  verificationClient = searchVerificationApi
}: SearchDashboardProps): ReactElement {
  const [searches, setSearches] = useState<ManagedVehicleSearch[]>(
    initialSearches === undefined ? [] : [...initialSearches]
  );
  const [loading, setLoading] = useState(initialSearches === undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [verification, setVerification] = useState<{
    search: ManagedVehicleSearch;
    preview: SearchVerificationPreview;
  } | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const loadSearches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSearches(await client.list());
    } catch (loadError: unknown) {
      setError(messageFor(loadError, "Saved searches could not be loaded. Check the local server."));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (initialSearches === undefined) void loadSearches();
  }, [initialSearches, loadSearches]);

  useEffect(() => {
    if (editor === null && confirmation === null) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || pending) return;
      if (confirmation !== null) setConfirmation(null);
      else setEditor(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [confirmation, editor, pending]);

  const overlayOpen = editor !== null || confirmation !== null || verification !== null;
  useEffect(() => {
    if (!overlayOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [overlayOpen]);

  const activeCount = searches.filter(({ active }) => active).length;

  const openCreate = (): void => {
    setNotice(null);
    setEditor({
      mode: "create",
      searchId: null,
      form: createSearchForm(searches.length + 1),
      fieldErrors: {}
    });
  };

  const openEdit = (search: ManagedVehicleSearch): void => {
    setNotice(null);
    setEditor({
      mode: "edit",
      searchId: search.id,
      form: draftToSearchForm(search),
      fieldErrors: {}
    });
  };

  const saveEditor = async (overrideActiveLimit = false): Promise<void> => {
    if (editor === null) return;
    setPending(true);
    setError(null);
    try {
      const draft = searchFormToDraft(editor.form);
      const saved = editor.mode === "create"
        ? await client.create(draft, overrideActiveLimit)
        : await client.update(requireId(editor.searchId), draft, overrideActiveLimit);
      setSearches((current) => editor.mode === "create"
        ? sortSearches([...current, saved])
        : sortSearches(current.map((search) => search.id === saved.id ? saved : search))
      );
      setEditor(null);
      setConfirmation(null);
      setNotice(editor.mode === "create" ? "Search created." : "Search updated.");
    } catch (saveError: unknown) {
      if (isActiveLimitWarning(saveError)) {
        setConfirmation({
          title: "Run more than ten active searches?",
          message: "More active searches increase scan time and may make marketplace checks less predictable. You can continue, or save this search as paused.",
          actionLabel: "Activate anyway",
          tone: "warning",
          action: () => saveEditor(true)
        });
      } else if (saveError instanceof SearchApiError && Object.keys(saveError.fieldErrors).length > 0) {
        setEditor((current) => current === null
          ? null
          : { ...current, fieldErrors: saveError.fieldErrors }
        );
      } else {
        setError(messageFor(saveError, "The search could not be saved."));
      }
    } finally {
      setPending(false);
    }
  };

  const replaceSearch = (updated: ManagedVehicleSearch): void => {
    setSearches((current) => sortSearches(
      current.map((search) => search.id === updated.id ? updated : search)
    ));
  };

  const toggleActive = async (search: ManagedVehicleSearch, override = false): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const updated = search.active
        ? await client.pause(search.id)
        : await client.activate(search.id, override);
      replaceSearch(updated);
      setConfirmation(null);
      setNotice(updated.active ? `${updated.name} activated.` : `${updated.name} paused.`);
    } catch (toggleError: unknown) {
      if (isActiveLimitWarning(toggleError)) {
        setConfirmation({
          title: "Activate an eleventh search?",
          message: "Ten searches are already active. Continue only if the longer scan rotation is acceptable.",
          actionLabel: "Activate anyway",
          tone: "warning",
          action: () => toggleActive(search, true)
        });
      } else {
        setError(messageFor(toggleError, "The search state could not be changed."));
      }
    } finally {
      setPending(false);
    }
  };

  const duplicateSearch = async (search: ManagedVehicleSearch): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const duplicate = await client.duplicate(search.id);
      setSearches((current) => sortSearches([...current, duplicate]));
      setNotice(`${duplicate.name} created as a paused search.`);
    } catch (duplicateError: unknown) {
      setError(messageFor(duplicateError, "The search could not be duplicated."));
    } finally {
      setPending(false);
    }
  };

  const confirmDelete = (search: ManagedVehicleSearch): void => {
    setConfirmation({
      title: `Delete “${search.name}”?`,
      message: "This removes only this saved search. This action cannot be undone.",
      actionLabel: "Delete search",
      tone: "danger",
      action: async () => {
        setPending(true);
        setError(null);
        try {
          await client.delete(search.id);
          setSearches((current) => current.filter(({ id }) => id !== search.id));
          setConfirmation(null);
          setNotice(`${search.name} deleted.`);
        } catch (deleteError: unknown) {
          setError(messageFor(deleteError, "The search could not be deleted."));
        } finally {
          setPending(false);
        }
      }
    });
  };

  const moveSearch = async (index: number, direction: -1 | 1): Promise<void> => {
    const destination = index + direction;
    if (destination < 0 || destination >= searches.length) return;
    const ordered = [...searches];
    const moving = ordered[index];
    const displaced = ordered[destination];
    if (moving === undefined || displaced === undefined) return;
    ordered[index] = displaced;
    ordered[destination] = moving;
    setPending(true);
    setError(null);
    try {
      setSearches(await client.reprioritize(ordered.map(({ id }) => id)));
      setNotice("Search priority updated.");
    } catch (priorityError: unknown) {
      setError(messageFor(priorityError, "Priorities changed elsewhere. Refresh and try again."));
    } finally {
      setPending(false);
    }
  };

  const requestScan = async (search: ManagedVehicleSearch): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await client.requestScan(search.id);
      setNotice(`Manual scan requested for ${search.name}.`);
    } catch (scanError: unknown) {
      setError(messageFor(scanError, "The manual scan could not be requested."));
    } finally {
      setPending(false);
    }
  };

  const openVerification = async (search: ManagedVehicleSearch): Promise<void> => {
    setPending(true);
    setError(null);
    setNotice(null);
    setVerificationError(null);
    try {
      const preview = await verificationClient.openFacebook(search.id);
      setVerification({ search, preview });
    } catch (openError: unknown) {
      setError(messageFor(
        openError,
        "Facebook verification could not start. Open the controlled browser and try again."
      ));
    } finally {
      setPending(false);
    }
  };

  const confirmVerification = async (): Promise<void> => {
    if (verification === null) return;
    setPending(true);
    setVerificationError(null);
    try {
      await verificationClient.confirmFacebook(verification.search.id);
      setVerification(null);
      await loadSearches();
      setNotice(`${verification.search.name} verified for Facebook Marketplace.`);
    } catch (confirmError: unknown) {
      setVerificationError(messageFor(
        confirmError,
        "Keep Chromium on the intended Marketplace results and try confirming again."
      ));
    } finally {
      setPending(false);
    }
  };

  const rejectVerification = async (): Promise<void> => {
    if (verification === null) return;
    setPending(true);
    setVerificationError(null);
    try {
      await verificationClient.rejectFacebook(verification.search.id);
      const searchName = verification.search.name;
      setVerification(null);
      setNotice(`${searchName} verification rejected. Nothing was saved.`);
    } catch (rejectError: unknown) {
      setVerificationError(messageFor(rejectError, "Verification could not be rejected."));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="search-manager" aria-labelledby="searches-title">
      <div className="search-heading">
        <div>
          <h1 id="searches-title">Saved searches</h1>
          <p>Define the vehicle once. Every marketplace adapter will work from the same rules.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate} disabled={pending}>
          <Icon name="plus" />
          New search
        </button>
      </div>

      <div className="search-register" aria-label="Search capacity">
        <p><strong>{activeCount}</strong> active <span>/ {ACTIVE_SEARCH_SOFT_LIMIT} recommended</span></p>
        <div className="capacity-track" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(activeCount / ACTIVE_SEARCH_SOFT_LIMIT, 1)})` }} />
        </div>
        <p>{searches.length} saved</p>
      </div>

      <div className="message-region" aria-live="polite">
        {notice === null ? null : <p className="notice-message">{notice}</p>}
        {error === null ? null : (
          <div className="error-message" role="alert">
            <p>{error}</p>
            {loading ? null : <button type="button" onClick={() => void loadSearches()}>Refresh searches</button>}
          </div>
        )}
      </div>

      {loading ? (
        <div className="search-loading" role="status">
          <span aria-hidden="true" />
          Reading saved searches…
        </div>
      ) : searches.length === 0 ? (
        <div className="search-empty">
          <div className="empty-orbit" aria-hidden="true"><span /></div>
          <div>
            <h2>Set your first search</h2>
            <p>Start with a make or model, then decide which rules are strict and which are preferences.</p>
            <button type="button" className="text-action" onClick={openCreate}>Create a saved search</button>
          </div>
        </div>
      ) : (
        <ol className="search-list" aria-label="Saved searches by priority">
          {searches.map((search, index) => (
            <SearchRow
              key={search.id}
              search={search}
              position={index + 1}
              first={index === 0}
              last={index === searches.length - 1}
              pending={pending}
              onEdit={() => openEdit(search)}
              onDuplicate={() => void duplicateSearch(search)}
              onToggle={() => void toggleActive(search)}
              onDelete={() => confirmDelete(search)}
              onScan={() => void requestScan(search)}
              onVerify={() => void openVerification(search)}
              onMove={(direction) => void moveSearch(index, direction)}
            />
          ))}
        </ol>
      )}

      {editor === null ? null : (
        <SearchEditor
          editor={editor}
          pending={pending}
          active={confirmation === null}
          onChange={(form) => setEditor((current) => current === null ? null : {
            ...current,
            form,
            fieldErrors: {}
          })}
          onClose={() => setEditor(null)}
          onSave={() => void saveEditor()}
        />
      )}

      {confirmation === null ? null : (
        <ConfirmationDialog
          confirmation={confirmation}
          pending={pending}
          onCancel={() => setConfirmation(null)}
        />
      )}

      {verification === null ? null : (
        <SearchVerificationDialog
          search={verification.search}
          preview={verification.preview}
          pending={pending}
          error={verificationError}
          onConfirm={() => void confirmVerification()}
          onReject={() => void rejectVerification()}
        />
      )}
    </section>
  );
}

interface SearchRowProps {
  search: ManagedVehicleSearch;
  position: number;
  first: boolean;
  last: boolean;
  pending: boolean;
  onEdit(): void;
  onDuplicate(): void;
  onToggle(): void;
  onDelete(): void;
  onScan(): void;
  onVerify(): void;
  onMove(direction: -1 | 1): void;
}

function SearchRow(props: SearchRowProps): ReactElement {
  const { search } = props;
  return (
    <li className={search.active ? "search-row" : "search-row is-paused"}>
      <div className="priority-cell">
        <span className="priority-number">{String(props.position).padStart(2, "0")}</span>
        <div className="priority-controls" aria-label={`Change priority for ${search.name}`}>
          <button type="button" disabled={props.first || props.pending} onClick={() => props.onMove(-1)} aria-label={`Move ${search.name} up`}>
            <Icon name="up" />
          </button>
          <button type="button" disabled={props.last || props.pending} onClick={() => props.onMove(1)} aria-label={`Move ${search.name} down`}>
            <Icon name="down" />
          </button>
        </div>
      </div>

      <div className="search-core">
        <div className="search-title-line">
          <h2>{search.name}</h2>
          <span className={search.active ? "state-badge active" : "state-badge"}>
            <span aria-hidden="true" />{search.active ? "Active" : "Paused"}
          </span>
        </div>
        <p className="criteria-summary">{summarizeCriteria(search)}</p>
        <div className="constraint-key" aria-label="Constraint summary">
          <span><i className="hard-key" />{countStrength(search, "hard")} hard</span>
          <span><i className="soft-key" />{countStrength(search, "soft")} soft</span>
        </div>
      </div>

      <dl className="search-meta">
        <div>
          <dt>Area</dt>
          <dd>{formatLocation(search)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd className={`verification-${search.sourceVerification.state}`}>{formatVerification(search)}</dd>
        </div>
        <div>
          <dt>Last scan</dt>
          <dd>{formatScanTime(search.lastScanAt, "Never scanned")}</dd>
        </div>
        <div>
          <dt>Next scan</dt>
          <dd>{formatScanTime(search.nextScanAt, "Not scheduled")}</dd>
        </div>
      </dl>

      <div className="row-actions">
        <button className="row-action-primary" type="button" onClick={props.onEdit} disabled={props.pending}>
          <Icon name="edit" /> Edit
        </button>
        <button className="source-action" type="button" onClick={props.onVerify} disabled={props.pending}>
          <Icon name="verify" /> {search.sourceVerification.state === "unverified" ? "Verify Facebook" : "Verify again"}
        </button>
        <button type="button" onClick={props.onScan} disabled={props.pending || !search.active} title={search.active ? "Request manual scan" : "Activate this search before scanning"}>
          <Icon name="scan" /> Scan
        </button>
        <button type="button" onClick={props.onToggle} disabled={props.pending}>
          <Icon name={search.active ? "pause" : "play"} /> {search.active ? "Pause" : "Activate"}
        </button>
        <button type="button" onClick={props.onDuplicate} disabled={props.pending}>
          <Icon name="copy" /> Duplicate
        </button>
        <button className="danger-action" type="button" onClick={props.onDelete} disabled={props.pending}>
          <Icon name="trash" /> Delete
        </button>
      </div>
    </li>
  );
}

interface SearchEditorProps {
  editor: EditorState;
  pending: boolean;
  active: boolean;
  onChange(form: SearchFormModel): void;
  onClose(): void;
  onSave(): void;
}

export function SearchEditor({ editor, pending, active, onChange, onClose, onSave }: SearchEditorProps): ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(dialogRef, active);
  const { form, fieldErrors } = editor;
  const update = <K extends keyof SearchFormModel>(key: K, value: SearchFormModel[K]): void => {
    onChange({ ...form, [key]: value });
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSave();
  };

  return (
    <div className="editor-layer">
      <div className="editor-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={dialogRef} className="editor-sheet" role="dialog" aria-modal={active} aria-hidden={!active} aria-labelledby="editor-title">
        <header className="editor-header">
          <h2 id="editor-title">{editor.mode === "create" ? "Create saved search" : `Edit ${form.name}`}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close search editor">
            <Icon name="close" />
          </button>
        </header>

        <form onSubmit={submit} noValidate>
          <FormSection title="Identity" description="Name the search and choose where it sits in the scan order.">
            <div className="field-grid two-column">
              <TextField id="search-name" label="Search name" value={form.name} onChange={(value) => update("name", value)} errors={errorsFor(fieldErrors, "name")} autoFocus />
              <TextField id="search-priority" label="Priority" value={form.priority} onChange={(value) => update("priority", value)} errors={errorsFor(fieldErrors, "priority")} type="number" min="1" max="1000" />
            </div>
            <label className="switch-field">
              <input type="checkbox" checked={form.active} onChange={(event) => update("active", event.currentTarget.checked)} />
              <span aria-hidden="true"><i /></span>
              Start this search active
            </label>
          </FormSection>

          <FormSection title="Vehicle identity" description="Comma-separate alternatives. A hard rule excludes mismatches; a soft rule improves ranking.">
            <ConstraintTextField id="make-keywords" label="Make keywords" value={form.makeKeywords} strength={form.makeStrength} placeholder="Volkswagen, VW" onValue={(value) => update("makeKeywords", value)} onStrength={(value) => update("makeStrength", value)} errors={errorsFor(fieldErrors, "criteria.makeKeywords", "criteria.makeKeywords.value")} />
            <ConstraintTextField id="model-keywords" label="Model keywords" value={form.modelKeywords} strength={form.modelStrength} placeholder="Golf" onValue={(value) => update("modelKeywords", value)} onStrength={(value) => update("modelStrength", value)} errors={errorsFor(fieldErrors, "criteria.modelKeywords", "criteria.modelKeywords.value")} />
            <ConstraintTextField id="variant-keywords" label="Variant keywords" value={form.variantKeywords} strength={form.variantStrength} placeholder="GTE, GTI" onValue={(value) => update("variantKeywords", value)} onStrength={(value) => update("variantStrength", value)} errors={errorsFor(fieldErrors, "criteria.variantKeywords", "criteria.variantKeywords.value")} />
          </FormSection>

          <FormSection title="Price and condition" description="Prices are whole EUR amounts; distance and mileage are kilometres.">
            <ConstraintPair
              label="Price range"
              strength={form.priceStrength}
              onStrength={(value) => update("priceStrength", value)}
            >
              <TextField id="minimum-price" label="Minimum EUR" value={form.minimumPriceEur} onChange={(value) => update("minimumPriceEur", value)} errors={errorsFor(fieldErrors, "criteria.priceRange.minimumEur")} type="number" min="0" />
              <TextField id="maximum-price" label="Maximum EUR" value={form.maximumPriceEur} onChange={(value) => update("maximumPriceEur", value)} errors={errorsFor(fieldErrors, "criteria.priceRange", "criteria.priceRange.maximumEur")} type="number" min="0" />
            </ConstraintPair>
            <div className="field-grid two-column">
              <NumberConstraint id="minimum-year" label="Minimum year" value={form.minimumYear} strength={form.yearStrength} onValue={(value) => update("minimumYear", value)} onStrength={(value) => update("yearStrength", value)} errors={errorsFor(fieldErrors, "criteria.minimumYear", "criteria.minimumYear.value")} min="1886" />
              <NumberConstraint id="maximum-mileage" label="Maximum mileage (km)" value={form.maximumMileageKm} strength={form.mileageStrength} onValue={(value) => update("maximumMileageKm", value)} onStrength={(value) => update("mileageStrength", value)} errors={errorsFor(fieldErrors, "criteria.maximumMileageKm", "criteria.maximumMileageKm.value")} min="0" />
              <NumberConstraint id="minimum-power" label="Minimum power (hp)" value={form.minimumPowerHp} strength={form.powerStrength} onValue={(value) => update("minimumPowerHp", value)} onStrength={(value) => update("powerStrength", value)} errors={errorsFor(fieldErrors, "criteria.minimumPowerHp", "criteria.minimumPowerHp.value")} min="1" />
              <label className="field">
                <span>Seller preference</span>
                <span className="input-with-strength">
                  <select value={form.sellerPreference} onChange={(event) => update("sellerPreference", event.currentTarget.value as SearchFormModel["sellerPreference"])}>
                    <option value="">Any seller</option>
                    <option value="private">Private seller</option>
                    <option value="dealer">Dealer</option>
                  </select>
                  <StrengthSelect id="seller-strength" value={form.sellerStrength} onChange={(value) => update("sellerStrength", value)} label="Seller preference strength" />
                </span>
              </label>
            </div>
          </FormSection>

          <FormSection title="Fuel and transmission" description="Choose more than one option when either is acceptable.">
            <ChoiceConstraint legend="Fuel" values={form.fuels} options={FUEL_OPTIONS} strength={form.fuelStrength} onValues={(values) => update("fuels", values as FuelType[])} onStrength={(value) => update("fuelStrength", value)} />
            <ChoiceConstraint legend="Transmission" values={form.transmissions} options={TRANSMISSION_OPTIONS} strength={form.transmissionStrength} onValues={(values) => update("transmissions", values as TransmissionType[])} onStrength={(value) => update("transmissionStrength", value)} />
          </FormSection>

          <FormSection title="Words that matter" description="Required and excluded terms are matched after marketplace results are collected.">
            <ConstraintTextField id="required-keywords" label="Required keywords" value={form.requiredKeywords} strength={form.requiredStrength} placeholder="service history, one owner" onValue={(value) => update("requiredKeywords", value)} onStrength={(value) => update("requiredStrength", value)} errors={errorsFor(fieldErrors, "criteria.requiredKeywords", "criteria.requiredKeywords.value")} />
            <ConstraintTextField id="excluded-keywords" label="Excluded keywords" value={form.excludedKeywords} strength={form.excludedStrength} placeholder="damaged, parts only" onValue={(value) => update("excludedKeywords", value)} onStrength={(value) => update("excludedStrength", value)} errors={errorsFor(fieldErrors, "criteria.excludedKeywords", "criteria.excludedKeywords.value")} />
          </FormSection>

          <FormSection title="Search area" description="Use a radius from one origin, or search across Portugal.">
            <fieldset className="segmented-field">
              <legend>Location mode</legend>
              <label><input type="radio" name="location-mode" value="radius" checked={form.locationMode === "radius"} onChange={() => update("locationMode", "radius")} /><span>Radius</span></label>
              <label><input type="radio" name="location-mode" value="nationwide" checked={form.locationMode === "nationwide"} onChange={() => update("locationMode", "nationwide")} /><span>Nationwide</span></label>
            </fieldset>
            {form.locationMode === "radius" ? (
              <div className="field-grid location-grid">
                <TextField id="search-origin" label="Origin" value={form.origin} onChange={(value) => update("origin", value)} errors={errorsFor(fieldErrors, "location.origin")} />
                <label className="field">
                  <span>Radius</span>
                  <select value={form.radiusKm} onChange={(event) => update("radiusKm", Number(event.currentTarget.value) as SearchRadiusKm)} aria-invalid={hasErrors(errorsFor(fieldErrors, "location.radiusKm"))} aria-describedby={hasErrors(errorsFor(fieldErrors, "location.radiusKm")) ? "radius-error" : undefined}>
                    {SEARCH_RADIUS_OPTIONS_KM.map((radius) => <option key={radius} value={radius}>{radius} km</option>)}
                  </select>
                  <FieldErrors id="radius-error" errors={errorsFor(fieldErrors, "location.radiusKm")} />
                </label>
              </div>
            ) : (
              <p className="nationwide-note">Origin and radius are ignored in nationwide mode.</p>
            )}
          </FormSection>

          {Object.keys(fieldErrors).length === 0 ? null : (
            <p className="form-error-summary" role="alert">Review the marked fields, then save again.</p>
          )}

          <footer className="editor-actions">
            <button type="button" className="secondary-action" onClick={onClose} disabled={pending}>Cancel</button>
            <button type="submit" className="primary-action" disabled={pending}>{pending ? "Saving…" : editor.mode === "create" ? "Create search" : "Save changes"}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }): ReactElement {
  return <section className="form-section"><header><h3>{title}</h3><p>{description}</p></header><div className="form-section-fields">{children}</div></section>;
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  errors: readonly string[];
  type?: "text" | "number";
  min?: string;
  max?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

function TextField(props: TextFieldProps): ReactElement {
  const errorId = `${props.id}-error`;
  return (
    <label className="field" htmlFor={props.id}>
      <span>{props.label}</span>
      <input id={props.id} type={props.type ?? "text"} value={props.value} min={props.min} max={props.max} placeholder={props.placeholder} autoFocus={props.autoFocus} data-initial-focus={props.autoFocus ? true : undefined} onChange={(event) => props.onChange(event.currentTarget.value)} aria-invalid={hasErrors(props.errors)} aria-describedby={hasErrors(props.errors) ? errorId : undefined} />
      <FieldErrors id={errorId} errors={props.errors} />
    </label>
  );
}

function ConstraintTextField(props: {
  id: string; label: string; value: string; strength: ConstraintStrength; placeholder: string;
  onValue(value: string): void; onStrength(value: ConstraintStrength): void; errors: readonly string[];
}): ReactElement {
  const errorId = `${props.id}-error`;
  return (
    <label className="field constraint-field" htmlFor={props.id}>
      <span>{props.label}</span>
      <span className="input-with-strength">
        <input id={props.id} value={props.value} placeholder={props.placeholder} onChange={(event) => props.onValue(event.currentTarget.value)} aria-invalid={hasErrors(props.errors)} aria-describedby={hasErrors(props.errors) ? errorId : undefined} />
        <StrengthSelect id={`${props.id}-strength`} value={props.strength} onChange={props.onStrength} label={`${props.label} strength`} />
      </span>
      <FieldErrors id={errorId} errors={props.errors} />
    </label>
  );
}

function NumberConstraint(props: {
  id: string; label: string; value: string; strength: ConstraintStrength; min: string;
  onValue(value: string): void; onStrength(value: ConstraintStrength): void; errors: readonly string[];
}): ReactElement {
  const errorId = `${props.id}-error`;
  return (
    <label className="field" htmlFor={props.id}>
      <span>{props.label}</span>
      <span className="input-with-strength">
        <input id={props.id} type="number" min={props.min} value={props.value} onChange={(event) => props.onValue(event.currentTarget.value)} aria-invalid={hasErrors(props.errors)} aria-describedby={hasErrors(props.errors) ? errorId : undefined} />
        <StrengthSelect id={`${props.id}-strength`} value={props.strength} onChange={props.onStrength} label={`${props.label} strength`} />
      </span>
      <FieldErrors id={errorId} errors={props.errors} />
    </label>
  );
}

function ConstraintPair(props: { label: string; strength: ConstraintStrength; onStrength(value: ConstraintStrength): void; children: ReactNode }): ReactElement {
  return <fieldset className="constraint-pair"><legend>{props.label}</legend><div className="pair-fields">{props.children}</div><StrengthSelect id="price-strength" value={props.strength} onChange={props.onStrength} label="Price range strength" /></fieldset>;
}

function StrengthSelect(props: { id: string; value: ConstraintStrength; onChange(value: ConstraintStrength): void; label: string }): ReactElement {
  return <select className={`strength-select is-${props.value}`} id={props.id} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value as ConstraintStrength)} aria-label={props.label}><option value="hard">Hard</option><option value="soft">Soft</option></select>;
}

function ChoiceConstraint<T extends string>(props: {
  legend: string; values: readonly T[]; options: readonly { value: T; label: string }[];
  strength: ConstraintStrength; onValues(values: T[]): void; onStrength(value: ConstraintStrength): void;
}): ReactElement {
  const toggle = (value: T): void => props.onValues(props.values.includes(value) ? props.values.filter((item) => item !== value) : [...props.values, value]);
  return (
    <fieldset className="choice-constraint">
      <legend>{props.legend}</legend>
      <div className="choice-grid">{props.options.map((option) => <label key={option.value}><input type="checkbox" checked={props.values.includes(option.value)} onChange={() => toggle(option.value)} /><span>{option.label}</span></label>)}</div>
      <StrengthSelect id={`${props.legend.toLowerCase()}-strength`} value={props.strength} onChange={props.onStrength} label={`${props.legend} strength`} />
    </fieldset>
  );
}

function FieldErrors({ id, errors }: { id: string; errors: readonly string[] }): ReactElement | null {
  if (errors.length === 0) return null;
  return <span className="field-error" id={id}>{errors.join(". ")}</span>;
}

function ConfirmationDialog({ confirmation, pending, onCancel }: { confirmation: ConfirmationState; pending: boolean; onCancel(): void }): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, true);
  return (
    <div className="confirmation-layer" role="presentation">
      <div ref={dialogRef} className={`confirmation-dialog is-${confirmation.tone}`} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
        <span className="confirmation-mark" aria-hidden="true"><Icon name={confirmation.tone === "danger" ? "trash" : "alert"} /></span>
        <h2 id="confirmation-title">{confirmation.title}</h2>
        <p id="confirmation-message">{confirmation.message}</p>
        <div>
          <button type="button" className="secondary-action" onClick={onCancel} disabled={pending} data-initial-focus>Cancel</button>
          <button type="button" className={confirmation.tone === "danger" ? "danger-button" : "primary-action"} onClick={() => void confirmation.action()} disabled={pending}>{pending ? "Working…" : confirmation.actionLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Icon({ name }: { name: "plus" | "up" | "down" | "edit" | "verify" | "scan" | "pause" | "play" | "copy" | "trash" | "close" | "alert" }): ReactElement {
  const paths: Record<typeof name, ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    up: <><path d="m7 14 5-5 5 5" /></>,
    down: <><path d="m7 10 5 5 5-5" /></>,
    edit: <><path d="m14.5 5.5 4 4L9 19H5v-4Z" /><path d="m12.5 7.5 4 4" /></>,
    verify: <><rect x="3" y="5" width="18" height="14" /><path d="M3 9h18M8 14l2.5 2.5L16 11" /></>,
    scan: <><path d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3" /><path d="M7 12h10" /></>,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    play: <><path d="m9 7 8 5-8 5Z" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5H5v11h3" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    alert: <><path d="M12 4 3 20h18ZM12 9v5M12 17h.01" /></>
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function errorsFor(errors: Readonly<Record<string, readonly string[]>>, ...paths: string[]): readonly string[] {
  return paths.flatMap((path) => errors[path] ?? []);
}

function hasErrors(errors: readonly string[]): boolean {
  return errors.length > 0;
}

function requireId(id: string | null): string {
  if (id === null) throw new Error("Search ID is missing");
  return id;
}

function isActiveLimitWarning(error: unknown): boolean {
  return error instanceof SearchApiError && error.code === "ACTIVE_SEARCH_LIMIT_CONFIRMATION_REQUIRED";
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sortSearches(searches: readonly ManagedVehicleSearch[]): ManagedVehicleSearch[] {
  return [...searches].sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt));
}

function summarizeCriteria(search: ManagedVehicleSearch): string {
  const criteria = search.criteria;
  const identity = [
    criteria.makeKeywords?.value.join(" / "),
    criteria.modelKeywords?.value.join(" / "),
    criteria.variantKeywords?.value.join(" / ")
  ].filter((value): value is string => value !== undefined && value.length > 0).join(" · ");
  const facts: string[] = [];
  if (criteria.priceRange !== null) {
    const { minimumEur, maximumEur } = criteria.priceRange.value;
    facts.push(minimumEur !== null && maximumEur !== null ? `€${formatNumber(minimumEur)}–€${formatNumber(maximumEur)}` : minimumEur !== null ? `from €${formatNumber(minimumEur)}` : `up to €${formatNumber(maximumEur ?? 0)}`);
  }
  if (criteria.minimumYear !== null) facts.push(`${criteria.minimumYear.value}+`);
  if (criteria.maximumMileageKm !== null) facts.push(`≤ ${formatNumber(criteria.maximumMileageKm.value)} km`);
  return [identity || "Keyword search", ...facts].join("  /  ");
}

function formatLocation(search: ManagedVehicleSearch): string {
  return search.location.mode === "nationwide" ? "Portugal" : `${search.location.origin} · ${search.location.radiusKm} km`;
}

function formatVerification(search: ManagedVehicleSearch): string {
  const verifiedAt = search.sourceVerification.verifiedAt;
  if (search.sourceVerification.state === "verified") {
    return verifiedAt === null ? "Verified" : `Verified · ${formatScanTime(verifiedAt, "")}`;
  }
  if (search.sourceVerification.state === "stale") {
    return verifiedAt === null ? "Verify again" : `Verify again · last ${formatScanTime(verifiedAt, "")}`;
  }
  return "Not verified";
}

function formatScanTime(value: string | null, fallback: string): string {
  if (value === null) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function countStrength(search: ManagedVehicleSearch, strength: ConstraintStrength): number {
  return Object.values(search.criteria).filter((constraint) => constraint?.strength === strength).length;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}
