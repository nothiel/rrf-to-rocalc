/**
 * Build a rocalc.cc URL from an .rrf equipment extraction.
 *
 * Usage:
 *   import { extractEquipment } from "./extract-equipment.js";
 *   import { buildRocalcUrl } from "./build-rocalc-url.js";
 *   const equip = extractEquipment(buf);
 *   const url = buildRocalcUrl(equip);
 */

import type { EquipmentResult, EquippedItem, RandomOption } from "./extract-equipment";

// ── Slot order → rocalc short-key prefix (URL JSON format) ──────────────
// The URL uses short keys: w=weapon, hu=headUpper, etc.
// Cards: weapons use c1/c2/c3/c4; other gear uses c for cards[0].
// Enchants: weapons use we0/we1/we2/we3; other gear uses e1/e2/e3.
// Costumes and shadow gear have unique enchant field names.

const SLOT_PREFIX: Record<number, string> = {
  0: "hu", 1: "hm", 2: "hl", 3: "ar", 4: "w", 5: "sh",
  6: "ga", 7: "bo", 8: "ar2", 9: "al", 10: "am",
  11: "cenu", 12: "cenm", 13: "cenl", 14: "ceng",
  15: "sa", 16: "sw", 17: "ss", 18: "sb", 19: "se", 20: "sp",
};

// Costume enchant keys from rocalc source. Each costume slot maps its
// card-array enchants directly to these keys (no item ID needed).
const COSTUME_ENCHANT_KEYS: Record<number, string[]> = {
  11: ["cenu", "cenu2"],                  // Costume Upper
  12: ["cenm"],                            // Costume Middle
  13: ["cenl"],                            // Costume Lower
  14: ["ceng", "ceng2", "ceng4"],          // Costume Garment
};

const COSTUME_SLOTS = new Set([11, 12, 13, 14]);

function buildEquipFields(item: EquippedItem): Record<string, unknown> {
  const prefix = SLOT_PREFIX[item.slotOrder];
  if (!prefix) return {};

  const fields: Record<string, unknown> = {};

  if (COSTUME_SLOTS.has(item.slotOrder)) {
    // Costumes: no item ID in URL, enchants go directly to dedicated keys.
    // Non-zero card values are assigned to keys in order (skipping zeros).
    const keys = COSTUME_ENCHANT_KEYS[item.slotOrder] ?? [];
    let keyIdx = 0;
    for (let i = 0; i < item.cards.length && keyIdx < keys.length; i++) {
      if (item.cards[i] === 0) continue;
      fields[keys[keyIdx++]] = item.cards[i];
    }
    return fields;
  }

  fields[prefix] = item.itemId;
  if (item.refine > 0) fields[`${prefix}r`] = item.refine;

  if (item.slotOrder === 4 || item.slotOrder === 5) {
    // Weapon/shield: cards → c1..c4 then enchants → we1..we3 / she1..she3
    const cPrefix = item.slotOrder === 4 ? "wc" : "shc";
    const ePrefix = item.slotOrder === 4 ? "we" : "she";
    const maxCards = item.slotOrder === 4 ? 4 : 1;
    let cardIdx = 0;
    for (let i = 0; i < item.cards.length; i++) {
      if (item.cards[i] === 0) continue;
      if (cardIdx < maxCards) {
        fields[maxCards === 1 ? `${prefix}c` : `${cPrefix}${cardIdx + 1}`] = item.cards[i];
        cardIdx++;
      } else {
        fields[`${ePrefix}${i - maxCards + 1}`] = item.cards[i];
      }
    }
  } else {
    // Normal gear: cards[0] → {prefix}c, cards[1..3] → {prefix}e1..e3
    // Armor (slotOrder 3) stores enchants in reverse order in the rrf.
    const reverseEnchants = item.slotOrder === 3;
    for (let i = 0; i < item.cards.length; i++) {
      if (item.cards[i] === 0) continue;
      if (i === 0) fields[`${prefix}c`] = item.cards[i];
      else fields[`${prefix}e${reverseEnchants ? 4 - i : i}`] = item.cards[i];
    }
  }

  return fields;
}

