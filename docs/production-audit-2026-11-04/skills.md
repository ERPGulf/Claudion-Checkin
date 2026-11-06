# Skill discovery and use

Discovery inspected the session catalog, system/plugin `SKILL.md` paths, project `.claude/skills`, `skills-lock.json`, and home `.claude/skills`. Project/home `.agents/skills` were absent. No skills were installed or modified and no remote skill code was run.

The project contains 14 `emilkowalski/skills` entries: animate, animate-expo, animation-vocabulary, apple-design, ask-sonner, break-ui, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, review-animations and write-swift. System/plugin catalogs additionally offer image generation, OpenAI documentation, skill creation/installation, review-agent, Notion, Sites, plugin management, pets and document templates. Home skills include find-skills and document/workspace helpers. These are not specialist SQLite/auth/network security workflows.

| Skill | Use in this audit |
| --- | --- |
| `write-swift` (`.claude/skills/write-swift/SKILL.md`) | Read and applied to Swift resource ownership, main-thread/callback and concurrency review by the native audit agent. No Swift rewrite. |
| `review-agent` (`~/.codex/skills/.system/review-agent/SKILL.md`) | Read and applied by a separate agent for read-only, defect-first review of startup/OTA/auth/push/config changes. No introduced regression found in the reviewed change set. |
| `animate-expo` | Read/consulted for thread, reduced-motion and hardware-profiling criteria. No animation construction or library migration was warranted. `DESIGN.md` and the user's preservation rules take precedence over its Reanimated/Expo Router prescriptions. |
| `apple-design` | Read/consulted for feedback/accessibility principles. Its concrete implementation workflow targets the web; no browser-specific implementation applied. |
| `mobile-native`, `break-ui`, `review-animations` | Instructions inspected to assess fit. Respectively web/PWA, dedicated stress-demo, and motion-change workflows; not invoked. No fabricated visual stress test or demo toggle. |
| Other discovered skills | Metadata/catalog assessed; unrelated document/app-generation/animation selection workflows not loaded or invoked. No third-party account or monitoring connection was added. |

For unavailable specialist skills, the team used repository architecture contracts, call-site tracing, delayed-promise/race reproductions, real-package SDK fixtures, SQL-backed queue tests, Kotlin production-source harness, local builds and bundle exports. Skills did not create an extra approval gate: safe local remediation/testing was already authorized.
