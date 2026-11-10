import { describe, expect, it } from 'vitest';
import {
  ADDRESS_LABEL,
  ADDRESS_PLACEHOLDER,
  ADDRESS_PROBLEM,
  CLOSED_LINK,
  CLOSED_LINK_HELP,
  CODE_LABEL,
  CODE_PLACEHOLDER,
  CONTINUE_BUSY,
  CONTINUE_FAILED,
  CONTINUE_HERE,
  cleanName,
  coresWords,
  desktopChoiceLabel,
  ENGINE_ANOTHER_COMPUTER,
  ENGINE_DESKTOP,
  ENGINE_HINT,
  ENGINE_LABEL,
  ENGINE_PROBLEM,
  ENGINE_THIS_DEVICE,
  engineWhereText,
  RESTARTED_HERE,
  RUNNING_ON_DESKTOP,
  versionProblem,
} from './desktopWords';

const ALL: string[] = [ADDRESS_LABEL, ADDRESS_PLACEHOLDER, ENGINE_DESKTOP, ENGINE_ANOTHER_COMPUTER, ...Object.values(ADDRESS_PROBLEM), versionProblem(2, 3), versionProblem(null, null), CLOSED_LINK_HELP, CONTINUE_HERE, CONTINUE_BUSY, CONTINUE_FAILED, RESTARTED_HERE, ENGINE_LABEL, ENGINE_THIS_DEVICE, CODE_LABEL, CODE_PLACEHOLDER, RUNNING_ON_DESKTOP, CLOSED_LINK, ...Object.values(ENGINE_HINT), ...Object.values(ENGINE_PROBLEM)];

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
    expect(ENGINE_PROBLEM.rateLimited).toBe('The desktop is waiting before it takes another code. Try again in about a minute.');
    expect(CONTINUE_BUSY).toBe('Starting on this device…');
    expect(CONTINUE_FAILED).toBe('This device could not start the run. Tap to try again.');
  });

  it('plain words in the voice of the app: no em dash, no jargon the person has not met, sentences end with a full stop', () => {
    // What the person types or reads on the desktop (a command-line flag, the start of an address) is not jargon of ours: the test leaves those out.
    const literal = (t: string): string => t.replace(/--[a-z][a-z-]*|\b[a-z]+:\/\//gi, '');
    for (const t of ALL) {
      expect(t, t).not.toMatch(/—|–/); // no em or en dash
      expect(literal(t), t).not.toMatch(/\b(websocket|socket|protocol|handshake|origin|payload|JSON|TLS|http|CORS|probe)\b/i);
      expect(t, t).not.toMatch(/undefined|NaN|null/);
    }
    for (const t of [...Object.values(ENGINE_HINT), ...Object.values(ENGINE_PROBLEM), ...Object.values(ADDRESS_PROBLEM), versionProblem(2, 3), CLOSED_LINK]) expect(t, t).toMatch(/[.…]$/);
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

  it('the waiting-for-a-minute sentence is its own: it does not say the code was wrong, and it says when to try again', () => {
    expect(ENGINE_PROBLEM.rateLimited).not.toBe(ENGINE_PROBLEM.refused);
    expect(ENGINE_PROBLEM.rateLimited).not.toMatch(/wrong|did not accept|invalid|error|failed/i);
    expect(ENGINE_PROBLEM.rateLimited).toContain('about a minute');
    expect(ENGINE_PROBLEM.refused).toMatch(/did not accept that code/); // the wrong-code wording is as it was
  });

  it('the chip names the desktop in two steps: "Desktop" before its code, "Desktop (NAME, N cores)" after its welcome; the app says it is another computer', () => {
    expect(ENGINE_DESKTOP).toBe('Desktop');
    expect(ENGINE_ANOTHER_COMPUTER).toBe('Desktop (another computer)');
    expect(desktopChoiceLabel(null)).toBe('Desktop');
    expect(desktopChoiceLabel(null, true)).toBe('Desktop (another computer)');
    expect(desktopChoiceLabel({ name: 'Studio PC', cores: 8 }, true)).toBe('Desktop (Studio PC, 8 cores)'); // after the welcome the name wins, typed or not
    expect(ENGINE_ANOTHER_COMPUTER.length).toBeLessThan(30); // it must fit a chip beside "This device" on a 360 px screen
  });

  it('the typed address: a label, an example, and a sentence for each way it can be wrong', () => {
    expect(ADDRESS_LABEL).toBe('Desktop address');
    expect(ADDRESS_PLACEHOLDER).toBe('192.168.1.20');
    expect(ENGINE_HINT.desktopAddress).toBe('The simulation runs on another computer on this network. Type the address and the code the desktop shows.');
    expect(Object.keys(ADDRESS_PROBLEM).sort()).toEqual(['credentials', 'empty', 'host', 'ipv6', 'path', 'port', 'scheme']);
    expect(new Set(Object.values(ADDRESS_PROBLEM)).size).toBe(7); // each its own words
    expect(ADDRESS_PROBLEM.empty).toBe(ENGINE_PROBLEM.needsAddress);
    expect(ADDRESS_PROBLEM.ipv6).toContain('[fe80::1]');
    expect(ADDRESS_PROBLEM.port).toContain('4300');
  });

  it('no desktop at the address, a desktop that will not let the app in, and no free session each say what to do', () => {
    // The words the contract names: the host must run with --lan (to be reached at all) and --allow-app (to let the app in).
    expect(ENGINE_PROBLEM.noAnswer).toContain('No desktop answered at that address.');
    expect(ENGINE_PROBLEM.noAnswer).toContain('--lan');
    expect(ENGINE_PROBLEM.noAnswer).toContain('--allow-app');
    expect(ENGINE_PROBLEM.notAllowed).toContain('--allow-app');
    expect(ENGINE_PROBLEM.notAllowed).not.toBe(ENGINE_PROBLEM.noAnswer);
    expect(ENGINE_PROBLEM.noSession).toContain('--max-sessions');
    expect(new Set([ENGINE_PROBLEM.noAnswer, ENGINE_PROBLEM.notAllowed, ENGINE_PROBLEM.refused, ENGINE_PROBLEM.unreachable, ENGINE_PROBLEM.noSession]).size).toBe(5);
  });

  it('a version mismatch says to update the app or the host, with the two numbers when it has them', () => {
    expect(versionProblem(2, 3)).toBe('This app and the desktop do not speak the same version of the link (this app speaks version 2, the desktop version 3). Update the app or the desktop host.');
    expect(versionProblem(null, null)).toBe('This app and the desktop do not speak the same version of the link. Update the app or the desktop host.');
    expect(versionProblem(2, null)).not.toContain('version 2');
    expect(versionProblem(2, 3)).toMatch(/Update the app or the desktop host\.$/);
  });

  it('the Continue action says what it is doing and what failed, in plain words, and keeps the button\'s own text short', () => {
    expect(CONTINUE_FAILED).toContain('try again');
    expect(CONTINUE_FAILED).not.toMatch(/error|exception|worker|script|chunk|network/i);
    expect(CONTINUE_BUSY.length).toBeLessThan(26); // the busy text takes the button's place and must fit beside "Details" as well
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