// ── Random option ID → rocalc short key ────────────────────────────────
// rocalc uses short string keys like "atk", "p_element_undead", "acd", etc.
// This maps the rAthena random-option IDs to those keys.

// rAthena random-option ID → rocalc property key.
// Left side: randomopt.json ID. Right side: rocalc.cc bonus key (from source).
// Cross-referenced against public/db/randomopt.json descriptions.
const OPTION_KEY: Record<number, string> = {
  // --- Basic stats ---
  1: "mhp",   // HP máx. +%d
  2: "msp",   // SP máx. +%d
  3: "str", 4: "agi", 5: "vit", 6: "int", 7: "dex", 8: "luk",
  // 9: HP máx. +%d%% — no direct rocalc key
  // 10: SP máx. +%d%% — no direct rocalc key
  15: "aspd",  // Velocidade de ataque +%d
  17: "atk",   // ATQ +%d
  18: "hit",   // Precisão +%d
  19: "matk",  // ATQM +%d
  20: "def",   // DEF +%d
  21: "mdef",  // DEFM +%d
  22: "flee",  // Esquiva +%d
  24: "cri",   // CRIT +%d

  // --- Physical damage vs element ---
  37: "p_element_neutral",  // Dano físico contra Neutro
  39: "p_element_water",    // Dano físico contra Água
  41: "p_element_earth",    // Dano físico contra Terra
  43: "p_element_fire",     // Dano físico contra Fogo
  45: "p_element_wind",     // Dano físico contra Vento
  47: "p_element_poison",   // Dano físico contra Veneno
  49: "p_element_holy",     // Dano físico contra Sagrado
  51: "p_element_dark",     // Dano físico contra Sombrio
  53: "p_element_ghost",    // Dano físico contra Fantasma
  55: "p_element_undead",   // Dano físico contra Maldito

  // --- Magical damage vs element ---
  57: "m_element_neutral",
  59: "m_element_water",
  61: "m_element_earth",
  63: "m_element_fire",
  65: "m_element_wind",
  67: "m_element_poison",
  69: "m_element_holy",
  71: "m_element_dark",     // Dano mágico contra Sombrio
  73: "m_element_ghost",
  75: "m_element_undead",

  // --- Physical damage vs race ---
  97: "p_race_formless", 98: "p_race_undead", 99: "p_race_brute",
  100: "p_race_plant", 101: "p_race_insect", 102: "p_race_fish",
  103: "p_race_demon", 104: "p_race_demihuman", 105: "p_race_angel",
  106: "p_race_dragon",

  // --- Magical damage vs race ---
  107: "m_race_formless", 108: "m_race_undead", 109: "m_race_brute",
  110: "m_race_plant", 111: "m_race_insect", 112: "m_race_fish",
  113: "m_race_demon", 114: "m_race_demihuman", 115: "m_race_angel",
  116: "m_race_dragon",

  // --- Ignore physical DEF by race ---
  127: "p_pene_race_formless", 128: "p_pene_race_undead", 129: "p_pene_race_brute",
  130: "p_pene_race_plant", 131: "p_pene_race_insect", 132: "p_pene_race_fish",
  133: "p_pene_race_demon", 134: "p_pene_race_demihuman", 135: "p_pene_race_angel",
  136: "p_pene_race_dragon",

  // --- Ignore magical DEF by race ---
  137: "m_pene_race_formless", 138: "m_pene_race_undead", 139: "m_pene_race_brute",
  140: "m_pene_race_plant", 141: "m_pene_race_insect", 142: "m_pene_race_fish",
  143: "m_pene_race_demon", 144: "m_pene_race_demihuman", 145: "m_pene_race_angel",
  146: "m_pene_race_dragon",

  // --- Damage / penetration by class (normal/boss) ---
  147: "p_class_normal",      // Dano físico contra alvo Normal
  148: "p_class_boss",        // Dano físico contra Chefes
  151: "m_class_normal",      // Dano mágico contra alvo Normal
  152: "m_class_boss",        // Dano mágico contra Chefes
  153: "p_pene_class_normal", // Ignora DEF de alvo Normal
  154: "p_pene_class_boss",   // Ignora DEF de Chefes
  155: "m_pene_class_normal", // Ignora DEFM de alvo Normal
  156: "m_pene_class_boss",   // Ignora DEFM de Chefes

  // --- Size ---
  157: "p_size_s",  // Dano físico contra Pequenos
  158: "p_size_m",  // Dano físico contra Médios
  159: "p_size_l",  // Dano físico contra Grandes
  163: "ignore_size_penalty", // Anula penalidade de tamanho
  187: "m_size_s",  // Dano mágico contra Pequenos
  188: "m_size_m",  // Dano mágico contra Médios
  189: "m_size_l",  // Dano mágico contra Grandes

  // --- Special ---
  164: "criDmg", // Dano crítico +%d%%
  166: "range",  // Dano físico a distância +%d%%
  170: "vct",    // Conjuração variável -%d%%
  171: "acd",    // Pós-conjuração -%d%% (After Cast Delay)
  204: "range",  // Dano físico a distância +%d%% (duplicate/4th job)
  219: "melee",  // Dano físico corpo a corpo +%d%%

  // --- Human/Doram race (4th job era) ---
  208: "p_race_demihuman",     // Dano físico contra Humano
  210: "m_race_demihuman",     // Dano mágico contra Humano
  214: "p_pene_race_demihuman", // Ignora DEF de Humano
  216: "m_pene_race_demihuman", // Ignora DEFM de Humano

  // --- 4th job stats ---
  243: "pow", 244: "sta", 245: "wis", 246: "spl", 247: "con", 248: "crt",
  249: "patk",   // P.ATQ
  250: "smatk",  // S.ATQM
  251: "res",    // TEN (Tenacity/RES)
  252: "mres",   // MTEN (Magic RES)
  253: "hplus",  // C.Mais (H.PLUS)
  254: "crate",  // T.CRÍT (CRATE)
};

