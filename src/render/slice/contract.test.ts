/**
 * The modules of this lane against the signatures written in types.ts (the SIGNATURES block): the object below only compiles
 * while every function has exactly the name, parameters and return type the other lanes were told to code against, so a drift is
 * a type error in `tsc`, and the test checks that each is really exported at the module path the contract names.
 */
import { describe, expect, it } from 'vitest';
import type { GridSpec } from '../../core/grid';
import type { AtmosphereSampler } from '../atmosphereSampler';
import { createFlow, flowArrows, seedFlow, stepFlow, type FlowOptions, type FlowParticles } from './flow2d';
import { niceTicks } from './niceTicks';
import { moveProbe, probeAt, probeSentence, windFromDeg } from './probe';
import { resolveSlice, sectionFromEndpoints, slicePresetStatus } from './sectionLine';
import { sampleSlice } from './sliceField';
import { createSliceUpdater } from './sliceUpdater';
import type {
  CreateSliceUpdater,
  ResolvedSlice,
  SectionResult,
  SliceData,
  SliceKind,
  SliceLineState,
  SlicePoint,
  SliceProbePos,
  SliceProbeReading,
  SlicePresetId,
  SlicePresetStatus,
  SliceResolveContext,
  SliceSpeedUnit,
  SliceSpec,
  SliceTerrain,
} from './types';

interface Contract {
  sampleSlice(sampler: AtmosphereSampler, terrain: SliceTerrain, spec: SliceSpec, out?: SliceData | null): SliceData | null;
  sectionFromEndpoints(a: SlicePoint, b: SlicePoint, grid: GridSpec): SectionResult;
  resolveSlice(state: SliceLineState, ctx: SliceResolveContext): ResolvedSlice;
  slicePresetStatus(preset: SlicePresetId, ctx: SliceResolveContext): SlicePresetStatus;
  niceTicks(lo: number, hi: number, target?: number): { values: number[]; step: number };
  createFlow(count: number, seed?: number): FlowParticles;
  seedFlow(f: FlowParticles, data: SliceData): void;
  stepFlow(f: FlowParticles, data: SliceData, dtS: number, opts: FlowOptions): void;
  flowArrows(data: SliceData, nCols: number, nRows: number, exaggeration: number): { count: number; s: Float32Array; z: Float32Array; angle: Float32Array; speed: Float32Array };
  probeAt(data: SliceData, pos: SliceProbePos): SliceProbeReading;
  moveProbe(data: SliceData, pos: SliceProbePos | null, key: 'left' | 'right' | 'up' | 'down', big?: boolean): SliceProbePos;
  probeSentence(r: SliceProbeReading, opts: { units: SliceSpeedUnit; kind: SliceKind }): string;
  windFromDeg(u: number, v: number): number;
  createSliceUpdater: CreateSliceUpdater;
}

const api: Contract = {
  sampleSlice,
  sectionFromEndpoints,
  resolveSlice,
  slicePresetStatus,
  niceTicks,
  createFlow,
  seedFlow,
  stepFlow,
  flowArrows,
  probeAt,
  moveProbe,
  probeSentence,
  windFromDeg,
  createSliceUpdater,
};

describe('the lane’s exports', () => {
  it('are the functions the contract names', () => {
    expect(Object.keys(api).sort()).toEqual(
      ['createFlow', 'createSliceUpdater', 'flowArrows', 'moveProbe', 'niceTicks', 'probeAt', 'probeSentence', 'resolveSlice', 'sampleSlice', 'sectionFromEndpoints', 'seedFlow', 'slicePresetStatus', 'stepFlow', 'windFromDeg'],
    );
    for (const f of Object.values(api)) expect(typeof f).toBe('function');
  });

  it('have the parameters of the contract (a call with only the required ones works)', () => {
    expect(niceTicks(0, 100).values.length).toBeGreaterThan(0);
    expect(createFlow(3).count).toBe(3);
    expect(createSliceUpdater().latest).toBeNull();
    expect(windFromDeg(1, 0)).toBeCloseTo(270, 9);
  });
});
