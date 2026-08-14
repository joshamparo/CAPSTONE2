# Debug Session: nurse-dashboard-whitescreen

- **Status:** [OPEN] 🔴 Evidence Collection Phase
- **Opened:** 2026-08-14
- **Bug:** Login as Nurse → entire Nurse side = WHITE SCREEN (top-level render crash, not just modal crash).
- **Regression window:** Occurred immediately after previous commit `574db5fa` converted Nurse custom profile dropdown to AccountHeaderActions shared component.

## Hypotheses:
| ID | H | Likelihood | Status | Evidence |
|---|---|---|---|---|
| H1 | Dangling references: `showProfileMenu` / `setShowProfileMenu` still called by global document click listener or settings dropdown. State declaration `useState` was NOT deleted with JSX usage block → or state declaration WAS accidentally still referenced (but not used) → OK, but if a listener calls setShowProfileMenu and it no longer exists → undefined = crash | 90% 🔴 | PENDING | Grep file for `showProfileMenu` / `setShowProfileMenu` occurrences (static) |
| H2 | Dangling references to `showProfileMenu` in JSX conditional render elsewhere outside deleted block | 70% 🟠 | PENDING | Grep JSX for conditional showProfileMenu branches |
| H3 | AccountHeaderActions import path malformed | 30% 🟡 | PENDING | Static check of L10 import line vs actual file location |
| H4 | Unused icon variable crash (tree-shake issue?) | 15% | PENDING | Build compile pass (exit 0) = falsified |
| H5 | JSX div imbalance after 55→9 line replacement → JSX parse | 10% | PENDING | Build compile pass (exit 0) = FALSIFIED |

## Evidence Log Key:
- grep point-ndws-1: All lines in NurseDashboard.js referencing `showProfileMenu` / `setShowProfileMenu`
- grep point-ndws-2: All lines in NurseDashboard.js referencing removed icons `LayoutDashboard` / old LogOut usage
- compile point-ndws-3: build exit code 0 already verified → H5=FALSIFIED
- runtime point-ndws-4: ErrorBoundary catch if exists for top-level crash stack

## Changes:
- [ ] Phase A: Read-only static evidence (grep / read file sections) — PROTOCOL SAFE no code changes yet
- [ ] Phase B: Instrumentation only (error boundary wrapper around NurseDashboard return) — NO logic fixes
- [ ] Phase C: Reproduce → examine evidence → confirm single hypothesis
- [ ] Phase D: Minimal fix applied
- [ ] Phase E: Build pass + diagnostics 0 + push to origin/main
- [ ] Phase F: User confirms fixed → cleanup debug artifacts
