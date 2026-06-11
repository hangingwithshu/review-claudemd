# review-claudemd

A Claude Code skill that mines your recent conversation history to suggest improvements to your `CLAUDE.md` files **and** your project skills. It tracks what it has already reviewed with a watermark file, so each run only processes sessions that are new since the last review.

This is an extended version of [`dx:review-claudemd`](https://github.com/ykdojo/dx). The original reviews CLAUDE.md files; this version also analyzes `.claude/skills/**/SKILL.md`, filters proposed CLAUDE.md additions against quality principles before suggesting them, and remembers where it left off.

## What it does

- Reads the JSONL transcripts for the current project from `~/.claude/projects/`.
- Skips anything older than the last run, using a watermark at `~/.claude/review-claudemd-watermark`.
- Fans the transcripts out to parallel subagents to find: rules that were violated, recurring patterns worth documenting, skill steps that kept getting skipped or done differently, and instructions that look outdated.
- Filters every proposed CLAUDE.md addition against budget and relevance gates (drawn from [Kyle / HumanLayer, "Writing a good CLAUDE.md"](https://www.humanlayer.dev/blog/writing-a-good-claude-md)), so it suggests only high-signal changes and routes task-specific rules into the right skill file instead.
- Applies approved edits one at a time, then advances the watermark.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- `jq` (used to extract text turns from transcripts)
- A project with at least one conversation in `~/.claude/projects/`

## Install

Run the installer with npx (no npm account or global install needed):

```bash
npx github:hangingwithshu/review-claudemd
```

This copies `SKILL.md` into `~/.claude/skills/review-claudemd/`, where Claude Code discovers it automatically.

Or clone it yourself:

```bash
git clone https://github.com/hangingwithshu/review-claudemd.git ~/.claude/skills/review-claudemd
```

To scope the skill to a single project instead, place it in that project's `.claude/skills/` directory.

## Usage

From within a project, invoke the skill:

```
/review-claudemd
```

The first run scans all conversations in the project. Later runs only look at sessions created since the previous run. The skill presents its findings, asks which to apply, makes the edits, then updates the watermark.

## Notes

- The skill runs on Sonnet by default (set via the `model` field in `SKILL.md`). Change it to `opus` or `haiku` if you prefer.
- Marketplace-installed skills under `~/.claude/plugins/` are treated as vendor-managed and are never edited.
- Resetting the review window is as simple as deleting the watermark: `rm ~/.claude/review-claudemd-watermark`.

## Credit

Built on top of [`dx:review-claudemd`](https://github.com/ykdojo/dx) by ykdojo.

## License

MIT
