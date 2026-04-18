/**
 * Content-script level step executor. Injected into the active tab by the
 * service worker to perform a single workflow step (click, type, select, etc.)
 * directly in the user's browser — no separate Playwright window needed.
 *
 * Each function is self-contained so it can be passed to
 * chrome.scripting.executeScript as `func`.
 */

import type { Locator, WorkflowStep } from '@routineflow/shared-types';

// ---- Element resolution ----

interface LocatorResult {
  element: Element | null;
  resolvedLocator: Locator | null;
  usedFallback: boolean;
  error?: string;
}

function resolveElement(step: WorkflowStep): LocatorResult {
  if (!('primaryLocator' in step) || !step.primaryLocator) {
    return { element: document.body, resolvedLocator: null, usedFallback: false };
  }

  const allLocators: Locator[] = [
    step.primaryLocator,
    ...('fallbackLocators' in step ? (step.fallbackLocators ?? []) : [])
  ];

  for (let i = 0; i < allLocators.length; i++) {
    const loc = allLocators[i]!;
    const el = findByLocator(loc);
    if (el) {
      return {
        element: el,
        resolvedLocator: loc,
        usedFallback: i > 0
      };
    }
  }

  return {
    element: null,
    resolvedLocator: null,
    usedFallback: false,
    error: `None of the ${allLocators.length} locator(s) matched any element.`
  };
}

function findByLocator(loc: Locator): Element | null {
  switch (loc.kind) {
    case 'role': {
      // Find by ARIA role + accessible name
      const candidates = document.querySelectorAll(`[role="${loc.role}"]`);
      for (const el of candidates) {
        if (matchesAccessibleName(el, loc.name)) return el;
      }
      // Also check implicit roles
      const implicitMap: Record<string, string[]> = {
        button: ['button', 'input[type="button"]', 'input[type="submit"]'],
        link: ['a[href]'],
        textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'input[type="search"]', 'input[type="tel"]', 'input[type="url"]', 'textarea'],
        combobox: ['select'],
        checkbox: ['input[type="checkbox"]'],
        radio: ['input[type="radio"]'],
        img: ['img[alt]'],
        heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      };
      const selectors = implicitMap[loc.role];
      if (selectors) {
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (matchesAccessibleName(el, loc.name)) return el;
          }
        }
      }
      return null;
    }
    case 'label': {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.trim() === loc.label && label.htmlFor) {
          const el = document.getElementById(label.htmlFor);
          if (el) return el;
        }
        // Label wrapping an input
        if (label.textContent?.trim() === loc.label) {
          const input = label.querySelector('input, select, textarea');
          if (input) return input;
        }
      }
      return null;
    }
    case 'text': {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let node: Element | null;
      while ((node = walker.nextNode() as Element | null)) {
        const text = node.textContent?.trim();
        if (loc.exact ? text === loc.text : text?.includes(loc.text)) {
          return node;
        }
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
      const result = document.evaluate(
        loc.selector,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue as Element | null;
    }
    case 'coordinates':
      return document.elementFromPoint(loc.x, loc.y);
  }
}

function matchesAccessibleName(el: Element, name?: string): boolean {
  if (!name) return true;
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim() === name) return true;
  const text = el.textContent?.trim();
  if (text === name) return true;
  // Check labels for form elements
  const inputEl = el as HTMLInputElement;
  if (inputEl.labels?.length) {
    for (const label of inputEl.labels) {
      if (label.textContent?.trim() === name) return true;
    }
  }
  // Check placeholder
  if (el.getAttribute('placeholder')?.trim() === name) return true;
  return false;
}

// ---- Step execution result ----

export interface StepResult {
  ok: boolean;
  resolvedLocator?: Locator | null | undefined;
  usedFallback?: boolean | undefined;
  error?: string | undefined;
}

// ---- Exported step executors ----
// These are the functions injected into the page via chrome.scripting.executeScript

