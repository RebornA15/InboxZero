import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  EnvelopeSimple,
  CopySimple,
  Check,
  ArrowClockwise,
  Clock,
  ShieldCheck,
  Plus,
  Tray,
  PaperPlaneTilt,
  Info,
  CheckCircle,
  MagnifyingGlass,
  List,
  X,
} from "@phosphor-icons/react";
import {
  getAddressOptions,
  createInbox,
  getInbox,
  getMessages,
  getMessage,
  deleteMessage,
  connectInboxEvents,
  simulateIncomingMail,
} from "./api";
import type { MessageDetail, MessageListItem, StoredInboxSession } from "./types";
import type { CreateInboxOptions } from "./types";
import { categoryLabels } from "./types";
import { CreateAddressDialog } from "./CreateAddressDialog";
import { MessageReader } from "./MessageReader";

const SESSION_STORAGE_KEY = "inboxzero_session";

function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio context may be blocked by autoplay policies until user interaction.
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea-based copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [simulationEnabled, setSimulationEnabled] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    workspaceRef.current?.setAttribute("inert", "");
    drawerRef.current?.querySelector<HTMLButtonElement>(".drawer-close")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDrawerOpen(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled)') ?? [])
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const media = matchMedia("(max-width: 900px)");
    const resize = () => { if (!media.matches) setDrawerOpen(false); };
    document.addEventListener("keydown", handleKey);
    media.addEventListener("change", resize);
    return () => {
      document.body.style.overflow = previousOverflow;
      workspaceRef.current?.removeAttribute("inert");
      document.removeEventListener("keydown", handleKey);
      media.removeEventListener("change", resize);
      menuRef.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  const didInitializeRef = useRef(false);
  const selectedMessageIdRef = useRef<number | null>(null);
  const generateAddressButtonRef = useRef<HTMLButtonElement>(null);
  const [session, setSession] = useState<StoredInboxSession | null>(null);
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [readerAttempt, setReaderAttempt] = useState(0);
  const [deletingMessageId, setDeletingMessageId] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isWarningExpiry, setIsWarningExpiry] = useState<boolean>(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ id: number; text: string; type: "success" | "info" } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);

  // Retry capabilities after inbox creation/restoration if a free backend was waking up.
  useEffect(() => {
    const controller = new AbortController();
    getAddressOptions(controller.signal).then(options => {
      setSimulationEnabled(options.simulationEnabled ?? options.development);
      setDemoMode(options.demoMode === true);
    }).catch(() => {});
    return () => controller.abort();
  }, [session?.inbox.publicId]);

  const showToast = (text: string, type: "success" | "info" = "info") => {
    setToastMessage({ id: Date.now(), text, type });
    setTimeout(() => {
      setToastMessage((current) => (current?.text === text ? null : current));
    }, 3500);
  };

  const initializeInbox = useCallback(async (forcedNew = false, options?: CreateInboxOptions) => {
    if (forcedNew && !options) { setAddressDialogOpen(true); return; }
    setIsLoading(true);
    setInitError(null);

    try {
      if (!forcedNew) {
        const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          try {
            const parsed: StoredInboxSession = JSON.parse(stored);
            if (new Date(parsed.inbox.expiresAt) > new Date()) {
              const verified = await getInbox(parsed.inbox.publicId, parsed.accessSecret);
              const restoredSession = { inbox: verified, accessSecret: parsed.accessSecret };
              setSession(restoredSession);
              sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(restoredSession));
              const initialMsgs = await getMessages(verified.publicId, parsed.accessSecret);
              setMessages(initialMsgs);
              setIsLoading(false);
              return;
            }
          } catch {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          }
        }
      }

      if (!options) { setAddressDialogOpen(true); return; }
      const newSession = await createInbox(options);
      setSession(newSession);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      setMessages([]);
      setSelectedMessageId(null);
      setSelectedMessage(null);
      setTimeLeft("");
      setIsWarningExpiry(false);
      setCopied(false);
      setAddressDialogOpen(false);
      showToast(`${categoryLabels[newSession.inbox.category]} ${newSession.inbox.demoOnly ? "demo-only " : ""}address created`, "success");
    } catch (err: unknown) {
      console.error("Failed to initialize inbox:", err);
      const message = (err as Error).message || "Could not generate inbox";
      showToast(message, "info");
      if (options) throw err; // Keep the previous inbox and show the error in the dialog.
      setInitError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didInitializeRef.current) return;
    didInitializeRef.current = true;
    initializeInbox();
  }, [initializeInbox]);

  useEffect(() => {
    selectedMessageIdRef.current = selectedMessageId;
  }, [selectedMessageId]);

  useEffect(() => {
    if (!session?.inbox.expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expires = new Date(session.inbox.expiresAt).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft("Expired");
        setIsWarningExpiry(true);
        clearInterval(interval);
      } else {
        const minutes = Math.floor(diff / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${minutes}m ${seconds.toString().padStart(2, "0")}s`);
        setIsWarningExpiry(minutes < 10);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.inbox.expiresAt]);

  useEffect(() => {
    if (!session) return;

    const cleanupSSE = connectInboxEvents(
      session.inbox.publicId,
      session.accessSecret,
      (event) => {
        if (event.type === "message:new") {
          playNotificationChime();
          showToast("New email arrived!", "success");
          getMessages(session.inbox.publicId, session.accessSecret)
            .then((newMsgs) => {
              setMessages(newMsgs);
              if (newMsgs.length > 0 && !selectedMessageIdRef.current && !matchMedia("(max-width: 900px)").matches) {
                setSelectedMessageId(newMsgs[0].id);
              }
            })
            .catch(console.error);
        } else if (event.type === "message:deleted") {
          setMessages((prev) => prev.filter((m) => m.id !== event.payload.messageId));
          if (selectedMessageIdRef.current === event.payload.messageId) {
            setSelectedMessageId(null);
            setSelectedMessage(null);
          }
        } else if (event.type === "inbox:expired") {
          setTimeLeft("Expired");
          setIsWarningExpiry(true);
          showToast("This inbox has expired", "info");
        }
      },
      connected => {
        // Reconcile messages after a deploy/reconnection; SSE has no replay log.
        if (connected) getMessages(session.inbox.publicId, session.accessSecret).then(setMessages).catch(console.error);
      }
    );

    return cleanupSSE;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    setSelectedMessage(null);
    setReaderError(null);
    if (!session || !selectedMessageId) { setReaderLoading(false); return; }
    setReaderLoading(true);
    getMessage(session.inbox.publicId, selectedMessageId, session.accessSecret)
      .then(msg => { if (!cancelled) setSelectedMessage(msg); })
      .catch((err: unknown) => {
        if (!cancelled) setReaderError((err as Error).message || "Please try opening this message again.");
      })
      .finally(() => { if (!cancelled) setReaderLoading(false); });
    return () => { cancelled = true; };
  }, [session, selectedMessageId, readerAttempt]);

  const closeReader = () => {
    const previousId = selectedMessageId;
    setSelectedMessageId(null);
    setSelectedMessage(null);
    requestAnimationFrame(() => document.getElementById(`message-item-${previousId}`)?.focus());
  };

  const copyRecipient = async (address: string) => {
    const success = await copyTextToClipboard(address);
    showToast(success ? "Recipient address copied" : "Could not copy recipient address", success ? "success" : "info");
  };

  const handleCopy = async () => {
    if (!session?.inbox.address) return;
    const copiedToClipboard = await copyTextToClipboard(session.inbox.address);
    if (!copiedToClipboard) {
      showToast("Could not copy address", "info");
      return;
    }
    setCopied(true);
    showToast(session.inbox.address.endsWith(".test") ? "Demo-only address copied. Cannot receive real email." : "Email address copied to clipboard", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    if (!session) return;
    setIsRefreshing(true);
    try {
      const msgs = await getMessages(session.inbox.publicId, session.accessSecret);
      setMessages(msgs);
      showToast("Messages refreshed", "info");
    } catch (err: unknown) {
      showToast((err as Error).message || "Refresh failed", "info");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!session || deletingMessageId !== null) return;
    setDeletingMessageId(msgId);
    try {
      await deleteMessage(session.inbox.publicId, msgId, session.accessSecret);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      setSelectedMessageId(current => current === msgId ? null : current);
      setSelectedMessage(current => current?.id === msgId ? null : current);
      if (selectedMessageIdRef.current === msgId || selectedMessageIdRef.current === null) {
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".message-row")?.focus());
      }
      showToast("Message deleted", "info");
    } catch (err: unknown) {
      showToast((err as Error).message || "Could not delete message", "info");
    } finally {
      setDeletingMessageId(null);
    }
  };

  const handleSimulate = async () => {
    if (!session) return;
    setIsSimulating(true);
    const demoSubjects = [
      "Your verification code is 492019",
      "Welcome to CloudPlatform - confirm your email",
      "Reset your password request",
      "Order Confirmation #NZ-994821",
    ];
    const subject = demoSubjects[Math.floor(Math.random() * demoSubjects.length)];
    const success = await simulateIncomingMail(
      session.inbox.publicId,
      session.accessSecret,
      subject,
    );

    if (success) {
      showToast("Sample message added to your inbox. No real email was sent.", "success");
    } else {
      showToast("Could not add a sample message. Your inbox may have expired or reached its limit.", "info");
    }
    setIsSimulating(false);
  };

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return messages;

    return messages.filter((msg) =>
      [msg.fromName, msg.fromAddress, msg.subject, msg.preview].some((value) =>
        value?.toLowerCase().includes(query)
      )
    );
  }, [messages, searchQuery]);

  return (
    <div className={`app-shell ${drawerOpen ? "drawer-open" : ""}`}>
      <CreateAddressDialog open={addressDialogOpen} initialCategory={session?.inbox.category ?? "personal"}
        hasActiveInbox={Boolean(session)} onClose={() => {
          setAddressDialogOpen(false);
          requestAnimationFrame(() => (matchMedia("(max-width: 900px)").matches ? menuRef.current : generateAddressButtonRef.current)?.focus());
        }}
        onGenerate={options => initializeInbox(true, options)} />
      <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      <aside ref={drawerRef} id="mobile-navigation" className="sidebar" role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined} aria-label="InboxZero navigation">
        <button type="button" className="btn btn-icon drawer-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={20} /></button>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <EnvelopeSimple size={22} weight="regular" />
          </div>
          <div className="brand-copy">
            <span className="brand-name">InboxZero</span>
            <span className="brand-meta">Temporary mail</span>
          </div>
        </div>

        <button
          id="generate-new-btn"
          ref={generateAddressButtonRef}
          onClick={() => { setDrawerOpen(false); initializeInbox(true); }}
          className="btn btn-primary sidebar-generate"
          disabled={isLoading}
          title="Generate a completely new address"
        >
          <Plus size={18} weight="regular" />
          <span>Generate Address</span>
        </button>

        <nav className="sidebar-nav" aria-label="Mailbox">
          <span className="nav-label">Workspace</span>
          <button className="nav-item active" type="button" aria-current="page" onClick={() => { setSelectedMessageId(null); setDrawerOpen(false); }}>
            <Tray size={18} weight="fill" />
            <span>Inbox</span>
            <span className="badge-count" id="message-count">
              {messages.length}
            </span>
          </button>
        </nav>

        <section className="session-panel" aria-label="Active temporary inbox">
          <div className="session-heading">
            <span>{demoMode || session?.inbox.address.endsWith(".test") ? "Demo-only address" : "Active address"}</span>
            <button
              id="copy-address-btn"
              onClick={handleCopy}
              className="btn btn-icon"
              disabled={isLoading || !session}
              title="Copy address"
              aria-label={copied ? "Address copied" : "Copy email address"}
            >
              {copied ? <Check size={16} weight="bold" /> : <CopySimple size={16} />}
            </button>
          </div>

          {session && <span className="active-category">{categoryLabels[session.inbox.category ?? "personal"]}</span>}
          <div
            className={`session-address ${initError ? "error" : ""}`}
            id="active-email-address"
            title={session?.inbox.address || undefined}
          >
            {isLoading
              ? "Generating address..."
              : initError
                ? initError
                : session
                  ? session.inbox.address.split(/(@)/).map((part, index) => (
                    <Fragment key={index}>
                      {index === 2 ? <span className="address-domain">{part}</span> : part}{part === "@" && <wbr />}
                    </Fragment>
                  ))
                  : "No active address"}
          </div>

          {session?.inbox.address.endsWith(".test") && <p className="dialog-description" role="note"><strong>DEMO ONLY.</strong> Cannot send or receive real email. Do not use for signups or verification.</p>}
          <div
            className={`expiry-line ${
              timeLeft === "Expired" ? "expired" : isWarningExpiry ? "warning" : ""
            }`}
          >
            <Clock size={16} />
            <span>{!session ? "Choose a style to get started" : timeLeft === "Expired" ? "Expired" : `Expires in ${timeLeft || "60m 00s"}`}</span>
          </div>

          {initError && !isLoading && (
            <button
              id="retry-create-btn"
              onClick={() => initializeInbox(true)}
              className="btn btn-secondary retry-btn"
              title="Retry address generation"
            >
              <ArrowClockwise size={16} />
              <span>Retry</span>
            </button>
          )}
        </section>

        <div className="sidebar-spacer" />

        {simulationEnabled && <section className="simulation-panel" aria-label="Simulated messages">
          <div className="simulation-note">
            <ShieldCheck size={16} />
            <span>{demoMode ? "Demo messages only" : "Development simulation"}</span>
          </div>
          <button
            id="simulate-mail-btn"
            onClick={handleSimulate}
            disabled={isSimulating || !session}
            className="btn btn-secondary simulate-btn"
          >
            <PaperPlaneTilt size={16} />
            <span>{isSimulating ? "Adding sample..." : "Add sample message"}</span>
          </button>
        </section>}
      </aside>

      <main ref={workspaceRef} className={`mail-workspace ${selectedMessageId !== null ? "reader-open" : ""}`}>
        {(demoMode || session?.inbox.address.endsWith(".test")) && <p className="demo-banner" role="note"><strong>Portfolio demo — no real email.</strong> All .test addresses are non-deliverable. Generate a demo inbox, then add a sample message to try it.</p>}
        <div className="mobile-topbar">
          <button ref={menuRef} type="button" className="btn btn-icon" aria-label="Open navigation" aria-expanded={drawerOpen}
            aria-controls="mobile-navigation" onClick={() => setDrawerOpen(true)}><List size={23} /></button>
          <span className="brand-name">InboxZero</span>
        </div>
        <header className="mail-toolbar">
          <div className="toolbar-title">
            <h1 className="display-heading">Inbox</h1>
            <span>
              {filteredMessages.length === messages.length
                ? `${messages.length} message${messages.length === 1 ? "" : "s"}`
                : `${filteredMessages.length} of ${messages.length}`}
            </span>
          </div>

          <label className="search-box">
            <MagnifyingGlass size={18} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              type="search"
              placeholder="Search mail"
              aria-label="Search mail"
            />
          </label>

          <button
            id="refresh-btn"
            onClick={handleRefresh}
            className={`btn btn-icon toolbar-refresh ${isRefreshing ? "refreshing" : ""}`}
            disabled={isLoading || !session}
            title="Refresh mailbox"
            aria-label="Refresh mailbox"
          >
            <ArrowClockwise size={18} className={isRefreshing ? "animate-spin" : ""} />
          </button>

        </header>

        <div className="mail-content">
          <section className="message-list-pane" aria-label="Messages">
            <div className="list-heading" aria-hidden="true">
              <span>Sender</span><span>Message</span><span>Received</span>
            </div>
            {filteredMessages.length === 0 ? (
              <div className="empty-state">
                <EnvelopeSimple size={20} />
                <h2 className="display-heading">{!session ? "Your next inbox starts here" : messages.length === 0 ? "No mail yet" : "No matching mail"}</h2>
                <p>
                  {!session ? "Choose Work, School, or Personal to create a temporary address." : messages.length === 0
                    ? "Your inbox is ready. New messages will appear here automatically."
                    : "Try a different sender, subject, or preview search."}
                </p>
                {!session && <button className="btn" onClick={() => setAddressDialogOpen(true)}>Choose address style</button>}
              </div>
            ) : (
              <div className="messages-table">
                {filteredMessages.map((msg) => {
                  const isSelected = selectedMessageId === msg.id;
                  const date = new Date(msg.receivedAt);
                  const timeString = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                  return (
                    <button
                      type="button"
                      key={msg.id}
                      id={`message-item-${msg.id}`}
                      className={`message-row ${isSelected ? "active" : ""}`}
                      onClick={() => setSelectedMessageId(msg.id)}
                      aria-pressed={isSelected}
                    >
                      <span className="message-sender" title={`${msg.fromName || msg.fromAddress} · ${msg.fromAddress}`}>
                        {msg.fromName || msg.fromAddress}
                      </span>
                      <span className="message-summary">
                        <strong title={msg.subject || "(No subject)"}>{msg.subject || "(No subject)"}</strong>
                        <span>{msg.preview || "No content preview"}</span>
                      </span>
                      <span className="message-time">{timeString}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <MessageReader message={selectedMessage} selected={selectedMessageId !== null}
            loading={readerLoading} error={readerError} deleting={deletingMessageId !== null}
            recipient={session?.inbox.address ?? ""} onClose={closeReader}
            onRetry={() => setReaderAttempt(attempt => attempt + 1)}
            onDelete={handleDeleteMessage} onCopy={copyRecipient} />
        </div>
      </main>

      {toastMessage && (
        <div className="toast-container">
          <div className={`toast ${toastMessage.type}`} role="status" aria-live="polite">
            {toastMessage.type === "success" ? (
              <CheckCircle size={18} color="var(--success)" />
            ) : (
              <Info size={18} color="var(--accent)" />
            )}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
