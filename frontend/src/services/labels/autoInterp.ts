/**
 * Auto-interpretation label types and utilities
 */

export type LabelMode = 'autointerp' | 'clerp' | 'manual';

export interface AutoInterpLabel {
  id: string;
  text: string;
  confidence: number;
  source: LabelMode;
}
