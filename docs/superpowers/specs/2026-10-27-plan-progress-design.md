# Plan-Fortschritt im Files-Pane – Design

Stand: 2026-10-27 · Fork `MiGrebin/claude-code-filetree`, Branch `feat/plan-progress`, Basis upstream `0.5.0`

## Ziel

Während Claude einen superpowers-Plan ausführt (`subagent-driven-development` oder `executing-plans`), teilt sich das Files-Pane von filetree in der Mitte: oben der Dateibaum, unten alle Tasks des Plans, markiert danach, welche erledigt sind und an welcher gerade gearbeitet wird. So sieht man jederzeit, wie weit die Implementierung ist.

## Entscheidungen und Begründung

- **Fork statt eigener Mod.** Die Mod-API zeigt in der Sidebar immer nur ein Pane, weitere offene Panes werden zu Tabs („one shown, the rest tabs“). Ein Bereich *unter* dem Dateibaum geht deshalb nur innerhalb des filetree-Panes. Der Fork liegt unter `MiGrebin/claude-code-filetree`, `upstream` zeigt auf `data-goblin/claude-code-filetree`, Updates kommen per `git merge upstream/main`.
- **Tasks aus der Plan-Datei, Status aus Claudes Task-Liste.** Die Checkboxen in den Plan-Dateien bleiben in der Praxis offen (in ~30 lokalen Plänen fast nie abgehakt), und SDD-Ledger gibt es lokal keine. Verlässlich gepflegt wird nur Claudes Task-Liste (`TaskCreate`/`TaskUpdate`, ältere Sessions `TodoWrite`). Die Plan-Datei liefert deshalb Liste und Nummern, die Task-Liste den Status.
- **Nachtrag nach dem ersten echten Lauf (2026-10-27):** Ein `executing-plans`-Lauf hat die Plan-Datei nur per `cat` gelesen, die Checkboxen per `sed -i` abgehakt und keine einzige Task angelegt. Der Plan erschien deshalb nie. Seitdem gilt: Der Planpfad kommt bevorzugt aus den Argumenten des Ausführungs-Skills, Bash-Befehle des Hauptloops zählen wie Read/Write/Edit, und abgehakte Checkboxen sind eine zweite Status-Quelle neben der Task-Liste.
- **Zweiter Nachtrag (2026-10-27):** Nach dem Testlauf mit dem Mini-Plan soll das Pane in der Mitte geteilt sein, eine Hälfte Dateibaum, eine Hälfte Plan. Der Plan-Bereich ist im Terminal deshalb nicht mehr so hoch wie seine Tasks, sondern belegt fest die untere Hälfte. Die Trennlinie bleibt dadurch an derselben Stelle, wie viele Tasks der Plan auch hat.
- **Kurzer Hinweis an Claude.** Solange ein Plan aktiv ist, ergänzt der Mod per `prompt.compose` den System-Prompt um eine Namenskonvention für die Tasks, damit sie sich zuverlässig zuordnen lassen.

## Architektur

### Neue Datei `hooks/plan.ts` (reine Funktionen, keine `$`-Aufrufe)

| Funktion | Zweck |
| --- | --- |
| `isPlanFile(path: string): boolean` | `true` für `…/docs/superpowers/plans/<name>.md` (posix-Pfad) |
| `isExecuteSkill(skill: string): boolean` | `true` für `subagent-driven-development` und `executing-plans`, mit oder ohne Präfix `superpowers:` |
| `parsePlan(markdown: string): { title: string; tasks: PlanTask[] }` | Titel aus der ersten H1, Tasks aus den Überschriften |
| `matchTask(subject: string, tasks: PlanTask[]): string \| undefined` | ID der Plan-Task zu einem Task-Subject |
| `statuses(plan: Plan): Record<string, PlanStatus>` | Status je Plan-Task aus dem Spiegel von Claudes Task-Liste |
| `planWindow(tasks: PlanTask[], status: Record<string, PlanStatus>, rows: number): PlanLine[]` | sichtbare Zeilen für die verfügbare Höhe |

