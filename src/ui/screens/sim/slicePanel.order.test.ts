/**
 * Where the fast tier's "Use the 3-D atmosphere" button sits (0.7.0, F8 with the owner's question 6; plan 20.5): directly under the disabled chips, beside the thing it
 * explains, in both places it is offered. The DOM is not built in node, so this pins the ORDER the two panels build their children in; the real positions (the button
 * within 16 px of the last chip, wholly in view at 412 x 915, Set start, Set end, Swap and Presets in view at 412 x 915 and 390 x 844, clear of the pinned footer at
 * 360 x 640 and 844 x 390) are pinned by e2e/air-slice.spec.ts.
 *   - Air slices tool (slicePanel.ts): ONLY the button comes right after the chips, before the legend and the controls. The words of the chips that are off (`reasons`)
 *     stay where 0.6.0 had them, under the controls: the first F8 build moved the whole block, and on a 412 x 915 phone Set start then sat behind the footer and Presets
 *     was hidden (verifier, real engine: Set start at y 772 to 812 under the footer at 802, Presets at 816 to 856).
 *   - Layers panel (layersPanel.ts): its callout (`sliceNote`: the words and the button) already follows the slice chips directly; it stays there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Air slices tool', () => {
  const src = strip(read('slicePanel.ts'));

  it('builds its children with the button right after the chips and the words under the controls, as 0.6.0 had them', () => {
    const list = /h\('div', \{ class: 'slice-panel'[^)]*\}, \[([^\]]+)\]\)/.exec(src)?.[1];
    expect(list, 'the root of the panel is found').toBeTruthy();
    const order = list!.split(',').map((x) => x.trim());
    expect(order.slice(0, 7)).toEqual(['view', 'readout', 'chipRow', 'use3dRow', 'legendHost', 'controlsWrap', 'reasons']);
    expect(order.indexOf('use3dRow')).toBe(order.indexOf('chipRow') + 1);
    expect(order.indexOf('reasons'), 'the words are right after the controls, not under the chips').toBe(order.indexOf('controlsWrap') + 1);
    expect(order.indexOf('cellsToggle.el')).toBeGreaterThan(order.indexOf('reasons'));
    expect(order[order.length - 1]).toBe('footer');
  });

  it('puts only the button in its row and the words in the reasons block, and moves the legend after the controls only while there are notes', () => {
    expect(src).toMatch(/setChildren\(use3dRow, notes\.some\(\(n\) => n\.use3d\) \? button\(\{ label: SLICE_USE_3D_LABEL/);
    expect(src).toMatch(/setChildren\(reasons, h\('div', \{ id: reasonsId \}/);
    expect(src).not.toMatch(/setChildren\(reasons, \[[^\]]*button\(/); // the button is not in the words' block
    expect(src).toMatch(/root\.insertBefore\(legendHost, last \? cellsToggle\.el : controlsWrap\)/);
  });
});

describe('the Layers panel', () => {
  const src = strip(read('layersPanel.ts'));

  it('puts the section\'s 3-D callout directly after the slice chips, before the line hint and the compass', () => {
    const at = src.indexOf("dataset: { testid: 'slice-field' }");
    expect(at, 'the slice chips are found').toBeGreaterThan(0);
    const after = src.slice(at, at + 400);
    expect(after).toMatch(/\),\s*sliceNote\.el,\s*lineHint,/);
  });

  it('builds that callout with the words and the button of the Air slices tool\'s wording', () => {
    expect(src).toContain("use3dCallout('slice-diagnosed', 'use-3d-slice', DIAGNOSED_SECTION_NOTE)");
    expect(src).toMatch(/label: USE_3D_LABEL,\s*icon: 'cube'/);
  });
});
