/**
 * Content script injected into the active tab to replay workflow steps.
 * Listens for step execution messages from the service worker and
 * performs DOM actions directly in the page.
 */

import type { Locator, WorkflowStep } from '@routineflow/shared-types';

// ---- Element resolution ----

function findByLocator(loc: Locator): Element | null {
  switch (loc.kind) {
    case 'role': {
      const candidates = document.querySelectorAll(`[role="${loc.role}"]`);
      for (const el of candidates) {
        if (matchesName(el, loc.name)) return el;
      }
      const implicit: Record<string, string[]> = {
        button: ['button', 'input[type="button"]', 'input[type="submit"]'],
        link: ['a[href]'],
        textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea'],
        combobox: ['select'],
        checkbox: ['input[type="checkbox"]'],
        radio: ['input[type="radio"]'],
        img: ['img[alt]'],
        heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      };
      const sels = implicit[loc.role];
      if (sels) {
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            if (matchesName(el, loc.name)) return el;
          }
        }
      }
      return null;
    }
    case 'label': {
      for (const label of document.querySelectorAll('label')) {
        if (label.textContent?.trim() === loc.label) {
          if (label.htmlFor) {
            const el = document.getElementById(label.htmlFor);
            if (el) return el;
          }
          const input = label.querySelector('input, select, textarea');
          if (input) return input;
        }
      }
      return null;
    }
    case 'text': {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let n: Element | null;
      while ((n = walk.nextNode() as Element | null)) {
        const t = n.textContent?.trim();
        if (loc.exact ? t === loc.text : t?.includes(loc.text)) return n;
      }
      return null;
    }
    case 'testId':
      return document.querySelector(`[data-testid="${loc.testId}"]`);
    case 'placeholder':
      return document.querySelector(`[placeholder="${loc.placeholder}"]`);
    case 'css':
      return document.querySelector(loc.selector);
    case 'xpath': {
      const r = document.evaluate(loc.selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue as Element | null;
    }
    case 'coordinates':
      return document.elementFromPoint(loc.x, loc.y);
  }
}

function matchesName(el: Element, name?: string): boolean {
  if (!name) return true;
  if (el.getAttribute('aria-label')?.trim() === name) return true;
  if (el.textContent?.trim() === name) return true;
  const inp = el as HTMLInputElement;
  if (inp.labels?.length) {
    for (const l of inp.labels) { if (l.textContent?.trim() === name) return true; }
  }
  if (el.getAttribute('placeholder')?.trim() === name) return true;
  return false;
}

function resolve(step: WorkflowStep): { el: Element | null; loc: Locator | null; fallback: boolean; err?: string } {
  if (!('primaryLocator' in step) || !step.primaryLocator) {
    return { el: document.body, loc: null, fallback: false };
  }
  const all: Locator[] = [step.primaryLocator, ...('fallbackLocators' in step ? (step.fallbackLocators ?? []) : [])];
  for (let i = 0; i < all.length; i++) {
    const el = findByLocator(all[i]!);
    if (el) return { el, loc: all[i]!, fallback: i > 0 };
  }
  return { el: null, loc: null, fallback: false, err: `None of the ${all.length} locator(s) matched.` };
}

// ---- Step handlers ----

interface Result { ok: boolean; error?: string | undefined; resolvedLocator?: Locator | null | undefined; usedFallback?: boolean | undefined }

