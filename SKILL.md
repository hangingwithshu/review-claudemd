---
name: review-claudemd
description: Review recent conversations to find improvements for CLAUDE.md files AND project skills. Tracks reviewed conversations via a watermark file so each run only processes new sessions.
model: sonnet
---

# Review CLAUDE.md and Skills from conversation history

Extended version of dx:review-claudemd. Analyzes project skill files (`.claude/skills/**/SKILL.md`) in addition to CLAUDE.md files, and tracks which conversations have already been reviewed via a watermark file at `~/.claude/review-claudemd-watermark`.

## Step 1: Find conversation history

The project's conversation history is in `~/.claude/projects/`. The folder name is the project path with slashes replaced by dashes.

```bash
PROJECT_PATH=$(pwd | sed 's|/|-|g' | sed 's|^-||')
CONVO_DIR=~/.claude/projects/-${PROJECT_PATH}
echo "Conversation dir: $CONVO_DIR"
ls "$CONVO_DIR"/*.jsonl | wc -l
```

## Step 2: Select conversations (watermark-aware)

Check for a watermark from the previous run. On first run (no watermark), scan ALL conversations. On subsequent runs, only process files newer than the watermark.

```bash
WATERMARK=~/.claude/review-claudemd-watermark

if [ -f "$WATERMARK" ]; then
  echo "Watermark found: $(cat $WATERMARK)"
  NEW_FILES=$(find "$CONVO_DIR" -maxdepth 1 -name "*.jsonl" -newer "$WATERMARK" 2>/dev/null | sort)
  COUNT=$(echo "$NEW_FILES" | grep -c . || echo 0)
  echo "New conversations since last review: $COUNT"
else
  echo "No watermark found — first run. Scanning ALL conversations."
  NEW_FILES=$(find "$CONVO_DIR" -maxdepth 1 -name "*.jsonl" 2>/dev/null | sort)
  COUNT=$(echo "$NEW_FILES" | grep -c . || echo 0)
  echo "Total conversations to scan: $COUNT"
fi

if [ "$COUNT" -eq 0 ]; then
  echo "No new conversations to review. Run complete."
  exit 0
fi
```

Extract to a temp directory. Only extract user text blocks (skip tool_result noise) and brief assistant context, both truncated.

```bash
SCRATCH=/tmp/claudemd-review-$(date +%s)
mkdir -p "$SCRATCH"

echo "$NEW_FILES" | while read f; do
  [ -z "$f" ] && continue
  basename=$(basename "$f" .jsonl)
  # Extract user text turns (not tool_results) + assistant text, both truncated
  cat "$f" | jq -r '
    if .type == "user" then
      (.message.content // []) |
      if type == "array" then map(select(.type == "text") | .text) | join(" ")
      elif type == "string" then .
      else "" end | .[0:400] | select(length > 5) | "U: " + .
    elif .type == "assistant" then
      ((.message.content // []) | map(select(.type == "text") | .text) | join("") | .[0:250]) |
      select(length > 5) | "A: " + .
    else empty end
  ' 2>/dev/null > "$SCRATCH/${basename}.txt"
done

echo "Conversations extracted: $(ls "$SCRATCH"/*.txt 2>/dev/null | wc -l)"
ls -lhS "$SCRATCH"/*.txt 2>/dev/null | head -20
```

## Step 2.5: Build condensed skill + CLAUDE.md reference

Read all skill files and CLAUDE.md files once here in the orchestrator. Build a single compact reference file to pass inline to subagents — this avoids each subagent independently re-reading 15+ files.

```bash
SKILL_REF="$SCRATCH/reference.txt"

# Condense CLAUDE.md files (key rules only, skip code blocks and blank lines)
echo "=== GLOBAL CLAUDE.md ===" > "$SKILL_REF"
grep -v "^\`\`\`\|^$\|^#" ~/.claude/CLAUDE.md 2>/dev/null | head -80 >> "$SKILL_REF"
echo "" >> "$SKILL_REF"
echo "=== LOCAL CLAUDE.md ===" >> "$SKILL_REF"
grep -v "^\`\`\`\|^$\|^#" ./CLAUDE.md 2>/dev/null | head -80 >> "$SKILL_REF"
echo "" >> "$SKILL_REF"

# Condense each skill to its trigger + first 25 lines of steps
echo "=== SKILLS ===" >> "$SKILL_REF"
find .claude/skills ~/.claude/skills -name "SKILL.md" -o -name "skill.md" 2>/dev/null | grep -v plugins | sort | while read sf; do
  skill_name=$(basename "$(dirname "$sf")")
  echo "--- $skill_name ---" >> "$SKILL_REF"
  grep -i "use when\|trigger\|description:" "$sf" 2>/dev/null | head -3 >> "$SKILL_REF"
  # First 20 non-blank, non-code lines of the skill body
  tail -n +5 "$sf" | grep -v "^\`\`\`\|^$" | head -20 >> "$SKILL_REF"
  echo "" >> "$SKILL_REF"
done

echo "Reference built: $(wc -c < "$SKILL_REF") bytes"
```

Marketplace skills (in `~/.claude/plugins/`) are vendor-managed — do not suggest edits to them.

## Step 3: Spin up subagents

Launch parallel subagents to analyze conversations. Files are pre-truncated so batch sizes can be larger:
- Large (>50KB): 2-3 per agent
- Medium (5-50KB): 5-8 per agent
- Small (<5KB): 10-15 per agent

Give each subagent this prompt:

