# Contributing

Make changes through short, focused pull requests rather than direct pushes to `main`.

1. Create a feature branch.
2. Follow [engineering principles](docs/engineering-principles.md) and Angular's official style guide.
3. Put page-specific components and unit tests inside the relevant feature folder.
4. Run `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run test:unit`, `npm run build`, and `npm run test:e2e`.
5. Update the docs when a decision changes the architecture.
6. Let `Validate website` and CodeQL complete before merging.

Don't add frameworks, design patterns or abstractions just to demonstrate that they exist. Make the code explain itself first.
