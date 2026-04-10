## **Project proposal: local-first browser routine recorder**

### **1\. Product idea**

Build a Chrome-first tool that lets a user record a browser routine once, save it as a reusable workflow, and replay it later with one click or on a schedule. The first version should focus only on **repetitive browser setup tasks** such as opening tabs, going to websites, clicking menus, typing into fields, waiting for pages to load, and reusing existing login state.

The right first product is **not** “record every pixel forever.” It is “capture everything for debugging, then replay the user’s intent reliably.” That means the recorder should store raw browser events, DOM context, URLs, screenshots, and timing, but the runner should execute normalized steps like `newTab`, `goto`, `click`, `type`, `select`, `waitFor`, and `assert`.

### **2\. Recommended product shape**

I recommend a **split architecture**:

1. A **Chrome extension** for recording, workflow editing, permissions, and the user interface.

2. A **local runner service** for durable playback.

3. A **local database and artifact store** for workflows, run history, screenshots, and traces.

That split is strong because Chrome extensions can provide a side-panel UI, inject scripts, manage tabs, store extension data, schedule alarms, and talk to a separate native process via native messaging; Manifest V3 background logic runs in a service worker. Playwright is then a better replay engine because it generates resilient locators, auto-waits until elements are actionable, can reuse authenticated browser state, and includes Trace Viewer for debugging failures.

### **3\. Tech stack to use**

All of the core pieces below are free or open-source.

* **Browser target:** Google Chrome first, using **Chrome Extensions Manifest V3**. MV3 is the current extension platform and requires executable code to be bundled with the extension package rather than loaded remotely.

* **Extension UI:** **React \+ TypeScript \+ Vite**. React is MIT-licensed, TypeScript is Apache 2.0, and Vite is MIT-licensed.

* **Extension runtime APIs:** `sidePanel`, `tabs`, `scripting`, `storage`, `alarms`, `runtime`, `nativeMessaging`, and `activeTab`. Chrome documents the Side Panel API, Scripting API, activeTab, permissions, alarms, and native messaging for this exact kind of architecture.

* **Local runner:** **Node.js \+ Playwright \+ Fastify**. Node.js is free/open-source, Playwright is Apache 2.0, and Fastify is MIT-licensed.

* **Local database:** **SQLite**. It is self-contained, serverless, and SQLite states the source code is in the public domain and free to use for any purpose.

* **Version control / CI:** **GitHub Free**. GitHub’s Free plan is $0/month and includes unlimited repositories plus included GitHub Actions minutes.

### **4\. Why this stack is the best low-cost choice**

This stack keeps the MVP **local-first**, which means you do not need to pay for cloud hosting, a managed database, queues, worker infrastructure, or AI APIs in version 1\. The browser extension handles user-facing controls and lightweight orchestration. The Node/Playwright runner handles the work that must be reliable: waiting for elements, dealing with dynamic pages, reusing sessions, and producing debug traces. SQLite avoids server bills entirely. GitHub Free is enough for source control and basic CI while you validate the product.

### **5\. MVP scope**

The MVP should ship with these capabilities:

* **Record a workflow** inside Chrome.

* **Normalize the recording** into durable steps.

* **Replay** the workflow on demand.

* **Schedule** it for a daily run.

* **Edit** recorded steps in a simple UI.

* **Reuse login state** so users do not sign in every time.

* **Show failure details** with screenshot, failing step, and trace.

* **Import/export** workflows as JSON.

The MVP should **not** include cloud sync, team sharing, desktop-app automation outside the browser, AI agents, OCR-heavy visual clicking, or marketplace features. Those can come later after the core replay engine is stable.

### **6\. How the product should work technically**

The recorder should capture two layers of information.

The first layer is **raw capture**: click coordinates, typed values, URL changes, tab creation, frame changes, keyboard events, element snapshots, timing, and small screenshot crops.

The second layer is **compiled intent**. Raw capture should be turned into a workflow DSL such as:

{  
 "id": "morning-setup",  
 "name": "Morning setup",  
 "trigger": { "type": "manual" },  
 "steps": \[  
   { "type": "newTab" },  
   { "type": "goto", "url": "https://docs.google.com/spreadsheets" },  
   {  
     "type": "click",  
     "target": {  
       "primary": { "role": "button", "name": "Functions" },  
       "fallback": \[  
         { "text": "SUM" },  
         { "css": "\[aria-label='Functions'\]" }  
       \]  
     }  
   }  
 \]  
}

That compiler step is where product quality comes from. For example, if the user recorded “open a tab, type google.com, click the Google apps launcher, click Sheets,” the compiler should often simplify that into a stable direct navigation step such as `goto("https://docs.google.com/spreadsheets")` when the destination is known and equivalent. This is how you reduce flakiness.

