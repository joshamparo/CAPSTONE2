[OPEN] backend-deploy-crash
Date: 2026-08-15
Reported: User: "nag crashed yung backend after madeploy" + deployment panel shows CRASHED.
Regression window: Commit 6487dade (Phase 1+2 assistant.js mega edit + AssistantWidget.js)

## Hypotheses (falsifiable)
H1: Syntax error (missing comma/bracket/quote) in new L15 TAGLISH_SLANG_MAP (180 entries) / SYMPTOM_TRIAGE_RULES / PUBLIC_PRICES (80 entries) → Node fail require(assistant.js) boot crash. **REJECTED**
H2: Invalid regular expression (unbalanced /, unescaped special char) inside any TAGLISH_SLANG_MAP entry → SyntaxError: Invalid regex during eval. **REJECTED**
H3: File encoding / unicode parse issue → ñ / emoji characters cause Node parser to fail in production build. **REJECTED**
H4: Duplicate const declaration or duplicate ROLE_QUICK_ANSWERS key causing parse/assignment crash. **CONFIRMED** ✅
H5: Node version incompatibility → uses newer operator not supported in deploy environment (low confidence). **REJECTED**

## Evidence collected
1. Command: `node --check routes/assistant.js` (syntax-only parse check)
   Result:
   ```
   C:\...\capstone-backend\routes\assistant.js:1603
     const normalized = normalizeQuestionText(text);
           ^
   SyntaxError: Identifier 'normalized' has already been declared
   ```
   Root cause: `localAssistantReply` declared `const normalized = normalizeQuestionText(text)` TWICE on same scope:
   - 1st decl L1554 (before greeting/capability blocks)
   - 2nd decl L1603 (before symptom detection block I inserted when reordering pipeline)
   This is a module-parse-time syntax error → Node throws before running any code → require(server.js) → require(routes/assistant.js) → process exits immediately with non-zero → Render/Render-like hosting marks deployment "CRASHED". Exactly matches user screenshot status "CRASHED 7 minutes ago via GitHub".

2. Post-fix verification commands:
   - `node --check routes/assistant.js` → exit 0 ✅
   - `node --check server.js` → exit 0 ✅
   - `node --check routes/appointments.js` → exit 0 ✅
   - `node --check routes/billing.js` → exit 0 ✅

## Root cause
✅ **Phase 1 assistant.js localAssistantReply pipeline reorder bug — duplicate const `normalized` in same function scope.**
When I moved symptom/price/appointment/lab detection BEFORE the medical risk block (L1600s area), I accidentally prepended a new `const normalized = normalizeQuestionText(text)` instead of reusing the earlier declaration that already existed (L1554 from original code used before greeting block). Since JS `const` can't be re-declared in same block scope, module parse fails immediately. This would crash on ANY Node version (14+/18+/20+/24+) — purely static syntax problem.

## Fix applied
🔧 **Minimal single-line delete in [assistant.js L1603](file:///C:/Users/Stellie/Downloads/CAPSTONE%20(7)%204/Pascualinga-Capstone/capstone-backend/routes/assistant.js#L1603):**
```
BEFORE:
  const normalized = normalizeQuestionText(text);   // DELETE — duplicate!
  const symptomHit = detectSymptomIntent(normalized);

AFTER:
  const symptomHit = detectSymptomIntent(normalized);
```
The existing top-of-function `const normalized` declaration L1554 remains in scope and is used everywhere correctly (symptom / price / appointment / lab / quick answers). No other code changes required.