function doClick(step: WorkflowStep & { type: 'click' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  if (!el) return { ok: false, error: err, resolvedLocator: loc, usedFallback: fallback };

  // Highlight briefly
  const htmlEl = el as HTMLElement;
  const origOutline = htmlEl.style.outline;
  htmlEl.style.outline = '3px solid #4f8cff';
  setTimeout(() => { htmlEl.style.outline = origOutline; }, 600);

  htmlEl.click();
  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

function doType(step: WorkflowStep & { type: 'type' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  if (!el) return { ok: false, error: err, resolvedLocator: loc, usedFallback: fallback };

  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const htmlEl = el as HTMLElement;
  const origOutline = htmlEl.style.outline;
  htmlEl.style.outline = '3px solid #4f8cff';
  setTimeout(() => { htmlEl.style.outline = origOutline; }, 800);

  input.focus();
  if (step.clearBefore) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Use native setter to trigger React/framework reactivity
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, step.value);
  } else {
    input.value = step.value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

function doSelect(step: WorkflowStep & { type: 'select' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  if (!el) return { ok: false, error: err, resolvedLocator: loc, usedFallback: fallback };

  const select = el as HTMLSelectElement;
  const htmlEl = el as HTMLElement;
  const origOutline = htmlEl.style.outline;
  htmlEl.style.outline = '3px solid #4f8cff';
  setTimeout(() => { htmlEl.style.outline = origOutline; }, 600);

  const { by, value } = step.option;
  let matched = false;
  for (let i = 0; i < select.options.length; i++) {
    const opt = select.options[i]!;
    if (
      (by === 'label' && opt.text === String(value)) ||
      (by === 'value' && opt.value === String(value)) ||
      (by === 'index' && i === Number(value))
    ) {
      select.selectedIndex = i;
      matched = true;
      break;
    }
  }
  if (!matched) return { ok: false, error: `Option not found: ${by}=${String(value)}`, resolvedLocator: loc, usedFallback: fallback };

  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

function doPress(step: WorkflowStep & { type: 'press' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  if (!el) return { ok: false, error: err, resolvedLocator: loc, usedFallback: fallback };

  const target = el as HTMLElement;
  target.focus();

  const keys: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 }
  };
  const mapped = keys[step.key] ?? { key: step.key, code: step.key, keyCode: 0 };
  const mods = {
    altKey: step.modifiers.includes('Alt'),
    ctrlKey: step.modifiers.includes('Control'),
    metaKey: step.modifiers.includes('Meta'),
    shiftKey: step.modifiers.includes('Shift')
  };

  target.dispatchEvent(new KeyboardEvent('keydown', { ...mapped, ...mods, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { ...mapped, ...mods, bubbles: true }));

  if (step.key === 'Enter') {
    const form = target.closest('form');
    if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

function doWaitFor(step: WorkflowStep & { type: 'waitFor' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  if (step.condition === 'attached' || step.condition === 'visible' || step.condition === 'enabled') {
    if (!el) return { ok: false, error: err ?? 'Element not found', resolvedLocator: loc, usedFallback: fallback };
  }
  if (step.condition === 'detached' || step.condition === 'hidden') {
    if (el) return { ok: false, error: 'Element still present', resolvedLocator: loc, usedFallback: fallback };
  }
  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

function doAssert(step: WorkflowStep & { type: 'assert' }): Result {
  const { el, loc, fallback, err } = resolve(step);
  const a = step.assertion;
  if (a.kind === 'visible') {
    if (!el) return { ok: false, error: err ?? 'Element not found', resolvedLocator: loc, usedFallback: fallback };
    return { ok: true, resolvedLocator: loc, usedFallback: fallback };
  }
  if (a.kind === 'hidden') {
    return { ok: !el, error: el ? 'Element is visible' : undefined, resolvedLocator: loc, usedFallback: fallback };
  }
  if (!el) return { ok: false, error: err ?? 'Element not found', resolvedLocator: loc, usedFallback: fallback };
  if (a.kind === 'textEquals') {
    const t = el.textContent?.trim();
    return { ok: t === a.expected, error: t !== a.expected ? `"${t}" ≠ "${a.expected}"` : undefined, resolvedLocator: loc, usedFallback: fallback };
  }
  if (a.kind === 'textContains') {
    const ok = !!el.textContent?.includes(a.expected);
    return { ok, error: ok ? undefined : `Text doesn't contain "${a.expected}"`, resolvedLocator: loc, usedFallback: fallback };
  }
  if (a.kind === 'valueEquals') {
    const v = (el as HTMLInputElement).value;
    return { ok: v === a.expected, error: v !== a.expected ? `"${v}" ≠ "${a.expected}"` : undefined, resolvedLocator: loc, usedFallback: fallback };
  }
  if (a.kind === 'attributeEquals') {
    const v = el.getAttribute(a.name);
    return { ok: v === a.expected, error: v !== a.expected ? `attr "${a.name}"="${v}" ≠ "${a.expected}"` : undefined, resolvedLocator: loc, usedFallback: fallback };
  }
  return { ok: true, resolvedLocator: loc, usedFallback: fallback };
}

// ---- Message listener ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'routineflow.replay.step') return false;

  const step = msg.step as WorkflowStep;
  let result: Result;

  try {
    switch (step.type) {
      case 'click': result = doClick(step as WorkflowStep & { type: 'click' }); break;
      case 'type': result = doType(step as WorkflowStep & { type: 'type' }); break;
      case 'select': result = doSelect(step as WorkflowStep & { type: 'select' }); break;
      case 'press': result = doPress(step as WorkflowStep & { type: 'press' }); break;
      case 'waitFor': result = doWaitFor(step as WorkflowStep & { type: 'waitFor' }); break;
      case 'assert': result = doAssert(step as WorkflowStep & { type: 'assert' }); break;
      default:
        result = { ok: true };
    }
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  sendResponse(result);
  return false;
});

// Signal ready
chrome.runtime.sendMessage({ type: 'routineflow.content-replay-ready' }, () => {
  void chrome.runtime.lastError;
});