export function executeClickStep(step: WorkflowStep): StepResult {
  if (step.type !== 'click') return { ok: false, error: 'Not a click step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);
  if (!element) return { ok: false, error, resolvedLocator, usedFallback };

  (element as HTMLElement).click();
  return { ok: true, resolvedLocator, usedFallback };
}

export function executeTypeStep(step: WorkflowStep): StepResult {
  if (step.type !== 'type') return { ok: false, error: 'Not a type step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);
  if (!element) return { ok: false, error, resolvedLocator, usedFallback };

  const input = element as HTMLInputElement | HTMLTextAreaElement;
  if (step.clearBefore) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Type character by character for realistic simulation
  input.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(input, step.value);
  } else {
    input.value = step.value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  return { ok: true, resolvedLocator, usedFallback };
}

export function executeSelectStep(step: WorkflowStep): StepResult {
  if (step.type !== 'select') return { ok: false, error: 'Not a select step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);
  if (!element) return { ok: false, error, resolvedLocator, usedFallback };

  const select = element as HTMLSelectElement;
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

  if (!matched) {
    return { ok: false, error: `Option not found: ${by}=${String(value)}`, resolvedLocator, usedFallback };
  }

  select.dispatchEvent(new Event('change', { bubbles: true }));
  select.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, resolvedLocator, usedFallback };
}

export function executePressStep(step: WorkflowStep): StepResult {
  if (step.type !== 'press') return { ok: false, error: 'Not a press step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);
  if (!element) return { ok: false, error, resolvedLocator, usedFallback };

  const target = element as HTMLElement;
  target.focus();

  const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
    Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    Space: { key: ' ', code: 'Space', keyCode: 32 },
    Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 }
  };

  const mapped = keyMap[step.key] ?? { key: step.key, code: step.key, keyCode: 0 };
  const mods = {
    altKey: step.modifiers.includes('Alt'),
    ctrlKey: step.modifiers.includes('Control'),
    metaKey: step.modifiers.includes('Meta'),
    shiftKey: step.modifiers.includes('Shift')
  };

  target.dispatchEvent(new KeyboardEvent('keydown', { ...mapped, ...mods, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { ...mapped, ...mods, bubbles: true }));

  // If Enter on a form element, also submit the form
  if (step.key === 'Enter') {
    const form = target.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  return { ok: true, resolvedLocator, usedFallback };
}

export function executeWaitForStep(step: WorkflowStep): StepResult {
  if (step.type !== 'waitFor') return { ok: false, error: 'Not a waitFor step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);

  switch (step.condition) {
    case 'attached':
    case 'visible':
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      if (step.condition === 'visible') {
        const htmlEl = element as HTMLElement;
        if (htmlEl.offsetParent === null && getComputedStyle(htmlEl).display === 'none') {
          return { ok: false, error: 'Element is not visible', resolvedLocator, usedFallback };
        }
      }
      return { ok: true, resolvedLocator, usedFallback };
    case 'detached':
    case 'hidden':
      if (element && step.condition === 'detached') {
        return { ok: false, error: 'Element is still attached', resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    case 'enabled':
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      if ((element as HTMLInputElement).disabled) {
        return { ok: false, error: 'Element is disabled', resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    case 'disabled':
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      if (!(element as HTMLInputElement).disabled) {
        return { ok: false, error: 'Element is not disabled', resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    default:
      return { ok: true, resolvedLocator, usedFallback };
  }
}

export function executeAssertStep(step: WorkflowStep): StepResult {
  if (step.type !== 'assert') return { ok: false, error: 'Not an assert step' };
  const { element, resolvedLocator, usedFallback, error } = resolveElement(step);

  switch (step.assertion.kind) {
    case 'visible':
      if (!element) return { ok: false, error: error ?? 'Element not found for visibility check', resolvedLocator, usedFallback };
      return { ok: true, resolvedLocator, usedFallback };
    case 'hidden':
      if (element) return { ok: false, error: 'Element is visible but expected hidden', resolvedLocator, usedFallback };
      return { ok: true, resolvedLocator, usedFallback };
    case 'textEquals': {
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      const text = element.textContent?.trim();
      if (text !== step.assertion.expected) {
        return { ok: false, error: `Text "${text}" does not equal "${step.assertion.expected}"`, resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    }
    case 'textContains': {
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      if (!element.textContent?.includes(step.assertion.expected)) {
        return { ok: false, error: `Text does not contain "${step.assertion.expected}"`, resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    }
    case 'valueEquals': {
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      if ((element as HTMLInputElement).value !== step.assertion.expected) {
        return { ok: false, error: `Value does not equal "${step.assertion.expected}"`, resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    }
    case 'attributeEquals': {
      if (!element) return { ok: false, error: error ?? 'Element not found', resolvedLocator, usedFallback };
      const actual = element.getAttribute(step.assertion.name);
      if (actual !== step.assertion.expected) {
        return { ok: false, error: `Attribute "${step.assertion.name}" is "${actual}" not "${step.assertion.expected}"`, resolvedLocator, usedFallback };
      }
      return { ok: true, resolvedLocator, usedFallback };
    }
    default:
      return { ok: true, resolvedLocator, usedFallback };
  }
}