// The `o` array in rocalc has 30 positional slots. Each equipment type owns
// a fixed range. Verified against a known-good rocalc URL:
//   [0-2]   Weapon (3)      [3-4]  Head Upper (2)  [5-6]   Head Mid (2)
//   [7-8]   Head Lower (2)  [9-10] Armor (2)       [11]    Shield (1)
//   [12-13] Garment (2)     [14-15] Boots (2)      [16-17] Acc L (2)
//   [18-19] Acc R (2)       [20] Shadow Armor       [21] Shadow Weapon
//   [22] Shadow Shield      [23] Shadow Shoes       [24] Shadow Acc R
//   [25] Shadow Acc L       [26-27] Costume Upper (2)
//   [28-29] Costume Garment (2)

// Exact positions from rocalc source enum (chunk-J4ZKM7NR.js):
//   W_Left_1=0  W_Left_2=1  W_Left_3=2      (weapon/left weapon)
//   W_Right_1=3 W_Right_2=4 W_Right_3=5     (right weapon / dual wield)
//   Shield_1=6  Shield_2=7
//   H_Upper_1=8 H_Upper_2=9
//   H_Mid_1=10  H_Mid_2=11
//   Armor_1=12  Armor_2=13  Armor_3=28
//   Garment_1=14 Garment_2=15
//   A_Right_1=16 A_Right_2=17
//   A_Left_1=18  A_Left_2=19
//   SD_Wp_1=20  SD_Ar_1=21  SD_Sh_1=22
//   SD_B_1=23   SD_Ear_1=24 SD_Pan_1=25
//   X_HP=26     X_SP=27
const SLOT_OPTION_INDICES: Record<number, number[]> = {
  4: [0, 1, 2],    // Weapon (W_Left_1..3)
  5: [6, 7],       // Shield (Shield_1..2)
  0: [8, 9],       // Head Upper (H_Upper_1..2)
  1: [10, 11],     // Head Mid (H_Mid_1..2)
  3: [12, 13, 28], // Armor (Armor_1..3)
  6: [14, 15],     // Garment (Garment_1..2)
  8: [16, 17],     // Acc Right (A_Right_1..2) — bit 8 = EQP_ACC_R
  9: [18, 19],     // Acc Left (A_Left_1..2) — bit 128 = EQP_ACC_L
  16: [20],        // Shadow Weapon (SD_Wp_1)
  15: [21],        // Shadow Armor (SD_Ar_1)
  17: [22],        // Shadow Shield (SD_Sh_1)
  18: [23],        // Shadow Boots (SD_B_1)
  19: [24],        // Shadow Earring (SD_Ear_1)
  20: [25],        // Shadow Pendant (SD_Pan_1)
};

