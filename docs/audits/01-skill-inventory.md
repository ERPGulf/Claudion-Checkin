# Installed skills and applicability

Audit date: 2026-10-28 (Asia/Calcutta). Source baseline: `9e163f4c0c785253b4360a9c2d50ca1405695816`; initial Git status was clean.

## Discovery and provenance

The project and home `.agents/skills/` directories do not exist. The actual project installation is `.claude/skills/`: 14 skill directories, with supporting references. `skills-lock.json` records **emilkowalski/skills**, GitHub source type, skill paths and computed hashes for all 14. This is local installation provenance, not a cryptographic attestation of the upstream checkout. The upstream [repository and skill index](https://github.com/emilkowalski/skills) were inspected and agree with the recorded skill family.

No local `dotscloud/skills` installation or provenance entry was found in these locations. Attempts to read `https://github.com/dotscloud/skills` and its GitHub repository API were unsuccessful through the browsing tool. Its existence, contents and relationship to this installation remain unverified. It was **not** silently substituted, fetched or installed.

Metadata was also read from the system skills in `~/.codex/skills/.system`, cached connector skills in `~/.codex/plugins/cache`, and active home `~/.claude/skills` installations. Home `.trash` copies were excluded as removed installations. No third-party installer or downloaded executable/script was run. No skill files were modified.

## Project applicability matrix

Source for every row below: the local `.claude/skills/<name>/SKILL.md`, recorded as `emilkowalski/skills` by `skills-lock.json`.

| Skill | Purpose | Relevant area / workflow | Actually applied |
| --- | --- | --- | --- |
| animate-expo | Native animation threading, feedback and accessibility | Audit loading/Welcome loops, retain native transform/opacity, reduced motion, optional haptics | Yes |
| apple-design | Feedback, predictable states, inclusive interaction | Notification/record error vs empty states; text scaling and native interaction review | Yes, native-relevant principles |
| emil-design-eng | Cohesion, interaction quality and restraint | Existing tokens/shared components, themed retry/status feedback | Yes |
| improve-animations | Reconnaissance, categorized audit, vetting | All eight `AUDIT.md` categories; parallel read-only app-area reviews, then user-authorized fixes | Yes |
| find-animation-opportunities | Frequency/purpose filter for additional motion | Rejected decorative motion on attendance data, routine navigation and repeated loading states | Yes, no new animation selected |
| write-swift | Swift concurrency, ownership and resource review | All native Swift sources, journal synchronization, bounded callbacks and compatibility | Yes, review and native harness validation |
| animate | Build web motion from scratch | Browser implementation workflow; native work covered by animate-expo | No |
| mobile-native | CSS/browser/PWA platform fixes | Explicitly excludes React Native; no web/PWA implementation in scope | No |
| animation-vocabulary | Name an unfamiliar effect | No effect-naming request | No |
| ask-sonner | Sonner web toast integration | App uses react-native-toast-message | No |
| pick-ui-library | Explicitly invoked library selection | Existing design system retained; no library selection requested | No |
| prototype | Explicitly invoked alternate visual prototypes | No redesign/prototype picker requested | No |
| review-animations | Explicit single-change motion review | Invocation-only workflow; whole-app audit uses improve-animations instead | No |
| break-ui | Dedicated worst-case visual demo/toggle | No stress-demo product control added; device/layout risks reported without claiming a visual stress test | No |

## Read references and adaptations

Selected `SKILL.md` files were read in full by the auditing team. Motion also used `improve-animations/AUDIT.md` and `PLAN-TEMPLATE.md`; the latter informed concrete verification steps, without adding a second plan hierarchy. Swift, Apple and general design skills were self-contained for this task. No new gesture construction required `animate-expo/RECIPES.md`.

The user's explicit remediation/deliverable instructions take precedence over improve-animations' report-only/plan-only workflow. Its requested parallel audit supplied the applicable authorization for read-only specialist reviews; implementation followed baseline verification and prioritized findings. No extra approval gate was inferred from the skill.

`DESIGN.md` and the user's preservation requirements override animate-expo's Reanimated/Expo Router migration defaults. Core Animated, native-driver transforms/opacity, React Navigation and the installed native-module contract remain. CSS, hover, browser viewport, DOM, web pointer events and browser blur prescriptions were not applied to React Native. No new dependencies or decorative motion were introduced. Swift 6-oriented guidance did not change the existing Swift 5/5.9 build targets.

## Other installed metadata

The following catalog is generated from installed metadata. These skills were not applied: they address connector services, document formats, assets, agent setup or review-delegation workflows rather than this local application audit. The requested deliverables are repository Markdown files; no remote document or app was created. This distinction prevents installing unrelated tools merely because their names sound useful.

Project skills: 14. Other active skill metadata entries inspected: 47.

| Skill | Installed source | Purpose from metadata (abridged) | Project workflow | Applied |
| --- | --- | --- | --- | --- |
| imagegen | `~/.codex/skills/.system/imagegen/SKILL.md` | Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, | No app area; excluded from local RN remediation | No |
| openai-docs | `~/.codex/skills/.system/openai-docs/SKILL.md` | Use for Codex models/pricing, scheduled tasks, skills, settings, setup, troubleshooting, customization, automations | No app area; excluded from local RN remediation | No |
| review-agent | `~/.codex/skills/.system/review-agent/SKILL.md` | Perform a read-only, defect-first review of a specified code change and return every actionable finding. Use when a | No app area; excluded from local RN remediation | No |
| skill-creator | `~/.codex/skills/.system/skill-creator/SKILL.md` | Create or update a Codex skill with appropriately scoped instructions and any needed supporting resources. | No app area; excluded from local RN remediation | No |
| skill-installer | `~/.codex/skills/.system/skill-installer/SKILL.md` | Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to lis | No app area; excluded from local RN remediation | No |
| notion-database-designer | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/notion-database-designer/SKILL.md` | Turns scattered notes and recurring work into useful Notion trackers for requests, content plans, or team work. Use | No app area; excluded from local RN remediation | No |
| notion-meeting-intelligence | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/notion-meeting-intelligence/SKILL.md` | Prepares Notion meeting agendas, pre-reads, decision briefs, and follow-up actions. Use for meeting preparation, ca | No app area; excluded from local RN remediation | No |
| notion-research-documentation | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/notion-research-documentation/SKILL.md` | Synthesizes Notion workspace evidence into cited answers, comparisons, briefs, or reports. Use to investigate a que | No app area; excluded from local RN remediation | No |
| notion-spec-to-implementation | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/notion-spec-to-implementation/SKILL.md` | Converts Notion product or technical specs into implementation plans, linked tasks, and evidence-based progress upd | No app area; excluded from local RN remediation | No |
| notion-weekly-project-digest | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/notion-weekly-project-digest/SKILL.md` | Produces evidence-based weekly project or team updates by comparing reporting periods, tasks, decisions, and blocke | No app area; excluded from local RN remediation | No |
| notion-setup | `~/.codex/plugins/cache/openai-curated-remote/notion/3.0.2/skills/setup/SKILL.md` | Sets up Notion after the user installs the Notion plugin or chooses Set up. | No app area; excluded from local RN remediation | No |
| artifact-template-analytics-dashboard | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-analytics-dashboard/SKILL.md` | Create a spreadsheet using the Analytics Dashboard template and its retained reference file. Use when the user sele | No app area; excluded from local RN remediation | No |
| artifact-template-business-review | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-business-review/SKILL.md` | Create a presentation using the Business Review template and its retained reference file. Use when the user selects | No app area; excluded from local RN remediation | No |
| artifact-template-design-report | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-design-report/SKILL.md` | Create a document using the Design Report template and its retained reference file. Use when the user selects or na | No app area; excluded from local RN remediation | No |
| artifact-template-experiment-analysis | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-experiment-analysis/SKILL.md` | Create a document using the Experiment Analysis template and its retained reference file. Use when the user selects | No app area; excluded from local RN remediation | No |
| artifact-template-financial-budget | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-financial-budget/SKILL.md` | Create a spreadsheet using the Financial Budget template and its retained reference file. Use when the user selects | No app area; excluded from local RN remediation | No |
| artifact-template-investment-committee-memo | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-investment-committee-memo/SKILL.md` | Create a document using the Investment Committee Memo template and its retained reference file. Use when the user s | No app area; excluded from local RN remediation | No |
| artifact-template-legal-memorandum | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-legal-memorandum/SKILL.md` | Create a document using the Legal Memorandum template and its retained reference file. Use when the user selects or | No app area; excluded from local RN remediation | No |
| artifact-template-market-trends-report | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-market-trends-report/SKILL.md` | Create a presentation using the Market Trends Report template and its retained reference file. Use when the user se | No app area; excluded from local RN remediation | No |
| artifact-template-minimal-letterhead | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-minimal-letterhead/SKILL.md` | Create a document using the Minimal Letterhead template and its retained reference file. Use when the user selects  | No app area; excluded from local RN remediation | No |
| artifact-template-operating-calendar | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-operating-calendar/SKILL.md` | Create a spreadsheet using the Operating Calendar template and its retained reference file. Use when the user selec | No app area; excluded from local RN remediation | No |
| artifact-template-operating-review | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-operating-review/SKILL.md` | Create a presentation using the Operating Review template and its retained reference file. Use when the user select | No app area; excluded from local RN remediation | No |
| artifact-template-project-kickoff | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-kickoff/SKILL.md` | Create a presentation using the Project Kickoff template and its retained reference file. Use when the user selects | No app area; excluded from local RN remediation | No |
| artifact-template-project-tracker | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-tracker/SKILL.md` | Create a spreadsheet using the Project Tracker template and its retained reference file. Use when the user selects  | No app area; excluded from local RN remediation | No |
| artifact-template-sales-pipeline | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-sales-pipeline/SKILL.md` | Create a spreadsheet using the Sales Pipeline template and its retained reference file. Use when the user selects o | No app area; excluded from local RN remediation | No |
| artifact-template-simple-dark-mode | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-simple-dark-mode/SKILL.md` | Create a presentation using the Simple Dark Mode template and its retained reference file. Use when the user select | No app area; excluded from local RN remediation | No |
| artifact-template-simple-light-mode | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-simple-light-mode/SKILL.md` | Create a presentation using the Simple Light Mode template and its retained reference file. Use when the user selec | No app area; excluded from local RN remediation | No |
| artifact-template-strategy-memorandum | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-strategy-memorandum/SKILL.md` | Create a document using the Strategy Memorandum template and its retained reference file. Use when the user selects | No app area; excluded from local RN remediation | No |
| artifact-template-system-design | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-system-design/SKILL.md` | Create a document using the System Design template and its retained reference file. Use when the user selects or na | No app area; excluded from local RN remediation | No |
| artifact-template-team-alignment | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-team-alignment/SKILL.md` | Create a presentation using the Team Alignment template and its retained reference file. Use when the user selects  | No app area; excluded from local RN remediation | No |
| artifact-template-three-statement-forecast | `~/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-three-statement-forecast/SKILL.md` | Create a spreadsheet using the Three-Statement Forecast template and its retained reference file. Use when the user | No app area; excluded from local RN remediation | No |
| plugin-management | `~/.codex/plugins/cache/openai-curated-remote/plugin-management/0.1.0/skills/plugin-management/SKILL.md` | Discover and suggest relevant plugins, inspect app permissions and dependencies, and manage plugin connections or r | No app area; excluded from local RN remediation | No |
| sites | `~/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/skills/sites/SKILL.md` | Use Sites when the user wants a website built for them (including a landing page, portfolio, dashboard, portal, tra | No app area; excluded from local RN remediation | No |
| sites-remix | `~/.codex/plugins/cache/openai-curated-remote/sites/1.1.2/skills/sites-remix/SKILL.md` | Remix a Site built with the Sites plugin into a new Site. Use when the user has identified the source Site and asks | No app area; excluded from local RN remediation | No |
| create-pet | `~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/skills/create-pet/SKILL.md` | Create, repair, validate, preview, upload, or activate an animated v2 pet in ChatGPT Work mode from a character ide | No app area; excluded from local RN remediation | No |
| pets | `~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/skills/pets/SKILL.md` | List, inspect, select, download, or delete animated pets in ChatGPT Work mode. Use for an explicit pet in ChatGPT o | No app area; excluded from local RN remediation | No |
| update-pet | `~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/skills/update-pet/SKILL.md` | Inspect, validate, preview, repair, or update a custom pet in ChatGPT Work mode, including its name, description, o | No app area; excluded from local RN remediation | No |
| find-skills | `~/.claude/skills/find-skills/SKILL.md` | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", " | No app area; excluded from local RN remediation | No |
| docs | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/docs/SKILL.md` | docs (editable docs people share and comment on; the default for any document, named as a doc or not: a document, r | No app area; excluded from local RN remediation | No |
| docx | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/docx/SKILL.md` | Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx) or Word template | No app area; excluded from local RN remediation | No |
| google-workspace | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/google-workspace/SKILL.md` | Read this before the first Google Drive, Docs, Sheets or Slides connector call whenever the task creates or changes | No app area; excluded from local RN remediation | No |
| import-memory | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/import-memory/SKILL.md` | Import a memory export from another AI assistant into Claude's memory — conversationally, additively, and with the  | No app area; excluded from local RN remediation | No |
| morning | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/morning/SKILL.md` | Render the user's morning brief as a styled HTML artifact, or set it up as a recurring weekday task. Use only when  | No app area; excluded from local RN remediation | No |
| pdf | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/pdf/SKILL.md` | Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tabl | No app area; excluded from local RN remediation | No |
| pptx | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/pptx/SKILL.md` | Use this skill any time a .pptx or .potx file is involved in any way — as input, output, or both. This includes: cr | No app area; excluded from local RN remediation | No |
| skill-creator | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/skill-creator/SKILL.md` | Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create | No app area; excluded from local RN remediation | No |
| xlsx | `~/.claude/skills/synced/12bcf11f-a941-4092-bfd4-2113d8657e88_bb6ef5ee-b25d-478a-9649-bddeae803bc6/xlsx/SKILL.md` | Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants | No app area; excluded from local RN remediation | No |


Audited local project skill content fingerprints (SHA-256 of SKILL.md, first 16 hex characters; distinct from the lockfile's package hash):

| Local skill | Content fingerprint |
| --- | --- |
| animate | `b8ede161270458e6` |
| animate-expo | `9a01a91701e6563c` |
| animation-vocabulary | `40d2b27adfdfeb05` |
| apple-design | `77bb63b7043bb93a` |
| ask-sonner | `39f3ee185b3aa2cf` |
| break-ui | `e7eec1d70ac56a04` |
| emil-design-eng | `ffbe68e6007fb42c` |
| find-animation-opportunities | `d52a377819b84a71` |
| improve-animations | `7396244746443347` |
| mobile-native | `888b7651d66d66db` |
| pick-ui-library | `675fdce308683256` |
| prototype | `bba39c955eb1871c` |
| review-animations | `6ff590d29e436766` |
| write-swift | `16a4b6adb74e338e` |
