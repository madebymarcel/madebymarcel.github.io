# Engineering principles

These are **working agreements**, not a checklist of patterns to force into every feature.

1. **Prefer the Angular style guide.** Organize by feature, colocate tests, use descriptive file names, prefer `inject()` for DI, and keep a consistent project style.
2. **Clarity over cleverness.** Use explicit types and intention-revealing names. Prefer a small component with one responsibility over an elaborate abstraction.
3. **Composition over inheritance.** Extract shared behavior only after a real reuse need. A little duplication is often less costly than a premature shared service.
4. **SOLID in context.** Respect high cohesion and loose coupling, but don't introduce interfaces or layers with only one trivial implementation.
5. **DRY is about knowledge, not identical syntax.** Avoid two representations of the same business rule. Don't force unrelated features through the same abstraction.
6. **KISS and YAGNI.** Prefer the simplest design that meets current requirements; document additional complexity when it becomes necessary.
7. **State has one owner.** Prefer Angular signals for synchronous local state and `computed()` for derived state. Use RxJS for genuine stream behavior and effects for external APIs, not state propagation.
8. **Accessible and fast by default.** Start with semantic HTML, keyboard navigation, reduced motion and budgets. Test, don't assume.
9. **Testing is evidence.** Write focused unit tests, route/component integration tests and user-facing E2E tests. Avoid testing implementation details.
10. **Refactor safely.** Small pull requests, meaningful names, all checks green. Explain trade-offs in ADRs when a decision affects future work.

## Code review questions

- Does this solve a real user or engineering need?
- Can someone unfamiliar with the feature follow the data flow?
- Are responsibilities and ownership clear?
- Is there unnecessary complexity or abstraction?
- Are failure states and accessibility considered?
- Does testing cover observable behavior rather than private internals?

Source of truth: [Angular style guide](https://angular.dev/style-guide), [Angular testing](https://angular.dev/guide/testing), and the specific decisions in `docs/decisions/`.