### **7\. Core modules**

A clean repository layout would look like this:

apps/  
 extension/  
 runner/

packages/  
 workflow-schema/  
 compiler/  
 selector-engine/  
 shared-types/  
 ui-components/

data/  
 app.db  
 artifacts/  
   screenshots/  
   traces/  
   logs/

Inside that structure, the important modules are:

* **Recorder module:** listens to browser and page events.

* **Compiler module:** transforms noisy recordings into durable workflows.

* **Selector engine:** stores primary and fallback selectors.

* **Runner module:** executes workflows with Playwright.

* **Scheduler module:** runs daily workflows.

* **History module:** stores run results and artifacts.

* **Editor module:** lets a user fix a broken step without re-recording.

### **8\. Important technical rules for version 1**

Use **intent-based selectors**, not just coordinates. Playwright’s generator prioritizes role, text, and test-id locators, and its locator system is central to auto-waiting and retryability. That is exactly the behavior you want in a workflow product.

Keep permissions lean. Chrome documents that some extension permissions trigger warnings, while `activeTab` grants temporary access to the current tab in response to a user gesture and does not show an install warning. For recording and editing, prefer `activeTab` plus programmatic injection over broad permanent site access whenever possible.

Treat saved authentication as sensitive. Playwright recommends reusing authenticated state, but also warns that browser state files may contain sensitive cookies and headers that could impersonate the user. Those files must never go into Git and should stay on the user’s machine.

Do not rely on extension alarms alone as your only scheduling system. Chrome’s extension docs note that alarms are not saved when Chrome closes and may disappear when the browser session restarts, so the runner should recreate schedules on startup or own scheduling entirely.

Do not base the automation engine on attaching to a user’s default Chrome profile through remote debugging. Chrome changed this behavior in version 136; debugging switches are no longer respected for the default profile unless a non-standard `--user-data-dir` is used, and Chrome recommends Chrome for Testing for automation scenarios.

### **9\. Security and privacy model**

For the MVP, the safest product stance is:

* local-first by default

* no cloud sync

* no plaintext password storage

* redact password fields during recording

* keep auth/session state local and outside Git

* give the user a visible permission model

* bundle all extension code inside the extension package because MV3 blocks remotely hosted executable code.

Playwright’s Trace Viewer is also useful here because traces can be opened locally, and the browser-based trace viewer loads the trace in the browser without transmitting the data externally.

### **10\. Development roadmap**

A realistic solo-founder or small-team plan is about **8–10 weeks** for a strong MVP.

**Phase 1: technical spike**  
 Build a proof of concept using Chrome DevTools Recorder output as a reference. Chrome Recorder supports export/import of user flows as JSON and Puppeteer formats, and Recorder extensions can customize export. This is a fast way to validate your workflow schema before building the full custom recorder UI.

**Phase 2: extension shell**  
 Create the MV3 extension, side panel, workflow list, content-script injection, event capture, and native messaging bridge.

**Phase 3: compiler and runner**  
 Build the workflow DSL, selector strategy, and Playwright runner with traces, screenshots, retries, and auth-state reuse.

**Phase 4: editor and scheduling**  
 Add step editing, enable/disable workflows, daily scheduling, and run history.

**Phase 5: pilot**  
 Test with 3–5 real users doing real morning routines. Measure how often workflows succeed without manual fixes.

### **11\. Estimated cost**

The **development stack itself** can stay free: Node.js, SQLite, Playwright, TypeScript, React, Vite, and Fastify are all free/open-source, and GitHub Free is $0/month.

The main non-zero costs show up during **distribution**, not development. For public Chrome distribution, Chrome requires a Web Store-hosted/signed extension for direct user installs, and publishing requires a Chrome Web Store developer account with a one-time registration fee. Self-hosting is officially supported only in managed environments. During private development and early pilot testing, you can avoid that by loading the extension unpacked locally.

A later **macOS desktop wrapper** would add optional platform cost: Apple’s Developer Program is $99/year. That is another reason to avoid packaging a desktop app too early.

### **12\. Final recommendation**

Build **version 1** as:

**Chrome MV3 extension \+ React/TypeScript/Vite \+ Node/Fastify local runner \+ Playwright \+ SQLite \+ GitHub Free**

That gives you a product that is cheap to build, cheap to run, technically solid, and easy to evolve into a startup later. The winning move is to keep the first release narrow: **browser-only, local-first, single-user, reliable replay**. Do not add cloud sync or AI in the MVP. Get the recorder, compiler, auth handling, and failure recovery excellent first.

Next, we can turn this into a build-ready PRD with folder structure, database schema, manifest permissions, and milestone tasks.

