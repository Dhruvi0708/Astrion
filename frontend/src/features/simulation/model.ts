/**
 * ILLUSTRATIVE TOY MODEL — not a simulation.
 *
 * A deliberately simple, fully transparent set of formulas used to demonstrate how the Simulation
 * Laboratory will compare scenarios. Coefficients are invented, outputs are unitless indices, and
 * nothing here is calibrated against real data. The real simulation engine is planned.
 */
export interface ScenarioParams {
  seaLevel: number; // multiplier vs. reference rate (0.5–2)
  storm: number; // storm intensity multiplier (0.8–1.4)
  mangrove: number; // restored mangrove coverage, % of shoreline (0–60)
  drainage: number; // drainage network upgraded, % (0–100)
}

export type OutcomeKey = 'flood' | 'buffer' | 'risk';

export const OUTCOMES: Record<OutcomeKey, { label: string; description: string; better: 'lower' | 'higher' }> = {
  flood: { label: 'Flood exposure index', description: 'Relative exposure of the coastline to flooding.', better: 'lower' },
  buffer: { label: 'Ecosystem buffer index', description: 'Relative capacity of ecosystems to absorb wave energy.', better: 'higher' },
  risk: { label: 'Community risk index', description: 'Combined exposure and loss of natural buffering.', better: 'lower' },
};

export const BASELINE: ScenarioParams = { seaLevel: 1, storm: 1, mangrove: 10, drainage: 20 };

export const PARAM_SPECS: { key: keyof ScenarioParams; label: string; min: number; max: number; step: number; unit: string; hint: string }[] = [
  { key: 'seaLevel', label: 'Sea-level rise rate', min: 0.5, max: 2, step: 0.1, unit: '×', hint: 'Multiplier on a reference rate' },
  { key: 'storm', label: 'Storm intensity', min: 0.8, max: 1.4, step: 0.05, unit: '×', hint: 'Higher values weaken mangrove protection' },
  { key: 'mangrove', label: 'Mangrove restoration', min: 0, max: 60, step: 5, unit: '%', hint: 'Shoreline coverage; benefit ramps in over 4 years' },
  { key: 'drainage', label: 'Drainage upgrades', min: 0, max: 100, step: 10, unit: '%', hint: 'Share of network upgraded' },
];

export const PRESETS: { id: string; label: string; params: ScenarioParams }[] = [
  { id: 'restoration', label: 'Restoration-led', params: { ...BASELINE, mangrove: 45 } },
  { id: 'infrastructure', label: 'Infrastructure-led', params: { ...BASELINE, drainage: 80 } },
  { id: 'combined', label: 'Combined', params: { ...BASELINE, mangrove: 45, drainage: 80 } },
  { id: 'stress', label: 'High stress', params: { ...BASELINE, seaLevel: 1.6, storm: 1.3 } },
];

export const YEARS = Array.from({ length: 11 }, (_, i) => i);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The exact formulas, shown verbatim in the UI so the model can be inspected. */
export const FORMULAS = [
  'ramp(t) = min(1, t / 4)',
  'eff = clamp(1.4 − storm, 0.2, 1)',
  'flood(t) = 100 · (1 + 0.035·slr·t) · storm · (1 − 0.6·m·eff·ramp(t)) · (1 − 0.25·d)',
  'buffer(t) = 100 · (0.35 + 0.65·(m / 0.6)·ramp(t)) · (1 − 0.03·slr·t)',
  'risk(t) = 0.6·flood(t) + 0.4·(100 − buffer(t))',
];

export function runScenario(p: ScenarioParams) {
  const m = p.mangrove / 100;
  const d = p.drainage / 100;
  const eff = clamp(1.4 - p.storm, 0.2, 1);
  return YEARS.map((t) => {
    const ramp = Math.min(1, t / 4);
    const flood = 100 * (1 + 0.035 * p.seaLevel * t) * p.storm * (1 - 0.6 * m * eff * ramp) * (1 - 0.25 * d);
    const buffer = 100 * (0.35 + 0.65 * (m / 0.6) * ramp) * (1 - 0.03 * p.seaLevel * t);
    const risk = 0.6 * flood + 0.4 * (100 - buffer);
    return { t, flood, buffer, risk };
  });
}

export const ASSUMPTIONS = [
  'Effects are independent and multiplicative; real systems interact non-linearly.',
  'Mangrove benefit ramps linearly to full effect after 4 years and weakens as storm intensity rises — mirroring the sample contradiction between Sources B and D.',
  'Drainage upgrades reduce exposure by up to 25%, immediately.',
  'Sea-level rise acts linearly over a 10-year horizon.',
];

export const LIMITATIONS = [
  'Coefficients are invented for demonstration and are not derived from any evidence.',
  'Outputs are unitless indices — they cannot be read as depths, costs or probabilities.',
  'No uncertainty is modelled; real simulations will report ranges and sensitivity.',
  'The model is not connected to the knowledge graph. Graph-grounded scenarios are planned.',
];