function formatOption(opt: RandomOption): string | null {
  const key = OPTION_KEY[opt.id];
  if (!key) return null;
  return `${key}:${opt.value}`;
}

// ── Public API ──────────────────────────────────────────────────────────

export type RocalcOverrides = {
  /** Job/class ID. If not provided, defaults to 0 (Novice). */
  classId?: number;
  /** Base level. Defaults to 1. */
  baseLevel?: number;
  /** Job level. Defaults to 1. */
  jobLevel?: number;
  /** Stats [STR, AGI, VIT, INT, DEX, LUK]. Defaults to all 1. */
  stats?: [number, number, number, number, number, number];
  /** Trait stats [POW, STA, WIS, SPL, CON, CRT]. Defaults to all 0. */
  traits?: [number, number, number, number, number, number];
};

/**
 * Build a rocalc.cc shareable URL from extracted .rrf equipment.
 *
 * @param equip   Output of `extractEquipment()`
 * @param pageIdx Which equipment page to export (0 = recording start)
 * @param overrides Optional character stats the .rrf doesn't carry
 */
export function buildRocalcPayload(
  equip: EquipmentResult,
  pageIdx = 0,
  overrides: RocalcOverrides = {},
): Record<string, unknown> {
  const page = equip.pages[Math.min(pageIdx, equip.pages.length - 1)];

  // Equipment fields. Skip shield slot if it's a two-handed weapon duplicate.
  const e: Record<string, unknown> = {};
  const weaponItem = page.items.find((it) => it.slotOrder === 4);
  for (const item of page.items) {
    if (item.slotOrder === 5 && weaponItem && item.itemId === weaponItem.itemId) continue;
    Object.assign(e, buildEquipFields(item));
  }

  // Random options array (30 slots, null-filled).
  // Deduplicate by itemId so two-handed weapons (which occupy both weapon
  // and shield slots) don't place the same options twice.
  const o: (string | null)[] = new Array(30).fill(null);
  const seenOptionItems = new Set<number>();
  for (const item of page.items) {
    const indices = SLOT_OPTION_INDICES[item.slotOrder];
    if (!indices || !item.options.length) continue;
    if (seenOptionItems.has(item.itemId)) continue;
    seenOptionItems.add(item.itemId);
    for (let i = 0; i < item.options.length && i < indices.length; i++) {
      const formatted = formatOption(item.options[i]);
      if (formatted) o[indices[i]] = formatted;
    }
  }

  const payload = {
    c: overrides.classId ?? 0,
    l: overrides.baseLevel ?? 1,
    j: overrides.jobLevel ?? 1,
    s: overrides.stats ?? [1, 1, 1, 1, 1, 1],
    t: overrides.traits ?? [0, 0, 0, 0, 0, 0],
    e,
    sk: { a: "", ac: [], pa: [], bu: [] },
    co: { items: [], items2: [], potion: 0, potions: [] },
    o,
    v: "1.0",
  };

  return payload;
}

/**
 * Compress a rocalc payload object into a shareable URL.
 */
export function rocalcPayloadToUrl(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const compressed = lzCompressToEncodedURIComponent(json);
  return `https://www.rocalc.cc/#/#/v1_${compressed}`;
}

/**
 * Build a rocalc.cc shareable URL from extracted .rrf equipment.
 */
