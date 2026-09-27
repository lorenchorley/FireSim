/**
 * Resolves the implementations the UI runs against: the real simulation client (src/sim SimClient), 3-D view
 * (src/render SceneView) and scenario builder (src/scenario buildScenario), or the mocks.
 *
 * Real modules are found with `import.meta.glob`, so the app still builds while a module does not exist yet, and
 * are loaded lazily (code-split). If a module is missing, fails to load, lacks the expected export, or (for the
 * 3-D view) throws on construction — e.g. no WebGL2 — the mock is used instead and a warning is logged.
 */
import type { ScenarioData } from '../core/types';
import type { SceneViewApi } from '../render/api';
import type { BuildProgress, ScenarioRequest } from '../scenario/request';
import type { SimController } from '../sim/protocol';
import type { LegendProvider } from './legends';

export type BuildScenarioFn = (req: ScenarioRequest, onProgress: (p: BuildProgress) => void, signal?: AbortSignal) => Promise<ScenarioData>;

export type ModuleSource = 'real' | 'mock';

export interface Services {
  buildScenario: BuildScenarioFn;
  createController(): SimController;
  /** Create the scene view; falls back to the 2-D mock if the real one throws (reported via `sceneSource`). */
  createSceneView(container: HTMLElement): SceneViewApi;
  readonly sources: { scenario: ModuleSource; sim: ModuleSource; scene: ModuleSource };
  /** Overlay legends from the renderer, when it provides them (the UI falls back to its own). */
  legendProvider: LegendProvider | null;
}

interface SimModule {
  SimClient: new () => SimController;
}
interface RenderModule {
  SceneView: new (container: HTMLElement) => SceneViewApi;
  legendFor?: LegendProvider;
}
interface ScenarioModule {
  buildScenario: BuildScenarioFn;
}

type Loader = () => Promise<unknown>;
const simLoaders = import.meta.glob('../sim/index.ts') as Record<string, Loader>;
const renderLoaders = import.meta.glob('../render/index.ts') as Record<string, Loader>;
const scenarioLoaders = import.meta.glob('../scenario/index.ts') as Record<string, Loader>;

async function tryLoad<T>(loaders: Record<string, Loader>, key: string, check: (m: unknown) => m is T, label: string): Promise<T | null> {
  const load = loaders[key];
  if (!load) {
    console.warn(`[FireSim] ${label} is not available yet — using the mock.`);
    return null;
  }
  try {
    const m = await load();
    if (check(m)) return m;
    console.warn(`[FireSim] ${label} does not export the expected API — using the mock.`);
  } catch (e) {
    console.warn(`[FireSim] ${label} failed to load — using the mock.`, e);
  }
  return null;
}

const isSim = (m: unknown): m is SimModule => typeof (m as SimModule | null)?.SimClient === 'function';
const isRender = (m: unknown): m is RenderModule => typeof (m as RenderModule | null)?.SceneView === 'function';
const isScenario = (m: unknown): m is ScenarioModule => typeof (m as ScenarioModule | null)?.buildScenario === 'function';

/** Resolve the services. `forceMock` (URL ?mock=1) skips the real modules entirely. */
export async function loadServices(forceMock: boolean): Promise<Services> {
  const mocks = await import('./mocks');
  const [sim, render, scenario] = forceMock
    ? [null, null, null]
    : await Promise.all([
        tryLoad(simLoaders, '../sim/index.ts', isSim, 'Simulation (src/sim)'),
        tryLoad(renderLoaders, '../render/index.ts', isRender, '3-D view (src/render)'),
        tryLoad(scenarioLoaders, '../scenario/index.ts', isScenario, 'Scenario builder (src/scenario)'),
      ]);
  const sources = {
    scenario: (scenario ? 'real' : 'mock') as ModuleSource,
    sim: (sim ? 'real' : 'mock') as ModuleSource,
    scene: (render ? 'real' : 'mock') as ModuleSource,
  };
  const services: Services = {
    sources,
    legendProvider: render && typeof render.legendFor === 'function' ? render.legendFor : null,
    buildScenario: scenario ? scenario.buildScenario : mocks.mockBuildScenario,
    createController: () => (sim ? new sim.SimClient() : new mocks.MockSimController()),
    createSceneView(container: HTMLElement): SceneViewApi {
      if (render) {
        try {
          return new render.SceneView(container);
        } catch (e) {
          console.warn('[FireSim] 3-D view unavailable on this device — showing the 2-D map instead.', e);
          sources.scene = 'mock';
          services.legendProvider = null;
          container.replaceChildren();
        }
      }
      return new mocks.MockSceneView(container);
    },
  };
  return services;
}