```
Read ONLY these files (do not read CLAUDE.md or skill files — a condensed reference is pasted inline below):

Conversation files to analyze:
[list of batch files from $SCRATCH]

---

RULES AND SKILL REFERENCE (condensed — do not re-read the source files):
[paste full contents of $SCRATCH/reference.txt here inline]

---

Analyze the conversations against the rules and skill reference above. Find:

**For CLAUDE.md:**
1. Instructions that exist but were violated (need reinforcement or stronger wording)
2. Patterns that recurred across conversations that should be added to LOCAL CLAUDE.md (project-specific)
3. Patterns that should be added to GLOBAL CLAUDE.md (applies to all projects)
4. Anything in either CLAUDE.md that seems outdated or no longer followed

**For skills:**
5. Steps in a skill workflow that Claude kept skipping, getting wrong, or doing differently than specified
6. Patterns that emerged in conversations that would improve a specific skill — add a new step, tighten a trigger condition, handle an edge case
7. Skills that are triggered too broadly or too narrowly based on actual usage
8. Anything in a skill file that seems outdated, never triggered, or contradicted by real behavior

For each finding, be specific:
- Quote the instruction or skill step that was violated or is missing
- Cite which conversation file triggered the observation
- For skill findings, name the exact skill file path

Output bullet points only. No summaries or prose. No markdown tables — tables truncate mid-cell in this context and lose findings.
```

## Step 4: Aggregate findings

Combine results from all subagents into five sections:

**1. Instructions violated** — existing CLAUDE.md rules that weren't followed (needs stronger wording or moved to a more prominent location)

**2. Suggested additions — LOCAL CLAUDE.md** — project-specific patterns observed across conversations, not yet documented

**3. Suggested additions — GLOBAL CLAUDE.md** — patterns that apply across all projects

**4. Suggested skill updates** — for each skill, list what to change and why. Format:
- Skill: `path/to/SKILL.md`
- Change: [what to add/modify/remove]
- Why: [what conversation behavior triggered this]

**5. Potentially outdated** — items in CLAUDE.md or skill files that seem no longer relevant, never triggered, or contradicted by recent behavior

Present as tables or bullet points. Then proceed to Step 4.5 before asking the user which changes to apply.

## Step 4.5: Filter CLAUDE.md additions against quality principles

Before presenting CLAUDE.md additions to the user, evaluate EVERY proposed addition to LOCAL and GLOBAL CLAUDE.md against these principles (based on Kyle / HumanLayer, "Writing a good CLAUDE.md": https://www.humanlayer.dev/blog/writing-a-good-claude-md):

**The budget constraint**: Claude Code's system prompt already consumes ~50 of the ~150 instructions frontier models can reliably follow. Every line added to CLAUDE.md competes with every other line. Prefer fewer, higher-signal instructions.

**The relevance filter**: Claude Code injects a system reminder that CLAUDE.md "may or may not be relevant" to the current task. Claude will skip instructions it deems task-irrelevant. An instruction that only matters for one kind of task will be silently ignored during unrelated tasks.

For each proposed CLAUDE.md addition, apply these gates in order:

1. **Is it already covered?** Read both the global CLAUDE.md (`~/.claude/CLAUDE.md`) and the local CLAUDE.md (`./CLAUDE.md`) before running this check — do not rely solely on the subagent's analysis. If either file already contains the rule, the proposed addition is redundant. Route to "skip."

2. **Is it universally applicable?** Ask: would this instruction matter during EVERY type of session in this project (e.g., coding, testing, docs, research, deployment)? If it only matters for one workflow, it belongs in that workflow's SKILL.md file, not CLAUDE.md. Route to "move to skill."

3. **Is it a style/linting rule?** Rules about formatting, word counts, em dashes, and placeholder removal are better enforced by hooks, linters, or explicit skill steps — not by hoping Claude reads the instruction at the right moment. Route to "move to skill or hook."

4. **Is it WHAT/WHY/HOW content?** Project structure (WHAT), purpose (WHY), and workflow entry points (HOW) belong in CLAUDE.md. These are high-signal, always-relevant.

5. **Is it short enough to survive?** If it takes more than 2 sentences to state the rule, it probably belongs in a referenced file. Pointer > inline content.

**Output format for this step:** Add a "Verdict" column to the CLAUDE.md additions tables:
- `ADD` — passes all gates
- `SKIP` — redundant with existing rule (cite the existing rule)
- `MOVE TO [skill/file]` — task-specific; belongs elsewhere

Only present `ADD` items to the user as CLAUDE.md candidates. Present `MOVE TO` items under the relevant skill update instead.

## Step 5: Apply changes

For each approved change:
- CLAUDE.md edits: use the Edit tool on the relevant file
- Skill edits: use the Edit tool on the specific SKILL.md file

Apply one change at a time. Confirm with the user before moving to the next if the change is significant (new section, large deletion, restructuring).

A blanket "all" or "yes" response authorizes ADD-verdict changes and low-risk skill additions. It does NOT authorize: deprecation notices, section removals, rewrites of source-of-truth claims, or any change flagged under "Potentially outdated." Confirm those individually even after a blanket approval.

## Step 6: Update watermark

After analysis (regardless of whether changes were applied — the conversations have been read):

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" > ~/.claude/review-claudemd-watermark
echo "Watermark updated: $(cat ~/.claude/review-claudemd-watermark)"
```

Confirm: "Watermark updated. Next run will only process conversations newer than now."
