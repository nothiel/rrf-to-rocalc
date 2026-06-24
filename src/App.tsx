import { useCallback, useRef, useState } from "react";
import { extractEquipment, type EquipmentResult } from "./rrf/extract-equipment";
import { buildRocalcPayload, rocalcPayloadToUrl } from "./rrf/build-rocalc-url";

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: "1.5rem", border: "1px solid #ccc", borderRadius: 6, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "0.6rem 0.8rem",
          background: "#f5f5f5",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          textAlign: "left",
          fontSize: "0.95rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {title}
        <span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▼</span>
      </button>
      {open && <div style={{ padding: "0.5rem" }}>{children}</div>}
    </div>
  );
}

function serializeEquipResult(equip: EquipmentResult): string {
  return JSON.stringify({
    player: equip.player,
    map: equip.map,
    sessionJob: equip.sessionJob,
    sessionBaseLevel: equip.sessionBaseLevel,
    pages: equip.pages.map((p) => ({
      timeMs: p.timeMs,
      items: p.items,
      changedSlots: p.changedSlots,
    })),
  }, null, 2);
}

export function App() {
  const [rrfJson, setRrfJson] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(null);
    setJson(null);
    setRrfJson(null);
    setError(null);
    setCopied(false);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const equip = extractEquipment(buf);
      setRrfJson(serializeEquipResult(equip));
      const payload = buildRocalcPayload(equip, 0, {
        classId: equip.sessionJob,
        baseLevel: equip.sessionBaseLevel,
      });
      setJson(JSON.stringify(payload, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file.");
    }
    e.target.value = "";
  }, []);

  const handleGenerate = useCallback(() => {
    if (!json) return;
    try {
      const payload = JSON.parse(json);
      setUrl(rocalcPayloadToUrl(payload));
      setError(null);
    } catch {
      setError("Invalid JSON.");
    }
  }, [json]);

  const handleCopy = useCallback(() => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  const btnStyle = (bg: string) => ({
    padding: "0.5rem 1.2rem",
    borderRadius: 6,
    border: "none",
    background: bg,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600 as const,
  });

  return (
    <div style={{ maxWidth: 700, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>RRF → rocalc.cc</h1>
      <p style={{ opacity: 0.7 }}>
        Upload a <code>.rrf</code> replay file to generate a rocalc.cc link with
        your equipped gear.
      </p>

      <label
        style={{
          display: "inline-block",
          ...btnStyle("#5b9bd5"),
          padding: "0.6rem 1.4rem",
        }}
      >
        Upload .rrf
        <input
          type="file"
          accept=".rrf"
          onChange={handleFile}
          style={{ display: "none" }}
        />
      </label>

      {error && (
        <p style={{ color: "#ef4444", marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {rrfJson && (
        <Accordion title="RRF extracted data (read-only)">
          <textarea
            readOnly
            value={rrfJson}
            rows={14}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: "0.8rem",
              padding: "0.5rem",
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#333",
              resize: "vertical",
              tabSize: 2,
              opacity: 0.85,
            }}
          />
        </Accordion>
      )}

      {json && (
        <Accordion title="Payload JSON (edit before generating)" defaultOpen>
          <textarea
            ref={jsonRef}
            value={json}
            onChange={(e) => { setJson(e.target.value); setUrl(null); }}
            rows={18}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: "0.8rem",
              padding: "0.5rem",
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#333",
              resize: "vertical",
              tabSize: 2,
            }}
          />
          <button onClick={handleGenerate} style={{ ...btnStyle("#5b9bd5"), marginTop: "0.5rem" }}>
            Generate link
          </button>
        </Accordion>
      )}

      {url && (
        <div style={{ marginTop: "1.5rem" }}>
          <label style={{ fontWeight: 600, display: "block", marginBottom: "0.3rem" }}>
            rocalc.cc URL
          </label>
          <textarea
            readOnly
            value={url}
            rows={3}
            style={{
              width: "100%",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              padding: "0.5rem",
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#fff",
              color: "#333",
              resize: "vertical",
            }}
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={handleCopy}
            style={{ ...btnStyle(copied ? "#22c55e" : "#5b9bd5"), marginTop: "0.5rem" }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
