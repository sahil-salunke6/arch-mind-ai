// Construction options for each part of the house, with typical properties (Indian practice and IS
// codes). Values are indicative: always check the supplier's data sheet and your engineer's spec.

import type { BuildingModel } from "../types";

export interface MaterialOption {
  id: string;
  name: string;
  summary: string; // one line: where it's used / why pick it
  color: string; // used by the close-up renders
  props: [string, string][];
  unit?: [number, number, number]; // masonry unit length × height × width (mm)
  thickness?: number; // layer thickness (mm)
}

export interface PartType {
  id: string;
  name: string;
  options: MaterialOption[];
}

const p = (o: MaterialOption) => o;

export const PARTS: Record<string, PartType> = {
  masonry: {
    id: "masonry", name: "Bricks / blocks", options: [
      p({ id: "red_brick", name: "Red clay brick", summary: "Traditional burnt clay brick, strong and easy to work",
        color: "#b5532e", unit: [230, 75, 110], props: [
          ["Size", "230 × 110 × 75 mm (modular: 190 × 90 × 90)"], ["Density", "1,800–1,900 kg/m³"],
          ["Compressive strength", "3.5–10 N/mm² (IS 1077)"], ["Water absorption", "12–20 %"],
          ["Thermal conductivity", "≈ 0.8 W/m·K"], ["Weight", "≈ 3.0–3.5 kg each"], ["Per m³ of wall", "≈ 500 bricks"]] }),
      p({ id: "flyash_brick", name: "Fly-ash brick", summary: "Made from power-plant ash; uniform size, less plaster",
        color: "#8f8e88", unit: [230, 75, 110], props: [
          ["Size", "230 × 110 × 75 mm"], ["Density", "1,700–1,850 kg/m³"], ["Compressive strength", "7.5–10+ N/mm² (IS 12894)"],
          ["Water absorption", "10–14 %"], ["Thermal conductivity", "≈ 0.9 W/m·K"], ["Weight", "≈ 2.6–3.0 kg each"]] }),
      p({ id: "aac_block", name: "AAC block", summary: "Light, insulating, fast to build; laid with thin-bed adhesive",
        color: "#e9e6df", unit: [600, 200, 200], props: [
          ["Size", "600 × 200 × 100–300 mm"], ["Density", "550–650 kg/m³"], ["Compressive strength", "3–4.5 N/mm² (IS 2185-3)"],
          ["Thermal conductivity", "≈ 0.16 W/m·K"], ["Weight", "≈ 14 kg (200 mm block)"], ["Fire rating", "Up to 4 hours"]] }),
      p({ id: "solid_block", name: "Solid concrete block", summary: "Heavy and strong; good for load-bearing and compound walls",
        color: "#a3a3a0", unit: [400, 200, 200], props: [
          ["Size", "400 × 200 × 100–200 mm"], ["Density", "1,900–2,100 kg/m³"], ["Compressive strength", "4–15 N/mm² (IS 2185-1)"],
          ["Thermal conductivity", "≈ 1.2 W/m·K"], ["Weight", "≈ 30–33 kg (200 mm)"]] }),
      p({ id: "hollow_block", name: "Hollow concrete block", summary: "Cheaper and lighter than solid blocks; cavities take services",
        color: "#9c9c98", unit: [400, 200, 200], props: [
          ["Size", "400 × 200 × 200 mm"], ["Density", "1,100–1,400 kg/m³ (with cavities)"],
          ["Compressive strength", "3.5–5 N/mm² (IS 2185-1)"], ["Thermal conductivity", "≈ 0.9 W/m·K"], ["Weight", "≈ 18–22 kg"]] }),
      p({ id: "cseb", name: "Compressed earth block (CSEB)", summary: "Low-carbon stabilised soil block, made on site",
        color: "#b98a5e", unit: [240, 90, 240], props: [
          ["Size", "240 × 240 × 90 mm (interlocking 290 × 140 × 90)"], ["Density", "1,700–1,900 kg/m³"],
          ["Compressive strength", "3–5 N/mm²"], ["Thermal conductivity", "≈ 0.7 W/m·K"], ["Embodied energy", "≈ 5× lower than fired brick"]] }),
    ],
  },
  mortar: {
    id: "mortar", name: "Mortar joints", options: [
      p({ id: "cm16", name: "Cement mortar 1:6", summary: "Standard for brick and block walls", color: "#cfc8bb", thickness: 10, props: [
        ["Mix", "1 cement : 6 sand"], ["Joint", "10 mm"], ["Strength", "≈ 3–5 N/mm²"]] }),
      p({ id: "cm14", name: "Cement mortar 1:4", summary: "Stronger; half-brick walls and parapets", color: "#c4bdb0", thickness: 10, props: [
        ["Mix", "1 cement : 4 sand"], ["Joint", "10 mm"], ["Strength", "≈ 7.5 N/mm²"]] }),
      p({ id: "thin_bed", name: "Thin-bed block adhesive", summary: "For AAC and precise blocks; faster, less shrinkage", color: "#dcd8cf", thickness: 3, props: [
        ["Joint", "2–3 mm"], ["Coverage", "≈ 2 bags per m³ of AAC"], ["Cure", "Ready to plaster in 24–48 h"]] }),
    ],
  },
  plaster_ext: {
    id: "plaster_ext", name: "Outside plaster", options: [
      p({ id: "cp14", name: "Cement plaster 1:4, 20 mm", summary: "Two coats, weather-proof outer finish", color: "#e3ded5", thickness: 20, props: [
        ["Mix", "1 cement : 4 sand + waterproofing admixture"], ["Thickness", "12 + 8 mm (two coats)"], ["Cure", "7 days wet curing"]] }),
      p({ id: "sand_faced", name: "Sand-faced plaster", summary: "Textured rough finish that hides cracks", color: "#d7cfbf", thickness: 20, props: [
        ["Thickness", "18–20 mm"], ["Finish", "Coarse sand sprinkled on the final coat"]] }),
    ],
  },
  plaster_int: {
    id: "plaster_int", name: "Inside plaster", options: [
      p({ id: "cp16", name: "Cement plaster 1:6, 12 mm", summary: "Standard inside finish", color: "#ebe6dd", thickness: 12, props: [
        ["Mix", "1 cement : 6 sand"], ["Thickness", "12 mm"], ["Cure", "7 days"]] }),
      p({ id: "gypsum", name: "Gypsum plaster, 11 mm", summary: "Smooth, crack-resistant, no curing needed", color: "#f4f1ea", thickness: 11, props: [
        ["Thickness", "8–13 mm"], ["Set", "Ready to paint in ~3 days"], ["Note", "Not for wet areas (toilets, outside)"]] }),
      p({ id: "pop", name: "Cement plaster + POP punning", summary: "Mirror-smooth walls for premium paint", color: "#f6f4ef", thickness: 15, props: [
        ["Layers", "12 mm cement plaster + 2–3 mm POP"], ["Note", "Interior dry areas only"]] }),
    ],
  },
  paint_ext: {
    id: "paint_ext", name: "Outside paint", options: [
      p({ id: "ext_emulsion", name: "Exterior acrylic emulsion", summary: "Washable, UV and rain resistant", color: "#efe7d6", thickness: 0.3, props: [
        ["System", "Primer + 2 coats"], ["Life", "5–8 years"]] }),
      p({ id: "texture", name: "Texture finish", summary: "Decorative roller or trowel texture", color: "#e2d6bf", thickness: 1.5, props: [
        ["System", "Primer + texture coat + topcoat"], ["Life", "8–10 years"]] }),
      p({ id: "cement_paint", name: "Cement paint", summary: "Economical, breathable", color: "#e9e4da", thickness: 0.3, props: [
        ["System", "2 coats"], ["Life", "3–4 years"]] }),
    ],
  },
  paint_int: {
    id: "paint_int", name: "Inside paint", options: [
      p({ id: "int_emulsion", name: "Interior emulsion", summary: "Washable matt or satin", color: "#f3efe8", thickness: 0.2, props: [
        ["System", "Putty + primer + 2 coats"], ["Life", "5–7 years"]] }),
      p({ id: "distemper", name: "Oil-bound distemper", summary: "Economical; not washable", color: "#f1ede4", thickness: 0.2, props: [
        ["System", "Primer + 2 coats"], ["Life", "2–3 years"]] }),
      p({ id: "luxury", name: "Luxury emulsion (sheen)", summary: "Stain-resistant, smooth sheen", color: "#f7f4ee", thickness: 0.2, props: [
        ["System", "2 putty + primer + 2 coats"], ["Life", "7–10 years"]] }),
    ],
  },
  conduit: {
    id: "conduit", name: "Electrical conduit & wires", options: [
      p({ id: "pvc20", name: "PVC conduit 20 mm", summary: "Lights, fans and 6 A sockets", color: "#f2f2f2", props: [
        ["Conduit", "Rigid PVC 20 mm, medium gauge (IS 9537-3)"], ["Wires", "FR copper 1.5 mm² (lights) / 2.5 mm² (sockets)"],
        ["Chase depth", "25–30 mm, filled with mortar"], ["Switch box", "Concealed GI box, 1.2 m (4 ft) from floor"]] }),
      p({ id: "pvc25", name: "PVC conduit 25 mm", summary: "Power points: AC, geyser, kitchen", color: "#f2f2f2", props: [
        ["Conduit", "Rigid PVC 25 mm"], ["Wires", "FR copper 4 mm² for 16–25 A circuits"], ["Chase depth", "30–35 mm"]] }),
    ],
  },
  pipe: {
    id: "pipe", name: "Water pipes", options: [
      p({ id: "cpvc", name: "CPVC 20 mm", summary: "Hot and cold water; most common today", color: "#e8d9a8", props: [
        ["Size", "20 mm (¾\"), SDR 11"], ["Temperature", "Up to 93 °C"], ["Joints", "Solvent cement"]] }),
      p({ id: "ppr", name: "PPR 20 mm", summary: "Hot and cold; heat-fused joints don't leak", color: "#7fb069", props: [
        ["Size", "20 mm, PN 16"], ["Temperature", "Up to 95 °C"], ["Joints", "Heat fusion"]] }),
      p({ id: "upvc", name: "UPVC 20 mm", summary: "Cold water only, economical", color: "#d9d9de", props: [
        ["Size", "20 mm, Sch 40"], ["Temperature", "Cold only"], ["Joints", "Solvent cement"]] }),
    ],
  },
  dpc: {
    id: "dpc", name: "Damp-proof course (DPC)", options: [
      p({ id: "pcc_dpc", name: "40 mm PCC with waterproofing", summary: "Stops ground moisture rising into walls", color: "#9aa0a6", thickness: 40, props: [
        ["Mix", "PCC 1:1.5:3 + integral waterproofing"], ["Level", "At plinth, under all walls"], ["Finish", "Two coats of hot bitumen"]] }),
    ],
  },
  lintel: {
    id: "lintel", name: "Lintel over openings", options: [
      p({ id: "rcc_lintel", name: "RCC lintel 150 mm", summary: "Carries the wall above doors and windows", color: "#8f9399", thickness: 150, props: [
        ["Concrete", "M20"], ["Steel", "2 × 10 mm bars bottom, 2 × 8 mm top, 6 mm stirrups @ 150"], ["Bearing", "150 mm each side"]] }),
    ],
  },
  floor_finish: {
    id: "floor_finish", name: "Floor finish", options: [
      p({ id: "vitrified", name: "Vitrified tiles 600 × 600", summary: "Hard-wearing, low maintenance, any room", color: "#e9e4dc", thickness: 10, props: [
        ["Size", "600 × 600 × 9–10 mm"], ["Water absorption", "< 0.5 %"], ["Joint", "2 mm with epoxy or cement grout"]] }),
      p({ id: "gvt", name: "Large vitrified 800 × 1600", summary: "Seamless look for living areas", color: "#ddd6cb", thickness: 9, props: [
        ["Size", "800 × 1600 × 9 mm"], ["Water absorption", "< 0.5 %"], ["Note", "Needs a very level bed"]] }),
      p({ id: "anti_skid", name: "Anti-skid ceramic 300 × 300", summary: "Toilets, balconies, utility", color: "#cfd8dc", thickness: 8, props: [
        ["Size", "300 × 300 × 8 mm"], ["Slip resistance", "R11"], ["Water absorption", "3–6 %"]] }),
      p({ id: "marble", name: "Marble (Makrana)", summary: "Classic, cool underfoot; needs polishing", color: "#f2efe9", thickness: 18, props: [
        ["Thickness", "15–20 mm"], ["Density", "≈ 2,700 kg/m³"], ["Care", "Re-polish every few years; stains with acids"]] }),
      p({ id: "granite", name: "Granite", summary: "Very hard; kitchens, stairs, entrances", color: "#6b6b70", thickness: 18, props: [
        ["Thickness", "15–18 mm"], ["Density", "≈ 2,650 kg/m³"], ["Water absorption", "< 0.4 %"]] }),
      p({ id: "kota", name: "Kota stone", summary: "Economical natural stone, very durable", color: "#8fa093", thickness: 25, props: [
        ["Thickness", "20–25 mm"], ["Finish", "Machine polished"]] }),
      p({ id: "laminate", name: "Wooden laminate", summary: "Warm feel for bedrooms (dry areas only)", color: "#b8875a", thickness: 8, props: [
        ["Thickness", "8–12 mm on foam underlay"], ["Note", "Not for wet areas"]] }),
    ],
  },
  floor_bed: {
    id: "floor_bed", name: "Bedding layer", options: [
      p({ id: "cm_bed", name: "Cement mortar bed 1:4", summary: "Traditional thick bed, levels uneven bases", color: "#cfc8bb", thickness: 30, props: [
        ["Thickness", "20–40 mm"], ["Mix", "1 cement : 4 sand"]] }),
      p({ id: "adhesive", name: "Tile adhesive (C2)", summary: "Thin bed, stronger bond, for large tiles", color: "#d9d5cc", thickness: 6, props: [
        ["Thickness", "3–6 mm"], ["Class", "C2 (IS 15477)"]] }),
    ],
  },
  sub_base: {
    id: "sub_base", name: "Sub-base", options: [
      p({ id: "pcc148", name: "PCC 1:4:8, 100 mm", summary: "Lean concrete over compacted filling", color: "#a7a29a", thickness: 100, props: [
        ["Mix", "1 cement : 4 sand : 8 aggregate"], ["Below", "Rammed earth / sand filling"]] }),
    ],
  },
  slab: {
    id: "slab", name: "Roof slab", options: [
      p({ id: "rcc125", name: "RCC slab 125 mm", summary: "Spans up to ~4 m", color: "#9fa3a8", thickness: 125, props: [
        ["Concrete", "M20 (1:1.5:3)"], ["Steel", "Fe500, 10 mm @ 150 c/c both ways"], ["Cover", "20 mm"]] }),
      p({ id: "rcc150", name: "RCC slab 150 mm", summary: "Longer spans or roof terraces", color: "#9fa3a8", thickness: 150, props: [
        ["Concrete", "M20 / M25"], ["Steel", "Fe500, 10 mm @ 125 c/c"], ["Cover", "20 mm"]] }),
    ],
  },
  waterproofing: {
    id: "waterproofing", name: "Roof waterproofing", options: [
      p({ id: "brickbat", name: "Brick-bat coba", summary: "Traditional; also slopes the roof and insulates", color: "#a86b4b", thickness: 110, props: [
        ["Thickness", "100–125 mm average"], ["Finish", "IPS with chequered pattern"], ["Life", "15+ years"]] }),
      p({ id: "app", name: "APP membrane 4 mm", summary: "Torch-applied bitumen sheet", color: "#3a3a40", thickness: 4, props: [
        ["Thickness", "3–4 mm"], ["Protection", "Screed or tiles on top"], ["Life", "10–15 years"]] }),
      p({ id: "acrylic", name: "Elastomeric acrylic coating", summary: "Reflective white coat, keeps rooms cooler", color: "#f4f6f7", thickness: 1, props: [
        ["Coats", "Primer + 2–3 coats"], ["Heat", "Reflects ~80 % of sunlight"], ["Life", "5–7 years"]] }),
    ],
  },
  door_frame: {
    id: "door_frame", name: "Door frame", options: [
      p({ id: "sal", name: "Sal wood frame", summary: "Strong and economical hardwood", color: "#7a5236", props: [["Section", "100 × 65 mm"], ["Treatment", "Anti-termite"]] }),
      p({ id: "teak", name: "Teak wood frame", summary: "Premium, stable, termite-resistant", color: "#8d5b34", props: [["Section", "100 × 65 mm"], ["Finish", "Polish or PU"]] }),
      p({ id: "wpc", name: "WPC frame", summary: "Water- and termite-proof; toilets and kitchens", color: "#c8b9a6", props: [["Section", "100 × 60 mm"], ["Note", "Doesn't swell in water"]] }),
    ],
  },
  door_shutter: {
    id: "door_shutter", name: "Door shutter", options: [
      p({ id: "flush", name: "Flush door 35 mm", summary: "Most common inside door; laminate or veneer", color: "#8a5a3b", props: [["Thickness", "32–35 mm"], ["Core", "Block board, BWR grade"]] }),
      p({ id: "panel_teak", name: "Teak panel door", summary: "Solid wood main door", color: "#6f4426", props: [["Thickness", "38–45 mm"], ["Weight", "40–60 kg"]] }),
      p({ id: "wpc_door", name: "WPC door", summary: "Waterproof; toilets", color: "#d8cbb8", props: [["Thickness", "30 mm"], ["Note", "No swelling or warping"]] }),
      p({ id: "upvc_door", name: "uPVC / FRP door", summary: "Economical toilet door", color: "#e6e6e6", props: [["Thickness", "25–30 mm"]] }),
    ],
  },
  window_frame: {
    id: "window_frame", name: "Window frame", options: [
      p({ id: "aluminium", name: "Aluminium sliding", summary: "Slim, economical; 2- or 3-track", color: "#b8bcc2", props: [["Section", "2-track, 1.2 mm wall"], ["Finish", "Powder coat or anodised"]] }),
      p({ id: "upvc", name: "uPVC", summary: "Best seal against dust, noise and rain", color: "#f4f4f4", props: [["Profile", "Multi-chamber with steel insert"], ["Seal", "EPDM gaskets"]] }),
      p({ id: "wood", name: "Wooden (teak/sal)", summary: "Traditional casement look", color: "#8d5b34", props: [["Section", "100 × 65 mm"], ["Finish", "Polish/paint"]] }),
    ],
  },
  glass: {
    id: "glass", name: "Glass", options: [
      p({ id: "clear5", name: "5 mm clear float", summary: "Standard windows", color: "#9fc8e6", props: [["Thickness", "5 mm"]] }),
      p({ id: "toughened", name: "6 mm toughened", summary: "Safety glass for large panes and doors", color: "#9fc8e6", props: [["Thickness", "6 mm"], ["Strength", "≈ 4–5× float glass"]] }),
      p({ id: "frosted", name: "5 mm frosted", summary: "Privacy for toilets", color: "#d6e4ec", props: [["Thickness", "5 mm"]] }),
      p({ id: "dgu", name: "Double glazed 5+12+5", summary: "Insulates against heat and noise", color: "#8fbcdc", props: [["Build-up", "5 mm + 12 mm air + 5 mm"], ["U-value", "≈ 2.8 W/m²·K"]] }),
    ],
  },
};