**Überschriften.** Erkannt wird `^#{2,4}\s+(Task|Aufgabe)\s+<id>\s*[:.–—-]\s*<Titel>`. `<id>` ist `[A-Za-z]?\d+[A-Za-z]?`, deckt also `3`, `P2`, `F1` und `9R` ab. Überschriften wie `## Task-Übersicht`, `## Aufgaben` oder `#### Teil A – …` sind keine Tasks. Code-Blöcke (```` ``` ````) werden übersprungen, damit Markdown-Beispiele in einem Plan nicht als Task zählen. IDs werden ohne Rücksicht auf Groß-/Kleinschreibung verglichen.

**Titel.** Die H1 ohne Zusatz am Ende, also ohne „Implementation Plan“ / „Implementierungsplan“ samt vorangestelltem Trenner (`–`, `—`, `-`) und einer folgenden Klammer. Beispiel: `Werkbank-API Revisionen – Implementierungsplan (PIM)` → `Werkbank-API Revisionen`. Fehlt die H1, wird der Dateiname ohne Datumspräfix und `.md` verwendet.

**Zuordnung (`matchTask`).**
1. Enthält das Subject `Task <id>` oder `Aufgabe <id>` (als ganzes Wort) und gibt es diese ID im Plan, gilt sie.
2. Sonst vergleicht die Funktion das Subject ohne ein führendes `Task <id>:` normalisiert mit den Plan-Titeln: Kleinschreibung, ohne Backticks und Satzzeichen, Leerraum zusammengefasst. Nur exakte Gleichheit zählt.
3. Sonst gibt es keine Zuordnung. Die Brainstorming-Checkliste oder „Final review“ bleiben damit außen vor.

**Status (`statuses`).** Es zählen nur Claude-Tasks, die unter diesem Plan angelegt wurden (`plan` gleich dem aktiven Pfad) oder bevor überhaupt ein Plan aktiv war (`plan` leer). Jede davon, die sich zuordnen lässt, setzt den Status ihrer Plan-Task. Ordnen sich mehrere Claude-Tasks derselben Plan-Task zu, gilt die Rangfolge `in_progress` > `completed` > `pending`. Dazu kommen die Checkboxen: `parsePlan` zählt je Task die Checkboxen (`- [ ]`/`- [x]`) bis zur nächsten Überschrift derselben oder einer höheren Ebene, außerhalb von Code-Blöcken (`checks: Record<id, [abgehakt, gesamt]>`). Alle abgehakt ergibt `completed`, ein Teil davon `in_progress`; mit der Task-Liste gilt der höhere Rang. Plan-Tasks ohne beides sind `pending`.

**Planpfade in Text (`planPaths`, `argumentsOf`).** `planPaths(text, cwd)` findet Pfade `…docs/superpowers/plans/<name>.md` in einem Bash-Befehl oder in Skill-Argumenten und löst relative Pfade gegen das Arbeitsverzeichnis der Session auf; Platzhalter wie `YYYY-MM-DD-<feature-name>.md` zählen nicht. `argumentsOf(text)` liest die letzte `ARGUMENTS:`-Zeile eines expandierten Skill-Texts.

**Fenster (`planWindow`).** `PlanLine` ist `{ kind: 'task'; task: PlanTask; status: PlanStatus }` oder `{ kind: 'before' | 'after'; count: number; allDone: boolean }`.
- Passen alle Tasks in `rows`, werden alle angezeigt.
- Sonst ist der Anker die erste `in_progress`-Task, ersatzweise die erste nicht erledigte, ersatzweise die letzte. Das Fenster beginnt eine Task vor dem Anker; bei nur 3 Zeilen beim Anker selbst. Eine Sammelzeile für genau eine Task gibt es nicht, denn dann wird die Task selbst gezeigt.
- Abgeschnittenes wird zu je einer Sammelzeile oben und unten, die selbst eine Zeile von `rows` belegen. Sind alle Tasks einer Sammelzeile erledigt, ist `allDone` gesetzt (oben `✓ 12 erledigt`). Unten steht `○ 18 weitere`, oben bei gemischtem Status `⋮ 3 davor`.
- `rows` ist mindestens 3. Der Anker ist immer sichtbar.

### State (`types/index.d.ts`)

Ein neuer Schlüssel `plan` unter `PluginState.filetree`:

```ts
export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export type PlanTask = { id: string; title: string }
export type ClaudeTask = { subject: string; status: PlanStatus; plan: string }  // plan: aktiver Pfad beim Anlegen
export type Plan = {
  candidate: string                      // zuletzt im Hauptloop gelesene/geschriebene Plan-Datei
  pick: boolean                          // nach einem Ausführungs-Skill: die nächste Plan-Datei wird aktiv
  path: string                           // aktiver Plan, '' wenn keiner
  title: string
  tasks: PlanTask[]
  claude: Record<string, ClaudeTask>     // Spiegel von Claudes Task-Liste
}
```

Der Startwert ist leer (`path: ''`). Der Wert lebt im Session-State: Er übersteht ein Neuladen des Mods und gilt nur für diese Session.

### Hooks in `hooks/register.tsx`

Berücksichtigt werden nur Aufrufe des Hauptloops: Ein `tool.call` mit `agentId` stammt von einem Subagent und wird durchgereicht, ohne den State zu ändern. Alle Hooks rufen zuerst `next(e)` auf und werten nur erfolgreiche Ergebnisse aus (kein `deny`, kein `isError`).

| Tool | Wirkung |
| --- | --- |
| `Read`, `Write`, `Edit` auf eine Plan-Datei | `candidate = path`. Ist `pick` gesetzt → aktivieren; nur wenn die Datei Tasks hat, wird `pick = false` (eine Datei ohne Tasks, etwa ein Index, verbraucht ihn nicht). Sonst, wenn es der aktive Plan ist → neu parsen. |
| `Bash` (auch wenn der Befehl fehlschlägt; nur ein `deny` zählt nicht) | Jeder Planpfad im Befehl (`planPaths`) wird behandelt wie ein Read derselben Datei. |
| `Bash`, `Edit`, `Write`, `NotebookEdit`, `Agent`, auch von Subagents (ein Subagent darf Checkboxen abhaken) | Der aktive Plan wird neu eingelesen, wenn sich seine Änderungszeit (`mtime`) geändert hat, etwa weil `sed` oder ein Edit Checkboxen abgehakt hat. Ein Hook ohne Matcher geht nicht: `register.tsx` hat schon den einzigen erlaubten. |
| `Skill` mit Ausführungs-Skill, sowie `skill.prompt` für denselben Skill (ein als `/name` getippter Skill löst keinen Tool-Call aus; `skill.prompt` trägt keine `agentId`, Subagents werden dort also nicht gefiltert; der Text bleibt unverändert) | Nennen die Argumente (`args` bzw. die `ARGUMENTS:`-Zeile) einen Plan, der sich aktivieren lässt → genau dieser wird aktiv und `pick = false`. Sonst `pick = true`; gibt es einen `candidate` → aktivieren (`pick` bleibt gesetzt, damit ein danach gelesener anderer Plan übernimmt). |
| `TaskCreate` | `claude[result.task.id] = { subject, status: 'pending', plan: <aktiver Pfad> }` |
| `TaskUpdate` | Status bzw. Subject im Spiegel aktualisieren (`plan` bleibt). `deleted` entfernt den Eintrag. |
| `TodoWrite` | Alle Einträge `todo:<i>` durch `todos` ersetzen (`content` → `subject`). `plan` bleibt erhalten, wenn an derselben Stelle derselbe Text stand, sonst wird der aktive Pfad eingetragen. |

Den Spiegel pflegt der Mod immer, auch ohne aktiven Plan. Tasks, die vor dem ersten Aktivieren angelegt wurden (`plan` leer), zählen für jeden Plan.

**Aktivieren** (`path` → Änderungszeit über `$.fs.stat`, Datei lesen über `$.fs.read`, `parsePlan`): setzt `path`, `title`, `tasks`, `checks` und `mtime`. Der Spiegel bleibt unverändert, denn welche Tasks zählen, ergibt sich aus deren `plan`. „Task 1“ eines früheren Plans zählt also nicht für den neuen, und beim Zurückwechseln ist der Fortschritt wieder da. Hat der Plan keine erkennbaren Tasks oder lässt sich die Datei nicht lesen, wird nichts aktiviert und der bisherige Zustand bleibt.

Ohne Ausführungs-Skill wird nie ein Plan aktiv. Ein Plan, den Claude nur zum Nachschlagen liest oder per `writing-plans` schreibt, erscheint also nicht.

**Hinweis an Claude** (`prompt.compose`): Bei aktivem Plan wird eine Sektion mit `scope: 'session'` angehängt:

> A superpowers plan is being executed: `<path>`. Track its progress in that file: as soon as a step is done, tick its checkbox there (`- [ ]` → `- [x]`), so the plan always shows how far the work is. If you coordinate this plan (not a subagent working on a single task) and task tools are available, also keep exactly one task per plan task with the subject `Task <id>: <title>` (ids as in the plan's headings), in_progress while you work on it and completed when it is done.

Zuerst ging es hier nur um die Task-Liste. Im zweiten echten Lauf zeigte sich, dass diese Claude-Code-Version dem Modell keine Task-Tools (`TaskCreate`/`TaskUpdate`/`TodoWrite`) anbietet. Der Hinweis schickte Claude also ins Leere, und es hakte auch keine Checkboxen ab. Deshalb bittet er jetzt in erster Linie um abgehakte Checkboxen, wie superpowers es für Pläne vorsieht. Die abgehakten Pläne landen dadurch in den Commits.

Der Nebensatz zum Koordinieren steht drin, weil nicht sicher ist, ob Subagents diese Sektion auch bekommen. Sie sollen keine eigenen Plan-Tasks anlegen.

Ohne aktiven Plan läuft `next(e)` unverändert durch.

## Darstellung

Die untere Hälfte des Files-Panes, unter der Fußzeile (`selected:` / Git-Status), die zur oberen Hälfte beim Dateibaum gehört. Die Kopfzeile des Plans ist die Trennlinie. Ohne aktiven Plan fehlt der Bereich, und das Pane bleibt unverändert.

```
│── Plan 2/5 · Auth-Refactor ──│
│ ✓ 1  Setup                   │
│ ✓ 2  Datenmodell             │
│ ▶ 3  API-Endpoint            │
│ ○ 4  UI                      │
│ ○ 5  Tests                   │
```

- **Kopfzeile:** `── Plan <erledigt>/<gesamt> · <Titel> ──`, auf die Breite gekürzt und mit `─` aufgefüllt.
- **Zeilen:** Symbol, ID (rechtsbündig auf die längste ID), Titel einzeilig mit `…` gekürzt.
  - `✓` erledigt: Symbol in `ADD_COLOR`, Text gedämpft (`mutedText`)
  - `▶` in Arbeit: Symbol, ID und Titel fett in `theme.accent`
  - `○` offen: gedämpft (`mutedText`)
  - Sammelzeilen gedämpft
- **Farben:** nur Palette-Indizes und Theme-Farben, keine neuen Hex-Werte. So bleibt `bun scripts/contrast.ts` grün (Regel aus `AGENTS.md`).
- **Symbole:** immer Unicode (`✓ ▶ ○ ⋮`), unabhängig von der Glyph-Einstellung.
- **Höhe im Terminal:** die untere Hälfte, also `floor(bodyRows / 2)` Zeilen: Kopfzeile plus `floor(bodyRows / 2) - 1` Task-Zeilen. Hat der Plan weniger Tasks, bleibt der Rest leer, damit die Trennlinie in der Mitte bleibt. Diese Zeilen kommen zu `chrome` und `fixed` hinzu, sodass Baum und Split-Ansicht (Treemap/Peek) in der oberen Hälfte Platz finden müssen. Der Baum behält seine Untergrenze von 5 Zeilen: die Task-Zeilen werden auf `bodyRows - Chrome ohne Plan - 5 - 1` (Kopfzeile) gekürzt, der Bereich ist dann kleiner als die Hälfte, und passen weniger als drei (bzw. weniger als der Plan hat) hinein, entfällt der Abschnitt.
- **Desktop** (`nativeScroll`): alle Tasks ohne Fenster, am Ende der Liste.
- **Keine Interaktion:** Der Bereich enthält keine Buttons, und Fokus sowie Tastenkürzel des Panes bleiben unverändert.

## Fork, Version, Installation

- Gearbeitet wird auf der Feature-Branch `feat/plan-progress`. Der PR geht gegen `main` des Forks (`gh pr create --repo MiGrebin/claude-code-filetree --base main`), danach folgt `review-tour`.
- Die Version in `plugin.json` wird `0.5.0-plan.1`, Schema `<upstream-version>-plan.<n>`. Bei Upstream-Merges wird die Upstream-Version übernommen und `n` zurückgesetzt.
- In `marketplace.json` bleibt der Name `claude-code-filetree`, und die Plugin-ID `filetree@claude-code-filetree` bleibt gleich.
- **Installation nach dem Merge** (eigener Schritt, nicht Teil des PRs): Die Quelle des Marketplace `claude-code-filetree` in `~/.claude/settings.json` (`extraKnownMarketplaces`) und in der Marketplace-Registrierung zeigt auf `MiGrebin/claude-code-filetree`, danach `claude plugin marketplace update claude-code-filetree` und `claude plugin update filetree@claude-code-filetree`. Die Einstellungen in `/config` bleiben erhalten. Dabei kommen auch alle Upstream-Änderungen von 0.2.24 bis 0.5.0 mit.
- **Vorab ausprobieren:** `claude --plugin-dir ~/Work/claude-code-filetree` in einer Test-Session, das installierte filetree dort deaktiviert.

## Tests

`claude plugin test .` (nie `bun test`), `claude plugin validate` für beide Manifeste, `bun scripts/contrast.ts`. Der pre-commit-Hook (`core.hooksPath .githooks`) führt validate und test aus.

- **`tests/plan.test.ts`** für die reinen Funktionen:
  - `parsePlan`: `##`/`###`/`####`, `Task`/`Aufgabe`, IDs `3`/`P2`/`9R`, Trenner `:`/`–`, Nicht-Tasks (`## Task-Übersicht`, `## Aufgaben`, `#### Teil A`), Überschriften in Code-Blöcken, Titel mit deutschem und englischem Zusatz, fehlende H1
  - `matchTask`: über die ID, über den Titel, ohne Treffer, keine Teiltreffer
  - `statuses`: Rangfolge, Tasks eines anderen Plans zählen nicht, Tasks ohne Plan zählen
  - `planWindow`: alles passt, Anker in der Mitte, am Anfang und am Ende, keine Task in Arbeit, alles erledigt, Sammelzeilen mit `allDone`
- **Ablauf-Tests in `tests/surfaces.test.tsx`** (bestehendes `world`-Harness): simulierte Tool-Calls Skill → Read Plan → `TaskCreate` → `TaskUpdate`, geprüft werden der State und das gerenderte Pane. Zusätzlich:
  - Subagent-Calls ändern nichts
  - Read ohne Skill zeigt nichts
  - Plan-Wechsel: Tasks des alten Plans zählen nicht, beim Zurückwechseln ist der Fortschritt wieder da
  - `TodoWrite`
  - `prompt.compose` hängt die Sektion nur bei aktivem Plan an
  - ohne Plan bleibt das Pane unverändert
- Alle bestehenden Tests bleiben grün.

## Nicht im Umfang

- Klicks auf Tasks, Steps innerhalb einer Task
- Pläne anderer Sessions
- PR an upstream
- Feinschliff für die Desktop-App über „funktioniert und bricht nichts“ hinaus
