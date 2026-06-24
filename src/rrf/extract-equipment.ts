/**
 * Standalone library to extract equipped items from a .rrf (Ragnarok Replay File).
 *
 * Usage:
 *   import { extractEquipment } from "./extract-equipment.js";
 *   const buf: ArrayBuffer = await file.arrayBuffer();
 *   const result = extractEquipment(buf);
 *   // result.initial  — items worn at recording start
 *   // result.pages    — timeline of equipment changes
 */

// ── Types ───────────────────────────────────────────────────────────────

export type RandomOption = { id: number; value: number; param: number };

export type InventoryRecord = {
  itemId: number;
  qty: number;
  equipped: number;
  refine: number;
  cards: [number, number, number, number];
  options: RandomOption[];
};

export type EquipChangeEvent = {
  time: number;
  slot: number;
  location: number;
  equipped: boolean;
  itemId: number;
  refine: number;
  cards: number[];
  options: RandomOption[];
};

export type EquippedItem = {
  slotOrder: number;
  slotLabel: string;
  itemId: number;
  refine: number;
  cards: number[];
  options: RandomOption[];
};

export type EquipPage = {
  timeMs: number;
  items: EquippedItem[];
  changedSlots: number[];
};

export type EquipmentResult = {
  player: string;
  map: string;
  recordedAt: Date;
  sessionJob: number;
  sessionBaseLevel: number;
  initial: EquippedItem[];
  pages: EquipPage[];
};

// ── Slot definitions (rAthena e_equip_pos) ──────────────────────────────

const EQUIP_SLOTS: Array<[bit: number, label: string]> = [
  [256, "Head Top"],
  [512, "Head Mid"],
  [1, "Head Low"],
  [16, "Armor"],
  [2, "Weapon"],
  [32, "Shield"],
  [4, "Garment"],
  [64, "Shoes"],
  [8, "Accessory L"],
  [128, "Accessory R"],
  [32768, "Ammo"],
  [1024, "Costume Head Top"],
  [2048, "Costume Head Mid"],
  [4096, "Costume Head Low"],
  [8192, "Costume Garment"],
  [65536, "Shadow Armor"],
  [131072, "Shadow Weapon"],
  [262144, "Shadow Shield"],
  [524288, "Shadow Shoes"],
  [1048576, "Shadow Acc R"],
  [2097152, "Shadow Acc L"],
];

function occupiedSlots(mask: number): Array<{ order: number; label: string }> {
  const out: Array<{ order: number; label: string }> = [];
  for (let i = 0; i < EQUIP_SLOTS.length; i++) {
    if (mask & EQUIP_SLOTS[i][0]) out.push({ order: i, label: EQUIP_SLOTS[i][1] });
  }
  if (!out.length) out.push({ order: EQUIP_SLOTS.length, label: "Other" });
  return out;
}

// ── Crypto ──────────────────────────────────────────────────────────────

type RecordedAt = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type CryptKeys = { k1: number; k2: number };

function deriveKeys(d: RecordedAt): CryptKeys {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setInt16(0, d.year, true);
  v.setUint8(2, d.month);
  v.setUint8(3, d.day);
  const k1 = v.getInt32(0, true) >> 5;
  v.setUint8(0, 0);
  v.setUint8(1, d.hour);
  v.setUint8(2, d.minute);
  v.setUint8(3, d.second);
  const k2 = v.getInt32(0, true) >> 3;
  return { k1, k2 };
}

function decrypt(data: Uint8Array, size: number, keys: CryptKeys): Uint8Array {
  const out = new Uint8Array(data.length);
  out.set(data);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const wordCount = Math.floor(size / 4);
  for (let i = 0; i < wordCount; i++) {
    view.setInt32(i * 4, view.getInt32(i * 4, true) ^ Math.imul(keys.k1 + i + 1, keys.k2), true);
  }
  return out;
}

// ── Header ──────────────────────────────────────────────────────────────

function readHeader(buf: ArrayBuffer) {
  if (buf.byteLength < 112) throw new Error("File too small.");
  const ascii = new TextDecoder("ascii").decode(new Uint8Array(buf, 0, 40));
  if (!ascii.startsWith("<< Ragnarok Replay File Version")) throw new Error("Not a .rrf file.");
  const view = new DataView(buf);
  let o = 100;
  const version = view.getUint8(o); o += 1;
  if (version !== 5) throw new Error(`Unsupported version ${version}.`);
  o += 3; // sig
  const year = view.getInt16(o, true); o += 2;
  const month = view.getUint8(o); o += 1;
  const day = view.getUint8(o); o += 1;
  o += 1; // padding
  const hour = view.getUint8(o); o += 1;
  const minute = view.getUint8(o); o += 1;
  const second = view.getUint8(o); o += 1;
  return { recordedAt: { year, month, day, hour, minute, second }, containerTableOffset: o };
}

