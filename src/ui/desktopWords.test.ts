import { describe, expect, it } from 'vitest';
import {
  CLOSED_LINK,
  CLOSED_LINK_HELP,
  CODE_LABEL,
  CODE_PLACEHOLDER,
  CONTINUE_HERE,
  cleanName,
  coresWords,
  desktopChoiceLabel,
  ENGINE_HINT,
  ENGINE_LABEL,
  ENGINE_PROBLEM,
  ENGINE_THIS_DEVICE,
  engineWhereText,
  RESTARTED_HERE,
  RUNNING_ON_DESKTOP,
} from './desktopWords';

const ALL: string[] = [CLOSED_LINK_HELP, CONTINUE_HERE, RESTARTED_HERE, ENGINE_LABEL, ENGINE_THIS_DEVICE, CODE_LABEL, CODE_PLACEHOLDER, RUNNING_ON_DESKTOP, CLOSED_LINK, ...Object.values(ENGINE_HINT), ...Object.values(ENGINE_PROBLEM)];

describe('the words of the desktop engine are pinned (the Help entry and the README say the same in more words)', () => {
  it('the labels', () => {
    expect(ENGINE_LABEL).toBe('Engine');
    expect(ENGINE_THIS_DEVICE).toBe('This device');
    expect(CODE_LABEL).toBe('Desktop code');
    expect(RUNNING_ON_DESKTOP).toBe('Running on the desktop');
    expect(CLOSED_LINK).toBe('The desktop connection closed.');
    expect(CONTINUE_HERE).toBe('Continue on this device');
    expect(RESTARTED_HERE).toBe('Running on this device again, from the start.');
    expect(CLOSED_LINK_HELP).toBe('Tap “Continue on this device” to run this scenario again here, from the start, with the fires and changes you marked. Until then the view keeps what the desktop had computed. Or open the menu (top left) and start a new scenario.');
    expect(desktopChoiceLabel({ name: 'Studio PC', cores: 8 })).toBe('Desktop (Studio PC, 8 cores)');
    expect(desktopChoiceLabel({ name: 'Laptop', cores: 1 })).toBe('Desktop (Laptop, 1 core)');
  });

  it('what is said under the chips and next to the code box', () => {
    expect(ENGINE_HINT.device).toBe('The simulation runs on this device.');
    expect(ENGINE_HINT.desktopLink).toBe('The simulation runs on the desktop computer. The code came with the link you opened.');
    expect(ENGINE_HINT.desktopCode).toBe('The simulation runs on the desktop computer. Type the code the desktop shows.');
    expect(ENGINE_HINT.connecting).toBe('Connecting to the desktop…');
    expect(ENGINE_PROBLEM.needsCode).toBe('Type the code the desktop shows, then build again.');
    expect(ENGINE_PROBLEM.refused).toBe('The desktop did not accept that code. Check the code it shows and type it again. After several wrong tries it waits about a minute.');
    expect(ENGINE_PROBLEM.unreachable).toBe('Could not reach the desktop. Check that it is still running, then try again.');
  });

  it('plain words in the voice of the app: no em dash, no jargon the person has not met, sentences end with a full stop', () => {
    for (const t of ALL) {
      expect(t, t).not.toMatch(/—|–/); // no em or en dash
      expect(t, t).not.toMatch(/\b(websocket|socket|protocol|handshake|origin|payload|JSON|TLS|http)\b/i);
      expect(t, t).not.toMatch(/undefined|NaN|null/);
    }
    for (const t of [...Object.values(ENGINE_HINT), ...Object.values(ENGINE_PROBLEM), CLOSED_LINK]) expect(t, t).toMatch(/[.…]$/);
    // a number is "about" (the voice of content.ts): the one minute a wrong code can cost
    expect(ENGINE_PROBLEM.refused).toContain('about a minute');
  });

  it('the action is said the same way everywhere, and the help line leads with it', () => {
    expect(CLOSED_LINK_HELP.startsWith(`Tap “${CONTINUE_HERE}”`)).toBe(true);
    expect(RESTARTED_HERE).toContain('again');
    expect(RESTARTED_HERE).toContain('from the start');
    expect(CONTINUE_HERE.length).toBeLessThan(26); // it must fit its button beside "Details" on a 360 px phone
  });

  it('the wrong-code sentence says what to do and does not blame the person', () => {
    expect(ENGINE_PROBLEM.refused).toMatch(/Check the code/);
    expect(ENGINE_PROBLEM.refused).not.toMatch(/wrong code!|invalid|error|failed/i);
  });
});

describe('a computer name is text the page may show', () => {
  it('one short line: control characters and line breaks go, a long name is cut with an ellipsis', () => {
    expect(cleanName('Studio PC')).toBe('Studio PC');
    expect(cleanName('  Studio\n\tPC\u0007 ')).toBe('Studio PC');
    expect(cleanName('a'.repeat(100))).toHaveLength(40);
    expect(cleanName('a'.repeat(100)).endsWith('…')).toBe(true);
    expect(cleanName('')).toBe('this computer');
    expect(cleanName('\n\u0000')).toBe('this computer');
    expect(desktopChoiceLabel({ name: 'b'.repeat(80), cores: 16 }).length).toBeLessThan(50); // it must fit a chip on a 360 px screen
  });

  it('markup in a name is only ever text (the rows use textContent, so this stays a string)', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('cores in words', () => {
    expect(coresWords(1)).toBe('1 core');
    expect(coresWords(2)).toBe('2 cores');
    expect(coresWords(16)).toBe('16 cores');
  });
});

describe('the engine row of the debug statistics', () => {
  const run = { name: 'Studio PC', cores: 8, node: 'v22.11.0', rttMs: 4.2, closed: false };
  it('names the computer, its cores, Node and the link in ms', () => {
    expect(engineWhereText(run)).toBe('Desktop Studio PC, 8 cores, Node v22.11.0, link 4.2 ms');
    expect(engineWhereText({ ...run, rttMs: 17.4 })).toBe('Desktop Studio PC, 8 cores, Node v22.11.0, link 17 ms');
    expect(engineWhereText({ ...run, rttMs: null })).toBe('Desktop Studio PC, 8 cores, Node v22.11.0, link not measured yet');
    expect(engineWhereText({ ...run, rttMs: Number.NaN })).toBe('Desktop Studio PC, 8 cores, Node v22.11.0, link not measured yet');
    expect(engineWhereText({ ...run, closed: true })).toBe('Desktop Studio PC, 8 cores, Node v22.11.0 (the connection closed)');
    expect(engineWhereText({ ...run, closed: true, restarted: true })).toBe('This device (the run was started again here, from the start, after the desktop connection closed)');
  });
});
