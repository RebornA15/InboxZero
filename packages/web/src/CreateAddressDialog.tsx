import { useEffect, useRef, useState } from "react";
import { Briefcase, GraduationCap, UserCircle, X, Plus, ArrowClockwise } from "@phosphor-icons/react";
import { getAddressOptions } from "./api";
import { categoryLabels } from "./types";
import type { AddressOptions, CreateInboxOptions, InboxCategory } from "./types";

const styles = [
  { category: "work" as const, Icon: Briefcase, description: "Professional, without sharing your real name." },
  { category: "school" as const, Icon: GraduationCap, description: "Student-inspired, with no institutional affiliation." },
  { category: "personal" as const, Icon: UserCircle, description: "Randomized and disposable, for everyday use." },
];

interface Props {
  open: boolean;
  initialCategory: InboxCategory;
  hasActiveInbox: boolean;
  onClose: () => void;
  onGenerate: (options: CreateInboxOptions) => Promise<void>;
}

export function CreateAddressDialog({ open, initialCategory, hasActiveInbox, onClose, onGenerate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<InboxCategory>(initialCategory);
  const [username, setUsername] = useState("");
  const [options, setOptions] = useState<AddressOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    setCategory(initialCategory);
    setUsername("");
    setError(null);
    setOptions(null);
    const controller = new AbortController();
    getAddressOptions(controller.signal).then(setOptions).catch((cause: Error) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [open, initialCategory, retry]);

  useEffect(() => {
    if (open && options) dialog.current?.querySelector<HTMLInputElement>('input[name="address-category"]:checked')?.focus();
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const domain = options?.categories.find(option => option.category === category)?.domain;
  const close = () => { if (!pending) onClose(); };

  return (
    <dialog ref={dialog} className="address-dialog" tabIndex={-1} aria-labelledby="address-dialog-title" aria-describedby="address-style-note"
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          .filter(control => control.getClientRects().length > 0 && !(control instanceof HTMLInputElement && control.type === "radio" && !control.checked));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) { event.preventDefault(); event.currentTarget.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={event => { if (pending) event.preventDefault(); else onClose(); }} onClose={onClose}>
      <form onSubmit={async event => {
        event.preventDefault();
        if (!options || pending) return;
        setPending(true);
        setError(null);
        try {
          const normalized = username.trim().toLowerCase();
          await onGenerate({ category, ...(options.customUsernamesEnabled && normalized ? { username: normalized } : {}) });
        } catch (cause) { setError((cause as Error).message || "Could not create an address. Please try again."); }
        finally { setPending(false); }
      }}>
        <div className="address-dialog-header">
          <div><p className="dialog-eyebrow">A fresh start</p><h2 id="address-dialog-title" className="display-heading">Choose your address style</h2></div>
          <button type="button" className="btn btn-icon" aria-label="Close address selection" title="Close" disabled={pending} onClick={close}><X size={18} /></button>
        </div>
        <p id="address-style-note" className="dialog-description">Work and School describe address styles, not verified work or school identities. No personal details needed.</p>
        <fieldset className="address-category-options" disabled={!options || pending}>
          <legend className="visually-hidden">Email address category</legend>
          {styles.map(({ category: value, Icon, description }) => (
            <label key={value} className={`address-category-option ${category === value ? "selected" : ""}`}>
              <input type="radio" name="address-category" value={value} checked={category === value} onChange={() => { setCategory(value); setError(null); }} />
              <Icon size={20} weight={category === value ? "bold" : "regular"} />
              <span><strong>{categoryLabels[value]}</strong><span>{description}</span></span>
            </label>
          ))}
        </fieldset>
        {!options && !error && <p className="dialog-description" role="status">Loading available domains…</p>}
        {options?.customUsernamesEnabled && <div className="username-field">
          <label htmlFor="address-username">Custom username <span>Optional</span></label>
          <input id="address-username" value={username} disabled={pending} onChange={event => { setUsername(event.target.value); setError(null); }}
            onBlur={() => setUsername(value => value.trim().toLowerCase())} minLength={3} maxLength={32}
            pattern={"[A-Za-z0-9]+([._\\-][A-Za-z0-9]+)*"} autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder="Random if left blank" aria-describedby="address-username-help" />
          <p id="address-username-help">3–32 letters or numbers, with single dots, hyphens or underscores between them. Reserved names are unavailable.</p>
        </div>}
        {domain && <div className="address-preview"><span>Address preview</span><code>{username.trim().toLowerCase() || (category === "work" ? "contact.…" : category === "school" ? "student…" : "random…")}@{domain}</code></div>}
        {error && <div className="address-dialog-error" role="alert"><p>{error}</p>{!options && <button className="btn" type="button" onClick={() => setRetry(value => value + 1)}><ArrowClockwise size={16} />Retry</button>}</div>}
        <p className="dialog-delivery-note">{options?.development ? "Test domains are local-only. Owned domains require inbound routing." : "External email requires configured DNS and inbound routing."}</p>
        {hasActiveInbox && <p className="dialog-description">Creating an address replaces this session’s active inbox.</p>}
        <div className="address-dialog-footer">
          <button type="button" className="btn" onClick={close} disabled={pending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!options || pending}><Plus size={18} />{pending ? "Creating address…" : "Create address"}</button>
        </div>
      </form>
    </dialog>
  );
}