// ── Containers ──────────────────────────────────────────────────────────

const CT_PacketStream = 1;
const CT_ReplayData = 2;
const CT_Session = 3;
const CT_Items = 8;

type GenericChunk = { id: number; data: Uint8Array };
type PacketChunk = { time: number; packetId: number; data: Uint8Array };
type Container = { type: number; chunks: GenericChunk[] } | { type: typeof CT_PacketStream; packets: PacketChunk[] };

function readContainers(buf: ArrayBuffer, tableOffset: number, keys: CryptKeys): Container[] {
  const view = new DataView(buf);
  const containers: Container[] = [];
  for (let i = 0; i < 24; i++) {
    const d = tableOffset + i * 10;
    const type = view.getUint16(d, true);
    const declaredLength = view.getInt32(d + 2, true);
    const offset = view.getInt32(d + 6, true);
    if (offset === 0 && declaredLength === 0) { containers.push({ type, chunks: [] }); continue; }
    let realLength = declaredLength || (buf.byteLength - offset);
    if (offset < 0 || offset >= buf.byteLength || offset + realLength > buf.byteLength) {
      containers.push({ type, chunks: [] }); continue;
    }
    const body = new Uint8Array(buf, offset, realLength);
    if (type === CT_PacketStream) {
      containers.push({ type, packets: parsePacketStream(body, keys) });
    } else {
      containers.push({ type, chunks: parseGeneric(body, declaredLength, keys) });
    }
  }
  return containers;
}

function parsePacketStream(body: Uint8Array, keys: CryptKeys): PacketChunk[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const out: PacketChunk[] = [];
  let p = 0;
  while (p + 10 <= body.byteLength) {
    const time = view.getInt32(p + 4, true);
    const length = view.getUint16(p + 8, true);
    const end = p + 10 + length;
    if (end > body.byteLength) break;
    const dec = decrypt(body.subarray(p + 10, end), length, keys);
    const packetId = dec.length >= 2 ? dec[0] | (dec[1] << 8) : 0;
    out.push({ time, packetId, data: dec });
    p = end;
  }
  return out;
}

