import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, CaretLeft, CopySimple, EnvelopeSimple, Trash } from "@phosphor-icons/react";
import type { MessageDetail } from "./types";

function MailAddress({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  return at < 0 ? <>{address}</> : <>{address.slice(0, at + 1)}<wbr />
    <span className="mail-address-domain">{address.slice(at + 1)}</span></>;
}

/** The API sanitizes stored HTML. Scripts, forms and top navigation remain
 * sandboxed. Same-origin access is used only to measure the document; we never
 * insert shell CSS, fonts, or scripts into the sender's document. */
function EmailDocument({ message }: { message: MessageDetail }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(280);
  const container = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 0, scale: 1 });
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    const measure = () => {
      const body = element.contentDocument?.body;
      if (!body || disposed) return;
      const available = container.current?.clientWidth || element.clientWidth;
      const mobile = matchMedia("(max-width: 900px)").matches;
      // Scale fixed-width email templates as a whole, preserving sender styles.
      element.style.width = `${available}px`;
      const naturalWidth = Math.max(available, body.scrollWidth, element.contentDocument?.documentElement.scrollWidth || 0);
      const width = mobile ? naturalWidth : available;
      element.style.width = `${width}px`;
      setLayout({ width, scale: mobile ? Math.min(1, available / width) : 1 });
      const style = getComputedStyle(body);
      const naturalHeight = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)
        + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0));
      setHeight(Math.max(280, naturalHeight));
    };
    const loaded = () => {
      observer?.disconnect();
      const doc = element.contentDocument;
      if (!doc?.body) return;
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      doc.querySelectorAll("img").forEach(image => image.addEventListener("load", measure, { once: true }));
      void doc.fonts.ready.then(measure);
      measure();
    };
    const containerObserver = new ResizeObserver(measure);
    if (container.current) containerObserver.observe(container.current);
    element.addEventListener("load", loaded);
    loaded();
    return () => { disposed = true; observer?.disconnect(); containerObserver.disconnect(); element.removeEventListener("load", loaded); };
  }, [message.htmlBody]);
  return <div ref={container} style={{ height: height * layout.scale, overflow: "hidden" }}><iframe ref={frame} title="Email content" className="email-iframe"
    style={{ height, width: layout.width || "100%", transform: `scale(${layout.scale})`, transformOrigin: "top left" }} sandbox="allow-same-origin allow-popups" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">${message.htmlBody!}`} /></div>;
}

export function MessageReader({ message, selected, loading, error, deleting, recipient, onClose, onRetry, onDelete, onCopy }: {
  message: MessageDetail | null; selected: boolean; loading: boolean; error: string | null;
  deleting: boolean; recipient: string; onClose: () => void; onRetry: () => void;
  onDelete: (id: number) => void; onCopy: (address: string) => Promise<void>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo(0, 0);
    if (message && matchMedia("(max-width: 900px)").matches) heading.current?.focus({ preventScroll: true });
  }, [message?.id]);
  const from = message?.fromName || message?.fromAddress || "Unknown sender";
  const date = message ? new Date(message.receivedAt) : null;
  return <section className="reader-pane" aria-label="Message reader" aria-busy={loading}>
    <div className="reader-toolbar">
      {selected ? <button type="button" className="btn btn-icon reader-close" onClick={onClose}
        aria-label="Back to inbox" title="Back to inbox"><CaretLeft size={18} /></button> : null}
      <span className="reader-toolbar-label">{selected ? "Message" : "Message reader"}</span>
      {message && !loading && !error ? <button id="delete-msg-btn" type="button" className="btn btn-icon"
        disabled={deleting} aria-label={deleting ? "Deleting message" : "Delete message"}
        title="Delete message" onClick={() => onDelete(message.id)}>
        {deleting ? <ArrowClockwise size={18} className="animate-spin" /> : <Trash size={18} />}
      </button> : null}
    </div>
    {loading ? <div className="reader-state" role="status"><ArrowClockwise size={20} className="animate-spin" />
      <h2 className="display-heading">Opening your message</h2><p>Loading the sender details and email content.</p></div>
      : error ? <div className="reader-state" role="alert"><h2 className="display-heading">Unable to open message</h2>
        <p>{error}</p><button className="btn" onClick={onRetry}><ArrowClockwise size={16} />Try again</button></div>
      : !message ? <div className="reader-state reader-empty"><EnvelopeSimple size={22} aria-hidden="true" />
        <h2 className="display-heading">A little room to read</h2><p>Select a message from your inbox. The full conversation starts here.</p></div>
      : <div ref={scroll} className="reader-scroll" tabIndex={0} aria-label="Message details and content">
        <div className="reader-content">
          <header className="reader-header">
            <h2 ref={heading} tabIndex={-1} className="reader-subject">{message.subject || "(No subject)"}</h2>
            <div className="reader-meta">
              <div className="avatar-initial" aria-hidden="true">{from.charAt(0).toUpperCase()}</div>
              <div className="sender-info"><span className="sender-display-name">{from}</span>
                <span className="sender-address" title={message.fromAddress}><MailAddress address={message.fromAddress} /></span>
                <div className="message-facts">
                  <time dateTime={message.receivedAt} title={date?.toLocaleString()}>{date?.toLocaleString(undefined, {
                    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                  })}</time>
                  {Number.isFinite(message.sizeBytes) && <span>{message.sizeBytes < 1024 ? `${message.sizeBytes} B` : `${(message.sizeBytes / 1024).toFixed(1)} KB`}</span>}
                </div>
              </div>
            </div>
            <div className="recipient-line"><span>To</span><span className="recipient-address" title={recipient}><MailAddress address={recipient} /></span>
              {recipient && <button type="button" className="btn btn-icon recipient-copy" title="Copy recipient address"
                aria-label="Copy recipient address" onClick={() => void onCopy(recipient)}><CopySimple size={16} /></button>}
            </div>
          </header>
          <div className="reader-body">
            {message.htmlBody?.trim() ? <EmailDocument key={message.id} message={message} />
              : <div className="email-body-text">{(message.textBody || message.preview || "This message has no content.")
                .split(/(\b\d{4,8}\b)/g).map((part, index) => /^\d{4,8}$/.test(part)
                  ? <span className="verification-code" key={index}>{part}</span> : part)}</div>}
          </div>
        </div>
      </div>}
  </section>;
}