export type Scope =
  | { kind: "wall"; wallType: "exterior" | "interior" }
  | { kind: "room"; roomId: string }
  | { kind: "roof" }
  | { kind: "opening"; openingId: string };

export function specKey(scope: Scope, part: string): string {
  switch (scope.kind) {
    case "wall": return `wall.${scope.wallType}.${part}`;
    case "room": return `room.${scope.roomId}.${part}`;
    case "roof": return `roof.${part}`;
    case "opening": return `opening.${scope.openingId}.${part}`;
  }
}

/** Sensible defaults per part, by context (e.g. anti-skid tiles in toilets). */
export function defaultOption(part: string, ctx: { roomType?: string; wallType?: string } = {}): string {
  if (part === "floor_finish") return ["toilet", "balcony", "utility"].includes(ctx.roomType ?? "") ? "anti_skid" : ctx.roomType === "parking" ? "kota" : "vitrified";
  if (part === "mortar") return ctx.wallType === "interior" ? "cm14" : "cm16";
  return PARTS[part].options[0].id;
}

export function chosen(model: BuildingModel, scope: Scope, part: string, ctx: Parameters<typeof defaultOption>[1] = {}): MaterialOption {
  const id = model.specs?.[specKey(scope, part)] ?? defaultOption(part, ctx);
  return PARTS[part].options.find((o) => o.id === id) ?? PARTS[part].options[0];
}

export function setSpec(model: BuildingModel, scope: Scope, part: string, optionId: string): BuildingModel {
  const specs = { ...(model.specs ?? {}), [specKey(scope, part)]: optionId };
  // AAC and precise blocks go with thin-bed adhesive
  if (part === "masonry" && optionId === "aac_block") specs[specKey(scope, "mortar")] = "thin_bed";
  if (part === "masonry" && optionId !== "aac_block" && specs[specKey(scope, "mortar")] === "thin_bed") delete specs[specKey(scope, "mortar")];
  return { ...model, specs };
}