function parseGeneric(body: Uint8Array, declaredLength: number, keys: CryptKeys): GenericChunk[] {
  if (declaredLength <= 0) return [];
  const dec = decrypt(body, declaredLength, keys);
  const view = new DataView(dec.buffer, dec.byteOffset, dec.byteLength);
  const out: GenericChunk[] = [];
  let p = 0;
  while (p + 6 <= declaredLength) {
    const id = view.getInt16(p, true);
    const len = view.getInt32(p + 2, true);
    if (len < 0 || p + 6 + len > dec.byteLength) break;
    out.push({ id, data: dec.subarray(p + 6, p + 6 + len) });
    p += 6 + len;
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findGeneric(containers: Container[], type: number): GenericChunk[] {
  for (const c of containers) if (c.type === type && "chunks" in c) return c.chunks;
  return [];
}

function readU32Chunk(chunks: GenericChunk[], id: number): number | null {
  const ch = chunks.find((c) => c.id === id);
  if (!ch || ch.data.byteLength < 4) return null;
  return new DataView(ch.data.buffer, ch.data.byteOffset, 4).getUint32(0, true);
}

function readStringZ(buf: Uint8Array): string {
  let end = buf.length;
  for (let i = 0; i < buf.length; i++) { if (buf[i] === 0) { end = i; break; } }
  try { return new TextDecoder("euc-kr", { fatal: true }).decode(buf.subarray(0, end)); } catch {}
  return new TextDecoder("windows-1252").decode(buf.subarray(0, end));
}

// ── Items container parser ──────────────────────────────────────────────

const ITEM_RECORD_SIZES = [221, 172] as const;
const NAMEID_OFFSET = 104;
const OPTIONS_OFFSET = 190;
const OPTIONS_TAG = 0x012d;
const MAX_OPTIONS = 5;

function readRandomOptions(view: DataView, base: number, recordSize: number): RandomOption[] {
  if (recordSize < OPTIONS_OFFSET + MAX_OPTIONS * 5) return [];
  const tag = view.getUint16(base + OPTIONS_OFFSET - 6, true);
  const len = view.getUint32(base + OPTIONS_OFFSET - 4, true);
  if (tag !== OPTIONS_TAG || len !== MAX_OPTIONS * 5) return [];
  const out: RandomOption[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const o = base + OPTIONS_OFFSET + i * 5;
    const id = view.getUint16(o, true);
    if (id === 0) continue;
    out.push({ id, value: view.getInt16(o + 2, true), param: view.getUint8(o + 4) });
  }
  return out;
}

function detectRecordSize(view: DataView, byteLength: number): number {
  const validId = (id: number) => id > 0 && id < 5_000_000;
  for (const size of ITEM_RECORD_SIZES) {
    if (byteLength < size || byteLength % size !== 0) continue;
    const count = byteLength / size;
    let anyValid = false, ok = true;
    for (let r = 0; r < count; r++) {
      const id = view.getInt32(r * size + NAMEID_OFFSET, true);
      if (id === 0) continue;
      if (!validId(id)) { ok = false; break; }
      anyValid = true;
    }
    if (ok && anyValid) return size;
  }
  return 0;
}

function readItemsContainer(chunks: GenericChunk[]): Map<number, InventoryRecord> {
  const out = new Map<number, InventoryRecord>();
  const ACTIVE = new Set([4601, 4603]);
  const SKIP = new Set([4602, 4604, 4605, 4606]);
  const sorted = [...chunks].filter((c) => !SKIP.has(c.id))
    .sort((a, b) => (ACTIVE.has(a.id) ? 0 : 1) - (ACTIVE.has(b.id) ? 0 : 1));
  for (const chunk of sorted) {
    const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
    const REC = detectRecordSize(view, chunk.data.byteLength);
    if (!REC) continue;
    let p = 0;
    while (p + REC <= chunk.data.byteLength) {
      const pos = view.getInt16(p + 22, true) - 2;
      const equipped = view.getInt32(p + 42, true);
      const qty = view.getInt16(p + 52, true);
      const cards: [number, number, number, number] = [
        view.getInt32(p + 82, true), view.getInt32(p + 86, true),
        view.getInt32(p + 90, true), view.getInt32(p + 94, true),
      ];
      const nameid = view.getInt32(p + NAMEID_OFFSET, true);
      const refine = view.getUint8(p + 134);
      if (nameid > 0 && qty > 0 && pos >= 0 && !out.has(pos)) {
        out.set(pos, { itemId: nameid, qty, equipped, refine, cards, options: readRandomOptions(view, p, REC) });
      }
      p += REC;
    }
  }
  return out;
}

// ── Packet decoders (equipment-relevant only) ───────────────────────────

const PKT_ITEM_DELETE = 0x07fa;
const PKT_ITEM_ADD = 0x0a37;
const PKT_ITEM_USE_ACK = 0x01c8;
const PKT_WEAR_EQUIP = 0x0999;
const PKT_TAKEOFF_EQUIP = 0x099a;

type EquipPacket = { time: number; slot: number; location: number; equipped: boolean; success: boolean };
type ItemAddData = { slot: number; itemId: number; amount: number; refine: number };

function decodeEquipPacket(data: Uint8Array, time: number, pktId: number): EquipPacket | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (pktId === PKT_WEAR_EQUIP && data.byteLength >= 11) {
    return { time, slot: v.getUint16(2, true) - 2, location: v.getUint32(4, true), equipped: true, success: v.getUint8(10) === 0 };
  }
  if (pktId === PKT_TAKEOFF_EQUIP && data.byteLength >= 9) {
    return { time, slot: v.getUint16(2, true) - 2, location: v.getUint32(4, true), equipped: false, success: v.getUint8(8) === 0 };
  }
  return null;
}

// ── Main extraction ─────────────────────────────────────────────────────

export function extractEquipment(buf: ArrayBuffer): EquipmentResult {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);
  const d = header.recordedAt;
  const recordedAt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute, d.second);

  // Session info
  const replayChunks = findGeneric(containers, CT_ReplayData);
  const player = replayChunks.length > 4 ? readStringZ(replayChunks[4].data) : "";
  const map = replayChunks.length > 5 ? readStringZ(replayChunks[5].data) : "";
  const sessionChunks = findGeneric(containers, CT_Session);
  const aid = readU32Chunk(sessionChunks, 1010) ?? 0;
  const job = readU32Chunk(sessionChunks, 1014) ?? 0;
  const baseLevel = readU32Chunk(sessionChunks, 1016) ?? 0;

  // Initial inventory
  const initialInventory = readItemsContainer(findGeneric(containers, CT_Items));
  const inventory = new Map<number, InventoryRecord>(
    [...initialInventory].map(([slot, rec]) => [slot, { ...rec }]),
  );

  // Walk packet stream for equip changes
  const equipChanges: EquipChangeEvent[] = [];
  const packetStream = containers.find((c): c is { type: 1; packets: PacketChunk[] } =>
    c.type === CT_PacketStream && "packets" in c,
  );
  if (packetStream) {
    for (const pkt of packetStream.packets) {
      const id = pkt.packetId;
      if (id === PKT_ITEM_DELETE && pkt.data.byteLength >= 8) {
        const v = new DataView(pkt.data.buffer, pkt.data.byteOffset, pkt.data.byteLength);
        const slot = v.getUint16(4, true) - 2;
        const amount = v.getUint16(6, true);
        const inv = inventory.get(slot);
        if (inv) inv.qty = Math.max(0, inv.qty - amount);
      } else if (id === PKT_ITEM_ADD && pkt.data.byteLength >= 11) {
        const v = new DataView(pkt.data.buffer, pkt.data.byteOffset, pkt.data.byteLength);
        const slot = v.getUint16(2, true) - 2;
        const amount = v.getUint16(4, true);
        const itemId = v.getUint32(6, true);
        const refine = v.getUint8(10);
        const existing = inventory.get(slot);
        if (existing && existing.itemId === itemId) { existing.qty += amount; }
        else { inventory.set(slot, { itemId, qty: amount, equipped: 0, refine, cards: [0, 0, 0, 0], options: [] }); }
      } else if (id === PKT_ITEM_USE_ACK && pkt.data.byteLength >= 15) {
        const v = new DataView(pkt.data.buffer, pkt.data.byteOffset, pkt.data.byteLength);
        const pktAid = v.getUint32(6, true);
        if (pktAid !== aid) continue;
        const slot = v.getUint16(2, true) - 2;
        const itemId = v.getUint32(4, true);
        const remaining = v.getUint16(10, true);
        inventory.set(slot, { itemId, qty: remaining, equipped: 0, refine: 0, cards: [0, 0, 0, 0], options: [] });
      } else if (id === PKT_WEAR_EQUIP || id === PKT_TAKEOFF_EQUIP) {
        const ep = decodeEquipPacket(pkt.data, pkt.time, id);
        if (!ep || !ep.success) continue;
        const inv = inventory.get(ep.slot);
        if (inv) {
          if (ep.equipped) inv.equipped |= ep.location;
          else inv.equipped &= ~ep.location;
        }
        equipChanges.push({
          time: ep.time,
          slot: ep.slot,
          location: ep.location,
          equipped: ep.equipped,
          itemId: inv?.itemId ?? 0,
          refine: inv?.refine ?? 0,
          cards: inv ? [...inv.cards] : [0, 0, 0, 0],
          options: inv?.options ?? [],
        });
      }
    }
  }

  // Build equipment pages
  const worn = new Map<number, EquippedItem>();
  const wear = (mask: number, itemId: number, refine: number, cards: number[], options: RandomOption[]): number[] => {
    const slots = occupiedSlots(mask);
    for (const { order, label } of slots)
      worn.set(order, { slotOrder: order, slotLabel: label, itemId, refine, cards: [...cards], options });
    return slots.map((s) => s.order);
  };
  const takeOff = (mask: number): number[] => {
    const orders = occupiedSlots(mask).map((s) => s.order);
    for (const o of orders) worn.delete(o);
    return orders;
  };

  for (const inv of initialInventory.values()) {
    if (!inv.equipped || !inv.itemId) continue;
    wear(inv.equipped, inv.itemId, inv.refine, inv.cards, inv.options);
  }
  const snapshot = (): EquippedItem[] => [...worn.values()].sort((a, b) => a.slotOrder - b.slotOrder);

  const pages: EquipPage[] = [{ timeMs: 0, items: snapshot(), changedSlots: [] }];
  const GROUP_MS = 250;
  const sorted = [...equipChanges].sort((a, b) => a.time - b.time);
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i].time;
    const changed = new Set<number>();
    let last = start;
    while (i < sorted.length && sorted[i].time - last <= GROUP_MS) {
      const c = sorted[i];
      const orders = c.equipped
        ? wear(c.location, c.itemId, c.refine, c.cards, c.options)
        : takeOff(c.location);
      for (const o of orders) changed.add(o);
      last = c.time;
      i++;
    }
    pages.push({ timeMs: start, items: snapshot(), changedSlots: [...changed] });
  }

  return { player, map, recordedAt, sessionJob: job, sessionBaseLevel: baseLevel, initial: pages[0].items, pages };
}