export function buildRocalcUrl(
  equip: EquipmentResult,
  pageIdx = 0,
  overrides: RocalcOverrides = {},
): string {
  return rocalcPayloadToUrl(buildRocalcPayload(equip, pageIdx, overrides));
}

/**
 * Convenience: build a rocalc URL using session info from the replay for
 * class and base level (the two fields the .rrf actually carries).
 */
export function buildRocalcUrlFromReplay(
  equip: EquipmentResult,
  sessionJob: number,
  sessionBaseLevel: number,
  pageIdx = 0,
): string {
  return buildRocalcUrl(equip, pageIdx, {
    classId: sessionJob,
    baseLevel: sessionBaseLevel,
  });
}

// ── Inline lz-string compressToEncodedURIComponent ─────────────────────
// Minimal self-contained implementation so we don't need the npm package.

const URI_KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";

function lzCompressToEncodedURIComponent(input: string): string {
  if (!input) return "";
  return _compress(input, 6, (a: number) => URI_KEY.charAt(a));
}

function _compress(uncompressed: string, bitsPerChar: number, getCharFromInt: (i: number) => string): string {
  let i: number;
  let value: number;
  const context_dictionary: Record<string, number> = {};
  const context_dictionaryToCreate: Record<string, boolean> = {};
  let context_c = "";
  let context_wc = "";
  let context_w = "";
  let context_enlargeIn = 2;
  let context_dictSize = 3;
  let context_numBits = 2;
  let context_data_string = "";
  let context_data_val = 0;
  let context_data_position = 0;

  for (let ii = 0; ii < uncompressed.length; ii++) {
    context_c = uncompressed.charAt(ii);
    if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
      context_dictionary[context_c] = context_dictSize++;
      context_dictionaryToCreate[context_c] = true;
    }

    context_wc = context_w + context_c;
    if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
      context_w = context_wc;
    } else {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data_string += getCharFromInt(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 8; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data_string += getCharFromInt(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          value = 1;
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data_string += getCharFromInt(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 16; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data_string += getCharFromInt(context_data_val);
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data_string += getCharFromInt(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
      context_dictionary[context_wc] = context_dictSize++;
      context_w = String(context_c);
    }
  }

  if (context_w !== "") {
    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
      if (context_w.charCodeAt(0) < 256) {
        for (i = 0; i < context_numBits; i++) {
          context_data_val = context_data_val << 1;
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data_string += getCharFromInt(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
        }
        value = context_w.charCodeAt(0);
        for (i = 0; i < 8; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data_string += getCharFromInt(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      } else {
        value = 1;
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | value;
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data_string += getCharFromInt(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = 0;
        }
        value = context_w.charCodeAt(0);
        for (i = 0; i < 16; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data_string += getCharFromInt(context_data_val);
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
      delete context_dictionaryToCreate[context_w];
    } else {
      value = context_dictionary[context_w];
      for (i = 0; i < context_numBits; i++) {
        context_data_val = (context_data_val << 1) | (value & 1);
        if (context_data_position === bitsPerChar - 1) {
          context_data_position = 0;
          context_data_string += getCharFromInt(context_data_val);
          context_data_val = 0;
        } else {
          context_data_position++;
        }
        value = value >> 1;
      }
    }
    context_enlargeIn--;
    if (context_enlargeIn === 0) {
      context_enlargeIn = Math.pow(2, context_numBits);
      context_numBits++;
    }
  }

  // Mark the end of the stream
  value = 2;
  for (i = 0; i < context_numBits; i++) {
    context_data_val = (context_data_val << 1) | (value & 1);
    if (context_data_position === bitsPerChar - 1) {
      context_data_position = 0;
      context_data_string += getCharFromInt(context_data_val);
      context_data_val = 0;
    } else {
      context_data_position++;
    }
    value = value >> 1;
  }

  // Flush
  // eslint-disable-next-line no-constant-condition
  while (true) {
    context_data_val = context_data_val << 1;
    if (context_data_position === bitsPerChar - 1) {
      context_data_string += getCharFromInt(context_data_val);
      break;
    } else {
      context_data_position++;
    }
  }
  return context_data_string;
}
